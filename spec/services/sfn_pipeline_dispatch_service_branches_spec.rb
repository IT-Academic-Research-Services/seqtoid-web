require 'rails_helper'
require 'json'
require 'support/common_stub_constants'

# Branch coverage for SfnPipelineDispatchService. sfn_pipeline_dispatch_service_spec
# only ever dispatches ONE shape of run: paired-end fastq, Human host, an explicit
# nucleotide_type, no pipeline_branch, and a pre-8 WDL version. That leaves whole
# conditional arms undriven, which this file closes:
#   * the missing-SFN-ARN guard in the constructor;
#   * the pipeline_branch-is-a-version shortcut (skips VersionRetrievalService);
#   * the ENTIRE new host-filtering stage (pipeline_version >= 8), in both its
#     paired-end/Human/fastq and single-end/non-Human/fasta shapes;
#   * the single-end / fasta / missing-nucleotide_type arms of the legacy
#     host-filtering + Experimental input blocks;
#   * the dag_vars merge arm of the per-stage input loop.
# All AWS access is stubbed (Aws::States + Aws::STS response stubs); nothing leaves
# the process.
RSpec.describe SfnPipelineDispatchService, type: :service do
  BRANCHES_SAMPLES_BUCKET = "branches-samples-bucket".freeze
  BRANCHES_SFN_ARN = "branches:fake:sfn:arn".freeze
  BRANCHES_LEGACY_WDL_VERSION = "4.9.0".freeze
  BRANCHES_WORKFLOW_NAME = WorkflowRun::WORKFLOW[:short_read_mngs]

  let(:project) { create(:project) }

  def stub_aws_clients
    Aws.config[:stub_responses] = true
    states = Aws::States::Client.new(
      stub_responses: {
        start_execution: {
          execution_arn: CommonStubConstants::FAKE_SFN_EXECUTION_ARN,
          start_date: Time.zone.now,
        },
      }
    )
    clients = { states: states, sts: Aws::STS::Client.new(stub_responses: true) }
    allow(AwsClient).to receive(:[]) { |client| clients[client] }
  end

  before do
    stub_const("SAMPLES_BUCKET_NAME", BRANCHES_SAMPLES_BUCKET)
    allow(ENV).to receive(:[]).and_call_original
    allow(ENV).to receive(:[]).with('SAMPLES_BUCKET_NAME').and_return(BRANCHES_SAMPLES_BUCKET)

    # The human genome pin is resolved for EVERY dispatch, Human host or not.
    create(:workflow_version, workflow: HostGenome::HUMAN_HOST, version: 1)
  end

  describe "constructor guards" do
    let(:sample) { create(:sample, project: project, host_genome_name: "Human") }
    let(:pipeline_run) { create(:pipeline_run, sample: sample) }

    it "raises SfnArnMissingError when neither SFN_MNGS_ARN nor SFN_ARN is configured" do
      expect(AppConfigHelper.get_app_config(AppConfig::SFN_MNGS_ARN)).to be_nil
      expect(AppConfigHelper.get_app_config(AppConfig::SFN_ARN)).to be_nil

      expect { described_class.call(pipeline_run) }
        .to raise_error(described_class::SfnArnMissingError, /SFN_MNGS_ARN and SFN_ARN not set/)
    end

    it "falls back to SFN_ARN when only that one is configured" do
      create(:app_config, key: AppConfig::SFN_ARN, value: BRANCHES_SFN_ARN)
      create(:app_config, key: format(AppConfig::WORKFLOW_VERSION_TEMPLATE, workflow_name: BRANCHES_WORKFLOW_NAME), value: BRANCHES_LEGACY_WDL_VERSION)
      stub_aws_clients

      result = described_class.call(pipeline_run)
      expect(result[:sfn_execution_arn]).to eq(CommonStubConstants::FAKE_SFN_EXECUTION_ARN)
    end
  end

  describe "wdl version resolution" do
    let(:sample) { create(:sample, project: project, host_genome_name: "Human") }

    before do
      create(:app_config, key: AppConfig::SFN_MNGS_ARN, value: BRANCHES_SFN_ARN)
      stub_aws_clients
    end

    it "uses a semver pipeline_branch verbatim instead of the configured workflow version" do
      # No WORKFLOW_VERSION_TEMPLATE app config exists, so VersionRetrievalService
      # would blow up / return blank -- the branch shortcut is what makes this work.
      pipeline_run = create(:pipeline_run, sample: sample, pipeline_branch: "9.3.1")

      result = described_class.call(pipeline_run)

      expect(result[:pipeline_version]).to eq("9.3")
      expect(pipeline_run.reload.wdl_version).to eq("9.3.1")
    end
  end

  describe "new host filtering stage (pipeline_version >= 8)" do
    before do
      create(:app_config, key: AppConfig::SFN_MNGS_ARN, value: BRANCHES_SFN_ARN)
      stub_aws_clients
    end

    it "builds paired-end Human fastq inputs" do
      human = create(:host_genome, name: "Human", version: 1,
                                   s3_original_transcripts_gtf_index_path: "s3://branches/human.gtf.gz")
      sample = create(:sample,
                      project: project,
                      host_genome_name: "Human",
                      metadata_fields: { nucleotide_type: "DNA" })
      expect(sample.host_genome.id).to eq(human.id)
      pipeline_run = create(:pipeline_run, sample: sample, pipeline_branch: "8.2.0")

      host_filter = described_class.call(pipeline_run)[:sfn_input_json][:Input][:HostFilter]

      # New-stage-only keys prove we took the new_host_filtering_inputs arm.
      expect(host_filter[:bowtie2_index_tar]).to eq(human.s3_bowtie2_index_path_v2)
      expect(host_filter[:hisat2_index_tar]).to eq(human.s3_hisat2_index_path)
      expect(host_filter[:kallisto_idx]).to eq(human.s3_kallisto_index_path)
      expect(host_filter).not_to include(:star_genome)
      expect(host_filter[:fastqs_1]).to eq(sample.input_files.fastq[1].s3_path) # rubocop:disable Naming/VariableNumber
      expect(host_filter[:nucleotide_type]).to eq("DNA")
      expect(host_filter[:adapter_fasta]).to eq(PipelineRun::ADAPTER_SEQUENCES["paired-end"])
      expect(host_filter[:host_genome]).to eq("human")
      # Human host -> the transcripts GTF is included.
      expect(host_filter[:gtf_gz]).to eq("s3://branches/human.gtf.gz")
      expect(host_filter[:file_ext]).to eq("fastq")
    end

    it "builds single-end non-Human fasta inputs" do
      create(:host_genome, name: "Human", version: 1)
      sample = create(:sample,
                      project: project,
                      host_genome_name: "Mosquito",
                      input_files: [build(:local_web_input_file, name: "solo.fasta.gz")])
      pipeline_run = create(:pipeline_run, sample: sample, pipeline_branch: "8.2.0")

      host_filter = described_class.call(pipeline_run)[:sfn_input_json][:Input][:HostFilter]

      expect(host_filter).to include(:bowtie2_index_tar)
      expect(host_filter[:fastqs_1]).to be_nil # rubocop:disable Naming/VariableNumber
      # No nucleotide_type metadatum -> the `|| ""` fallback.
      expect(host_filter[:nucleotide_type]).to eq("")
      expect(host_filter[:adapter_fasta]).to eq(PipelineRun::ADAPTER_SEQUENCES["single-end"])
      expect(host_filter[:host_genome]).to eq("mosquito")
      # Non-Human host -> no transcripts GTF.
      expect(host_filter[:gtf_gz]).to be_nil
      expect(host_filter[:file_ext]).to eq("fasta")
    end
  end

  describe "legacy host filtering stage (pipeline_version < 8)" do
    before do
      create(:app_config, key: AppConfig::SFN_MNGS_ARN, value: BRANCHES_SFN_ARN)
      create(:app_config, key: format(AppConfig::WORKFLOW_VERSION_TEMPLATE, workflow_name: BRANCHES_WORKFLOW_NAME), value: BRANCHES_LEGACY_WDL_VERSION)
      stub_aws_clients
      create(:host_genome, name: "Human", version: 1)
    end

    it "builds single-end non-Human fasta inputs and merges dag_vars into the stage" do
      sample = create(:sample,
                      project: project,
                      host_genome_name: "Mosquito",
                      input_files: [build(:local_web_input_file, name: "legacy_solo.fasta.gz")])
      pipeline_run = create(:pipeline_run,
                            sample: sample,
                            dag_vars: { "HostFilter" => { "extra_dag_var" => "on" } }.to_json)

      input = described_class.call(pipeline_run)[:sfn_input_json][:Input]
      host_filter = input[:HostFilter]

      # Legacy-stage-only keys prove we took the else arm.
      expect(host_filter).to include(:star_genome, :bowtie2_genome, :human_star_genome)
      expect(host_filter).not_to include(:kallisto_idx)
      expect(host_filter[:fastqs_1]).to be_nil # rubocop:disable Naming/VariableNumber
      expect(host_filter[:file_ext]).to eq("fasta")
      expect(host_filter[:nucleotide_type]).to eq("")
      expect(host_filter[:host_genome]).to eq("mosquito")
      expect(host_filter[:adapter_fasta]).to eq(PipelineRun::ADAPTER_SEQUENCES["single-end"])

      # dag_vars keyed by stage name get merged into that stage only. They arrive from
      # JSON so they keep their STRING keys alongside the service's symbol keys.
      expect(host_filter["extra_dag_var"]).to eq("on")
      expect(input[:Postprocess]).not_to include("extra_dag_var")

      experimental = input[:Experimental]
      expect(experimental[:fastqs_1]).to be_nil # rubocop:disable Naming/VariableNumber
      expect(experimental[:file_ext]).to eq("fasta")

      # Every stage still gets the common per-stage keys.
      input.each_value do |stage|
        expect(stage[:s3_wd_uri]).to include("s3://#{BRANCHES_SAMPLES_BUCKET}/")
        expect(stage[:docker_image_id]).to include(BRANCHES_WORKFLOW_NAME)
      end
    end
  end
end
