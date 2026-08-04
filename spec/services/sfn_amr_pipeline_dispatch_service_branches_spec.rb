require 'rails_helper'

# Branch sweep for SfnAmrPipelineDispatchService, companion to
# sfn_amr_pipeline_dispatch_service_spec.rb (which only covers the happy
# legacy/modern human-host dispatch). The arms filled in here:
#
#   * initialize guards: SfnArnMissingError (no ARN app config at all) and
#     SfnVersionMissingError (no AMR WDL version resolves).
#   * #call: the blank-execution-arn arm, which marks the run FAILED instead of
#     RUNNING.
#   * host_filtering_parameters / modern_host_filtering_parameters: the
#     non-Human host arm, the fasta file_ext arm, the single-end adapter arm and
#     the missing-nucleotide_type safe-navigation arm.
#   * input_files_params: the MODERN_HOST_FILTERING elsif (both start_from_mngs
#     arms), the start_from_mngs arm of the INITIAL elsif, and the final else
#     that raises for a WDL version older than INITIAL.
#   * reduplicated_reads_input_files: the non-Human HISAT2_HUMAN_FILTERED arm.
#   * initial_version_input_files: the start_from_mngs arm.
#
# Self-contained: every AppConfig / WorkflowVersion / HostGenome row the service
# reads is created in-spec. No app code touched.
RSpec.describe SfnAmrPipelineDispatchService, type: :service do
  let(:amr_workflow) { WorkflowRun::WORKFLOW[:amr] }
  let(:fake_sfn_execution_arn) { "fake:sfn:execution:arn" }
  let(:fake_account_id) { "123456789012" }
  let(:fake_sfn_arn) { "fake:sfn:arn" }
  let(:fake_samples_bucket) { "fake-samples-bucket" }

  let(:fake_states_client) do
    Aws::States::Client.new(
      stub_responses: {
        start_execution: { execution_arn: fake_sfn_execution_arn, start_date: Time.zone.now },
      }
    )
  end
  let(:blank_arn_states_client) do
    Aws::States::Client.new(
      stub_responses: {
        start_execution: { execution_arn: "", start_date: Time.zone.now },
      }
    )
  end
  let(:fake_sts_client) do
    Aws::STS::Client.new(stub_responses: { get_caller_identity: { account: fake_account_id } })
  end

  # Every context needs the AWS clients, the samples bucket and a Human host
  # genome (appropriate_human_genome is consulted on BOTH host-filtering paths).
  before do
    allow(ENV).to receive(:[]).and_call_original
    allow(ENV).to receive(:[]).with('SAMPLES_BUCKET_NAME').and_return(fake_samples_bucket)

    Aws.config[:stub_responses] = true
    @mock_aws_clients = { states: fake_states_client, sts: fake_sts_client }
    allow(AwsClient).to receive(:[]) { |client| @mock_aws_clients[client] }

    create(:app_config, key: AppConfig::CARD_FOLDER, value: "card-3.2.6-wildcard-4.0.0")
    create(:workflow_version, workflow: HostGenome::HUMAN_HOST, version: 1)
    @human_host_genome = create(:host_genome, name: "Human", version: 1)

    @project = create(:project)
  end

  def set_amr_version(version) # rubocop:disable Naming/AccessorMethodName
    create(:app_config, key: format(AppConfig::WORKFLOW_VERSION_TEMPLATE, workflow_name: amr_workflow), value: version)
    # CZID-982: the configured default must also be catalogued -- dispatch validates it now.
    # find_or_create_by because this helper is called more than once per example group.
    WorkflowVersion.find_or_create_by!(workflow: amr_workflow, version: version) do |wv|
      wv.deprecated = false
      wv.runnable = true
    end
  end

  def set_sfn_arn
    create(:app_config, key: AppConfig::SFN_SINGLE_WDL_ARN, value: fake_sfn_arn)
  end

  # A sample with ONE fasta input file and no nucleotide_type metadatum: drives the
  # fasta file_ext arm, the single-end adapter arm and the nil-metadata arm at once.
  def single_fasta_sample(host_genome_name)
    create(
      :sample,
      project: @project,
      host_genome_name: host_genome_name,
      input_files: [build(:local_web_input_file, name: "reads.fasta.gz", source: "reads.fasta.gz")]
    )
  end

  def amr_run(sample, start_from_mngs: false)
    inputs = start_from_mngs ? { "start_from_mngs" => "true" } : {}
    create(:workflow_run, sample: sample, workflow: amr_workflow, inputs_json: inputs.to_json)
  end

  def prior_mngs_run(sample)
    create(
      :pipeline_run,
      sample: sample,
      sfn_execution_arn: "arn:aws:states:us-west-2:1:execution:idseq:prior",
      s3_output_prefix: "s3://#{fake_samples_bucket}/prior-run",
      wdl_version: "8.0.0",
      deprecated: false
    )
  end

  def run_inputs_for(result)
    result[:sfn_input_json][:Input][:Run]
  end

  describe "initialize guards" do
    # NOTE: AppConfig::SFN_AMR_ARN is referenced by the service but is NOT defined
    # on AppConfig today, so the `||` fallback raises NameError before the blank
    # check can run. stub_const supplies the missing key name (spec-side only) so
    # the fail-closed guard itself is reachable and pinned.
    before { stub_const("AppConfig::SFN_AMR_ARN", "sfn_amr_arn") }

    it "raises SfnArnMissingError when neither SFN ARN app config is set" do
      set_amr_version("1.3.1")
      wr = amr_run(create(:sample, project: @project, host_genome_name: "Human"))

      expect { described_class.call(wr) }.to raise_error(SfnAmrPipelineDispatchService::SfnArnMissingError)
    end

    it "falls back to the AMR-specific ARN when SFN_SINGLE_WDL_ARN is absent" do
      create(:app_config, key: AppConfig::SFN_AMR_ARN, value: fake_sfn_arn)
      set_amr_version("1.3.1")
      wr = amr_run(create(:sample, project: @project, host_genome_name: "Human"))

      expect { described_class.call(wr) }.not_to raise_error
      expect(wr.reload.sfn_execution_arn).to eq(fake_sfn_execution_arn)
    end

    it "raises SfnVersionMissingError when no AMR WDL version resolves" do
      set_sfn_arn
      # No WORKFLOW_VERSION app config for amr -> VersionRetrievalService yields nil.
      wr = amr_run(create(:sample, project: @project, host_genome_name: "Human"))

      expect { described_class.call(wr) }.to raise_error(SfnAmrPipelineDispatchService::SfnVersionMissingError)
    end
  end

  describe "#call when Step Functions returns no execution arn" do
    it "marks the workflow run FAILED instead of RUNNING" do
      set_sfn_arn
      set_amr_version("1.3.1")
      @mock_aws_clients[:states] = blank_arn_states_client
      sample = create(:sample, project: @project, host_genome_name: "Human")
      wr = amr_run(sample)

      result = described_class.call(wr)

      expect(result[:sfn_execution_arn]).to be_blank
      expect(wr.reload.status).to eq(WorkflowRun::STATUS[:failed])
      expect(wr.reload.sfn_execution_arn).to be_nil
    end
  end

  describe "legacy (pre modern-host-filtering) host filtering parameters" do
    it "keeps a non-Human host genome, uses the fasta ext, single-end adapters and a blank nucleotide type" do
      set_sfn_arn
      set_amr_version("0.2.4")
      sample = single_fasta_sample("Mosquito")
      wr = amr_run(sample)

      inputs = run_inputs_for(described_class.call(wr))

      expect(inputs[:"host_filter_stage.host_genome"]).to eq("mosquito")
      expect(inputs[:"host_filter_stage.file_ext"]).to eq("fasta")
      expect(inputs[:"host_filter_stage.nucleotide_type"]).to eq("")
      expect(inputs[:"host_filter_stage.adapter_fasta"]).to eq(PipelineRun::ADAPTER_SEQUENCES["single-end"])
      # The human indexes still come from the Human genome even for a non-Human host.
      expect(inputs[:"host_filter_stage.human_star_genome"]).to eq(@human_host_genome.s3_star_index_path)
    end

    it "uses the prior mNGS run's gsnap-filtered reads when start_from_mngs is set" do
      set_sfn_arn
      set_amr_version("0.2.4")
      sample = create(:sample, project: @project, host_genome_name: "Human")
      prior_mngs_run(sample)
      wr = amr_run(sample, start_from_mngs: true)

      inputs = run_inputs_for(described_class.call(wr))

      expect(inputs[:non_host_reads].length).to eq(2)
      expect(inputs[:non_host_reads].first).to end_with(PipelineRun::GSNAP_FILTERED_NAMES.first)
      expect(inputs[:contigs]).to end_with(PipelineRun::ASSEMBLED_CONTIGS_NAME)
      # The raw-reads arm must NOT be taken.
      expect(inputs).not_to have_key(:raw_reads_0) # rubocop:disable Naming/VariableNumber
    end
  end

  describe "modern host filtering (>= MODERN_HOST_FILTERING, < REDUPLICATED_READS)" do
    before do
      set_sfn_arn
      set_amr_version("1.0.0")
    end

    it "keeps a non-Human host, fasta ext and single-end adapters, and uses subsampled reads from the prior run" do
      sample = single_fasta_sample("Mosquito")
      prior_mngs_run(sample)
      wr = amr_run(sample, start_from_mngs: true)

      inputs = run_inputs_for(described_class.call(wr))

      expect(inputs[:"host_filter_stage.host_genome"]).to eq("mosquito")
      expect(inputs[:"host_filter_stage.file_ext"]).to eq("fasta")
      expect(inputs[:"host_filter_stage.adapter_fasta"]).to eq(PipelineRun::ADAPTER_SEQUENCES["single-end"])
      expect(inputs[:"host_filter_stage.human_hisat2_index_tar"]).to eq(@human_host_genome.s3_hisat2_index_path)
      # start_from_mngs -> subsampled reads, truncated to the sample's file count (1).
      expect(inputs[:non_host_reads].length).to eq(1)
      expect(inputs[:non_host_reads].first).to end_with(PipelineRun::SUBSAMPLED_NAMES.first)
    end

    it "falls back to the sample's raw reads when start_from_mngs is not set" do
      sample = create(:sample, project: @project, host_genome_name: "Human")
      wr = amr_run(sample)

      inputs = run_inputs_for(described_class.call(wr))

      # The nil-files arm: initial_version_input_files takes the raw-reads branch.
      expect(inputs[:raw_reads_0]).to be_present  # rubocop:disable Naming/VariableNumber
      expect(inputs[:raw_reads_1]).to be_present  # rubocop:disable Naming/VariableNumber
      expect(inputs).not_to have_key(:non_host_reads)
      # Human host and two fastq files -> paired-end adapters, fastq ext.
      expect(inputs[:"host_filter_stage.file_ext"]).to eq("fastq")
      expect(inputs[:"host_filter_stage.adapter_fasta"]).to eq(PipelineRun::ADAPTER_SEQUENCES["paired-end"])
    end
  end

  describe "reduplicated reads (>= REDUPLICATED_READS)" do
    before do
      set_sfn_arn
      set_amr_version("1.3.1")
    end

    it "uses the human-filtered hisat2 reads for a NON-human host" do
      sample = create(:sample, project: @project, host_genome_name: "Mosquito")
      prior_mngs_run(sample)
      wr = amr_run(sample, start_from_mngs: true)

      filtered = run_inputs_for(described_class.call(wr))[:filtered_sample]

      expect(filtered[:non_host_reads].length).to eq(2)
      expect(filtered[:non_host_reads].first).to end_with(PipelineRun::HISAT2_HUMAN_FILTERED_NAMES.first)
      expect(filtered[:clusters]).to end_with(PipelineRun::DUPLICATE_CLUSTERS_NAME)
    end

    it "uses the host-filtered hisat2 reads for a Human host" do
      sample = create(:sample, project: @project, host_genome_name: "Human")
      prior_mngs_run(sample)
      wr = amr_run(sample, start_from_mngs: true)

      filtered = run_inputs_for(described_class.call(wr))[:filtered_sample]

      expect(filtered[:non_host_reads].first).to end_with(PipelineRun::HISAT2_HOST_FILTERED_NAMES.first)
    end
  end

  describe "a WDL version older than the INITIAL AMR release" do
    it "raises SfnVersionMissingError and marks the run FAILED" do
      set_sfn_arn
      set_amr_version("0.0.9")
      sample = create(:sample, project: @project, host_genome_name: "Human")
      wr = amr_run(sample)

      expect { described_class.call(wr) }.to raise_error(SfnAmrPipelineDispatchService::SfnVersionMissingError)
      expect(wr.reload.status).to eq(WorkflowRun::STATUS[:failed])
    end
  end
end
