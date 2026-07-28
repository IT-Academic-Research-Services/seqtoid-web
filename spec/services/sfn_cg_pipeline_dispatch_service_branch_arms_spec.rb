require 'rails_helper'
require 'json'

# Branch coverage for the nil-tolerant (`inputs&.[]`) arms of SfnCgPipelineDispatchService's
# private helpers. Each of these helpers reads the workflow run's parsed inputs with a safe
# navigation operator, so each has a "no inputs at all" arm that decides what the dispatcher
# does when a run carries no inputs hash. In the full #call flow #technology raises first, so
# these arms are only observable by exercising the helpers directly -- which is exactly the
# contract they exist to provide.
RSpec.describe SfnCgPipelineDispatchService, type: :service do
  let(:fake_account_id) { "123456789012" }
  let(:fake_sfn_arn) { "fake:sfn:arn" }
  let(:fake_sfn_execution_arn) { "fake:sfn:execution:arn" }
  let(:fake_wdl_version) { "10.0.0" }
  let(:test_workflow_name) { WorkflowRun::WORKFLOW[:consensus_genome] }
  let(:illumina_technology) { ConsensusGenomeWorkflowRun::TECHNOLOGY_INPUT[:illumina] }

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

  let(:workflow_run) do
    create(:workflow_run,
           workflow: test_workflow_name,
           status: WorkflowRun::STATUS[:created],
           sample: sample,
           inputs_json: { technology: illumina_technology, accession_id: "ABC123" }.to_json)
  end

  before do
    Aws.config[:stub_responses] = true
    mock_aws_clients = { states: fake_states_client, sts: fake_sts_client }
    allow(AwsClient).to receive(:[]) { |client| mock_aws_clients[client] }

    create(:app_config, key: AppConfig::SFN_SINGLE_WDL_ARN, value: fake_sfn_arn)
    create(:app_config,
           key: format(AppConfig::WORKFLOW_VERSION_TEMPLATE, workflow_name: test_workflow_name),
           value: fake_wdl_version)
  end

  # Build the service against a run that DOES have inputs (the constructor requires them), then
  # take the inputs away so the helpers see the nil-receiver arm of their `inputs&.[]` reads.
  def service_without_inputs
    service = described_class.new(workflow_run)
    allow(workflow_run).to receive(:inputs).and_return(nil)
    service
  end

  describe "#apply_length_filter" do
    it "keeps the length filter on when the run carries no inputs" do
      expect(service_without_inputs.send(:apply_length_filter)).to be(true)
    end

    it "turns the length filter off for a ClearLabs run" do
      workflow_run.update!(inputs_json: { technology: illumina_technology, accession_id: "ABC123",
                                          clearlabs: true, }.to_json)
      service = described_class.new(workflow_run)

      expect(service.send(:apply_length_filter)).to be(false)
    end
  end

  describe "#technology" do
    it "raises TechnologyMissingError when the run carries no inputs" do
      service = service_without_inputs

      expect { service.send(:technology) }
        .to raise_error(described_class::TechnologyMissingError, /Technology not found/)
    end
  end

  describe "#medaka_model" do
    it "raises InvalidMedakaModelError when the run carries no inputs" do
      service = service_without_inputs

      expect { service.send(:medaka_model) }
        .to raise_error(described_class::InvalidMedakaModelError, /Medaka model option not recognized/)
    end
  end

  describe "#illumina_primer_file" do
    it "raises WetlabProtocolMissingError when the run carries no inputs" do
      service = service_without_inputs

      expect { service.send(:illumina_primer_file) }
        .to raise_error(described_class::WetlabProtocolMissingError, /Wetlab Protocol not found/)
    end

    it "still maps a known protocol to its primer bed file" do
      workflow_run.update!(inputs_json: {
        technology: illumina_technology, accession_id: "ABC123",
        wetlab_protocol: ConsensusGenomeWorkflowRun::WETLAB_PROTOCOL[:ampliseq],
      }.to_json)
      service = described_class.new(workflow_run)

      expect(service.send(:illumina_primer_file)).to eq("ampliseq_primers.bed")
    end
  end

  describe "#nanopore_primer_set" do
    it "raises WetlabProtocolMissingError (not InvalidWetlabProtocolError) when there are no inputs" do
      service = service_without_inputs

      expect { service.send(:nanopore_primer_set) }
        .to raise_error(described_class::WetlabProtocolMissingError, /Wetlab Protocol not found/)
    end

    it "raises InvalidWetlabProtocolError when a protocol is supplied that ONT does not support" do
      workflow_run.update!(inputs_json: {
        technology: ConsensusGenomeWorkflowRun::TECHNOLOGY_INPUT[:nanopore],
        wetlab_protocol: ConsensusGenomeWorkflowRun::WETLAB_PROTOCOL[:msspe],
      }.to_json)
      service = described_class.new(workflow_run)

      expect { service.send(:nanopore_primer_set) }
        .to raise_error(described_class::InvalidWetlabProtocolError, /is not supported for technology/)
    end
  end
end
