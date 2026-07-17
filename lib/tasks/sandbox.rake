# Per-PR preview sandbox provisioning (#616).
#
# These tasks run ONLY inside a preview sandbox's provision/teardown Jobs (the chart's
# preview-*-job.yaml), as the elevated seqtoid-web-provisioner IRSA role, wrapped in
# `chamber exec idseq-<env>-web` so they hold the shared config + the MASTER DB creds.
# They are NEVER run by app pods (those hold only the scoped seqtoid-web-preview role).
#
# provision: create an isolated schema + a per-PR DB user scoped to that schema, then
#   seed the sandbox's own SSM path (a copy of the shared dev config with the DB
#   connection overridden to the scoped user + schema). The pod then boots against its
#   OWN creds + schema; even holding those creds it cannot reach idseq_dev.
# teardown: drop the schema + user and delete the SSM path when the PR closes.
#
# Hard guards: SANDBOX_PR_NUMBER must be a positive integer; the schema/user names are
# built ONLY from it (never free-form), so these tasks can only ever touch idseq_pr_<N>
# / sbx_pr_<N> -- never idseq_dev or any other schema.
require "English" # $CHILD_STATUS -- the shell-out exit codes below are load-bearing guards
namespace :sandbox do
  def sandbox_pr_number!
    raw = ENV["SANDBOX_PR_NUMBER"].to_s
    raise "SANDBOX_PR_NUMBER must be a positive integer (got #{raw.inspect})" unless raw.match?(/\A[1-9][0-9]*\z/)
    raw
  end

  def sandbox_names(pr)
    { schema: "idseq_pr_#{pr}", user: "sbx_pr_#{pr}", ssm: "idseq-sandbox-pr-#{pr}-web" }
  end

  # Raw admin connection from the chamber-injected master creds (NOT the Rails pool,
  # which points at a specific schema). Used only to run DDL / user management.
  def admin_client
    require "mysql2"
    Mysql2::Client.new(
      host:     ENV.fetch("RDS_ADDRESS"),
      port:     (ENV["DB_PORT"] || 3306).to_i,
      username: ENV.fetch("DB_USERNAME"),
      password: ENV.fetch("DB_PASSWORD")
    )
  end

  def sh!(cmd)
    puts "+ #{cmd.gsub(/(db_password|IDENTIFIED BY)\s+\S+/i, '\1 [redacted]')}"
    raise "command failed: #{cmd}" unless system(cmd)
  end

  # Resolve ONE env var exactly the way the app will see it (chamber exec injects the config
  # as env vars). Read one at a time: `printenv A B C` silently omits a missing var, which
  # shifts every later value up a slot and makes a multi-var read misreport what resolved.
  def chamber_env(service, var)
    `chamber exec #{service} -- printenv #{var} 2>/dev/null`.strip
  end

  # Every param name under a chamber service's SSM path (raw API -- see the case notes in
  # :provision for why chamber's own write/delete cannot address these by name).
  #
  # FAILS LOUDLY on purpose. This swallowed stderr and returned [] on error, which made both
  # callers no-op SILENTLY: the duplicate sweep deleted nothing and the isolation assert passed
  # VACUOUSLY (no names -> no duplicates found -> "verified"), so a provision exited 0 while
  # leaving the sandbox pointed at the dev master. The provisioner role was missing
  # ssm:GetParametersByPath, so this failed on EVERY run and nothing ever said so. A check that
  # cannot fail is not a check. A chamber service path is never legitimately empty, so an empty
  # result is an error too, not an answer.
  # Delete SSM params by full name, in API-limit batches. Also fails loudly: this used to send both
  # stdout and stderr to /dev/null and ignore the exit status, so an IAM denial looked exactly like a
  # successful delete -- which is how :teardown reported "deleted N params" while deleting none.
  def ssm_delete_params!(names)
    names.each_slice(10) do |batch|
      out = IO.popen(["aws", "ssm", "delete-parameters", "--names", *batch], err: [:child, :out], &:read)
      raise "aws ssm delete-parameters failed (exit #{$CHILD_STATUS.exitstatus}): #{out.strip}" unless $CHILD_STATUS.success?
    end
  end

  # NOTE THE TRAILING SLASH on --path, it is load-bearing. GetParametersByPath authorises against the
  # PATH itself, not its children: `--path /idseq-sandbox-pr-23-web` is checked against the resource
  # `parameter/idseq-sandbox-pr-23-web`, which the provisioner policy does NOT match (it grants
  # `parameter/idseq-sandbox-pr-*-web/*`, i.e. the children). `--path /idseq-sandbox-pr-23-web/` is
  # checked against `parameter/idseq-sandbox-pr-23-web/`, which DOES match `/*`. This is also why
  # `chamber export` from dev works while a bare-path CLI call gets AccessDenied -- chamber queries
  # with the slash. Verified against the live role 2026-07-16.
  def ssm_param_names(service)
    out = `aws ssm get-parameters-by-path --path /#{service}/ --recursive --query 'Parameters[].Name' --output text 2>&1`
    raise "aws ssm get-parameters-by-path failed for /#{service} (exit #{$CHILD_STATUS.exitstatus}): #{out.strip}" unless $CHILD_STATUS.success?

    names = out.split
    raise "aws ssm get-parameters-by-path returned NO params for /#{service}; refusing to treat that as 'nothing to do'" if names.empty?

    names
  end

  desc "Provision a per-PR sandbox: isolated schema + scoped user + its own SSM path"
  task :provision do
    require "securerandom"
    pr = sandbox_pr_number!
    n = sandbox_names(pr)
    env = ENV.fetch("ENVIRONMENT", "dev")
    src_service = ENV["SANDBOX_SRC_CHAMBER_SERVICE"] || "idseq-#{env}-web"
    # REQUIRED, with no fallback, deliberately. This used to default to `seqtoid-sandbox` -- which
    # sounds like a throwaway and is not: it is a hand-created, un-terraformed bucket holding
    # ~4.8 TB of the team's research data (validation sets, time trials, taxid indexes, personal
    # prefixes), backup status unknown. Every sandbox was uploading into it, and the preview role
    # granted DeleteObject across the whole thing, with prefix isolation resting only on this
    # value. A default that silently points at that bucket is how that happened, so there is no
    # default now: an unset bucket fails the provision loudly instead of quietly polluting
    # research data. Set it to the terraformed preview bucket (infra: terraform output
    # preview_samples_bucket) via the chart's preview.samplesBucket.
    sandbox_bucket = ENV["SANDBOX_SAMPLES_BUCKET"].to_s
    if sandbox_bucket.empty?
      abort("[sandbox:provision] FATAL: SANDBOX_SAMPLES_BUCKET is not set. Refusing to guess a " \
            "samples bucket -- the historical default (seqtoid-sandbox) is the team's research " \
            "data, not a sandbox. Set chart value preview.samplesBucket to the terraformed " \
            "preview bucket. See platform-overhaul #697.")
    end
    if sandbox_bucket == "seqtoid-sandbox"
      abort("[sandbox:provision] FATAL: SANDBOX_SAMPLES_BUCKET is 'seqtoid-sandbox', which holds " \
            "the team's research data (~4.8 TB: validation sets, time trials, taxid indexes). " \
            "Sandboxes must not write there. Use the dedicated preview bucket. See #697.")
    end

    puts "[sandbox:provision] pr=#{pr} schema=#{n[:schema]} user=#{n[:user]} ssm=#{n[:ssm]}"

    # REUSE the sandbox's existing password when one is already stored, and only mint a new one
    # on a genuinely fresh sandbox. Argo recreates this hook on every sync, so two provision Jobs
    # can overlap; if each minted its own password they would race (A: ALTER USER pw_a -> B: ALTER
    # USER pw_b -> A writes pw_a to SSM) and leave SSM disagreeing with the DB, which the app can
    # only report as "Access denied". Reusing makes a re-provision idempotent and the overlap benign.
    existing_pw = `aws ssm get-parameter --name /#{n[:ssm]}/DB_PASSWORD --with-decryption --query Parameter.Value --output text 2>/dev/null`.strip
    password = existing_pw.empty? || existing_pw == "None" ? SecureRandom.hex(24) : existing_pw

    # 1) Schema + scoped user. Idempotent; ALTER USER keeps the password current on a
    #    re-provision (a PR re-sync). GRANT is scoped to THIS schema only -- the user
    #    physically cannot touch idseq_dev.
    c = admin_client
    c.query("CREATE DATABASE IF NOT EXISTS `#{n[:schema]}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
    c.query("CREATE USER IF NOT EXISTS '#{n[:user]}'@'%' IDENTIFIED BY '#{c.escape(password)}'")
    c.query("ALTER USER '#{n[:user]}'@'%' IDENTIFIED BY '#{c.escape(password)}'")
    c.query("GRANT ALL PRIVILEGES ON `#{n[:schema]}`.* TO '#{n[:user]}'@'%'")
    c.query("FLUSH PRIVILEGES")
    c.close

    # 2) Seed the sandbox SSM path = a copy of the shared config, then override the DB
    #    connection to the scoped user + schema (rds_address stays the shared Aurora).
    #    chamber uses the provisioner role: it can read src_service + write the sandbox path.
    # KEY CASE IS THE WHOLE BALLGAME HERE (#697). The three chamber verbs disagree about case:
    #   - `chamber import` copies keys VERBATIM        -> dev's /DB_USERNAME (= idseqmaster) lands as-is
    #   - `chamber write`  LOWERCASES the key          -> `write DB_USERNAME x` stores /db_username
    #   - `chamber exec`   UPPERCASES keys for env     -> /DB_USERNAME and /db_username BOTH become $DB_USERNAME
    # So overriding the import with `chamber write` did not override anything: it created a SECOND,
    # distinct param, and exec then picked between the two NON-DETERMINISTICALLY. A sandbox would
    # sometimes come up as the dev MASTER user against the shared dev Aurora, and sometimes not, from
    # byte-identical inputs. `chamber delete <svc> db_username` lowercases too, so it can never remove
    # the imported UPPERCASE key -- which is why re-ordering the deletes made no difference.
    #
    # Fix at the mechanism: normalise the exported config to ONE case and apply the overrides BEFORE
    # importing, so no key can ever collide with another spelling of itself. No `chamber write` here --
    # its lowercasing is what created the duplicate in the first place. Proven against the live dev
    # config 2026-07-16 (IT-ARS #23 e2e): dev carries 34 uppercase + 2 lowercase keys.
    require "json"
    require "tempfile"
    Tempfile.create(["dev-config", ".json"]) do |f|
      sh!("chamber export --format json #{src_service} > #{f.path}")
      config = JSON.parse(File.read(f.path))
      scoped = config.each_with_object({}) { |(k, v), h| h[k.upcase] = v }
      scoped["DB_USERNAME"] = n[:user]
      scoped["DB_PASSWORD"] = password
      scoped["DB_NAME"] = n[:schema]
      scoped["SAMPLES_BUCKET_NAME"] = sandbox_bucket
      scoped["SAMPLES_BUCKET_NAME_V1"] = sandbox_bucket
      # The sandbox serves on its OWN host, so it needs its OWN SERVER_DOMAIN; importing dev's
      # pointed all three consumers at dev. Most visibly it made the sandbox return 403 "Blocked
      # hosts" on every page: config/environments/development.rb allowlists ENV["SERVER_DOMAIN"],
      # and application.rb's `.seqtoid.org` entry does NOT cover us -- Rails 7.2 compiles a leading
      # dot with SUBDOMAIN_REGEX = /(?:[a-z0-9-]+\.)/ and a `?`, i.e. AT MOST ONE label, so it
      # allows dev.seqtoid.org but not pr-23.dev.seqtoid.org (two labels). Setting this exact host
      # is tighter than widening the allowlist to a wildcard, and also fixes rack_cors and the
      # bulk-download callback URLs (app/models/bulk_download.rb), which both read SERVER_DOMAIN and
      # were sending sandbox traffic to dev. Host must match the appset's ingress.host
      # (pr-<N>.dev.seqtoid.org); override via SANDBOX_SERVER_DOMAIN if that ever changes.
      scoped["SERVER_DOMAIN"] = ENV["SANDBOX_SERVER_DOMAIN"] || "https://pr-#{pr}.dev.seqtoid.org"
      File.write(f.path, JSON.pretty_generate(scoped))
      # Import (not write) so the scoped values land under the SAME uppercase keys the app reads, and
      # overwrite the imported dev values in place rather than racing them. Doing this in one import
      # also means the path never has a window with the config half-missing, so an overlapping Job or
      # a pod booting mid-provision sees a consistent (if briefly older) config, never a broken one.
      sh!("chamber import #{n[:ssm]} #{f.path}")
    end

    # Sweep any lower-case leftovers from provisions that ran the old `chamber write` path. They are
    # invisible to chamber (it would lowercase the name and match the wrong key), so enumerate and
    # delete them through the raw SSM API. Any key that is not already canonical uppercase is a
    # duplicate spelling of one we just imported and can only cause an exec collision.
    stale = ssm_param_names(n[:ssm]).reject { |name| name.split("/").last == name.split("/").last.upcase }
    ssm_delete_params!(stale)
    puts "[sandbox:provision] removed #{stale.size} lower-case duplicate param(s)"

    # Assert isolation held BEFORE the pod is allowed to boot, resolving each value exactly as the app
    # will (chamber exec). Verify every scoped credential, not just the username: a sandbox missing
    # DB_PASSWORD/DB_NAME falls back toward the dev master creds, which is the failure this exists to
    # prevent. Also assert the collision itself is gone -- with duplicate spellings present these
    # checks are a COIN FLIP that passes ~half the time and certifies nothing.
    # POLL, do not snapshot. GetParametersByPath is eventually consistent: immediately after the
    # deletes above it still lists the names it just removed, so asserting on a single read failed the
    # Job with a FATAL naming keys that were already gone. Wait for the listing to actually converge,
    # and only then decide. Still fails closed -- if the duplicates are real they never clear and we
    # abort with the same message, just after the window instead of before it.
    deadline = Time.now + 120
    dupes = {}
    loop do
      dupes = ssm_param_names(n[:ssm]).map { |name| name.split("/").last }.group_by(&:upcase).select { |_, v| v.size > 1 }
      break if dupes.empty? || Time.now > deadline

      sleep 5
    end
    unless dupes.empty?
      abort("[sandbox:provision] FATAL: #{n[:ssm]} still has case-duplicate keys #{dupes.values.flatten.sort.inspect} " \
            "after waiting for the SSM listing to converge. chamber exec would pick between them " \
            "non-deterministically. See platform-overhaul #697.")
    end
    resolved_user = chamber_env(n[:ssm], "DB_USERNAME")
    resolved_name = chamber_env(n[:ssm], "DB_NAME")
    if resolved_user != n[:user]
      abort("[sandbox:provision] FATAL: DB_USERNAME resolved to '#{resolved_user}', expected '#{n[:user]}'. " \
            "Refusing to provision a sandbox that is not DB-isolated. See platform-overhaul #697.")
    end
    if chamber_env(n[:ssm], "DB_PASSWORD").blank?
      abort("[sandbox:provision] FATAL: DB_PASSWORD did not resolve for #{n[:ssm]}. The pod would fall back " \
            "to the dev MASTER creds. Refusing to provision. See platform-overhaul #697.")
    end
    if resolved_name != n[:schema]
      abort("[sandbox:provision] FATAL: DB_NAME resolved to '#{resolved_name}', expected '#{n[:schema]}'. " \
            "Refusing to provision a sandbox that would target the wrong schema. See platform-overhaul #697.")
    end

    puts "[sandbox:provision] done -- pod may now boot with CHAMBER_SERVICE=#{n[:ssm]} DB_NAME=#{n[:schema]}"
  end

  # Copy the source env's user rows into the sandbox schema.
  #
  # WHY THIS EXISTS: a sandbox gets its OWN empty schema (that isolation is the point, #697), and
  # db/seeds.rb creates ZERO users. Auth0 authenticates fine, then `User.find_by(email:)`
  # (app/helpers/auth0_helper.rb) finds nothing in idseq_pr_<N> and the callback renders "Your
  # account does not exist on this server". So NOBODY could ever log into a sandbox -- it served
  # pages and nothing else. There is no create-on-miss path in the callback, and the
  # AUTO_ACCOUNT_CREATION_V1 AppConfig does not help (it gates a logged-OUT registration mutation,
  # which would also 409 against a user who already exists in the Auth0 tenant).
  #
  # Auth0 already holds the identity; the sandbox only needs a matching local row. Copying dev's
  # users means anyone who can log into dev can log into any sandbox, with no list to maintain.
  # This copies USER ROWS ONLY -- never samples, projects or any other data.
  #
  # MUST run AFTER the migrate hook (the users table does not exist until then) and as the
  # PROVISIONER (the scoped sbx_pr_<N> user has no grant on idseq_dev and cannot read it). Hence
  # its own PreSync hook at a sync-wave after migrate, not part of provision.
  desc "Copy the source env's user rows into the sandbox schema so devs can actually log in"
  task :seed_users do
    pr = sandbox_pr_number!
    n = sandbox_names(pr)
    env = ENV.fetch("ENVIRONMENT", "dev")
    src_schema = ENV["SANDBOX_SRC_SCHEMA"] || "idseq_#{env}"

    # The sandbox name is built only from a validated integer, but assert anyway: copying a schema
    # onto itself, or ever treating the shared schema as a destination, must be impossible.
    raise "refusing to seed users: source #{src_schema} == destination #{n[:schema]}" if src_schema == n[:schema]

    c = admin_client

    # Idempotent: Argo re-runs this hook on every sync. Only seed a schema that has no users yet,
    # so a re-sync never duplicates rows or clobbers state a reviewer created by hand.
    existing = c.query("SELECT COUNT(*) AS n FROM `#{n[:schema]}`.users").first["n"].to_i
    if existing.positive?
      puts "[sandbox:seed_users] #{n[:schema]}.users already has #{existing} row(s) -- skipping"
      c.close
      next
    end

    # Copy the INTERSECTION of columns, never `SELECT *`. A PR branch is free to add or drop a
    # users column (that is half the point of a preview sandbox), and the sandbox schema is
    # migrated to the PR's schema while dev is not -- so the column lists legitimately differ and
    # `SELECT *` would fail or silently mis-map.
    cols = c.query(<<~SQL).map { |r| r["COLUMN_NAME"] }
      SELECT s.COLUMN_NAME
      FROM information_schema.COLUMNS s
      JOIN information_schema.COLUMNS d
        ON d.COLUMN_NAME = s.COLUMN_NAME AND d.TABLE_NAME = 'users' AND d.TABLE_SCHEMA = '#{n[:schema]}'
      WHERE s.TABLE_NAME = 'users' AND s.TABLE_SCHEMA = '#{src_schema}'
    SQL
    raise "refusing to seed users: no common columns between #{src_schema}.users and #{n[:schema]}.users" if cols.empty?

    quoted = cols.map { |col| "`#{col}`" }.join(", ")
    c.query("INSERT INTO `#{n[:schema]}`.users (#{quoted}) SELECT #{quoted} FROM `#{src_schema}`.users")
    copied = c.query("SELECT COUNT(*) AS n FROM `#{n[:schema]}`.users").first["n"].to_i
    c.close

    puts "[sandbox:seed_users] copied #{copied} user row(s) from #{src_schema} into #{n[:schema]} (#{cols.size} columns)"
    puts "[sandbox:seed_users] NOTE: these rows are PII and are dropped with the schema on teardown; " \
         "`rake sandbox:reap_orphans` is the backstop if teardown never runs."
  end

  desc "Tear down a per-PR sandbox: drop the schema + user and delete its SSM path"
  task :teardown do
    pr = sandbox_pr_number!
    n = sandbox_names(pr)

    puts "[sandbox:teardown] pr=#{pr} dropping schema=#{n[:schema]} user=#{n[:user]} ssm=#{n[:ssm]}"

    c = admin_client
    c.query("DROP DATABASE IF EXISTS `#{n[:schema]}`")
    c.query("DROP USER IF EXISTS '#{n[:user]}'@'%'")
    c.query("FLUSH PRIVILEGES")
    c.close

    # Delete every param under the sandbox SSM path. Enumerate + delete via the aws CLI (the chamber
    # service `X` maps to SSM path `/X/`); this is more robust than parsing `chamber list` output.
    # Both calls now raise on failure -- they previously discarded stderr AND the exit status, so the
    # missing ssm:GetParametersByPath grant made this print "deleted 0 SSM params" and orphan every
    # sandbox's config forever, with no error anywhere. Tolerate ONLY the already-empty case.
    ssm_path = "/#{n[:ssm]}"
    names = begin
      ssm_param_names(n[:ssm])
    rescue RuntimeError => e
      raise unless e.message.include?("returned NO params")

      [] # genuinely already torn down
    end
    ssm_delete_params!(names)
    puts "[sandbox:teardown] deleted #{names.size} SSM params under #{ssm_path}"

    puts "[sandbox:teardown] done"
  end

  # THE BACKSTOP. Reconcile every sandbox that physically exists against the PRs that are actually
  # open, and tear down anything left over.
  #
  # WHY THIS IS NOT OPTIONAL: sandbox teardown is BEST-EFFORT and has three known ways to never
  # run, each of which strands a schema full of copied user PII (see sandbox:seed_users):
  #   (a) the teardown Job renders from the PR head SHA, and the gitops flow closes PRs with
  #       --delete-branch -- once that commit is unreachable the PostDelete hook cannot render;
  #   (b) the teardown Job pulls seqtoid-web-preview:sha-<head8>, but that ECR repo expires all but
  #       the 30 most recent tags, so a long-lived PR cannot pull its own teardown image;
  #   (c) any failed teardown Job wedges deletion behind the Argo finalizer forever.
  # In all three the only signal is an Application stuck Terminating. This system has already lost
  # cleanup twice (leaked ~40 SSM params; orphaned namespaces). A hook that usually runs is not a
  # retention guarantee, and "usually" is not good enough for PII.
  #
  # This task depends on NONE of that machinery: it lists what exists, asks GitHub what is open,
  # and reaps the difference. Run it on a schedule from a STABLE image (never a per-PR tag, which
  # is failure mode (b) all over again).
  #
  # FAILS CLOSED: if the open-PR list cannot be fetched, it reaps NOTHING rather than guessing --
  # a bad PR list would drop the schema of a live sandbox someone is using.
  desc "Reap sandbox schemas/users/SSM paths whose PR is no longer open (backstop for teardown)"
  task :reap_orphans do
    require "json"
    require "net/http"

    repo = ENV["SANDBOX_GITHUB_REPO"] || "IT-Academic-Research-Services/seqtoid-web"
    token = ENV["GITHUB_TOKEN"].to_s
    dry_run = ENV["SANDBOX_REAP_DRY_RUN"] == "1"
    raise "GITHUB_TOKEN is required: refusing to reap without an authoritative open-PR list" if token.empty?

    # Every open PR number, paginated. Any failure raises -- see FAILS CLOSED above.
    open_prs = []
    page = 1
    loop do
      uri = URI("https://api.github.com/repos/#{repo}/pulls?state=open&per_page=100&page=#{page}")
      req = Net::HTTP::Get.new(uri)
      req["Authorization"] = "Bearer #{token}"
      req["Accept"] = "application/vnd.github+json"
      res = Net::HTTP.start(uri.hostname, uri.port, use_ssl: true) { |http| http.request(req) }
      raise "GitHub API #{res.code} listing open PRs for #{repo}: #{res.body.to_s[0, 200]}" unless res.is_a?(Net::HTTPSuccess)

      batch = JSON.parse(res.body)
      break if batch.empty?

      open_prs.concat(batch.map { |pr| pr["number"].to_i })
      page += 1
    end
    puts "[sandbox:reap_orphans] #{repo}: #{open_prs.size} open PR(s)"

    # What actually exists, from the two systems that hold state.
    c = admin_client
    schema_names = c.query("SHOW DATABASES").map { |r| r.values.first }
    c.close
    live_schemas = schema_names.filter_map do |db|
      Regexp.last_match(1).to_i if db =~ /\Aidseq_pr_([1-9][0-9]*)\z/
    end

    # Raise on a failed enumeration rather than reading an error message as "no sandboxes".
    # Swallowing stderr here would mean an IAM denial silently reported an empty SSM list, the
    # reaper would skip every orphaned config path, and it would still exit 0 -- the exact
    # fail-open shape that let broken sandboxes report success for a day (see ssm_param_names).
    ssm_out = `aws ssm describe-parameters --query 'Parameters[].Name' --output text 2>&1`
    raise "aws ssm describe-parameters failed (exit #{$CHILD_STATUS.exitstatus}): #{ssm_out.strip}" unless $CHILD_STATUS.success?

    ssm_prs = ssm_out.split.filter_map do |nm|
      Regexp.last_match(1).to_i if nm =~ %r{\A/idseq-sandbox-pr-([1-9][0-9]*)-web/}
    end
    ssm_prs = ssm_prs.uniq

    orphans = (live_schemas | ssm_prs).reject { |pr| open_prs.include?(pr) }.sort
    puts "[sandbox:reap_orphans] schemas=#{live_schemas.sort.inspect} ssm=#{ssm_prs.sort.inspect} " \
         "-> orphans=#{orphans.inspect}#{dry_run ? ' (DRY RUN)' : ''}"

    if orphans.empty?
      puts "[sandbox:reap_orphans] nothing to reap"
      next
    end

    # Reap each orphan through the SAME teardown task, so there is exactly one implementation of
    # "destroy a sandbox" and the backstop cannot drift from the real path. Keep going on failure
    # so one wedged sandbox cannot block the rest, then fail loudly at the end.
    failed = []
    orphans.each do |pr|
      if dry_run
        puts "[sandbox:reap_orphans] would tear down pr=#{pr}"
        next
      end
      puts "[sandbox:reap_orphans] tearing down orphaned pr=#{pr}"
      begin
        ENV["SANDBOX_PR_NUMBER"] = pr.to_s
        Rake::Task["sandbox:teardown"].reenable
        Rake::Task["sandbox:teardown"].invoke
      rescue StandardError => e
        warn "[sandbox:reap_orphans] FAILED to tear down pr=#{pr}: #{e.message}"
        failed << pr
      end
    end
    raise "[sandbox:reap_orphans] #{failed.size} sandbox(es) failed to reap: #{failed.inspect}" unless failed.empty?

    puts "[sandbox:reap_orphans] reaped #{orphans.size} orphaned sandbox(es)"
  end

  # Idempotent seed for the sandbox migrate hook. db:seed (db/seeds.rb) uses
  # AppConfig.create, which raises on a schema that already has these rows -- so it fails
  # on ANY re-sync of a sandbox (a PR push re-runs the migrate hook against the existing
  # schema). Guard it: only run db:seed on a truly fresh schema (no app_configs yet).
  # The first sync seeds the (dev) SFN ARNs + launched features; later re-syncs skip it.
  desc "Run db:seed only if the sandbox schema has not been seeded yet (idempotent), then force the sandbox onto the polling pipeline model"
  task seed_once: :environment do
    if AppConfig.count.zero?
      puts "[sandbox:seed_once] fresh schema -- running db:seed"
      Rake::Task["db:seed"].invoke
    else
      puts "[sandbox:seed_once] app_configs already present (#{AppConfig.count}) -- skipping db:seed"
    end

    # A sandbox POLLS; it does not get notified. db:seed writes
    # enable_sfn_notifications=1, which is right for dev and wrong here, and the mismatch is
    # silent: the sample dispatches, the pipeline runs to completion in Step Functions, and the
    # UI sits on whatever stage it started at, forever. Nothing errors.
    #
    # With the flag at 1 the app expects SQS notifications to drive status, so
    # pipeline_monitor.rake deliberately skips the poll:
    #
    #   if AppConfigHelper.get_app_config(AppConfig::ENABLE_SFN_NOTIFICATIONS) != "1"
    #     pr.update_job_status
    #   end
    #
    # ...and the notifications never arrive, because a sandbox runs NO shoryuken -- deliberately.
    # A sandbox shoryuken would be a competing consumer on DEV's shared notification queue and
    # would steal dev's messages. So the sandbox runs both monitors and polls instead. Setting
    # the flag to 0 is what makes those monitors actually do their job; it is the config half of
    # the polling model the preview values already describe in prose.
    #
    # Enforced on EVERY sync rather than only on a fresh seed: the skip-branch above means an
    # already-seeded sandbox would otherwise keep the wrong value forever, and this is how
    # existing sandboxes self-heal on their next sync.
    #
    # Dev/staging/prod are untouched -- this task only ever runs in a sandbox's own schema.
    flag = AppConfig.find_or_initialize_by(key: AppConfig::ENABLE_SFN_NOTIFICATIONS)
    if flag.value == "0"
      puts "[sandbox:seed_once] enable_sfn_notifications already 0 (polling model) -- ok"
    else
      puts "[sandbox:seed_once] forcing enable_sfn_notifications #{flag.value.inspect} -> \"0\": a sandbox has no shoryuken, so status must be polled"
      flag.value = "0"
      flag.save!
    end
  end
end
