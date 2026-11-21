# frozen_string_literal: true

# migration_rehearsal leg of the RC battery, in-cluster half (forgejo 1267).
#
# Runs as a CronJob in env-staging (chart deploy/charts/seqtoid-rc-rehearsal), FROM THE RC IMAGE, while
# dev is pinned to an RC (cypherid-web-infra dev-pin.yaml kind rc, layered into that Argo app). Each tick:
#
#   not pinned / bad config          -> exit (the chart does not even render the CronJob then)
#   result.json terminal for this RC -> no-op
#   otherwise: reap stale clones, then in ONE run
#     1. fast-clone (copy-on-write) the env-staging Aurora cluster -> <clone prefix>-<rc>-<attempt>
#     2. add one instance, wait for it
#     3. PROVE the target is the clone (endpoint name + @@aurora_server_id), never the live cluster
#     4. run scripts/rc-battery/migration-rehearsal.sh from this image against the clone, in a child
#        process with OFFLINE=1, a throwaway Redis, and NO AWS identity (see child_env)
#     5. delete the clone (always, in ensure), write result.json for the battery to read
#
# A failed rehearsal (the script exits non-zero) is terminal: state "failed". An infrastructure error
# (AWS API, clone never became available, ...) is retried on the next tick up to MAX_ATTEMPTS, then
# recorded as "failed". A safety refusal (the target is not provably the clone) is terminal at once.
#
# Plain Ruby, run with `bundle exec ruby` (no Rails boot): the orchestrator holds the pod's IRSA role;
# the Rails child does not.
require "json"
require "open3"
require "securerandom"
require "time"
require "aws-sdk-rds"
require "aws-sdk-s3"
require "aws-sdk-ssm"
require "mysql2"

