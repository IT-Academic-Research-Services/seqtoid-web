# frozen_string_literal: true

# L1 pipeline-failure enrichment for the in-app "Report an issue" flow.
#
# Given a run context ({sample_id, run_id, workflow}) submitted alongside a support
# request and the requesting user's viewable-samples Power, this returns a compact,
# support-only failure detail hash plus a friendly user-facing one-liner -- or nil
# when there is no accessible failed run to attach.
#
# SCOPE (v1 = L1): DB columns ONLY. This never makes an AWS call. In particular it
# does NOT call WorkflowRun#input_error / #error_message_display, which reach into
# Step Functions (that is L2, handled later by a dedicated, least-privilege
# enrichment lambda -- never from the internet-facing web tier). Here we read the
# raw error_message column and the run's stored status, nothing more.
#
# Access control: the sample is resolved through the caller's Power (viewable
# samples), so a user can only ever enrich a run they are allowed to see.
#
# Covers all workflows: mNGS runs live in pipeline_runs; consensus-genome / AMR /
# long-read live in workflow_runs. The frontend sends `workflow` to disambiguate.
class SupportPipelineFailure
  include Callable

  # mNGS is modeled by pipeline_runs; everything else by workflow_runs.
  MNGS_WORKFLOWS = ["short-read-mngs", "long-read-mngs", "mngs"].freeze

  def initialize(user_power:, sample_id:, run_id: nil, workflow: nil)
    @power = user_power
    @sample_id = sample_id.presence && sample_id.to_i
    @run_id = run_id.presence && run_id.to_i
    @workflow = workflow.to_s.presence
  end

  def call
    return nil if @power.nil? || @sample_id.nil?

    # Access control: only samples this user can view are resolvable.
    sample = @power.samples.find_by(id: @sample_id)
    return nil if sample.nil?

    run = resolve_run(sample)
    return nil if run.nil? || !failed?(run)

    build_detail(sample, run)
  rescue StandardError => e
    # Enrichment is best-effort: never let it break a support submission.
    LogUtil.log_error("SupportPipelineFailure enrichment failed", exception: e)
    nil
  end

  private

  def mngs?
    @workflow.nil? || MNGS_WORKFLOWS.include?(@workflow)
  end

  def resolve_run(sample)
    if mngs?
      scope = sample.pipeline_runs
      @run_id ? scope.find_by(id: @run_id) : scope.order(id: :desc).first
    else
      scope = WorkflowRun.where(sample_id: sample.id)
      scope = scope.where(workflow: @workflow) if @workflow
      @run_id ? scope.find_by(id: @run_id) : scope.order(id: :desc).first
    end
  end

  def failed?(run)
    if run.is_a?(PipelineRun)
      run.failed?
    else
      run.status == WorkflowRun::STATUS[:failed] ||
        WorkflowRun::FAILED_REMOTE_STATUSES.include?(run.status)
    end
  end

  def build_detail(sample, run)
    common = {
      sample_id: sample.id,
      sample_name: sample.name,
      project_id: sample.project_id,
      sfn_execution_arn: run.sfn_execution_arn,
      wdl_version: run.wdl_version,
      s3_output_prefix: run.s3_output_prefix,
      # L2/L3 (SFN cause + CloudWatch tail) is intentionally deferred to the
      # enrichment lambda; flagged so the operator knows more can be pulled.
      deep_enrichment: "pending (L2/L3 async)",
    }

    if run.is_a?(PipelineRun)
      stage = failed_stage_label(run.job_status)
      common.merge(
        run_type: "pipeline_run",
        run_id: run.id,
        workflow: sample.initial_workflow,
        status: run.job_status,
        failed_stage: stage,
        error_message: run.error_message,
        known_user_error: run.known_user_error,
        pipeline_version: run.pipeline_version,
        technology: run.technology,
        user_facing: user_line(stage: stage, workflow: sample.initial_workflow),
      )
    else
      common.merge(
        run_type: "workflow_run",
        run_id: run.id,
        workflow: run.workflow,
        status: run.status,
        failed_stage: nil,
        # DB column only -- do NOT call error_message_display (it hits SFN = L2).
        error_message: run.error_message,
        known_user_error: nil,
        user_facing: user_line(stage: nil, workflow: run.workflow),
      )
    end
  end

  # "1.Host Filtering-FAILED|READY" -> "Host Filtering"; "FAILED" -> nil.
  def failed_stage_label(job_status)
    return nil if job_status.blank?

    token = job_status.split("|").first.to_s
    match = token.match(/\A\d+\.(.+)-FAILED\z/)
    match && match[1].strip.presence
  end

  # High-level, non-technical one-liner for the end user (decision: the user sees a
  # friendly summary; raw error_message / ARNs stay in the support-only payload).
  def user_line(stage:, workflow:)
    label = workflow_label(workflow)
    if stage
      "Your #{label} run stopped during the #{stage} step and did not finish."
    else
      "Your #{label} run did not finish successfully."
    end
  end

  def workflow_label(workflow)
    {
      "short-read-mngs" => "metagenomics",
      "long-read-mngs" => "nanopore metagenomics",
      "mngs" => "metagenomics",
      "consensus-genome" => "consensus genome",
      "amr" => "antimicrobial resistance",
    }.fetch(workflow.to_s, "analysis")
  end
end
