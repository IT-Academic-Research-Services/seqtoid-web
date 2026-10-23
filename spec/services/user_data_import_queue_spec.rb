require 'rails_helper'

RSpec.describe UserDataImportQueue do
  # Minimal in-memory S3: just the calls the queue makes.
  class FakeQueueS3
    Obj = Struct.new(:key)
    Prefix = Struct.new(:prefix)
    Page = Struct.new(:contents, :common_prefixes, :is_truncated, :next_continuation_token)
    Head = Struct.new(:last_modified)
    Body = Struct.new(:body)

    def initialize
      @objects = {}
    end

    def store(bucket, key, body, mtime = Time.current)
      @objects["#{bucket}/#{key}"] = [body, mtime]
    end

    def json(bucket, key)
      entry = @objects["#{bucket}/#{key}"]
      entry && JSON.parse(entry[0])
    end

    def get_object(bucket:, key:, response_target: nil)
      entry = @objects["#{bucket}/#{key}"] || raise(Aws::S3::Errors::NoSuchKey.new(nil, "no such key"))
      return File.write(response_target, entry[0]) if response_target

      Body.new(StringIO.new(entry[0]))
    end

    def head_object(bucket:, key:)
      entry = @objects["#{bucket}/#{key}"] || raise(Aws::S3::Errors::NotFound.new(nil, "not found"))
      Head.new(entry[1])
    end

    def put_object(bucket:, key:, body:, content_type: nil)
      store(bucket, key, body)
    end

    def list_objects_v2(bucket:, prefix:, delimiter: nil, continuation_token: nil)
      keys = @objects.keys.select { |k| k.start_with?("#{bucket}/#{prefix}") }.map { |k| k.delete_prefix("#{bucket}/") }
      if delimiter
        prefixes = keys.filter_map do |k|
          rest = k.delete_prefix(prefix)
          (i = rest.index(delimiter)) ? prefix + rest[0..i] : nil
        end.uniq
        contents = keys.reject { |k| k.delete_prefix(prefix).include?(delimiter) }
      else
        prefixes = []
        contents = keys
      end
      Page.new(contents.map { |k| Obj.new(k) }, prefixes.map { |p| Prefix.new(p) }, false, nil)
    end
  end

  let(:s3) { FakeQueueS3.new }
  let(:calls) { [] }
  let(:responses) { {} }
  let(:importer) do
    lambda do |dir:, mode:, target_user_id:, **|
      calls << { dir: dir, mode: mode, target_user_id: target_user_id, files: Dir.children(dir).sort }
      Array(responses[target_user_id]).shift || { success: true, stats: { samples: 1 }, timings: {}, warnings: [] }
    end
  end

  around do |example|
    old = ENV.fetch("IMPORT_REQUIRE_DB_HOST", nil)
    ENV["IMPORT_REQUIRE_DB_HOST"] = "next-prod.example.internal"
    example.run
  ensure
    old.nil? ? ENV.delete("IMPORT_REQUIRE_DB_HOST") : ENV["IMPORT_REQUIRE_DB_HOST"] = old
  end

  def add_export(id, user_id:)
    s3.store("transfer", "exports/#{id}/migration_1/manifest.json", { user_id: user_id }.to_json, 2.days.ago)
    s3.store("transfer", "exports/#{id}/migration_1/samples.ndjson.gz", "rows")
  end

  def write_queue(csv)
    s3.store("ops", "queues/q1/queue.csv", csv)
  end

  def queue(**opts)
    described_class.new(queue_uri: "s3://ops/queues/q1/", export_root: "s3://transfer/exports/", s3: s3, importer: importer, **opts)
  end

  def result(id)
    s3.json("ops", "queues/q1/results/#{id}.json")
  end

  before do
    add_export(11, user_id: 9_000_111)
    add_export(12, user_id: 9_000_112)
    write_queue("export_id,target_user_id,priority\n11,1,0\n12,2,5\n")
  end

  it "refuses to start without IMPORT_REQUIRE_DB_HOST" do
    ENV.delete("IMPORT_REQUIRE_DB_HOST")
    expect { queue }.to raise_error(UserDataImportQueue::ConfigError, /IMPORT_REQUIRE_DB_HOST/)
  end

  it "imports by priority (then file order), downloads each bundle, and writes a success result per export" do
    summary = queue.run

    expect(calls.pluck(:target_user_id)).to eq([2, 1])
    expect(calls.first[:files]).to eq(["manifest.json", "samples.ndjson.gz"])
    expect(calls.pluck(:mode)).to eq(%w[live live])
    expect(result(12)).to include("status" => "success", "attempts" => ["live"], "target_user_id" => 2)
    expect(summary).to eq(succeeded: 2)
  end

  it "skips exports whose result already says success" do
    s3.store("ops", "queues/q1/results/12.json", { status: "success" }.to_json)
    summary = queue.run

    expect(calls.pluck(:target_user_id)).to eq([1])
    expect(summary).to eq(already_done: 1, succeeded: 1)
  end

  it "retries once with skip_existing when the target already holds some of the export's rows" do
    responses[2] = [{ success: false, error: "Primary keys already exist on the target (samples: 3); re-run with mode skip_existing" }]
    queue.run

    expect(calls.select { |c| c[:target_user_id] == 2 }.pluck(:mode)).to eq(%w[live skip_existing])
    expect(result(12)).to include("status" => "success", "attempts" => %w[live skip_existing])
  end

  it "records an id conflict as a failure and does not retry it again" do
    responses[2] = [
      { success: false, error: "Primary keys already exist on the target (samples: 3 in the first colliding batch); re-run with mode skip_existing" },
      { success: false, error: "Id conflict in samples: 1 row(s) in this batch already exist on the target as a DIFFERENT record (...)" },
    ]
    queue.run

    expect(calls.select { |c| c[:target_user_id] == 2 }.pluck(:mode)).to eq(%w[live skip_existing])
    expect(result(12)).to include("status" => "failed", "attempts" => %w[live skip_existing])
    expect(result(12)["error"]).to start_with("Id conflict in samples")
  end

  it "records a failure and moves on to the next export" do
    responses[2] = [{ success: false, error: "host_genomes not found on target: Alien" }]
    summary = queue.run

    expect(result(12)).to include("status" => "failed", "error" => "host_genomes not found on target: Alien")
    expect(result(11)).to include("status" => "success")
    expect(summary).to eq(failed: 1, succeeded: 1)
  end

  it "picks up no new export while the PAUSE marker exists" do
    s3.store("ops", "queues/q1/PAUSE", "deploy in progress")
    summary = queue.run

    expect(calls).to be_empty
    expect(summary).to eq(paused: true)
  end

  context "with a WORKERS control file" do
    it "stops a worker whose index is at or above the desired count, before it takes an export" do
      s3.store("ops", "queues/q1/WORKERS", "2")
      summary = queue(worker_index: 2, worker_count: 4).run

      expect(calls).to be_empty
      expect(summary).to eq(drained: true)
    end

    it "lets a worker below the desired count keep going" do
      s3.store("ops", "queues/q1/WORKERS", "2\n")
      summary = queue(worker_index: 1, worker_count: 4).run

      expect(calls.size).to eq(2)
      expect(summary).to eq(succeeded: 2)
    end

    it "finishes the current export, then stops when the count drops mid-pass" do
      scale_down = lambda do |**kw|
        s3.store("ops", "queues/q1/WORKERS", "0")
        importer.call(**kw)
      end
      summary = queue(importer: scale_down).run

      expect(calls.size).to eq(1)
      expect(result(12)).to include("status" => "success")
      expect(summary).to eq(succeeded: 1, drained: true)
    end

    it "ignores a value that is not an integer" do
      s3.store("ops", "queues/q1/WORKERS", "lots")
      summary = queue(worker_index: 3, worker_count: 4).run

      expect(summary).to eq(succeeded: 2)
    end
  end

  it "skips an export another worker has claimed (its per-export lock is held)" do
    conn = ActiveRecord::Base.connection
    allow(conn).to receive(:select_value).and_call_original
    allow(conn).to receive(:select_value).with(/GET_LOCK\('seqtoid_user_data_import:u9000112', 0\)/).and_return(0)
    summary = queue.run

    expect(calls.pluck(:target_user_id)).to eq([1])
    expect(result(12)).to be_nil
    expect(summary).to eq(claimed_by_other: 1, succeeded: 1)
  end

  it "records a failure when the export has no bundle with a manifest" do
    write_queue("export_id,target_user_id\n99,3\n")
    queue.run

    expect(result(99)).to include("status" => "failed")
    expect(result(99)["error"]).to include("no bundle with manifest.json")
  end

  it "deletes the scratch copy of each bundle afterwards" do
    queue.run

    expect(calls.map { |c| Dir.exist?(c[:dir]) }).to all(be(false))
  end

  context "with IMPORT_QUEUE_MODE=dry_run" do
    def dry_result(id)
      s3.json("ops", "queues/q1/dry-runs/#{id}.json")
    end

    it "runs the importer read-only and records results under dry-runs/, never results/" do
      summary = queue(mode: "dry_run").run

      expect(calls.pluck(:mode)).to eq(%w[dry_run dry_run])
      expect(dry_result(12)).to include("status" => "success", "mode" => "dry_run", "attempts" => ["dry_run"])
      expect(result(12)).to be_nil
      expect(summary).to eq(succeeded: 2)
    end

    it "does not make the live pass skip anything" do
      queue(mode: "dry_run").run
      calls.clear
      queue.run

      expect(calls.pluck(:mode)).to eq(%w[live live])
    end

    it "dry-runs the remainder with skip_existing when the export is partially imported" do
      responses[2] = [{ success: false, error: "Primary keys already exist on the target (samples: 3 in the first colliding batch)" }]
      queue(mode: "dry_run").run

      expect(calls.select { |c| c[:target_user_id] == 2 }.pluck(:mode)).to eq(%w[dry_run dry_run_skip_existing])
      expect(dry_result(12)).to include("status" => "success", "attempts" => %w[dry_run dry_run_skip_existing])
    end

    it "skips exports that are already imported" do
      s3.store("ops", "queues/q1/results/12.json", { status: "success" }.to_json)
      summary = queue(mode: "dry_run").run

      expect(calls.pluck(:target_user_id)).to eq([1])
      expect(summary).to eq(already_done: 1, succeeded: 1)
    end

    it "rejects an unknown mode" do
      expect { queue(mode: "dryrun") }.to raise_error(UserDataImportQueue::ConfigError, /IMPORT_QUEUE_MODE/)
    end
  end

  describe ".report" do
    it "writes one row per queued export with live and dry-run status and counts, without a target database" do
      ENV.delete("IMPORT_REQUIRE_DB_HOST")
      s3.store("ops", "queues/q1/results/12.json", { status: "failed", error: "boom" }.to_json)
      s3.store("ops", "queues/q1/dry-runs/11.json", {
        status: "success", attempts: %w[dry_run], warnings: %w[w1 w2],
        stats: { projects_name_conflicts: 2, phylo_trees_name_conflicts: 1, samples_id_conflicts: 0 },
      }.to_json)

      out = described_class.report(queue_uri: "s3://ops/queues/q1/", s3: s3)

      expect(out).to eq(exports: 2, report: "s3://ops/queues/q1/report.csv")
      rows = CSV.parse(s3.get_object(bucket: "ops", key: "queues/q1/report.csv").body.read, headers: true).map(&:to_h)
      expect(rows.find { |r| r["export_id"] == "11" }).to include(
        "dry_run_status" => "success", "dry_run_attempts" => "dry_run", "warnings" => "2", "name_conflicts" => "3",
        "id_conflicts" => "0", "live_status" => nil
      )
      expect(rows.find { |r| r["export_id"] == "12" }).to include("live_status" => "failed", "live_error" => "boom", "dry_run_status" => nil)
    end
  end

  it "starts each worker at its own offset in the queue" do
    write_queue("export_id,target_user_id\n11,1\n12,2\n")
    queue(worker_index: 1, worker_count: 2).run

    expect(calls.pluck(:target_user_id)).to eq([2, 1])
  end
end
