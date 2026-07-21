// CZID-462 coverage: app/assets/src/components/common/DetailsSidebar/SampleDetailsMode/components/PipelineTab/utils.ts
// Pure server-response -> display-value transforms for the Pipeline details tab.
import {
  processAMRWorkflowRun,
  processCGWorkflowRunInfo,
  processPipelineInfo,
} from "../app/assets/src/components/common/DetailsSidebar/SampleDetailsMode/components/PipelineTab/utils";
import { AMR_PIPELINE_HELP_LINK } from "../app/assets/src/components/utils/documentationLinks";
import {
  WORKFLOW_TABS,
  WORKFLOWS,
  WorkflowType,
} from "../app/assets/src/components/utils/workflows";
import { CG_WETLAB_OPTIONS } from "../app/assets/src/components/views/SampleUploadFlow/constants";

describe("PipelineTab/utils", () => {
  describe("processPipelineInfo", () => {
    it("returns an empty object when there is no additional info", () => {
      expect(processPipelineInfo(null)).toEqual({});
      expect(processPipelineInfo(undefined)).toEqual({});
    });

    it("derives mNGS display values for an Illumina run with summary stats", () => {
      const info = processPipelineInfo({
        pipeline_run: {
          total_reads: 1000000,
          total_ercc_reads: 5000,
          technology: "Illumina",
          sample_id: 42,
          host_subtracted: "Human",
          guppy_basecaller_setting: "hac",
          version: { pipeline: "8.0", alignment_db: "2024-02-06" },
        },
        summary_stats: {
          adjusted_remaining_reads: 12345,
          percent_remaining: 12.5,
          unmapped_reads: 678,
          qc_percent: 98.7,
          compression_ratio: 3.5,
          last_processed_at: "2024-01-15",
          insert_size_mean: 300,
          insert_size_standard_deviation: 40,
        },
      } as $TSFixMe);

      expect(info.totalReads).toEqual({ text: "1,000,000" });
      // 100 * 5000 / 1000000 = 0.50%
      expect(info.totalErccReads).toEqual({ text: "5,000 (0.50%)" });
      expect(info.pipelineVersion).toEqual({
        text: "v8.0",
        linkLabel: "View Pipeline Visualization",
        link: "/samples/42/pipeline_viz/8.0",
      });
      expect(info.hostSubtracted).toEqual({ text: "Human" });
      expect(info.workflow).toEqual({ text: WORKFLOW_TABS.SHORT_READ_MNGS });
      expect(info.technology).toEqual({ text: "Illumina" });
      expect(info.ncbiIndexDate).toEqual({ text: "2024-02-06" });
      expect(info.guppyBasecallerVersion).toEqual({ text: "hac" });
      expect(info.nonhostReads).toEqual({ text: "12,345 (12.50%)" });
      expect(info.unmappedReads).toEqual({ text: "678" });
      expect(info.qcPercent).toEqual({ text: "98.70%" });
      expect(info.compressionRatio).toEqual({ text: "3.50" });
      expect(info.lastProcessedAt).toEqual({ text: "2024-01-15" });
      expect(info.meanInsertSize).toEqual({ text: "300±40" });
    });

    it("maps ONT technology to the long-read workflow tab and Nanopore display name", () => {
      const info = processPipelineInfo({
        pipeline_run: { total_reads: 10, technology: "ONT" },
      } as $TSFixMe);
      expect(info.workflow).toEqual({ text: WORKFLOW_TABS.LONG_READ_MNGS });
      expect(info.technology).toEqual({ text: "Nanopore" });
    });

    it("falls back to placeholders when ercc reads and summary stats are absent", () => {
      const info = processPipelineInfo({
        pipeline_run: { total_reads: 10, total_ercc_reads: 0 },
      } as $TSFixMe);
      expect(info.totalErccReads).toEqual({ text: "--" });
      // No summary_stats block -> none of those fields are populated.
      expect(info.qcPercent).toBeUndefined();
      expect(info.meanInsertSize).toBeUndefined();
    });
  });

  describe("processCGWorkflowRunInfo", () => {
    it("formats consensus-genome quality metrics and inputs", () => {
      const info = processCGWorkflowRunInfo({
        workflow: WorkflowType.CONSENSUS_GENOME,
        executed_at: "2024-03-01",
        wdl_version: "3.5.0",
        inputs: {
          technology: "ONT",
          wetlab_protocol: "artic_v4",
          medaka_model: "r941",
        },
        parsed_cached_results: {
          quality_metrics: {
            ercc_mapped_reads: 1200,
            mapped_reads: 3400,
            total_reads: 5600,
          },
        },
      } as $TSFixMe);

      const expectedWetlab = CG_WETLAB_OPTIONS.find(
        o => o.value === "artic_v4",
      )?.text;
      expect(info.erccMappedReads).toEqual({ text: "1,200" });
      expect(info.mappedReads).toEqual({ text: "3,400" });
      expect(info.totalReads).toEqual({ text: "5,600" });
      expect(info.lastProcessedAt).toEqual({ text: "2024-03-01" });
      expect(info.hostSubtracted).toEqual({ text: "Human" });
      expect(info.medakaModel).toEqual({ text: "r941" });
      expect(info.pipelineVersion).toEqual({ text: "3.5.0" });
      expect(info.technology).toEqual({ text: "Nanopore" });
      expect(info.wetlabProtocol).toEqual({ text: expectedWetlab });
      expect(info.workflow).toEqual({
        text: WORKFLOWS[WorkflowType.CONSENSUS_GENOME].label,
      });
    });

    it("emits empty strings when quality metrics are missing", () => {
      const info = processCGWorkflowRunInfo({
        workflow: WorkflowType.CONSENSUS_GENOME,
        executed_at: "2024-03-01",
        inputs: {},
        parsed_cached_results: {},
      } as $TSFixMe);
      expect(info.erccMappedReads).toEqual({ text: "" });
      expect(info.mappedReads).toEqual({ text: "" });
      expect(info.totalReads).toEqual({ text: "" });
    });
  });

  describe("processAMRWorkflowRun", () => {
    const amrLabel = WORKFLOWS[WorkflowType.AMR].label;

    it("builds the full AMR tab info when quality metrics are present", () => {
      const info = processAMRWorkflowRun({
        workflow: WorkflowType.AMR,
        executed_at: "2024-02-02",
        wdl_version: "1.2.3",
        inputs: { card_version: "3.2.5", wildcard_version: "4.0.0" },
        parsed_cached_results: {
          quality_metrics: {
            total_reads: 1000,
            total_ercc_reads: 50,
            adjusted_remaining_reads: 900,
            percent_remaining: 90.0,
            qc_percent: 95.0,
            compression_ratio: 2.0,
            insert_size_mean: 200,
            insert_size_standard_deviation: 20,
          },
        },
      } as $TSFixMe);

      expect(info.analysisType).toEqual({ text: amrLabel });
      expect(info.workflow).toEqual({ text: amrLabel });
      expect(info.technology).toEqual({ text: "Illumina" });
      expect(info.pipelineVersion).toEqual({
        text: "1.2.3",
        linkLabel: "View Pipeline Visualization",
        link: AMR_PIPELINE_HELP_LINK,
      });
      expect(info.cardDatabaseVersion).toEqual({ text: "3.2.5" });
      expect(info.lastProcessedAt).toEqual({ text: "2024-02-02" });
      expect(info.totalReads).toEqual({ text: "1,000" });
      expect(info.totalErccReads).toEqual({ text: "50" });
      expect(info.nonhostReads).toEqual({ text: "900 (90.00%)" });
      expect(info.qcPercent).toEqual({ text: "95.00%" });
      expect(info.compressionRatio).toEqual({ text: "2.00" });
      expect(info.meanInsertSize).toEqual({ text: "200±20" });
      expect(info.wildcardDatabaseVersion).toEqual({ text: "4.0.0" });
    });

    it("returns the reduced info shape when quality metrics are absent", () => {
      const info = processAMRWorkflowRun({
        workflow: WorkflowType.AMR,
        executed_at: "2024-02-02",
        wdl_version: "1.2.3",
        inputs: { card_version: "3.2.5", wildcard_version: "4.0.0" },
        parsed_cached_results: {},
      } as $TSFixMe);

      expect(info.workflow).toEqual({ text: amrLabel });
      expect(info.cardDatabaseVersion).toEqual({ text: "3.2.5" });
      expect(info.wildcardDatabaseVersion).toEqual({ text: "4.0.0" });
      // Metric-derived fields are omitted entirely in this branch.
      expect(info.totalReads).toBeUndefined();
      expect(info.nonhostReads).toBeUndefined();
    });
  });
});
