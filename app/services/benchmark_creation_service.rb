# Creates a benchmark Sample + BenchmarkWorkflowRun comparing one or two runs (and optionally a
# ground-truth file) and dispatches it. Extracted from SamplesController#benchmark so the admin
# endpoint and non-HTTP callers (the RC AUPR gate tick) share one creation path.
#
# A benchmark sample is synthetic: it has no input files or host genome, so it is inserted with
# validations and callbacks skipped (same as the original controller code).
class BenchmarkCreationService
  include Callable

  # run_ids: PipelineRun ids for mNGS workflows, WorkflowRun ids otherwise (first is the run under
  # test, second -- if present -- is the REF).
  def initialize(run_ids:, workflow_benchmarked:, project_id:, user_id:, sample_name:, ground_truth_file: nil)
    @run_ids = run_ids
    @workflow_benchmarked = workflow_benchmarked
    @project_id = project_id
    @user_id = user_id
    @sample_name = sample_name
    @ground_truth_file = ground_truth_file
  end

  # Returns the dispatched benchmark WorkflowRun (call #workflow_by_class for the subclass).
  def call
    now = Time.current
    # rubocop:disable Rails/SkipsModelValidations
    Sample.insert({
                    name: @sample_name,
                    status: Sample::STATUS_CHECKED,
                    user_id: @user_id,
                    initial_workflow: WorkflowRun::WORKFLOW[:benchmark],
                    project_id: @project_id,
                    created_at: now,
                    updated_at: now,
                  })

    benchmark_sample_id = Sample.where(name: @sample_name, project_id: @project_id).last.id
    WorkflowRun.insert({
                         sample_id: benchmark_sample_id,
                         user_id: @user_id,
                         workflow: WorkflowRun::WORKFLOW[:benchmark],
                         created_at: now,
                         updated_at: now,
                         wdl_version: AppConfigHelper.get_workflow_version(WorkflowRun::WORKFLOW[:benchmark]),
                         inputs_json: {
                           run_ids: @run_ids,
                           workflow_benchmarked: @workflow_benchmarked,
                           ground_truth_file: @ground_truth_file,
                         }.to_json,
                       })
    # rubocop:enable Rails/SkipsModelValidations

    benchmark_wr = WorkflowRun.where(sample_id: benchmark_sample_id, workflow: WorkflowRun::WORKFLOW[:benchmark]).last
    benchmark_wr.dispatch
    benchmark_wr
  end
end
