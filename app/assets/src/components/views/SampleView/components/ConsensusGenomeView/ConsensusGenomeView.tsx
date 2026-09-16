import { Callout } from "@czi-sds/components";
import React, { Suspense } from "react";
import { SampleMessage } from "~/components/common/SampleMessage";
import csSampleMessage from "~/components/common/SampleMessage/sample_message.scss";
import Sample, { SampleStatus, WorkflowRun } from "~/interface/sample";
import { IconLoading } from "~ui/icons";
import { ConsensusGenomeHeader } from "./components/ConsensusGenomeHeader";
import { ConsensusGenomeReport } from "./components/ConsensusGenomeReport";
import cs from "./consensus_genome_view.scss";
import { getConsensusGenomeIssueMessage } from "./utils";
interface ConsensusGenomeViewProps {
  onWorkflowRunSelect: $TSFixMeFunction;
  sample: Sample | null;
  workflowRun?: WorkflowRun | null;
}

export const ConsensusGenomeView = ({
  onWorkflowRunSelect,
  sample,
  workflowRun,
}: ConsensusGenomeViewProps) => {
  if (sample && workflowRun) {
    // SMP-1908: a "Complete - Issue" run (e.g. insufficient coverage) produces no genome, so
    // the report body below renders empty. Surface the stored reason as an info banner here --
    // above the genome-data query, which early-returns null when there is no consensus genome --
    // so the user learns why instead of seeing a blank report.
    const issueMessage = getConsensusGenomeIssueMessage(workflowRun);
    return (
      <>
        <ConsensusGenomeHeader
          sample={sample}
          workflowRun={workflowRun}
          onWorkflowRunSelect={onWorkflowRunSelect}
        />
        {issueMessage && (
          <Callout
            className={cs.issueCallout}
            intent="info"
            data-testid="consensus-genome-issue-callout"
          >
            {issueMessage}
          </Callout>
        )}
        <Suspense
          fallback={
            <SampleMessage
              icon={<IconLoading className={csSampleMessage.icon} />}
              message={"Loading report data."}
              status={"Loading"}
              type={"inProgress"}
            />
          }
        >
          <ConsensusGenomeReport sample={sample} workflowRun={workflowRun} />
        </Suspense>
      </>
    );
  } else {
    return (
      <SampleMessage
        icon={<IconLoading className={csSampleMessage.icon} />}
        message={"Loading report data."}
        status={SampleStatus.LOADING}
        type={"inProgress"}
      />
    );
  }
};
