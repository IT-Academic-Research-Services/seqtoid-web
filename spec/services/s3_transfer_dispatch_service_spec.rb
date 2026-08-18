require 'rails_helper'

# Exercises the policy-driven file selection across all transferable run types.
# S3 + Batch are stubbed; no real AWS calls. The per-run results prefixes are
# stubbed so the test does not depend on sfn_results_path internals, and
# list_objects_v2 returns a per-workflow fixture set keyed on the prefix.
RSpec.describe S3TransferDispatchService do
  let(:bucket) { "idseq-samples-test" }

  # Relative output filenames returned per workflow, mixing transfer / skip /
  # unclassified so we can assert each branch. Decisions come from the real
  # shipped policy (config/s3_transfer_file_policy.yml).
  let(:fixtures) do
    {
      "short-read-mngs" => %w[gsnap.m8 valid_input1.fastq _status2.json surprise_new.dat],
      "long-read-mngs" => %w[gsnap.m8 sample.humanfiltered.bam],
      "amr" => %w[comprehensive_AMR_metrics.tsv outputs.zip],
      "consensus-genome" => %w[consensus.fa],
    }
  end

  let(:user) { create(:user) }
  let(:project) { create(:project, users: [user]) }
  let(:sample) { create(:sample, user: user, project: project) }

  let!(:illumina_pr) do
    create(:pipeline_run, sample: sample, technology: PipelineRun::TECHNOLOGY_INPUT[:illumina],
                          pipeline_version: "7.0.0",
                          sfn_execution_arn: "arn:pr:illumina", deprecated: false)
  end
  let!(:ont_pr) do
    create(:pipeline_run, sample: sample, technology: PipelineRun::TECHNOLOGY_INPUT[:nanopore],
                          sfn_execution_arn: "arn:pr:ont", deprecated: false)
  end
  let!(:amr_wr) do
    create(:workflow_run, sample: sample, user: user, workflow: WorkflowRun::WORKFLOW[:amr],
                          sfn_execution_arn: "arn:wr:amr", deprecated: false)
  end
  let!(:cg_wr) do
    create(:workflow_run, sample: sample, user: user, workflow: WorkflowRun::WORKFLOW[:consensus_genome],
                          sfn_execution_arn: "arn:wr:cg", deprecated: false)
  end

  let(:manifest_lines) { @manifest_body.to_s.split("\n") }

  # Per-environment config the service requires (fail-loud in #initialize).
  let(:job_definition_arn) { "arn:aws:batch:us-west-2:1:job-definition/test-s3-copy:1" }
  let(:job_queue_arn) { "arn:aws:batch:us-west-2:1:job-queue/test-s3-copy" }
  let(:dest_bucket) { "idseq-test-s3-copy-dest" }

  before do
    stub_const("SAMPLES_BUCKET_NAME", bucket)

    # Stub the required env vars so the spec does not depend on the deploy env
    # (they live in web.env for local dev but are unset in CI).
    allow(ENV).to receive(:[]).and_call_original
    allow(ENV).to receive(:[]).with("S3_TRANSFER_JOB_DEFINITION_ARN").and_return(job_definition_arn)
    allow(ENV).to receive(:[]).with("S3_TRANSFER_JOB_QUEUE_ARN").and_return(job_queue_arn)
    allow(ENV).to receive(:[]).with("S3_TRANSFER_DESTINATION_BUCKET").and_return(dest_bucket)

    # Deterministic results prefix per run, tokenized by workflow.
    allow_any_instance_of(PipelineRun).to receive(:sfn_results_path) do |pr|
      wf = S3TransferDispatchService::PIPELINE_RUN_WORKFLOW[pr.technology]
      "s3://#{bucket}/wf/#{wf}/results"
    end
    allow_any_instance_of(WorkflowRun).to receive(:sfn_results_path) do |wr|
      "s3://#{bucket}/wf/#{wr.workflow}/results"
    end

    s3 = Aws::S3::Client.new(stub_responses: true)
    fixture_set = fixtures
    s3.stub_responses(:list_objects_v2, lambda do |ctx|
      prefix = ctx.params[:prefix].to_s
      wf = fixture_set.keys.find { |w| prefix.include?("/#{w}/") }
      contents = fixture_set.fetch(wf, []).map { |name| { key: "#{prefix}#{name}" } }
      { contents: contents, is_truncated: false }
    end)

    batch = Aws::Batch::Client.new(stub_responses: true)
    batch.stub_responses(:submit_job, { job_name: "czid-test-s3-transfer", job_arn: "arn:aws:batch:us-west-2:1:job/xyz", job_id: "xyz" })

    clients = { s3: s3, batch: batch }
    allow(AwsClient).to receive(:[]) { |name| clients.fetch(name) }

    # Capture the manifest body without a real S3 upload.
    @manifest_body = nil
    allow(S3Util).to receive(:upload_to_s3) { |_bucket, _key, body| @manifest_body = body }
  end

  describe "#call" do
    it "transfers only policy transfer:true files across all run types" do
      job = described_class.call(user.id)

      expected = [
        "wf/short-read-mngs/results/gsnap.m8",
        "wf/long-read-mngs/results/gsnap.m8",
        "wf/amr/results/comprehensive_AMR_metrics.tsv",
        "wf/amr/results/outputs.zip",
        "wf/consensus-genome/results/consensus.fa",
      ]
      sources = manifest_lines.map { |line| line.split("\t").first }
      expect(sources).to match_array(expected.map { |k| "s3://#{bucket}/#{k}" })
      expect(job.file_count).to eq(expected.size)
    end

    it "excludes skipped (host-genomic / intermediate) files" do
      described_class.call(user.id)

      joined = manifest_lines.join("\n")
      expect(joined).not_to include("valid_input1.fastq")        # pre-host-filter read
      expect(joined).not_to include("sample.humanfiltered.bam")  # human-aligned BAM
    end

    it "writes each destination URI as the source key with only the bucket swapped" do
      described_class.call(user.id)

      manifest_lines.each do |line|
        source, dest = line.split("\t")
        expect(source).to start_with("s3://#{bucket}/")
        expect(dest).to start_with("s3://#{dest_bucket}/")
        expect(source.sub("s3://#{bucket}/", "")).to eq(dest.sub(%r{\As3://[^/]+/}, ""))
      end
    end

    it "flags only truly-unclassified files (orchestration status files are skipped, not flagged)" do
      # surprise_new.dat is unclassified (count 1); _status2.json is a policy skip,
      # so it must NOT inflate the unclassified count.
      expect(LogUtil).to receive(:log_message).with(
        a_string_including("unclassified"),
        hash_including(unclassified_counts: hash_including("short-read-mngs" => 1))
      )

      described_class.call(user.id)
      joined = manifest_lines.join("\n")
      expect(joined).not_to include("surprise_new.dat")
      expect(joined).not_to include("_status2.json")
    end

    it "excludes short-read runs below the minimum migration pipeline version" do
      illumina_pr.update!(pipeline_version: "5.9.0")

      described_class.call(user.id)

      joined = manifest_lines.join("\n")
      expect(joined).not_to include("short-read-mngs/results/gsnap.m8") # sub-7.0.0 short-read excluded
      expect(joined).to include("long-read-mngs/results/gsnap.m8")      # ONT is exempt, still transferred
    end

    it "raises NoFilesError when the user has no transferable files" do
      other = create(:user)
      expect { described_class.call(other.id) }
        .to raise_error(S3TransferDispatchService::NoFilesError)
    end
  end
end