module RcBattery
  class StagingRehearsal
    SCHEMA = 1
    TERMINAL = ["succeeded", "failed"].freeze
    RC_ID = /\A[A-Za-z0-9][A-Za-z0-9._-]{0,40}\z/
    DIGEST = /\Asha256:[0-9a-f]{64}\z/
    # Every clone carries this tag; the reaper (here and in the chart) only ever deletes tagged clones
    # whose name starts with the clone prefix.
    MANAGED_TAG = "seqtoid-rc-rehearsal"
    LOG_TAIL_LINES = 200
    # Keys copied from the orchestrator's env into the Rails child. Nothing else crosses: in particular
    # no AWS_* (the IRSA web-identity token) and no chamber config.
    CHILD_PASSTHROUGH = /\A(PATH|HOME|LANG|LC_ALL|TZ|GEM_HOME|GEM_PATH|BUNDLE_[A-Z_]+|RUBY[A-Z_]*)\z/

    class InfraError < StandardError; end
    class Refused < StandardError; end

    Config = Struct.new(:rc, :image_tag, :image_digest, :source_cluster, :clone_prefix, :instance_class,
                        :bucket, :prefix, :ssm_prefix, :rails_env, :max_attempts, :wait_minutes, :redis_url,
                        :region, keyword_init: true)

    def self.config_from_env(env = ENV)
      Config.new(
        rc: env["RC_REHEARSAL_RC"].to_s, image_tag: env["RC_REHEARSAL_IMAGE_TAG"].to_s,
        image_digest: env["RC_REHEARSAL_IMAGE_DIGEST"].to_s,
        source_cluster: env["RC_REHEARSAL_SOURCE_CLUSTER"].to_s, clone_prefix: env["RC_REHEARSAL_CLONE_PREFIX"].to_s,
        instance_class: env.fetch("RC_REHEARSAL_INSTANCE_CLASS", "db.r6g.large"),
        bucket: env["RC_REHEARSAL_RESULTS_BUCKET"].to_s, prefix: env.fetch("RC_REHEARSAL_RESULTS_PREFIX", "rc-rehearsal"),
        ssm_prefix: env["RC_REHEARSAL_SSM_PREFIX"].to_s, rails_env: env.fetch("RC_REHEARSAL_RAILS_ENV", "staging"),
        max_attempts: Integer(env.fetch("RC_REHEARSAL_MAX_ATTEMPTS", "2"), 10),
        wait_minutes: Integer(env.fetch("RC_REHEARSAL_WAIT_MINUTES", "60"), 10),
        redis_url: env.fetch("RC_REHEARSAL_REDIS_URL", "redis://127.0.0.1:6379"),
        region: env.fetch("AWS_REGION", "us-west-2")
      )
    end

    # Fail before touching AWS on any config that could aim the run at the wrong thing.
    def self.validate!(cfg)
      errors = []
      errors << "RC_REHEARSAL_RC '#{cfg.rc}' is not an RC id" unless cfg.rc.match?(RC_ID)
      errors << "RC_REHEARSAL_IMAGE_DIGEST is not sha256:<64 hex>" unless cfg.image_digest.match?(DIGEST)
      [:source_cluster, :clone_prefix, :bucket, :ssm_prefix].each do |k|
        errors << "#{k} is empty" if cfg[k].to_s.strip.empty?
      end
      if cfg.clone_prefix == cfg.source_cluster || !cfg.clone_prefix.include?("rc-rehearsal")
        errors << "clone prefix '#{cfg.clone_prefix}' must contain 'rc-rehearsal' and differ from the source cluster"
      end
      errors << "max_attempts must be >= 1" if cfg.max_attempts < 1
      raise ArgumentError, errors.join("; ") unless errors.empty?

      cfg
    end

    def initialize(cfg, rds: nil, s3: nil, ssm: nil, verifier: nil, runner: nil, out: $stdout, now: -> { Time.now.utc },
                   sleeper: ->(s) { sleep(s) })
      @cfg = self.class.validate!(cfg)
      @rds = rds || Aws::RDS::Client.new(region: cfg.region)
      @s3 = s3 || Aws::S3::Client.new(region: cfg.region)
      @ssm = ssm || Aws::SSM::Client.new(region: cfg.region)
      @verifier = verifier || method(:verify_server_id)
      @runner = runner || method(:run_child)
      @out = out
      @now = now
      @sleeper = sleeper
    end

    def key
      "#{@cfg.prefix}/#{@cfg.rc}/result.json"
    end

    # Returns the state written, or :already_terminal.
    def call
      previous = read_result
      if previous && TERMINAL.include?(previous["state"]) && previous["image_digest"] == @cfg.image_digest
        log("#{@cfg.rc}: already #{previous['state']}; nothing to do")
        return :already_terminal
      end

      reap_clones
      attempt = (previous && previous["image_digest"] == @cfg.image_digest ? previous["attempt"].to_i : 0) + 1
      if attempt > @cfg.max_attempts
        return write(base_result(attempt - 1).merge("state" => "failed",
                                                    "error" => "gave up after #{attempt - 1} attempt(s): #{previous['error']}"))
      end

      rehearse(attempt)
    end

    private

    def rehearse(attempt)
      result = base_result(attempt).merge("state" => "running", "started_at" => iso)
      write(result)
      clone_id = clone_identifier(attempt)
      result["clone_cluster"] = clone_id
      begin
        source = describe_cluster(@cfg.source_cluster) || raise(InfraError, "source cluster #{@cfg.source_cluster} not found")
        create_clone(source, clone_id)
        endpoint = wait_available(clone_id)
        assert_clone_target!(endpoint, clone_id, source)
        user, password = db_credentials
        @verifier.call(endpoint, source["port"] || 3306, user, password, "#{clone_id}-0")
        status, output = @runner.call(child_env(endpoint, source["port"] || 3306, user, password))
        result["log_tail"] = tail(output, password)
        result["state"] = status ? "succeeded" : "failed"
        result["error"] = "migration-rehearsal.sh failed (see log_tail)" unless status
      rescue Refused => e
        result.merge!("state" => "failed", "error" => "refused: #{e.message}")
      rescue InfraError, Aws::Errors::ServiceError, Mysql2::Error, Timeout::Error => e
        # Retryable: leave a non-terminal state so the next tick tries again (bounded by max_attempts).
        result.merge!("state" => "pending", "error" => "#{e.class}: #{e.message}"[0, 500])
      ensure
        delete_clone(clone_id)
      end
      result["completed_at"] = iso if TERMINAL.include?(result["state"])
      write(result)
    end

    def base_result(attempt)
      { "schema" => SCHEMA, "rc" => @cfg.rc, "image_tag" => @cfg.image_tag, "image_digest" => @cfg.image_digest,
        "source_cluster" => @cfg.source_cluster, "rails_env" => @cfg.rails_env, "attempt" => attempt, }
    end

    def clone_identifier(attempt)
      # Cluster ids: letters, digits, single hyphens, <= 63 chars, start with a letter.
      slug = @cfg.rc.downcase.gsub(/[^a-z0-9]+/, "-").gsub(/\A-+|-+\z/, "")
      id = "#{@cfg.clone_prefix}-#{slug}-a#{attempt}"
      raise Refused, "clone id #{id} is longer than 63 characters" if id.length > 63

      id
    end

    def describe_cluster(id)
      @rds.describe_db_clusters(db_cluster_identifier: id).db_clusters.first&.to_h&.transform_keys(&:to_s)
    rescue Aws::RDS::Errors::DBClusterNotFoundFault
      nil
    end

    def create_clone(source, clone_id)
      tags = [{ key: MANAGED_TAG, value: "true" }, { key: "rc", value: @cfg.rc }, { key: "started-at", value: iso }]
      log("cloning #{@cfg.source_cluster} -> #{clone_id} (copy-on-write)")
      @rds.restore_db_cluster_to_point_in_time(
        source_db_cluster_identifier: @cfg.source_cluster, db_cluster_identifier: clone_id,
        restore_type: "copy-on-write", use_latest_restorable_time: true,
        db_subnet_group_name: source["db_subnet_group"],
        vpc_security_group_ids: Array(source["vpc_security_groups"]).map { |g| g[:vpc_security_group_id] || g["vpc_security_group_id"] },
        deletion_protection: false, copy_tags_to_snapshot: false, tags: tags
      )
      @rds.create_db_instance(
        db_instance_identifier: "#{clone_id}-0", db_cluster_identifier: clone_id, engine: source["engine"],
        db_instance_class: @cfg.instance_class, publicly_accessible: false, tags: tags
      )
    end

    def wait_available(clone_id)
      deadline = @now.call + (@cfg.wait_minutes * 60)
      loop do
        cluster = describe_cluster(clone_id)
        instance = @rds.describe_db_instances(db_instance_identifier: "#{clone_id}-0").db_instances.first
        if cluster && cluster["status"] == "available" && instance&.db_instance_status == "available"
          log("#{clone_id} available at #{cluster['endpoint']}")
          return cluster["endpoint"]
        end
        raise InfraError, "#{clone_id} not available after #{@cfg.wait_minutes} minutes" if @now.call >= deadline

        log("#{clone_id}: cluster #{cluster&.fetch('status', '?')}, instance #{instance&.db_instance_status || '?'}; waiting")
        @sleeper.call(30)
      end
    rescue Aws::RDS::Errors::DBInstanceNotFound
      raise InfraError, "#{clone_id}-0 disappeared while waiting"
    end

    # The one check that matters most: the host the child will connect to is the clone's own cluster
    # endpoint, and nothing about the live cluster.
    def assert_clone_target!(endpoint, clone_id, source)
      raise Refused, "clone id #{clone_id} does not start with #{@cfg.clone_prefix}-" unless clone_id.start_with?("#{@cfg.clone_prefix}-")
      raise Refused, "clone id equals the source cluster" if clone_id == @cfg.source_cluster
      raise Refused, "endpoint #{endpoint.inspect} is not #{clone_id}'s cluster endpoint" unless endpoint.to_s.start_with?("#{clone_id}.cluster-")

      live = [source["endpoint"], source["reader_endpoint"]].compact
      raise Refused, "endpoint #{endpoint} is a live endpoint of #{@cfg.source_cluster}" if live.include?(endpoint)
    end

    def db_credentials
      names = ["DB_USERNAME", "DB_PASSWORD"].map { |k| "#{@cfg.ssm_prefix}/#{k}" }
      params = @ssm.get_parameters(names: names, with_decryption: true).parameters.to_h { |p| [p.name, p.value] }
      user, password = names.map { |n| params[n] }
      raise InfraError, "missing #{names.reject { |n| params[n] }.join(', ')} in SSM" if user.to_s.empty? || password.to_s.empty?

      [user, password]
    end

    # Second, independent proof from INSIDE the database: Aurora reports the instance the session is on.
    def verify_server_id(host, port, user, password, want)
      tries = 0
      begin
        client = Mysql2::Client.new(host: host, port: port, username: user, password: password, connect_timeout: 30)
      rescue Mysql2::Error
        # A brand-new endpoint can take a few minutes to resolve.
        raise if (tries += 1) >= 6

        @sleeper.call(30)
        retry
      end
      got = client.query("SELECT @@aurora_server_id AS id").first["id"]
      raise Refused, "connected to #{got.inspect}, expected the clone instance #{want}" unless got == want
    ensure
      client&.close
    end

    # The Rails child gets the clone, a throwaway Redis (the pod's sidecar) and a region -- and NO AWS
    # credentials: OFFLINE=1 makes AwsClient stub every SDK client with fake keys, and the IRSA token
    # variables are not passed, so a data migration that reaches for S3/SQS/SFN fails instead of writing
    # to live staging. ES_ADDRESS is unset (no live OpenSearch). A fresh SECRET_KEY_BASE per run.
    def child_env(host, port, user, password)
      env = ENV.select { |k, _| k.match?(CHILD_PASSTHROUGH) }
      env.merge(
        "OFFLINE" => "1", "RAILS_ENV" => @cfg.rails_env, "ENVIRONMENT" => @cfg.rails_env,
        "SECRET_KEY_BASE" => SecureRandom.hex(64), "AWS_REGION" => @cfg.region,
        "REDISCLOUD_URL" => @cfg.redis_url,
        "RDS_ADDRESS" => host, "DB_HOST" => host, "SCREENING_DB_ADDRESS" => host, "DB_PORT" => port.to_s,
        "DB_USERNAME" => user, "DB_PASSWORD" => password
      )
    end

    def run_child(env)
      log("running scripts/rc-battery/migration-rehearsal.sh (RAILS_ENV=#{@cfg.rails_env}) against the clone")
      output = +""
      Open3.popen2e(env, "bin/entrypoint.sh", "bash", "scripts/rc-battery/migration-rehearsal.sh", unsetenv_others: true) do |_in, out, wait|
        out.each_line do |line|
          output << line
          @out.puts(line) unless line.include?(env["DB_PASSWORD"])
        end
        return [wait.value.success?, output]
      end
    end

    def tail(output, password)
      output.lines.last(LOG_TAIL_LINES).join.gsub(password, "[REDACTED]")
    end

    # Delete every tagged clone left by a dead attempt (pod killed mid-run). Only names under the prefix.
    def reap_clones
      @rds.describe_db_clusters.each_page do |page|
        page.db_clusters.each do |c|
          next unless c.db_cluster_identifier.start_with?("#{@cfg.clone_prefix}-")
          next unless Array(c.tag_list).any? { |t| t.key == MANAGED_TAG && t.value == "true" }

          log("reaping leftover clone #{c.db_cluster_identifier}")
          delete_clone(c.db_cluster_identifier)
        end
      end
    end

    def delete_clone(clone_id)
      return unless clone_id.start_with?("#{@cfg.clone_prefix}-") && clone_id != @cfg.source_cluster

      begin
        @rds.delete_db_instance(db_instance_identifier: "#{clone_id}-0", skip_final_snapshot: true)
      rescue Aws::RDS::Errors::DBInstanceNotFound, Aws::RDS::Errors::InvalidDBInstanceState
        nil
      end
      deadline = @now.call + (20 * 60)
      loop do
        @rds.describe_db_instances(db_instance_identifier: "#{clone_id}-0")
        break if @now.call >= deadline

        @sleeper.call(20)
      rescue Aws::RDS::Errors::DBInstanceNotFound
        break
      end
      @rds.delete_db_cluster(db_cluster_identifier: clone_id, skip_final_snapshot: true)
      log("deleted #{clone_id}")
    rescue Aws::RDS::Errors::DBClusterNotFoundFault
      nil
    rescue Aws::Errors::ServiceError => e
      # The reaper (next tick, and the chart's reaper CronJob) retries; never mask the rehearsal result.
      log("WARNING: could not delete #{clone_id}: #{e.class}: #{e.message}")
    end

    def read_result
      JSON.parse(@s3.get_object(bucket: @cfg.bucket, key: key).body.read)
    rescue Aws::S3::Errors::NoSuchKey
      nil
    end

    def write(result)
      @s3.put_object(bucket: @cfg.bucket, key: key, body: JSON.pretty_generate(result), content_type: "application/json")
      log("#{key}: state #{result['state']}#{result['error'] ? " (#{result['error']})" : ''}")
      result["state"]
    end

    def iso
      @now.call.utc.iso8601
    end

    def log(msg)
      @out.puts("[rc-rehearsal] #{msg}")
    end
  end
end

if $PROGRAM_NAME == __FILE__
  cfg = RcBattery::StagingRehearsal.config_from_env
  state = RcBattery::StagingRehearsal.new(cfg).call
  # A finished rehearsal is a successful tick whatever its verdict; only "pending" (retry) exits 1 so
  # the Job shows the infra error.
  exit(state == "pending" ? 1 : 0)
end
