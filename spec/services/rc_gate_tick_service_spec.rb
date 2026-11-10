require "rails_helper"

RSpec.describe RcGateTickService, type: :service do
  # Minimal in-memory S3 for get_object/put_object.
  class FakeRcGateS3
    attr_reader :objects, :puts

    def initialize
      @objects = {}
      @puts = 0
    end

    def get_object(bucket:, key:)
      body = @objects["#{bucket}/#{key}"]
      raise Aws::S3::Errors::NoSuchKey.new(nil, "no such key") if body.nil?

      Struct.new(:body).new(StringIO.new(body))
    end

    def put_object(bucket:, key:, body:, content_type: nil)
      @puts += 1
      @objects["#{bucket}/#{key}"] = body
    end
  end

  let(:s3) { FakeRcGateS3.new }
  let(:owner) { create(:admin, email: "rc-gate-owner@example.com") }
  let(:result_key) { "bench-bucket/rc-gates/rc-2026.11.10/result.json" }
  let(:now) { Time.utc(2026, 11, 10, 12, 0, 0) }
  let(:env) do
    {
      "DEV_PIN_KIND" => "rc",
      "DEV_PIN_RC" => "rc-2026.11.10",
      "RC_GATE_IMAGE_TAG" => "sha-abc12345",
      "RC_GATE_RESULTS_PREFIX" => "s3://bench-bucket/rc-gates/",
      "RC_GATE_DATASET" => "idseq_bench_5",
      "RC_GATE_FASTQS" => "s3://bench-bucket/5/norg_13_R1.fastq.gz,s3://bench-bucket/5/norg_13_R2.fastq.gz",
      "RC_GATE_TRUTH_FILE" => "norg_13.TRUTH.txt",
      "RC_GATE_SRM_VERSION" => "8.3.15",
      "RC_GATE_OWNER_EMAIL" => owner.email,
      "RC_GATE_TIMEOUT_HOURS" => "6",
    }
  end

  def tick(at: now, environment: env)
    described_class.call(env: environment, now: at)
  end

  def result
    JSON.parse(s3.objects.fetch(result_key))
  end

  def gate_sample
    Sample.find_by(name: "rc-gate rc-2026.11.10 idseq_bench_5")
  end

  def add_pipeline_run(job_status:, finalized:, taxon_counts: [])
    pr = create(:pipeline_run, sample: gate_sample, taxon_counts_data: taxon_counts)
    pr.update_columns(job_status: job_status, results_finalized: finalized, wdl_version: "8.3.15") # rubocop:disable Rails/SkipsModelValidations
    pr
  end

  def gate_benchmark
    Sample.find_by(name: "rc-gate rc-2026.11.10 idseq_bench_5 benchmark").workflow_runs.last
  end

  before do
    allow(AwsClient).to receive(:[]).and_call_original
    allow(AwsClient).to receive(:[]).with(:s3).and_return(s3)
    allow(Resque).to receive(:enqueue)
    allow(SfnBenchmarkPipelineDispatchService).to receive(:call).and_return(true)
    allow(VersionRetrievalService).to receive(:call).and_call_original
    allow(VersionRetrievalService).to receive(:call).with(anything, WorkflowRun::WORKFLOW[:short_read_mngs]).and_return("8.3.15")
    create(:host_genome, name: "Human")
    # What a real environment has, so the new project gets the same pins ProjectsController#create sets.
    allow(AppConfigHelper).to receive(:get_workflow_version).and_return("8.3.15")
    create(:app_config, key: AppConfig::DEFAULT_ALIGNMENT_CONFIG_NAME, value: "2024-02-06")
    create(:workflow_version, workflow: HostGenome::HUMAN_HOST, version: "1")
  end

  it "is a no-op when dev is not pinned to an RC" do
    expect(tick(environment: env.merge("DEV_PIN_KIND" => "lease"))).to eq(:not_pinned)
    expect(tick(environment: env.except("DEV_PIN_RC"))).to eq(:not_pinned)
    expect(s3.puts).to eq(0)
    expect(Project.find_by(name: "RC Benchmarks")).to be_nil
  end

  it "is a no-op once the result is terminal" do
    s3.objects[result_key] = { "state" => "succeeded" }.to_json
    expect(tick).to eq(:already_terminal)
    expect(s3.puts).to eq(0)
    expect(Sample.count).to eq(0)
  end

  it "raises (and creates nothing) when the result cannot be read for a reason other than NoSuchKey" do
    allow(s3).to receive(:get_object).and_raise(Aws::S3::Errors::AccessDenied.new(nil, "denied"))
    expect { tick }.to raise_error(Aws::S3::Errors::AccessDenied)
    expect(Sample.count).to eq(0)
  end

  it "creates the pinned project + gate sample via the S3 upload path and records running" do
    expect(tick).to eq("running")

    project = Project.find_by(name: "RC Benchmarks")
    expect(project.users).to include(owner)
    expect(ProjectWorkflowVersion.find_by(project: project, workflow: "short-read-mngs").version_prefix).to eq("8.3.15")
    expect(gate_sample.project).to eq(project)
    expect(gate_sample.host_genome.name).to eq("Human")
    expect(gate_sample.input_files.map(&:source)).to eq(env["RC_GATE_FASTQS"].split(","))
    expect(gate_sample.input_files.map(&:source_type).uniq).to eq(["s3"])
    expect(Resque).to have_received(:enqueue).with(InitiateS3Cp, gate_sample.id)

    expect(result).to eq(
      "schema" => 1, "rc" => "rc-2026.11.10", "image_tag" => "sha-abc12345", "dataset" => "idseq_bench_5",
      "srm_version" => "8.3.15", "state" => "running", "sample_id" => gate_sample.id,
      "pipeline_run_id" => nil, "pipeline_status" => nil, "benchmark_workflow_run_id" => nil,
      "metrics" => nil, "report_digest" => nil, "report_rows" => nil,
      "started_at" => "2026-11-10T12:00:00Z", "updated_at" => "2026-11-10T12:00:00Z",
      "completed_at" => nil, "error" => nil
    )
  end

  it "is idempotent: re-running does not create a second sample or benchmark" do
    tick
    add_pipeline_run(job_status: PipelineRun::STATUS_CHECKED, finalized: PipelineRun::FINALIZED_SUCCESS)
    tick(at: now + 900)
    tick(at: now + 1800)

    expect(Sample.where(name: "rc-gate rc-2026.11.10 idseq_bench_5").count).to eq(1)
    expect(Sample.where(name: "rc-gate rc-2026.11.10 idseq_bench_5 benchmark").count).to eq(1)
    expect(WorkflowRun.where(workflow: WorkflowRun::WORKFLOW[:benchmark]).count).to eq(1)
    expect(SfnBenchmarkPipelineDispatchService).to have_received(:call).once
    expect(result["started_at"]).to eq("2026-11-10T12:00:00Z")
    expect(result["updated_at"]).to eq("2026-11-10T12:30:00Z")
  end

  it "goes running -> succeeded with metrics and a report digest" do
    tick
    pr = add_pipeline_run(job_status: PipelineRun::STATUS_RUNNING, finalized: 0)
    tick(at: now + 900)
    expect(result).to include("state" => "running", "pipeline_run_id" => pr.id, "pipeline_status" => "RUNNING")

    pr.update_columns(job_status: PipelineRun::STATUS_CHECKED, results_finalized: PipelineRun::FINALIZED_SUCCESS) # rubocop:disable Rails/SkipsModelValidations
    create(:taxon_count, pipeline_run: pr, tax_id: 573, tax_level: 1, count_type: "NT", count: 10, rpm: 1.23456)
    create(:taxon_count, pipeline_run: pr, tax_id: 570, tax_level: 2, count_type: "NR", count: 4, rpm: 0.5)
    tick(at: now + 1800)
    bench = gate_benchmark
    expect(result).to include("state" => "running", "benchmark_workflow_run_id" => bench.id, "report_rows" => 2)
    expect(bench.inputs).to include("run_ids" => [pr.id], "ground_truth_file" => "#{BenchmarkWorkflowRun::AWS_S3_TRUTH_FILES_BUCKET}norg_13.TRUTH.txt")

    metrics = { "nt_aupr" => 0.99, "nr_aupr" => 0.98, "nt_l2_norm" => 0.1, "nr_l2_norm" => 0.2, "correlation" => 0.97 }
    bench.update!(status: WorkflowRun::STATUS[:succeeded], cached_results: { "benchmark_metrics" => metrics }.to_json)
    expect(tick(at: now + 2700)).to eq("succeeded")
    expect(result).to include("state" => "succeeded", "pipeline_status" => "CHECKED", "metrics" => metrics, "completed_at" => "2026-11-10T12:45:00Z", "error" => nil)
    expect(result["report_digest"]).to eq(described_class.report_digest([[573, 1, "NT", 10, 1.23456], [570, 2, "NR", 4, 0.5]]))
    expect(result.keys).to eq(["schema", "rc", "image_tag", "dataset", "srm_version", "state", "sample_id", "pipeline_run_id",
                               "pipeline_status", "benchmark_workflow_run_id", "metrics", "report_digest", "report_rows",
                               "started_at", "updated_at", "completed_at", "error",])

    # Terminal: later ticks leave it alone.
    puts_before = s3.puts
    expect(tick(at: now + 3600)).to eq(:already_terminal)
    expect(s3.puts).to eq(puts_before)
  end

  it "records failed when the pipeline run fails" do
    tick
    add_pipeline_run(job_status: PipelineRun::STATUS_FAILED, finalized: PipelineRun::FINALIZED_FAIL)
    expect(tick(at: now + 900)).to eq("failed")
    expect(result["error"]).to match(/pipeline run \d+ failed/)
    expect(result["completed_at"]).to eq("2026-11-10T12:15:00Z")
  end

  it "records failed when the benchmark fails" do
    tick
    add_pipeline_run(job_status: PipelineRun::STATUS_CHECKED, finalized: PipelineRun::FINALIZED_SUCCESS)
    tick(at: now + 900)
    gate_benchmark.update!(status: WorkflowRun::STATUS[:failed])
    expect(tick(at: now + 1800)).to eq("failed")
    expect(result["error"]).to match(/benchmark workflow run \d+ FAILED/)
  end

  it "records failed (timeout) when the gate outlives RC_GATE_TIMEOUT_HOURS" do
    tick
    expect(tick(at: now + (6 * 3600) + 1)).to eq("failed")
    expect(result["error"]).to start_with("timeout")
    expect(result["started_at"]).to eq("2026-11-10T12:00:00Z")
  end

  it "fails clearly when the owner does not exist" do
    expect(tick(environment: env.merge("RC_GATE_OWNER_EMAIL" => "nobody@example.com"))).to eq("failed")
    expect(result["error"]).to include("nobody@example.com")
    expect(Sample.count).to eq(0)
  end

  it "fails clearly when dev cannot dispatch the pinned short-read-mngs version" do
    allow(VersionRetrievalService).to receive(:call).with(anything, WorkflowRun::WORKFLOW[:short_read_mngs])
                                                    .and_raise(StandardError, "8.3.15 not catalogued")
    expect(tick).to eq("failed")
    expect(result["error"]).to include("cannot dispatch short-read-mngs 8.3.15")
    expect(gate_sample).to be_nil
  end

  describe ".report_digest" do
    it "is stable for the same rows in a different order and changes when a value changes" do
      rows = [[573, 1, "NT", 10, 1.23456], [570, 2, "NR", 4, 0.5], [-200, 2, "NT", 1, nil]]
      digest = described_class.report_digest(rows)
      expect(digest).to match(/\Asha256:[0-9a-f]{64}\z/)
      expect(described_class.report_digest(rows.reverse)).to eq(digest)
      expect(described_class.report_digest([[573, 1, "NT", 10, 1.234561], *rows.drop(1)])).to eq(digest) # rounds to 4 dp
      expect(described_class.report_digest([[573, 1, "NT", 11, 1.23456], *rows.drop(1)])).not_to eq(digest)
    end
  end
end
