// SMP-1816: the sidebar "Date Processed" value (lastProcessedAt) is derived
// from a Rails timestamp string. These tests pin that the PipelineTab utils
// format it correctly and without emitting moment's deprecation warning.
import {
  processAMRWorkflowRun,
  processPipelineInfo,
} from "~/components/common/DetailsSidebar/SampleDetailsMode/components/PipelineTab/utils";
import { WorkflowRun } from "~/interface/sample";

const MOMENT_DEPRECATION_FRAGMENT = "not in a recognized RFC2822 or ISO format";

describe("processAMRWorkflowRun -- lastProcessedAt (Date Processed)", () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("formats the Rails executed_at string as YYYY-MM-DD without warning", () => {
    const result = processAMRWorkflowRun({
      workflow: "amr",
      executed_at: "2026-08-31 14:38:05 -0400",
      wdl_version: "1.2.3",
    } as unknown as WorkflowRun);

    expect(result.lastProcessedAt).toEqual({ text: "2026-08-31" });

    const warned = warnSpy.mock.calls
      .map(call => call.join(" "))
      .some(msg => msg.includes(MOMENT_DEPRECATION_FRAGMENT));
    expect(warned).toBe(false);
  });

  it("falls back to 'unknown' when executed_at is missing (not the current date)", () => {
    const result = processAMRWorkflowRun({
      workflow: "amr",
      executed_at: undefined,
      wdl_version: "1.2.3",
    } as unknown as WorkflowRun);

    expect(result.lastProcessedAt).toEqual({ text: "unknown" });
  });
});

describe("processPipelineInfo -- summary_stats.last_processed_at", () => {
  it("formats last_processed_at as YYYY-MM-DD", () => {
    const result = processPipelineInfo({
      pipeline_run: { total_reads: 1000 },
      summary_stats: { last_processed_at: "2026-08-31 14:38:05 UTC" },
    } as any);

    expect(result.lastProcessedAt).toEqual({ text: "2026-08-31" });
  });
});
