import React from "react";
import { graphql, useLazyLoadQuery } from "react-relay";
import cs from "~/components/views/SampleView/components/ConsensusGenomeView/consensus_genome_view.scss";
import { SampleReportContent } from "~/components/views/SampleView/components/SampleReportConent";
import { getWorkflowRunStatusCategory } from "~/components/views/SampleView/utils";
import Sample, { WorkflowRun } from "~/interface/sample";
import { getConsensusGenomeHelpLink } from "../../utils";
import { ConsensusGenomeReportQuery as ConsensusGenomeReportQueryType } from "./__generated__/ConsensusGenomeReportQuery.graphql";
import { ConsensusGenomeCoverageView } from "./components/ConsensusGenomeCoverageView";
import { ConsensusGenomeMetricsTable } from "./components/ConsensusGenomeMetricsTable";

const ConsensusGenomeReportQuery = graphql`
  query ConsensusGenomeReportQuery($workflowRunId: String) {
    fedConsensusGenomes(
      input: { where: { producingRunId: { _eq: $workflowRunId } } }
    ) {
      ...ConsensusGenomeMetricsTableFragment
      ...ConsensusGenomeCoverageViewFragment
      ...ConsensusGenomeHistogramFragment
    }
  }
`;
interface ConsensusGenomeReportProps {
  sample: Sample;
  workflowRun: WorkflowRun;
}

export const ConsensusGenomeReport = ({
  sample,
  workflowRun,
}: ConsensusGenomeReportProps) => {
  const data = useLazyLoadQuery<ConsensusGenomeReportQueryType>(
    ConsensusGenomeReportQuery,
    {
      workflowRunId: workflowRun?.id?.toString(),
    },
  );

  const workflowRunResultsDataNullable = data.fedConsensusGenomes;
  // SMP-1908: a complete-with-issue run produces no genome, so fedConsensusGenomes is
  // empty/absent. Do NOT early-return null for it -- fall through to SampleReportContent so
  // its shared "successWithIssue" branch can surface the reason. A genuinely SUCCEEDED run
  // with no genome still early-returns null here (unchanged behaviour).
  const isCompleteWithIssue =
    getWorkflowRunStatusCategory(workflowRun?.status) === "successWithIssue";
  if (!workflowRunResultsDataNullable && !isCompleteWithIssue) {
    return null;
  }
  // filter out null values from the array
  const workflowRunResultsData = (workflowRunResultsDataNullable ?? []).filter(
    (value): value is NonNullable<typeof value> => !!value,
  );

  const helpLinkUrl = getConsensusGenomeHelpLink(
    workflowRun.inputs?.accession_id,
  );

  return (
    <SampleReportContent
      sample={sample}
      workflowRun={workflowRun}
      // loadingResults is false because with Relay and GraphQL we are using Suspense to handle the loading state
      // once all the Reports are using Relay and GraphQL, we can remove this prop from SampleReportContent
      loadingResults={false}
      loadingInfo={{
        linkText: "Learn about Consensus Genomes",
        message: "Your Consensus Genome is being generated!",
        helpLink: helpLinkUrl,
      }}
      eventNames={{
        error: "ConsensusGenomeView_sample-error-info-link_clicked",
        loading: "ConsensusGenomeView_consenus-genome-doc-link_clicked",
      }}
    >
      {workflowRunResultsData && (
        <div className={cs.resultsContainer}>
          <ConsensusGenomeMetricsTable
            helpLinkUrl={helpLinkUrl}
            workflowRunResultsData={workflowRunResultsData}
          />
          <ConsensusGenomeCoverageView
            helpLinkUrl={helpLinkUrl}
            sampleId={sample.id}
            workflowRun={workflowRun}
            workflowRunResultsData={workflowRunResultsData}
          />
        </div>
      )}
    </SampleReportContent>
  );
};
