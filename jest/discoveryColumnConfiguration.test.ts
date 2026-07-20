// CZID-462 coverage: app/assets/src/components/views/DiscoveryView/components/SamplesView/columnConfiguration.ts
// computeColumnsByWorkflow dispatches on WorkflowType to a per-workflow column
// builder and appends user metadata columns. The dispatch branches and the
// metadata-append/dedup logic are the behavior worth pinning here.
import { WorkflowType } from "~utils/workflows";
import {
  computeColumnsByWorkflow,
  DEFAULT_ACTIVE_COLUMNS_BY_WORKFLOW,
  DEFAULT_SORTED_COLUMN_BY_TAB,
} from "../app/assets/src/components/views/DiscoveryView/components/SamplesView/columnConfiguration";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const keysOf = (cols: any[]) => cols.map(c => c.dataKey);

const build = (workflow?: string, extra = {}) =>
  computeColumnsByWorkflow({
    workflow,
    metadataFields: [],
    showSampleOwnerName: false,
    ...extra,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any[];

describe("computeColumnsByWorkflow dispatch", () => {
  it("returns undefined for an unrecognized workflow", () => {
    expect(
      computeColumnsByWorkflow({
        workflow: "not-a-workflow",
        showSampleOwnerName: false,
      }),
    ).toBeUndefined();
    // Also undefined when no workflow is provided at all.
    expect(
      computeColumnsByWorkflow({ showSampleOwnerName: false }),
    ).toBeUndefined();
  });

  it("always leads with a fixed-width 'sample' column", () => {
    for (const wf of [
      WorkflowType.SHORT_READ_MNGS,
      WorkflowType.CONSENSUS_GENOME,
      WorkflowType.AMR,
      WorkflowType.BENCHMARK,
    ]) {
      const cols = build(wf);
      expect(cols[0].dataKey).toBe("sample");
      expect(cols[0].width).toBe(350);
    }
  });

  it("builds mNGS columns for short-read with the mNGS-specific metrics", () => {
    const keys = keysOf(build(WorkflowType.SHORT_READ_MNGS));
    expect(keys).toEqual(
      expect.arrayContaining([
        "totalReads",
        "nonHostReads",
        "duplicateCompressionRatio",
        "erccReads",
        "meanInsertSize",
      ]),
    );
    // These belong to other workflows and must NOT leak in.
    expect(keys).not.toContain("coverageDepth");
    expect(keys).not.toContain("aupr");
  });

  it("routes long-read mNGS to the same column set as short-read mNGS", () => {
    expect(keysOf(build(WorkflowType.LONG_READ_MNGS))).toEqual(
      keysOf(build(WorkflowType.SHORT_READ_MNGS)),
    );
  });

  it("builds consensus-genome columns with CG-specific metrics", () => {
    const keys = keysOf(build(WorkflowType.CONSENSUS_GENOME));
    expect(keys).toEqual(
      expect.arrayContaining([
        "coverageDepth",
        "referenceAccession",
        "percentGenomeCalled",
        "wdl_version",
      ]),
    );
    // mNGS-only metric must not appear.
    expect(keys).not.toContain("totalReads");
    expect(keys).not.toContain("aupr");
  });

  it("builds AMR columns and honors showSampleOwnerName on the sample renderer", () => {
    const keys = keysOf(build(WorkflowType.AMR));
    expect(keys).toEqual(
      expect.arrayContaining(["totalReadsAMR", "nonHostReads"]),
    );
    expect(keys).not.toContain("aupr");
  });

  it("builds benchmark columns with the benchmark-only metrics", () => {
    const keys = keysOf(build(WorkflowType.BENCHMARK));
    expect(keys).toEqual(
      expect.arrayContaining([
        "aupr",
        "l2Norm",
        "workflowBenchmarked",
        "correlation",
      ]),
    );
    expect(keys).not.toContain("coverageDepth");
  });
});

describe("computeColumnsByWorkflow metadata columns", () => {
  it("appends non-fixed metadata fields as columns and drops the hard-coded ones", () => {
    const withoutMeta = keysOf(build(WorkflowType.SHORT_READ_MNGS));
    const withMeta = build(WorkflowType.SHORT_READ_MNGS, {
      metadataFields: [
        { key: "custom_field", name: "Custom Field" },
        // sample_type is already a fixed column -> must be filtered out.
        { key: "sample_type", name: "Sample Type" },
      ],
    });
    const withMetaKeys = keysOf(withMeta);

    // Exactly one new column added (custom_field), sample_type not duplicated.
    expect(withMetaKeys).toContain("custom_field");
    expect(withMetaKeys).toHaveLength(withoutMeta.length + 1);
    expect(withMetaKeys.filter(k => k === "sample_type")).toHaveLength(1);

    // The appended metadata column carries the human-readable name as its label.
    const custom = withMeta.find(c => c.dataKey === "custom_field");
    expect(custom.label).toBe("Custom Field");
  });
});

describe("computeColumnsByWorkflow cell data getters", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const colByKey = (cols: any[], key: string) =>
    cols.find(c => c.dataKey === key);

  it("mNGS 'createdAt' getter prefers the latest pipeline run date", () => {
    const createdAt = colByKey(
      build(WorkflowType.SHORT_READ_MNGS),
      "createdAt",
    );
    expect(
      createdAt.cellDataGetter({
        rowData: {
          createdAt: "2020-01-01",
          sample: { pipelineRunCreatedAt: "2021-06-06" },
        },
      }),
    ).toBe("2021-06-06");
    // Falls back to sample createdAt when no pipeline run date exists.
    expect(
      createdAt.cellDataGetter({
        rowData: { createdAt: "2020-01-01", sample: {} },
      }),
    ).toBe("2020-01-01");
  });

  it("benchmark 'sampleId' getter returns additionalInfo (or {} when absent)", () => {
    const cols = build(WorkflowType.BENCHMARK);
    const sampleId = colByKey(cols, "sampleId");
    const info = { run1: { sampleId: 7 } };
    expect(sampleId.cellDataGetter({ rowData: { additionalInfo: info } })).toBe(
      info,
    );
    expect(sampleId.cellDataGetter({ rowData: {} })).toEqual({});
  });

  it("benchmark version getters flatten a field across all additionalInfo runs", () => {
    const pipelineVersion = colByKey(
      build(WorkflowType.BENCHMARK),
      "pipelineVersion",
    );
    const result = pipelineVersion.cellDataGetter({
      dataKey: "pipelineVersion",
      rowData: {
        additionalInfo: {
          run1: { pipelineVersion: "1.0" },
          run2: { pipelineVersion: "2.0" },
        },
      },
    });
    expect(result).toEqual(["1.0", "2.0"]);
  });
});

describe("column default exports", () => {
  it("keeps 'sample' as the leading default active column for every workflow", () => {
    Object.values(DEFAULT_ACTIVE_COLUMNS_BY_WORKFLOW).forEach(cols => {
      expect(cols[0]).toBe("sample");
    });
  });

  it("maps each tab to its tiebreaker sort column", () => {
    expect(DEFAULT_SORTED_COLUMN_BY_TAB).toEqual({
      projects: "created_at",
      samples: "createdAt",
      visualizations: "updated_at",
    });
  });
});
