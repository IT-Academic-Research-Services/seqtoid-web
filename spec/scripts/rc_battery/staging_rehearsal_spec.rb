# frozen_string_literal: true

require "rails_helper"
require "stringio"
require_relative "../../../scripts/rc-battery/staging_rehearsal"

RSpec.describe RcBattery::StagingRehearsal do
  let(:digest) { "sha256:#{'a' * 64}" }
  let(:cfg) do
    described_class::Config.new(
      rc: "rc-2026.11.24", image_tag: "sha-12345678", image_digest: digest,
      source_cluster: "seqtoid-staging", clone_prefix: "seqtoid-staging-rc-rehearsal", instance_class: "db.r6g.large",
      bucket: "seqtoid-staging-rc-rehearsal", prefix: "rc-rehearsal", ssm_prefix: "/seqtoid-staging-web",
      rails_env: "staging", max_attempts: 2, wait_minutes: 60, redis_url: "redis://127.0.0.1:6379", region: "us-west-2"
    )
  end
  let(:clone_id) { "seqtoid-staging-rc-rehearsal-rc-2026-11-24-a1" }
  let(:clone_endpoint) { "#{clone_id}.cluster-abc.us-west-2.rds.amazonaws.com" }
  let(:source_cluster) do
    { db_cluster_identifier: "seqtoid-staging", status: "available", engine: "aurora-mysql", port: 3306,
      endpoint: "seqtoid-staging.cluster-abc.us-west-2.rds.amazonaws.com",
      reader_endpoint: "seqtoid-staging.cluster-ro-abc.us-west-2.rds.amazonaws.com",
      db_subnet_group: "seqtoid-staging-aurora", vpc_security_groups: [{ vpc_security_group_id: "sg-1", status: "active" }], }
  end
  let(:clone_endpoint_for_cluster) { clone_endpoint }
  let(:written) { [] }
  let(:existing_result) { nil }
  let(:s3) do
    Aws::S3::Client.new(stub_responses: true).tap do |c|
      c.stub_responses(:get_object, lambda { |_ctx|
        existing_result ? { body: JSON.generate(existing_result) } : "NoSuchKey"
      })
      c.stub_responses(:put_object, lambda { |ctx|
        written << JSON.parse(ctx.params[:body])
        {}
      })
    end
  end
  let(:instance_gone) { false }
  let(:rds) do
    Aws::RDS::Client.new(stub_responses: true).tap do |c|
      c.stub_responses(:describe_db_clusters, lambda { |ctx|
        id = ctx.params[:db_cluster_identifier]
        if id.nil?
          { db_clusters: [] }
        elsif id == "seqtoid-staging"
          { db_clusters: [source_cluster] }
        else
          { db_clusters: [{ db_cluster_identifier: id, status: "available", endpoint: clone_endpoint_for_cluster }] }
        end
      })
      # The clone instance exists until delete_db_instance is called.
      c.stub_responses(:describe_db_instances, lambda { |ctx|
        if @instance_deleted
          "DBInstanceNotFound"
        else
          { db_instances: [{ db_instance_identifier: ctx.params[:db_instance_identifier], db_instance_status: "available" }] }
        end
      })
      c.stub_responses(:delete_db_instance, lambda { |_ctx|
        @instance_deleted = true
        {}
      })
    end
  end
  let(:ssm) do
    Aws::SSM::Client.new(stub_responses: true).tap do |c|
      c.stub_responses(:get_parameters, parameters: [
                         { name: "/seqtoid-staging-web/DB_USERNAME", value: "app" },
                         { name: "/seqtoid-staging-web/DB_PASSWORD", value: "s3cret-pw" },
                       ])
    end
  end
  let(:verified) { [] }
  let(:verifier) { ->(*args) { verified << args } }
  let(:child_envs) { [] }
  let(:runner_result) { [true, "line one\npassword s3cret-pw here\nmigration rehearsal passed\n"] }
  let(:runner) do
    lambda { |env|
      child_envs << env
      runner_result
    }
  end
  let(:out) { StringIO.new }

  def build(config = cfg)
    described_class.new(config, rds: rds, s3: s3, ssm: ssm, verifier: verifier, runner: runner, out: out,
                                now: -> { Time.utc(2026, 11, 24, 18) }, sleeper: ->(_s) {})
  end

  def calls(name)
    rds.api_requests.select { |r| r[:operation_name] == name }
  end

  describe ".validate!" do
    it "rejects a clone prefix equal to the source cluster" do
      cfg.clone_prefix = "seqtoid-staging"
      expect { described_class.validate!(cfg) }.to raise_error(ArgumentError, /rc-rehearsal/)
    end

    it "rejects a non-digest image and a bad RC id" do
      cfg.image_digest = "sha-12345678"
      cfg.rc = "rc 1; rm -rf"
      expect { described_class.validate!(cfg) }.to raise_error(ArgumentError, /not an RC id.*sha256/)
    end
  end

  context "when the RC already has a terminal result for this digest" do
    let(:existing_result) { { "state" => "succeeded", "image_digest" => digest, "attempt" => 1 } }

    it "does nothing" do
      expect(build.call).to eq(:already_terminal)
      expect(rds.api_requests).to be_empty
      expect(written).to be_empty
    end
  end

  context "on a clean run" do
    it "clones copy-on-write, proves the target, runs the child without AWS identity, deletes the clone" do
      expect(build.call).to eq("succeeded")

      restore = calls(:restore_db_cluster_to_point_in_time).first[:params]
      expect(restore).to include(source_db_cluster_identifier: "seqtoid-staging", db_cluster_identifier: clone_id,
                                 restore_type: "copy-on-write", db_subnet_group_name: "seqtoid-staging-aurora",
                                 vpc_security_group_ids: ["sg-1"], deletion_protection: false)
      expect(restore[:tags]).to include({ key: "seqtoid-rc-rehearsal", value: "true" })
      expect(calls(:create_db_instance).first[:params]).to include(db_instance_identifier: "#{clone_id}-0",
                                                                   db_cluster_identifier: clone_id)
      expect(verified.first).to eq([clone_endpoint, 3306, "app", "s3cret-pw", "#{clone_id}-0"])

      env = child_envs.first
      expect(env.keys.grep(/\AAWS_(?!REGION\z)/)).to be_empty
      expect(env).to include("OFFLINE" => "1", "RAILS_ENV" => "staging", "RDS_ADDRESS" => clone_endpoint,
                             "SCREENING_DB_ADDRESS" => clone_endpoint, "REDISCLOUD_URL" => "redis://127.0.0.1:6379")

      expect(calls(:delete_db_cluster).map { |r| r[:params][:db_cluster_identifier] }).to eq([clone_id])
      final = written.last
      expect(final).to include("state" => "succeeded", "rc" => "rc-2026.11.24", "image_digest" => digest, "attempt" => 1,
                               "clone_cluster" => clone_id)
      expect(final["log_tail"]).to include("[REDACTED]")
      expect(final["log_tail"]).not_to include("s3cret-pw")
      expect(written.first["state"]).to eq("running")
    end

    context "when the rehearsal script fails" do
      let(:runner_result) { [false, "MIGRATION REHEARSAL FAILED\n"] }

      it "records a terminal failure and still deletes the clone" do
        expect(build.call).to eq("failed")
        expect(written.last["error"]).to match(/migration-rehearsal.sh failed/)
        expect(calls(:delete_db_cluster)).not_to be_empty
      end
    end

    context "when the clone's endpoint is not provably the clone" do
      let(:clone_endpoint_for_cluster) { source_cluster[:endpoint] }

      it "refuses before touching the database" do
        expect(build.call).to eq("failed")
        expect(written.last["error"]).to match(/refused/)
        expect(verified).to be_empty
        expect(child_envs).to be_empty
        expect(calls(:delete_db_cluster)).not_to be_empty
      end
    end
  end

  context "on an infrastructure error" do
    before do
      rds.stub_responses(:restore_db_cluster_to_point_in_time, "InsufficientDBClusterCapacityFault")
    end

    it "leaves a retryable pending state" do
      expect(build.call).to eq("pending")
      expect(written.last).to include("state" => "pending", "attempt" => 1)
      expect(child_envs).to be_empty
    end

    context "after the last attempt" do
      let(:existing_result) { { "state" => "pending", "image_digest" => digest, "attempt" => 2, "error" => "boom" } }

      it "gives up with a terminal failure" do
        expect(build.call).to eq("failed")
        expect(written.last["error"]).to match(/gave up after 2 attempt\(s\): boom/)
        expect(calls(:restore_db_cluster_to_point_in_time)).to be_empty
      end
    end
  end

  describe "reaping" do
    before do
      rds.stub_responses(:describe_db_clusters, lambda { |ctx|
        if ctx.params[:db_cluster_identifier].nil?
          { db_clusters: [
            { db_cluster_identifier: "seqtoid-staging", tag_list: [{ key: "seqtoid-rc-rehearsal", value: "true" }] },
            { db_cluster_identifier: "seqtoid-staging-rc-rehearsal-old-a1", tag_list: [{ key: "seqtoid-rc-rehearsal", value: "true" }] },
            { db_cluster_identifier: "seqtoid-staging-rc-rehearsal-untagged", tag_list: [] },
          ] }
        else
          "DBClusterNotFoundFault"
        end
      })
    end

    it "deletes only tagged clones under the prefix, never the source" do
      build.call
      deleted = calls(:delete_db_cluster).map { |r| r[:params][:db_cluster_identifier] }
      expect(deleted).to include("seqtoid-staging-rc-rehearsal-old-a1")
      expect(deleted).not_to include("seqtoid-staging", "seqtoid-staging-rc-rehearsal-untagged")
    end
  end
end
