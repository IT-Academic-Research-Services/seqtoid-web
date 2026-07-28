require "rails_helper"

# Branch coverage for Queries::FedWorkflowRunsQuery. The sibling request specs drive the
# resolver end-to-end through GraphQL, which only ever hands it a fully-populated
# `todoRemove` input -- so the `td&.` nil arms, the ids-validation mode's error path and the
# nil-sample mapping arm are never taken. These examples include the concern into a bare
# resolver host so each arm can be driven directly, with no schema or HTTP in the way.
RSpec.describe Queries::FedWorkflowRunsQuery do
  # A minimal host for the concern: `included do field ... end` only needs a `field` class
  # method, and the resolver body only needs `discovery_workflow_runs` + `current_user`,
  # which real QueryType supplies via WorkflowRunsFetching / GraphqlAuthHelpers.
  let(:resolver_class) do
    Class.new do
      def self.field(*_args, **_kwargs)
      end

      include Queries::FedWorkflowRunsQuery

      attr_accessor :current_user

      def discovery_workflow_runs(**_kwargs)
        { workflow_runs: [] }
      end
    end
  end

  let(:resolver) { resolver_class.new }

  describe "#resolve_fed_workflow_runs" do
    it "raises when the input is nil" do
      expect { resolver.resolve_fed_workflow_runs(input: nil) }
        .to raise_error(GraphQL::ExecutionError, "fedWorkflowRuns input is nullish")
    end

    it "passes nils through for every filter when todoRemove is absent" do
      captured = nil
      allow(resolver).to receive(:discovery_workflow_runs) do |**kwargs|
        captured = kwargs
        { workflow_runs: [] }
      end

      expect(resolver.resolve_fed_workflow_runs(input: OpenStruct.new)).to eq([])
      expect(captured[:domain]).to be_nil
      expect(captured[:order_by]).to be_nil
      expect(captured[:order_dir]).to be_nil
      expect(captured[:filters].values.compact).to be_empty
      expect(captured[:limit]).to eq(described_class::DISCOVERY_LIMIT)
    end

    it "forwards every todoRemove filter when one is supplied" do
      captured = nil
      allow(resolver).to receive(:discovery_workflow_runs) do |**kwargs|
        captured = kwargs
        { workflow_runs: [] }
      end

      td = OpenStruct.new(
        domain: "my_data", search: "flu", host: [1], location_v2: ["CA"], tissue: ["serum"],
        project_id: 3, visibility: ["public"], time: %w[2024-01-01 2024-02-01],
        workflow: "consensus-genome", taxon: [11], order_by: "createdAt", order_dir: "desc"
      )

      resolver.resolve_fed_workflow_runs(input: OpenStruct.new(todoRemove: td))

      expect(captured[:domain]).to eq("my_data")
      expect(captured[:order_by]).to eq("createdAt")
      expect(captured[:order_dir]).to eq("desc")
      expect(captured[:filters]).to include(
        search: "flu", host: [1], locationV2: ["CA"], tissue: ["serum"],
        projectId: 3, visibility: ["public"], workflow: "consensus-genome", taxon: [11]
      )
    end

    it "takes the discovery path when `where` is present but carries no id filter" do
      expect(resolver).to receive(:discovery_workflow_runs).and_return(workflow_runs: [])

      resolver.resolve_fed_workflow_runs(input: OpenStruct.new(where: OpenStruct.new))
    end

    it "takes the discovery path when the id filter has an empty _in list" do
      expect(resolver).to receive(:discovery_workflow_runs).and_return(workflow_runs: [])

      resolver.resolve_fed_workflow_runs(input: OpenStruct.new(where: OpenStruct.new(id: OpenStruct.new(_in: []))))
    end
  end

  describe "the ids-validation mode" do
    let(:user) { create(:user) }
    let(:project) { create(:project, users: [user]) }
    let(:sample) { create(:sample, project: project, user: user) }
    let!(:cg_run) do
      create(:workflow_run,
             sample: sample, user: user,
             workflow: WorkflowRun::WORKFLOW[:consensus_genome],
             status: WorkflowRun::STATUS[:succeeded],
             deprecated: false)
    end
    let!(:deprecated_run) do
      create(:workflow_run,
             sample: sample, user: user,
             workflow: WorkflowRun::WORKFLOW[:consensus_genome],
             status: WorkflowRun::STATUS[:succeeded],
             deprecated: true)
    end

    before { resolver.current_user = user }

    it "returns only the non-deprecated consensus-genome runs in the federation shape" do
      allow(WorkflowRunValidationService).to receive(:call).and_return(
        error: nil, viewable_workflow_runs: WorkflowRun.where(id: [cg_run.id, deprecated_run.id])
      )

      result = resolver.resolve_fed_workflow_runs(
        input: OpenStruct.new(where: OpenStruct.new(id: OpenStruct.new(_in: [cg_run.id, deprecated_run.id])))
      )

      expect(result).to eq([{ id: cg_run.id.to_s, ownerUserId: user.id, status: cg_run.status }])
    end

    it "returns an empty list when access validation reports an error" do
      allow(WorkflowRunValidationService).to receive(:call).and_return(error: :not_found, viewable_workflow_runs: nil)

      result = resolver.resolve_fed_workflow_runs(
        input: OpenStruct.new(where: OpenStruct.new(id: OpenStruct.new(_in: [cg_run.id])))
      )

      expect(result).to eq([])
    end
  end

  describe "#map_fed_workflow_run" do
    it "maps a fully-populated run, stringifying the sample id" do
      run = {
        "id" => 12, "status" => "SUCCEEDED", "created_at" => "2024-01-01T00:00:00Z",
        "wdl_version" => "3.4.1",
        "inputs" => { "creation_source" => "CLI" },
        "runner" => { "id" => 7 },
        "sample" => { "info" => { "id" => 99 } },
      }

      mapped = resolver.send(:map_fed_workflow_run, run)

      expect(mapped[:id]).to eq("12")
      expect(mapped[:ownerUserId]).to eq(7)
      expect(mapped[:rawInputsJson]).to eq(%({"creation_source": "CLI"}))
      expect(mapped[:workflowVersion]).to eq(version: "3.4.1", workflow: { name: "CLI" })
      expect(mapped[:entityInputs][:edges].first[:node][:inputEntityId]).to eq("99")
    end

    it "leaves the input entity id nil when the run has no sample info" do
      mapped = resolver.send(:map_fed_workflow_run, "id" => 5, "status" => "RUNNING")

      expect(mapped[:entityInputs][:edges].first[:node][:inputEntityId]).to be_nil
      expect(mapped[:entityInputs][:edges].first[:node][:entityType]).to eq("sequencing_read")
    end
  end
end
