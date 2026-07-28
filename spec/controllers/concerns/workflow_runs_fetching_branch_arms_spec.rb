require "rails_helper"

# Second branch sweep for WorkflowRunsFetching. spec/controllers/concerns/
# workflow_runs_fetching_branches_spec.rb already covers filter/paginate/
# discovery and format_workflow_runs in BASIC mode; the arms still untaken are
# the "with_sample_info" side of format_workflow_runs (the includes(...) branch,
# the sample-info serialization, and the upload_error present/blank fork around
# result_status_description) plus fetch_workflow_runs' filter split.
RSpec.describe WorkflowRunsFetching, type: :concern do
  let(:host_class) do
    Class.new do
      include ParameterSanitization
      include SamplesHelper
      include WorkflowRunsFetching
      attr_accessor :current_user, :current_power
    end
  end

  let(:host) { host_class.new }

  # A workflow run double in a non-CG workflow so the CG inputs arm stays out of
  # the way -- the sample serialization is what we are exercising here.
  def workflow_run_double(id:, sample_id:)
    double(
      "workflow_run",
      id: id,
      workflow: WorkflowRun::WORKFLOW[:amr],
      user: double("user", name: "Runner #{id}"),
      user_id: 11,
      wdl_version: "1.0.0",
      created_at: Time.zone.parse("2022-03-04T00:00:00Z"),
      status: WorkflowRun::STATUS[:succeeded],
      parsed_cached_results: nil,
      sample_id: sample_id,
      sample: nil
    )
  end

  def sample_double(id:, upload_error:)
    double(
      "sample",
      id: id,
      upload_error: upload_error,
      project: double("project", name: "Proj #{id}"),
      slice: { id: id, name: "Sample #{id}" }
    )
  end

  describe "#format_workflow_runs in with_sample_info mode" do
    it "eager-loads the sample tree and serializes project/metadata/uploader/visibility" do
      sample = sample_double(id: 21, upload_error: nil)
      wr = workflow_run_double(id: 5, sample_id: 21)
      allow(wr).to receive(:sample).and_return(sample)

      rel = double("relation", empty?: false)
      allow(rel).to receive(:pluck).with(:sample_id).and_return([21, 21])
      allow(rel).to receive(:includes)
        .with(:user, sample: [:host_genome, :project, :user])
        .and_return([wr])

      allow(Metadatum).to receive(:by_sample_ids).with([21]).and_return(21 => { "host" => "Human" })
      allow(host).to receive(:get_visibility_by_sample_id).with([21]).and_return(21 => true)
      allow(host).to receive(:sample_uploader).with(sample).and_return(name: "Uploader", id: 3)
      # upload_error is blank, so the errored-sample description helper must not run.
      expect(host).not_to receive(:get_result_status_description_for_errored_sample)

      out = host.format_workflow_runs(workflow_runs: rel, mode: "with_sample_info")

      info = out.first[:sample][:info]
      expect(info[:id]).to eq(21)
      expect(info[:name]).to eq("Sample 21")
      expect(info[:public]).to be(true)
      expect(out.first[:sample][:metadata]).to eq("host" => "Human")
      expect(out.first[:sample][:project_name]).to eq("Proj 21")
      expect(out.first[:sample][:uploader]).to eq(name: "Uploader", id: 3)
      # only unique sample ids are looked up
      expect(Metadatum).to have_received(:by_sample_ids).with([21])
    end

    it "merges the result status description when the sample carries an upload_error" do
      sample = sample_double(id: 22, upload_error: "FAULTY_INPUT")
      wr = workflow_run_double(id: 6, sample_id: 22)
      allow(wr).to receive(:sample).and_return(sample)

      rel = double("relation", empty?: false)
      allow(rel).to receive(:pluck).with(:sample_id).and_return([22])
      allow(rel).to receive(:includes)
        .with(:user, sample: [:host_genome, :project, :user])
        .and_return([wr])

      allow(Metadatum).to receive(:by_sample_ids).and_return({})
      allow(host).to receive(:get_visibility_by_sample_id).and_return(22 => false)
      allow(host).to receive(:sample_uploader).and_return({})
      allow(host).to receive(:get_result_status_description_for_errored_sample)
        .with(sample).and_return(result_status_description: "FAULTY INPUT")

      out = host.format_workflow_runs(workflow_runs: rel, mode: "with_sample_info")

      expect(out.first[:sample][:info][:result_status_description]).to eq("FAULTY INPUT")
      expect(out.first[:sample][:info][:public]).to be(false)
    end

    it "leaves the info untouched when the errored-sample helper returns nothing" do
      sample = sample_double(id: 23, upload_error: "SOME_ERROR")
      wr = workflow_run_double(id: 7, sample_id: 23)
      allow(wr).to receive(:sample).and_return(sample)

      rel = double("relation", empty?: false)
      allow(rel).to receive(:pluck).with(:sample_id).and_return([23])
      allow(rel).to receive(:includes).and_return([wr])

      allow(Metadatum).to receive(:by_sample_ids).and_return({})
      allow(host).to receive(:get_visibility_by_sample_id).and_return({})
      allow(host).to receive(:sample_uploader).and_return({})
      allow(host).to receive(:get_result_status_description_for_errored_sample).with(sample).and_return(nil)

      out = host.format_workflow_runs(workflow_runs: rel, mode: "with_sample_info")

      expect(out.first[:sample][:info].keys).to contain_exactly(:id, :name, :public)
    end
  end

  describe "#fetch_workflow_runs" do
    it "splits the filters between the sample fetch and the workflow-run filter" do
      samples = double("samples")
      scoped = double("scoped_runs")
      non_deprecated = double("non_deprecated")
      filtered = double("filtered")

      allow(host).to receive(:fetch_samples).and_return(samples)
      host.current_power = double("power")
      allow(host.current_power).to receive(:samples_workflow_runs).with(samples).and_return(scoped)
      allow(scoped).to receive(:non_deprecated).and_return(non_deprecated)
      allow(non_deprecated).to receive(:non_deleted).and_return(filtered)
      allow(host).to receive(:filter_workflow_runs).and_return(:result)

      filters = {
        search: "abc", host: [1], projectId: 9,
        workflow: WorkflowRun::WORKFLOW[:amr], time: ["2020-01-01", "2020-02-01"],
      }

      expect(host.fetch_workflow_runs(domain: "my_data", filters: filters)).to eq(:result)

      expect(host).to have_received(:fetch_samples).with(
        domain: "my_data",
        filters: { search: "abc", host: [1], projectId: 9 }
      )
      expect(host).to have_received(:filter_workflow_runs).with(
        workflow_runs: filtered,
        filters: { workflow: WorkflowRun::WORKFLOW[:amr], time: ["2020-01-01", "2020-02-01"] }
      )
    end
  end
end
