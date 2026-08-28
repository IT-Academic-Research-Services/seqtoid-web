import { cx } from "@emotion/css";
import React, { useCallback } from "react";
import { graphql, useFragment } from "react-relay";
import { SampleMessage } from "~/components/common/SampleMessage";
import csSampleMessage from "~/components/common/SampleMessage/sample_message.scss";
import { HelpIcon } from "~/components/ui/containers";
import { IconAlert } from "~/components/ui/icons";
import { FIELDS_METADATA } from "~/components/utils/tooltip";
import cs from "~/components/views/SampleView/components/ConsensusGenomeView/consensus_genome_view.scss";
import { Table } from "~/components/visualizations/table";
import { SampleStatus } from "~/interface/sample";
import { ConsensusGenomeMetricsTableFragment$key } from "./__generated__/ConsensusGenomeMetricsTableFragment.graphql";

// SMP-1817: shown to the user (instead of a blank screen) when a consensus
// genome workflow succeeded but its metric results have aged out of the data
// retention window, so the detailed metrics are no longer available to display.
export const CONSENSUS_GENOME_METRICS_EXPIRED_MESSAGE =
  "The detailed metrics for this consensus genome are no longer available. " +
  "Per the data retention policy, results are stored for a limited time after " +
  "a workflow runs. Try viewing a more recently run workflow.";

export const ConsensusGenomeMetricsTableFragment = graphql`
  fragment ConsensusGenomeMetricsTableFragment on query_fedConsensusGenomes_items
  @relay(plural: true) {
    taxon {
      name
    }
    metrics {
      mappedReads
      nActg
      nAmbiguous
      nMissing
      refSnps
      percentIdentity
      gcPercent
      percentGenomeCalled
    }
  }
`;
interface ConsensusGenomeMetricsTableProps {
  helpLinkUrl: string;
  workflowRunResultsData: ConsensusGenomeMetricsTableFragment$key;
}

export const ConsensusGenomeMetricsTable = ({
  helpLinkUrl,
  workflowRunResultsData,
}: ConsensusGenomeMetricsTableProps) => {
  const data = useFragment<ConsensusGenomeMetricsTableFragment$key>(
    ConsensusGenomeMetricsTableFragment,
    workflowRunResultsData,
  );
  const computeQualityMetricColumns = useCallback(() => {
    const renderRowCell = (
      { cellData }: $TSFixMe,
      options: { percent?: $TSFixMeUnknown } = {},
    ) => (
      <div className={cs.cell}>
        {cellData}
        {options && options.percent ? "%" : null}
      </div>
    );
    const columns = [
      {
        className: cs.taxonName,
        dataKey: "taxonName",
        headerClassName: cs.primaryHeader,
        label: "Taxon",
        width: 320,
      },
      {
        dataKey: "mappedReads",
        width: 80,
      },
      {
        cellRenderer: (cellData: $TSFixMe) =>
          renderRowCell(cellData, { percent: true }),
        dataKey: "gcPercent",
        width: 60,
      },
      {
        dataKey: "refSnps",
        width: 20,
      },
      {
        cellRenderer: (cellData: $TSFixMe) =>
          renderRowCell(cellData, { percent: true }),
        dataKey: "percentIdentity",
        width: 30,
      },
      {
        dataKey: "nActg",
        width: 135,
      },
      {
        cellRenderer: (cellData: $TSFixMe) =>
          renderRowCell(cellData, { percent: true }),
        dataKey: "percentGenomeCalled",
        width: 100,
      },
      {
        dataKey: "nMissing",
        width: 75,
      },
      {
        dataKey: "nAmbiguous",
        width: 100,
      },
    ];

    for (const col of columns) {
      if (!col["cellRenderer"]) {
        // @ts-expect-error CZID-8698 enable strictNullChecks: error TS2322
        col["cellRenderer"] = renderRowCell;
      }
      col["flexGrow"] = 1;

      const key = col["dataKey"];
      if (key in FIELDS_METADATA) {
        col["columnData"] = FIELDS_METADATA[key];
        col["label"] = FIELDS_METADATA[key].label;
      }
    }
    return columns;
  }, []);

  if (!data) {
    return null;
  }

  const metricsData = {
    taxonName: data[0]?.taxon?.name,
    ...data[0]?.metrics,
  };

  // SMP-1817: A succeeded workflow whose metric_consensus_genome data has aged
  // out of the retention window (we only keep it ~6 months on staging/local)
  // comes back with a taxon name but no computed metrics. Previously this only
  // logged a console warning and returned null, leaving the user staring at a
  // blank screen. Keep the developer-facing warning, but also surface a clear
  // message in the UI so the user understands the results have expired.
  if (metricsData.taxonName && !metricsData.percentIdentity) {
    console.warn(
      "You may be seeing a blank screen here because of the data retention policy on staging. Try looking at a more recently run workflow.",
    );
    return (
      <SampleMessage
        icon={<IconAlert className={csSampleMessage.icon} type="warning" />}
        message={CONSENSUS_GENOME_METRICS_EXPIRED_MESSAGE}
        status={SampleStatus.COMPLETE_ISSUE}
        type="warning"
      />
    );
  }

  return (
    <div className={cs.section}>
      <div className={cs.title}>
        Is my consensus genome complete?
        <HelpIcon
          text="These metrics help determine the quality of the reference accession."
          learnMoreLinkUrl={helpLinkUrl}
          learnMoreLinkAnalyticsEventName="ConsensusGenomeView_help-link_clicked"
          className={cx(cs.helpIcon, cs.lower)}
        />
      </div>
      <div className={cx(cs.metricsTable, cs.raisedContainer)}>
        <Table
          columns={computeQualityMetricColumns()}
          data={[metricsData]}
          defaultRowHeight={55}
          gridClassName={cs.tableGrid}
          headerClassName={cs.tableHeader}
          headerRowClassName={cs.tableHeaderRow}
          headerHeight={25}
          headerLabelClassName={cs.tableHeaderLabel}
          rowClassName={cs.tableRow}
        />
      </div>
    </div>
  );
};
