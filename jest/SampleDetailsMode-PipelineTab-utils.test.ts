// Branch coverage for
// app/assets/src/components/common/DetailsSidebar/SampleDetailsMode/components/PipelineTab/utils.ts
//
// jest/pipelineTabUtils.test.ts already covers the happy paths; this file
// deliberately drives the *other* side of every conditional in those three
// transforms: falsy summary stats, missing/zero quality metrics, absent
// optional-chained sub-objects and unmatched lookup values.
import {
  processAMRWorkflowRun,
  processCGWorkflowRunInfo,
  processPipelineInfo,
} from "~/components/common/DetailsSidebar/SampleDetailsMode/components/PipelineTab/utils";
import { WORKFLOWS, WorkflowType } from "~/components/utils/workflows";

describe("PipelineTab/utils falsy-side branches", () => {
  describe("processPipelineInfo", () => {
    it("returns an empty object when pipeline_run is absent", () => {
      // summary_stats alone is not enough -- the whole block is gated on the run.
      const info = processPipelineInfo({
        summary_stats: { qc_percent: 90 },
      } as $TSFixMe);
      expect(info).toEqual({});
    });

    it("falls back to 'unknown' for every falsy summary stat", () => {
      const info = processPipelineInfo({
        pipeline_run: { total_reads: 100 },
        summary_stats: {
          adjusted_remaining_reads: 0,
          percent_remaining: 0,
          unmapped_reads: 0,
          qc_percent: 0,
          compression_ratio: 0,
          last_processed_at: "2024-06-01",
          insert_size_mean: null,
          insert_size_standard_deviation: null,
        },
      } as $TSFixMe);

      // adjustedRemainingReads -> BLANK_TEXT, adjustedPercent -> "" (no suffix).
      expect(info.nonhostReads).toEqual({ text: "unknown" });
      expect(info.unmappedReads).toEqual({ text: "unknown" });
      expect(info.qcPercent).toEqual({ text: "unknown" });
      expect(info.compressionRatio).toEqual({ text: "unknown" });
      expect(info.lastProcessedAt).toEqual({ text: "2024-06-01" });
      // numberWithPlusOrMinus returns null for non-numbers -> field omitted.
      expect(info.meanInsertSize).toBeUndefined();
    });

    it("omits the pipeline version link when the run has no version block", () => {
      const info = processPipelineInfo({
        pipeline_run: { total_reads: 5, sample_id: 9 },
      } as $TSFixMe);
      expect(info.pipelineVersion).toBeUndefined();
      // Optional-chained fields degrade to undefined rather than throwing.
      expect(info.ncbiIndexDate).toEqual({ text: undefined });
      expect(info.guppyBasecallerVersion).toEqual({ text: undefined });
      expect(info.hostSubtracted).toEqual({ text: undefined });
    });

    it("leaves technology blank and defaults to long-read when technology is missing", () => {
      const info = processPipelineInfo({
        pipeline_run: { total_reads: 5 },
      } as $TSFixMe);
      // Falsy technology short-circuits the display-name lookup...
      expect(info.technology?.text).toBeFalsy();
      // ...and anything that is not Illumina is treated as the long read tab.
      expect(info.workflow?.text).toBe("Nanopore");
      // Analysis type is decoupled from the workflow tab and stays "Metagenomic".
      expect(info.analysisType?.text).toBe("Metagenomic");
    });

    it("suppresses the ERCC percentage when total_reads is missing", () => {
      const info = processPipelineInfo({
        pipeline_run: { total_reads: 0, total_ercc_reads: 250 },
      } as $TSFixMe);
      // ERCC count still renders, but with no "( x%)" suffix.
      expect(info.totalErccReads).toEqual({ text: "250" });
      expect(info.totalReads).toEqual({ text: "0" });
    });
  });

  describe("processCGWorkflowRunInfo", () => {
    it("returns undefined text for inputs that are absent entirely", () => {
      const info = processCGWorkflowRunInfo({
        workflow: WorkflowType.CONSENSUS_GENOME,
        executed_at: "2024-04-04",
      } as $TSFixMe);

      expect(info.medakaModel).toEqual({ text: undefined });
      expect(info.technology).toEqual({ text: undefined });
      expect(info.wetlabProtocol).toEqual({ text: undefined });
      expect(info.pipelineVersion).toEqual({ text: undefined });
      // Missing quality metrics collapse to empty strings, not "undefined".
      expect(info.erccMappedReads).toEqual({ text: "" });
      expect(info.mappedReads).toEqual({ text: "" });
      expect(info.totalReads).toEqual({ text: "" });
      expect(info.workflow).toEqual({
        text: WORKFLOWS[WorkflowType.CONSENSUS_GENOME].label,
      });
    });

    it("leaves the wetlab protocol undefined when the value matches no option", () => {
      const info = processCGWorkflowRunInfo({
        workflow: WorkflowType.CONSENSUS_GENOME,
        executed_at: "2024-04-04",
        inputs: { wetlab_protocol: "not-a-real-protocol" },
      } as $TSFixMe);
      expect(info.wetlabProtocol).toEqual({ text: undefined });
    });

    it("formats zero-valued quality metrics rather than blanking them", () => {
      const info = processCGWorkflowRunInfo({
        workflow: WorkflowType.CONSENSUS_GENOME,
        executed_at: "2024-04-04",
        inputs: {},
        parsed_cached_results: {
          quality_metrics: {
            ercc_mapped_reads: 0,
            mapped_reads: 0,
            total_reads: 0,
          },
        },
      } as $TSFixMe);
      // 0 is defined, so isUndefined() is false and the number is formatted.
      expect(info.erccMappedReads).toEqual({ text: "0" });
      expect(info.mappedReads).toEqual({ text: "0" });
      expect(info.totalReads).toEqual({ text: "0" });
    });
  });

  describe("processAMRWorkflowRun", () => {
    const amrLabel = WORKFLOWS[WorkflowType.AMR].label;

    it("blanks derived metrics when the present quality metrics are all falsy", () => {
      const info = processAMRWorkflowRun({
        workflow: WorkflowType.AMR,
        executed_at: "2024-05-05",
        wdl_version: "1.0.0",
        inputs: {},
        parsed_cached_results: {
          quality_metrics: {
            total_reads: 0,
            total_ercc_reads: 0,
            adjusted_remaining_reads: 0,
            percent_remaining: 0,
            qc_percent: 0,
            compression_ratio: 0,
            insert_size_mean: undefined,
            insert_size_standard_deviation: undefined,
          },
        },
      } as $TSFixMe);

      expect(info.nonhostReads).toEqual({ text: "unknown" });
      expect(info.qcPercent).toEqual({ text: "unknown" });
      expect(info.compressionRatio).toEqual({ text: "unknown" });
      // meanInsertSize is null when either input is not a number.
      expect(info.meanInsertSize).toEqual({ text: null });
      // The metric fields are still emitted (this is the with-metrics branch).
      expect(info.totalReads).toEqual({ text: "0" });
      expect(info.cardDatabaseVersion).toEqual({ text: undefined });
      expect(info.wildcardDatabaseVersion).toEqual({ text: undefined });
      expect(info.technology).toEqual({ text: "Illumina" });
    });

    it("blanks non-host reads when only one of reads/percent is present", () => {
      const info = processAMRWorkflowRun({
        workflow: WorkflowType.AMR,
        executed_at: "2024-05-05",
        inputs: {},
        parsed_cached_results: {
          quality_metrics: { adjusted_remaining_reads: 900 },
        },
      } as $TSFixMe);
      expect(info.nonhostReads).toEqual({ text: "unknown" });
    });

    it("returns the reduced shape and an undefined label for an unknown workflow", () => {
      const info = processAMRWorkflowRun({
        workflow: "not-a-workflow",
        executed_at: "2024-05-05",
        inputs: { card_version: "3.0.0" },
      } as $TSFixMe);

      expect(info.analysisType).toEqual({ text: undefined });
      expect(info.workflow).toEqual({ text: undefined });
      expect(info.cardDatabaseVersion).toEqual({ text: "3.0.0" });
      expect(info.qcPercent).toBeUndefined();
      expect(info.lastProcessedAt).toEqual({ text: "2024-05-05" });
      // Sanity: the known workflow does resolve a label.
      expect(amrLabel).toBeTruthy();
    });
  });
});
