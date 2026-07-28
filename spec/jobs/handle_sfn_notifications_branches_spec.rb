require "rails_helper"

# Branch sweep for HandleSfnNotifications, companion to
# handle_sfn_notifications_spec.rb (which drives the happy WorkflowRun /
# PipelineRun paths) and handle_sfn_notifications_timeout_spec.rb.
#
# Untaken arms filled in here:
#   * perform: the `return if body.blank?` guard, and the ELSE of the
#     `body["Message"] ? JSON.parse(...) : body` ternary (an already-unwrapped
#     EventBridge envelope with no SNS "Message" key).
#   * handle_phylo_tree_ng_update: the found-and-not-finalized arm.
#   * handle_pipeline_run_update: pr nil; pr already finalized (status update
#     skipped); the nanopore single-stage status arm; results already finalized
#     (no result loading); the stage-complete Illumina load arm; and the
#     terminal-status monitor_results arm.
#
# NOTE: self-contained -- ENABLE_SFN_NOTIFICATIONS is seeded in-spec because the
# pipeline-run path is gated on it.
RSpec.describe HandleSfnNotifications, type: :job do
  subject { described_class.new }

  let(:project) { create(:project) }
  let(:sample) { create(:sample, project: project, name: "Branch Sample") }
  let(:sqs_msg) { double(message_id: "fake-message-id", body: "fake-body", delete: nil) }

  # An EventBridge status-change event, NOT wrapped in an SNS "Message" envelope.
  def unwrapped_event(arn, status, extra_detail = {})
    {
      "detail-type" => described_class::STATUS_CHANGE_DETAIL_TYPE,
      "detail" => { "executionArn" => arn, "status" => status }.merge(extra_detail),
    }
  end

  describe "#perform message-shape arms" do
    it "returns immediately for a blank body without touching any lookup" do
      expect(WorkflowRun).not_to receive(:find_by)
      expect(sqs_msg).not_to receive(:delete)

      expect(subject.perform(sqs_msg, nil)).to be_nil
      expect(subject.perform(sqs_msg, {})).to be_nil
    end

    it "reads the event directly when there is no SNS 'Message' envelope" do
      wr = create(
        :workflow_run,
        sample: sample,
        sfn_execution_arn: "unwrapped-wr-arn",
        status: WorkflowRun::STATUS[:created]
      )
      expect(sqs_msg).to receive(:delete)

      subject.perform(sqs_msg, unwrapped_event("unwrapped-wr-arn", WorkflowRun::STATUS[:running]))

      expect(wr.reload.status).to eq(WorkflowRun::STATUS[:running])
    end
  end

  describe "#handle_phylo_tree_ng_update" do
    it "updates an unfinalized PhyloTreeNg and deletes the message" do
      pt = create(:phylo_tree_ng, sfn_execution_arn: "pt-arn", status: WorkflowRun::STATUS[:running])
      expect(sqs_msg).to receive(:delete)

      subject.handle_phylo_tree_ng_update("pt-arn", sqs_msg, "SUCCEEDED")

      expect(pt.reload.status).to eq(WorkflowRun::STATUS[:succeeded])
    end

    it "leaves an already-finalized PhyloTreeNg alone" do
      pt = create(:phylo_tree_ng, sfn_execution_arn: "pt-done-arn", status: WorkflowRun::STATUS[:succeeded])
      expect(sqs_msg).not_to receive(:delete)

      subject.handle_phylo_tree_ng_update("pt-done-arn", sqs_msg, "FAILED")

      expect(pt.reload.status).to eq(WorkflowRun::STATUS[:succeeded])
    end
  end

  describe "#handle_pipeline_run_update" do
    let(:details) { { "executionArn" => "pr-arn", "status" => "SUCCEEDED" } }

    it "does nothing when no PipelineRun owns the arn" do
      expect(sqs_msg).not_to receive(:delete)

      subject.handle_pipeline_run_update("no-such-arn", sqs_msg, details, "SUCCEEDED")
    end

    it "skips the status update for an already-finalized run but still deletes the message" do
      create(
        :pipeline_run,
        sample: sample,
        sfn_execution_arn: "pr-finalized-arn",
        finalized: 1,
        results_finalized: PipelineRun::FINALIZED_SUCCESS
      )
      expect_any_instance_of(PipelineRun).not_to receive(:async_update_job_status)
      expect_any_instance_of(PipelineRun).not_to receive(:update_single_stage_run_status)
      expect_any_instance_of(PipelineRun).not_to receive(:monitor_results)
      expect(sqs_msg).to receive(:delete)

      subject.handle_pipeline_run_update("pr-finalized-arn", sqs_msg, details, "SUCCEEDED")
    end

    it "uses the single-stage status update for a nanopore run" do
      create(
        :pipeline_run,
        sample: sample,
        sfn_execution_arn: "pr-ont-arn",
        finalized: 0,
        results_finalized: PipelineRun::FINALIZED_SUCCESS,
        technology: PipelineRun::TECHNOLOGY_INPUT[:nanopore]
      )
      expect_any_instance_of(PipelineRun).to receive(:update_single_stage_run_status)
      expect_any_instance_of(PipelineRun).not_to receive(:async_update_job_status)

      subject.handle_pipeline_run_update("pr-ont-arn", sqs_msg, details, "RUNNING")
    end

    it "loads the completed stage's results for an Illumina run and enqueues taxon indexing" do
      pr = create(
        :pipeline_run,
        sample: sample,
        sfn_execution_arn: "pr-stage-arn",
        finalized: 1,
        results_finalized: PipelineRun::IN_PROGRESS,
        technology: PipelineRun::TECHNOLOGY_INPUT[:illumina]
      )
      stage_details = details.merge("executionArn" => "pr-stage-arn", "lastCompletedStage" => "host_filter_out")

      expect_any_instance_of(PipelineRun).to receive(:load_stage_results).with("host_filter_out")
      expect_any_instance_of(PipelineRun).not_to receive(:monitor_results)
      expect(Resque).to receive(:enqueue).with(IndexTaxons, anything, pr.id)
      expect(sqs_msg).to receive(:delete)

      subject.handle_pipeline_run_update("pr-stage-arn", sqs_msg, stage_details, "RUNNING")
    end

    it "monitors results when the execution reached a terminal FAILED status" do
      create(
        :pipeline_run,
        sample: sample,
        sfn_execution_arn: "pr-failed-arn",
        finalized: 1,
        results_finalized: PipelineRun::IN_PROGRESS,
        technology: PipelineRun::TECHNOLOGY_INPUT[:illumina]
      )
      # No lastCompletedStage -> falls through to the terminal-status elsif.
      expect_any_instance_of(PipelineRun).to receive(:monitor_results)
      expect_any_instance_of(PipelineRun).not_to receive(:load_stage_results)
      expect(sqs_msg).to receive(:delete)

      subject.handle_pipeline_run_update("pr-failed-arn", sqs_msg, details.merge("executionArn" => "pr-failed-arn"), "FAILED")
    end

    it "loads nothing when the results are already finalized" do
      create(
        :pipeline_run,
        sample: sample,
        sfn_execution_arn: "pr-results-done-arn",
        finalized: 1,
        results_finalized: PipelineRun::FINALIZED_SUCCESS,
        technology: PipelineRun::TECHNOLOGY_INPUT[:illumina]
      )
      expect_any_instance_of(PipelineRun).not_to receive(:monitor_results)
      expect_any_instance_of(PipelineRun).not_to receive(:load_stage_results)
      expect(sqs_msg).to receive(:delete)

      subject.handle_pipeline_run_update(
        "pr-results-done-arn", sqs_msg,
        details.merge("executionArn" => "pr-results-done-arn", "lastCompletedStage" => "host_filter_out"),
        "FAILED"
      )
    end
  end

  describe "#stage_complete_event?" do
    it "is true only when lastCompletedStage is present" do
      expect(subject.stage_complete_event?("lastCompletedStage" => "host_filter_out")).to be(true)
      expect(subject.stage_complete_event?("lastCompletedStage" => "")).to be(false)
      expect(subject.stage_complete_event?({})).to be(false)
    end
  end

  describe "the ENABLE_SFN_NOTIFICATIONS gate inside #perform" do
    it "does not touch PipelineRun when the app config is off" do
      AppConfigHelper.set_app_config(AppConfig::ENABLE_SFN_NOTIFICATIONS, "0")
      create(:pipeline_run, sample: sample, sfn_execution_arn: "gated-arn")

      expect(PipelineRun).not_to receive(:find_by)

      subject.perform(sqs_msg, unwrapped_event("gated-arn", "SUCCEEDED"))
    end

    it "reaches PipelineRun when the app config is on" do
      AppConfigHelper.set_app_config(AppConfig::ENABLE_SFN_NOTIFICATIONS, "1")
      create(:pipeline_run, sample: sample, sfn_execution_arn: "gated-on-arn", finalized: 1, results_finalized: PipelineRun::FINALIZED_SUCCESS)

      expect(PipelineRun).to receive(:find_by).with(sfn_execution_arn: "gated-on-arn").and_call_original

      subject.perform(sqs_msg, unwrapped_event("gated-on-arn", "SUCCEEDED"))
    end
  end
end
