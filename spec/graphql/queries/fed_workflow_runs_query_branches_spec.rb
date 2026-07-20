# frozen_string_literal: true

require "rails_helper"

# Branch sweep for the Queries::FedWorkflowRunsQuery concern (CZID-285/309). The existing
# spec is a request spec; these drive the two private helpers directly so the
# empty-on-error arm and the sample-id nil-coalesce arm are exercised in isolation.
#
# Branches driven (each fails if its arm is inverted/removed):
#   - valid_consensus_genome_workflow_runs: validation error -> [] (early return) vs
#     no error -> filter chain + row mapping.
#   - map_fed_workflow_run: sample_id present -> inputEntityId string vs absent -> nil (&.).
RSpec.describe Queries::FedWorkflowRunsQuery, type: :concern do
  # Host mixing in the concern. The `included do field ... end` needs a no-op `field` DSL;
  # the concern also reads `current_user`, stubbed per-example.
  let(:host_class) do
    Class.new do
      def self.field(*_args, **_kwargs); end
      include Queries::FedWorkflowRunsQuery
      attr_accessor :current_user
    end
  end

  let(:host) { host_class.new }

  describe "#valid_consensus_genome_workflow_runs" do
    it "returns [] when the access validation reports an error (no filtering)" do
      allow(WorkflowRunValidationService).to receive(:call)
        .and_return(error: "no permission", viewable_workflow_runs: nil)

      expect(host.send(:valid_consensus_genome_workflow_runs, [1, 2])).to eq([])
    end

    it "filters to non-deprecated CG runs and maps rows when there is no error" do
      cg_scope = double("cg_scope")
      allow(cg_scope).to receive(:non_deprecated).and_return(cg_scope)
      allow(cg_scope).to receive(:pluck).and_return([[10, 3, "SUCCEEDED"]])
      viewable = double("viewable")
      allow(viewable).to receive(:by_workflow).and_return(cg_scope)
      allow(WorkflowRunValidationService).to receive(:call)
        .and_return(error: nil, viewable_workflow_runs: viewable)

      result = host.send(:valid_consensus_genome_workflow_runs, [10])

      expect(viewable).to have_received(:by_workflow).with(WorkflowRun::WORKFLOW[:consensus_genome])
      expect(result).to eq([{ id: "10", ownerUserId: 3, status: "SUCCEEDED" }])
    end
  end

  describe "#map_fed_workflow_run" do
    it "stringifies the sample id into inputEntityId when present" do
      run = { "id" => 5, "sample" => { "info" => { "id" => 88 } }, "inputs" => {} }
      result = host.send(:map_fed_workflow_run, run)

      expect(result[:id]).to eq("5")
      expect(result[:entityInputs][:edges].first[:node][:inputEntityId]).to eq("88")
    end

    it "leaves inputEntityId nil when there is no sample id (the &. arm)" do
      run = { "id" => 5, "sample" => {}, "inputs" => { "creation_source" => "CLI" } }
      result = host.send(:map_fed_workflow_run, run)

      expect(result[:entityInputs][:edges].first[:node][:inputEntityId]).to be_nil
      # creation_source is threaded into the raw inputs JSON + workflow name.
      expect(result[:workflowVersion][:workflow][:name]).to eq("CLI")
    end
  end
end
