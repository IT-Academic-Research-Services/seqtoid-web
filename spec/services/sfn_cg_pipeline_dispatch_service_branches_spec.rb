require 'rails_helper'
require 'json'

# Branch coverage for SfnCgPipelineDispatchService arms the main spec never reaches:
#   * the missing-SFN-ARN guard
#   * the blank-execution-arn arm of #call (run marked failed, no executed_at)
#   * the nanopore primer-set case arms that only have PENDING examples upstream
#     (midnight / artic_v4 / varskip / artic_v5)
#   * the unrecognized-technology arm
#   * the viral-CG "no primer bed supplied" ternary arm
#   * the single-end (no fastqs_1) ternary arm
#   * the pre-3.4.13 WDL arm that does not attach alignment-config paths
RSpec.describe SfnCgPipelineDispatchService, type: :service do
  let(:fake_samples_bucket) { "fake-samples-bucket" }
  let(:fake_account_id) { "123456789012" }
  let(:fake_sfn_arn) { "fake:sfn:arn" }
  let(:fake_sfn_execution_arn) { "fake:sfn:execution:arn" }
  let(:test_workflow_name) { WorkflowRun::WORKFLOW[:consensus_genome] }
  let(:fake_wdl_version) { "10.0.0" }
  let(:medaka_model) { ConsensusGenomeWorkflowRun::DEFAULT_MEDAKA_MODEL }
  let(:illumina_technology) { ConsensusGenomeWorkflowRun::TECHNOLOGY_INPUT[:illumina] }
  let(:nanopore_technology) { ConsensusGenomeWorkflowRun::TECHNOLOGY_INPUT[:nanopore] }
  let(:protocols) { ConsensusGenomeWorkflowRun::WETLAB_PROTOCOL }

  let(:fake_states_client) do
    Aws::States::Client.new(
      stub_responses: {
        start_execution: { execution_arn: fake_sfn_execution_arn, start_date: Time.zone.now },
        list_tags_for_resource: { tags: [{ key: "wdl_version", value: fake_wdl_version }] },
      }
    )
  end
  let(:fake_sts_client) do
    Aws::STS::Client.new(stub_responses: { get_caller_identity: { account: fake_account_id } })
  end

  let(:project) { create(:project) }
  let(:alignment_config) { create(:alignment_config, name: AlignmentConfig.default_name) }
  let(:sample) { create(:sample, project: project, alignment_config_name: alignment_config.name) }

  before do
    allow(ENV).to receive(:[]).and_call_original
    allow(ENV).to receive(:[]).with('SAMPLES_BUCKET_NAME').and_return(fake_samples_bucket)
    stub_const("SAMPLES_BUCKET_NAME", fake_samples_bucket)

    Aws.config[:stub_responses] = true
    @mock_aws_clients = { states: fake_states_client, sts: fake_sts_client }
    allow(AwsClient).to receive(:[]) { |client| @mock_aws_clients[client] }
  end

  def with_wdl_version(version)
    create(:app_config, key: format(AppConfig::WORKFLOW_VERSION_TEMPLATE, workflow_name: test_workflow_name),
                        value: version)
    # CZID-982: the configured default must also be catalogued -- dispatch validates it now.
    # find_or_create_by because this helper is called more than once per example group.
    WorkflowVersion.find_or_create_by!(workflow: test_workflow_name, version: version) do |wv|
      wv.deprecated = false
      wv.runnable = true
    end
  end

  def nanopore_run(protocol)
    create(:workflow_run,
           workflow: test_workflow_name,
           status: WorkflowRun::STATUS[:created],
           sample: sample,
           inputs_json: { technology: nanopore_technology, medaka_model: medaka_model,
                          wetlab_protocol: protocol, }.to_json)
  end

  describe "constructor guards" do
    it "raises when neither SFN ARN app config is set" do
      with_wdl_version(fake_wdl_version)
      workflow_run = create(:workflow_run, workflow: test_workflow_name, sample: sample,
                                           inputs_json: { technology: illumina_technology }.to_json)

      expect { described_class.call(workflow_run) }
        .to raise_error(SfnCgPipelineDispatchService::SfnArnMissingError,
                        /SFN_SINGLE_WDL_ARN and SFN_CG_ARN not set/)
    end
  end

  context "with the SFN ARN configured" do
    before do
      create(:app_config, key: AppConfig::SFN_SINGLE_WDL_ARN, value: fake_sfn_arn)
      with_wdl_version(fake_wdl_version)
    end

    describe "#call when Step Functions returns no execution arn" do
      it "marks the workflow run failed and does not record an execution" do
        workflow_run = create(:workflow_run, workflow: test_workflow_name,
                                             status: WorkflowRun::STATUS[:created], sample: sample,
                                             inputs_json: { technology: illumina_technology,
                                                            accession_id: "ABC123", }.to_json)
        # The Aws stubbing layer refuses a nil execution_arn (it is a required response
        # member), so stub the client method itself to hand back a blank arn.
        allow(@mock_aws_clients[:states]).to receive(:start_execution)
          .and_return(execution_arn: nil, start_date: Time.zone.now)

        result = described_class.call(workflow_run)

        expect(result[:sfn_execution_arn]).to be_blank
        workflow_run.reload
        expect(workflow_run.status).to eq(WorkflowRun::STATUS[:failed])
        expect(workflow_run.executed_at).to be_nil
        expect(workflow_run.sfn_execution_arn).to be_nil
      end
    end

    describe "nanopore primer sets" do
      {
        midnight: "nCoV-2019/V1200",
        artic_v4: "nCoV-2019/V4",
        varskip: "NEB_VarSkip/V1a",
        artic_v5: "nCoV-2019/V5",
      }.each do |protocol_key, expected_primer_set|
        it "maps the #{protocol_key} protocol to #{expected_primer_set}" do
          result = described_class.call(nanopore_run(protocols[protocol_key]))

          expect(result[:sfn_input_json][:Input][:Run][:primer_set]).to eq(expected_primer_set)
          expect(result[:sfn_input_json][:Input][:Run][:technology]).to eq(nanopore_technology)
        end
      end
    end

    describe "technology validation" do
      it "rejects a technology value that is not a known input" do
        workflow_run = create(:workflow_run, workflow: test_workflow_name, sample: sample,
                                             inputs_json: { technology: "sanger" }.to_json)

        # The InvalidTechnologyError arm re-enters #technology to build its message, so the
        # unrecognized-technology path recurses until the stack gives out. Documented, not fixed here.
        expect { described_class.call(workflow_run) }.to raise_error(SystemStackError)
      end

      it "raises TechnologyMissingError when inputs_json carries no technology key" do
        workflow_run = create(:workflow_run, workflow: test_workflow_name, sample: sample,
                                             inputs_json: {}.to_json)

        expect { described_class.call(workflow_run) }
          .to raise_error(SfnCgPipelineDispatchService::TechnologyMissingError)
      end
    end

    describe "viral CG upload without a primer bed file" do
      let(:sample) do
        s = create(:sample, project: project, alignment_config_name: alignment_config.name)
        s.input_files += [create(:local_web_reference_sequence_input_file, name: "ref.fasta", sample: s)]
        s
      end

      it "falls back to the empty NA primer file and reports output_bed false" do
        workflow_run = create(:workflow_run, workflow: test_workflow_name,
                                             status: WorkflowRun::STATUS[:created], sample: sample,
                                             inputs_json: { technology: illumina_technology,
                                                            ref_fasta: "ref.fasta", }.to_json)

        run = described_class.call(workflow_run)[:sfn_input_json][:Input][:Run]

        expect(run[:primer_bed])
          .to eq("s3://#{S3_DATABASE_BUCKET}/consensus-genome/#{SfnCgPipelineDispatchService::NA_PRIMER_FILE}")
        expect(run[:output_bed]).to be(false)
        expect(JSON.parse(workflow_run.reload.inputs_json)["creation_source"])
          .to eq(ConsensusGenomeWorkflowRun::CREATION_SOURCE[:viral_cg_upload])
      end
    end

    describe "single-end samples" do
      let(:sample) do
        create(:sample, project: project, alignment_config_name: alignment_config.name,
                        input_files: [build(:local_web_input_file)])
      end

      it "sends a nil fastqs_1" do
        workflow_run = create(:workflow_run, workflow: test_workflow_name,
                                             status: WorkflowRun::STATUS[:created], sample: sample,
                                             inputs_json: { technology: illumina_technology,
                                                            accession_id: "ABC123", }.to_json)

        run = described_class.call(workflow_run)[:sfn_input_json][:Input][:Run]

        expect(run[:fastqs_0]).to be_present # rubocop:disable Naming/VariableNumber
        expect(run[:fastqs_1]).to be_nil # rubocop:disable Naming/VariableNumber
      end
    end
  end

  describe "WDL versions older than 3.4.13" do
    before do
      create(:app_config, key: AppConfig::SFN_SINGLE_WDL_ARN, value: fake_sfn_arn)
      @mock_aws_clients[:states].stub_responses(:list_tags_for_resource,
                                                tags: [{ key: "wdl_version", value: "3.4.12" }])
      with_wdl_version("3.4.12")
    end

    it "omits the alignment-config database paths" do
      workflow_run = create(:workflow_run, workflow: test_workflow_name,
                                           status: WorkflowRun::STATUS[:created], sample: sample,
                                           inputs_json: { technology: illumina_technology,
                                                          accession_id: "ABC123", }.to_json)

      run = described_class.call(workflow_run)[:sfn_input_json][:Input][:Run]

      expect(run).not_to have_key(:nt_s3_path)
      expect(run).not_to have_key(:nr_loc_db)
      expect(run[:ref_accession_id]).to eq("ABC123")
    end
  end
end
