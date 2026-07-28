require "rails_helper"

# Second-wave branch coverage for SfnPipelineDataService, aimed at
# #create_stage_nodes_scaffolding -- the one private helper the other specs never call
# directly (the happy-path service spec reaches it only through #call, which needs S3 WDLs).
# Two arms live in there and nowhere else: the "no dag name for this step" diagnostic, and
# the stage-level shortcut that reports a stage as finished purely because its
# PipelineRunStage succeeded, without consulting the individual step statuses.
RSpec.describe SfnPipelineDataService do
  HOST_FILTERING = PipelineRunStage::HOST_FILTERING_STAGE_NAME

  # Build the service without running #initialize (which parses WDLs off S3) and set only
  # the instance state create_stage_nodes_scaffolding reads.
  def service(ivars = {})
    svc = described_class.allocate
    defaults = {
      "@stages_wdl_info" => [],
      "@stage_names" => [],
      "@stage_job_statuses" => [],
      "@result_files" => {},
      "@host_filtering_stage_index" => nil,
      "@see_experimental" => false,
      "@remove_host_filtering_urls" => false,
    }
    defaults.merge(ivars).each { |name, value| svc.instance_variable_set(name, value) }
    svc
  end

  def pipeline_run_double(step_statuses_by_stage)
    double("PipelineRun", step_statuses_by_stage: step_statuses_by_stage)
  end

  describe "#create_stage_nodes_scaffolding" do
    let(:stage_info) do
      {
        "task_names" => ["RunValidateInput"],
        "task_inputs" => { "RunValidateInput" => ["WorkflowInput.fastqs"] },
        "inputs" => { "fastqs" => "File" },
        "basenames" => {},
      }
    end

    it "derives the description and status of a step from its dag-name status entry" do
      svc = service(
        "@pipeline_run" => pipeline_run_double([{ "validate_input_out" => { "status" => "uploaded", "start_time" => 10, "end_time" => 20, "resources" => { "log" => "s3://logs" } } }]),
        "@stages_wdl_info" => [stage_info],
        "@stage_names" => [HOST_FILTERING],
        "@stage_job_statuses" => [PipelineRunStage::STATUS_STARTED]
      )

      stages = svc.send(:create_stage_nodes_scaffolding)

      expect(stages.length).to eq(1)
      step = stages[0][:steps][0]
      expect(step[:name]).to eq("RunValidateInput")
      expect(step[:status]).to eq("finished")
      expect(step[:description]).to eq(PipelineRunsHelper::STEP_DESCRIPTIONS[HOST_FILTERING]["steps"]["validate_input_out"])
      expect(step[:startTime]).to eq(10)
      expect(step[:endTime]).to eq(20)
      expect(step[:resources]).to eq([{ name: "log", url: "s3://logs" }])
      expect(step[:inputFiles]).to eq([{ name: "fastqs", type: "File" }])
      # Stage is still running, so the status is inferred from the step statuses.
      expect(stages[0][:jobStatus]).to eq("finished")
    end

    it "logs a diagnostic when a task name resolves to no dag name at all" do
      svc = service(
        "@pipeline_run" => pipeline_run_double([{}]),
        "@stages_wdl_info" => [{ "task_names" => [nil], "task_inputs" => { nil => [] }, "inputs" => {}, "basenames" => {} }],
        "@stage_names" => [HOST_FILTERING],
        "@stage_job_statuses" => [PipelineRunStage::STATUS_STARTED]
      )
      allow(LogUtil).to receive(:log_message)

      stages = svc.send(:create_stage_nodes_scaffolding)

      expect(LogUtil).to have_received(:log_message).with("No dag name found for step  in stage #{HOST_FILTERING}")
      # A step with no status info at all is reported as not started, with an empty description.
      expect(stages[0][:steps][0][:status]).to eq("notStarted")
      expect(stages[0][:steps][0][:description]).to eq("")
    end

    it "reports a stage as finished from its succeeded run stage even while its steps are not started" do
      svc = service(
        "@pipeline_run" => pipeline_run_double([{}]),
        "@stages_wdl_info" => [stage_info],
        "@stage_names" => [HOST_FILTERING],
        "@stage_job_statuses" => [PipelineRunStage::STATUS_SUCCEEDED]
      )

      stages = svc.send(:create_stage_nodes_scaffolding)

      expect(stages[0][:steps][0][:status]).to eq("notStarted")
      expect(stages[0][:jobStatus]).to eq("finished")
    end

    it "prefers a status.json description over the built-in one and falls back to the raw step name lookup" do
      svc = service(
        "@pipeline_run" => pipeline_run_double([{ "RunValidateInput" => { "status" => "running", "description" => "From status.json" } }]),
        "@stages_wdl_info" => [stage_info],
        "@stage_names" => [HOST_FILTERING],
        "@stage_job_statuses" => [PipelineRunStage::STATUS_FAILED]
      )

      stages = svc.send(:create_stage_nodes_scaffolding)

      expect(stages[0][:steps][0][:description]).to eq("From status.json")
      # A running step in a failed stage is remapped to pipelineErrored.
      expect(stages[0][:steps][0][:status]).to eq("pipelineErrored")
      expect(stages[0][:jobStatus]).to eq("pipelineErrored")
    end
  end
end
