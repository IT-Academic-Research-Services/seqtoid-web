import React, { useEffect } from "react";
import { SampleMessage } from "~/components/common/SampleMessage";
import { IconLoading } from "~/components/ui/icons";
import { logError } from "~/components/utils/logUtil";
import {
  getWorkflowRunStatusCategory,
  isKnownWorkflowRunStatus,
} from "~/components/views/SampleView/utils";
import Sample, { WorkflowRun } from "~/interface/sample";
import { FailedMessage } from "./components/FailedMessage";
import cs from "./sample_report_content.scss";

export interface SampleReportContentProps {
  loadingResults: boolean;
  children: React.ReactNode;
  workflowRun?: WorkflowRun | null;
  sample: Sample;
  loadingInfo: {
    message: string;
    linkText?: string;
    helpLink?: string;
  };
  eventNames?: {
    loading: string;
    error: string;
  };
}

export const SampleReportContent = ({
  loadingResults,
  children,
  workflowRun,
  sample,
  loadingInfo,
  eventNames,
}: SampleReportContentProps) => {
  // SMP-1501 / SMP-1476: classify the run status instead of the old
  // `=== "SUCCEEDED"`-else-fail check. Because of a Relay store dataID collision the
  // status can arrive in either of two Rails vocabularies -- the raw WorkflowRun::STATUS
  // (SampleForReport) or the SFN-mapped form (fedWorkflowRuns) -- and the old check
  // misrendered the SFN-mapped successes ("COMPLETE") as the failure screen. See
  // WORKFLOW_RUN_STATUS_CATEGORY.
  const status = workflowRun?.status;
  const statusCategory = getWorkflowRunStatusCategory(status);

  // Surface (do not silently spinner) a status that is in neither known vocabulary, so a
  // new value degrading the UI to in-progress is discoverable rather than invisible.
  useEffect(() => {
    if (status && !isKnownWorkflowRunStatus(status)) {
      logError({
        message:
          "[SampleReportContent] Unrecognized workflow run status; defaulting to in-progress",
        details: {
          status,
          sampleId: sample.id,
          workflowRunId: workflowRun?.id,
        },
      });
    }
  }, [status, sample.id, workflowRun?.id]);

  return (
    <>
      {loadingResults ? (
        <SampleMessage
          icon={<IconLoading className={cs.icon} />}
          message={"Loading report data."}
          status={"Loading"}
          type={"inProgress"}
        />
      ) : statusCategory === "success" ? (
        children
      ) : sample.upload_error ? (
        // An upload error is a terminal failure regardless of run status (a run may not
        // exist). Success is handled above, so reaching here means it is not a success.
        <FailedMessage
          sample={sample}
          workflowRun={workflowRun}
          analyticsEventName={eventNames?.error}
        />
      ) : statusCategory === "inProgress" ? (
        <SampleMessage
          icon={<IconLoading className={cs.icon} />}
          link={loadingInfo?.helpLink}
          linkText={loadingInfo?.linkText}
          message={loadingInfo?.message}
          status={"IN PROGRESS"}
          type={"inProgress"}
          analyticsEventName={eventNames?.loading}
        />
      ) : statusCategory === "waiting" ? (
        <SampleMessage
          icon={<IconLoading className={cs.icon} />}
          message={"Waiting to Start or Receive Files"}
          status={"IN PROGRESS"}
          type={"inProgress"}
        />
      ) : (
        <FailedMessage
          sample={sample}
          workflowRun={workflowRun}
          analyticsEventName={eventNames?.error}
        />
      )}
    </>
  );
};
