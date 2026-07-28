// Coverage for the per-column cellDataGetter / cellRenderer closures inside
// app/assets/src/components/views/DiscoveryView/components/SamplesView/columnConfiguration.ts
// discoveryColumnConfiguration.test.ts pins which columns each workflow emits;
// the arrow functions attached to those columns (number/percentage/duration
// formatting, the createdAt fallback, the benchmark additionalInfo extractor
// and the sample renderers) are only reached by invoking them, which is what
// this suite does.
import { render } from "@testing-library/react";
import React from "react";
import { computeColumnsByWorkflow } from "~/components/views/DiscoveryView/components/SamplesView/columnConfiguration";
import { WorkflowType } from "~utils/workflows";

// Keeps organize-imports from dropping the React import the classic JSX
// runtime needs in scope.
const _React: typeof React = React;

/* eslint-disable @typescript-eslint/no-explicit-any */
const build = (workflow: string, extra: Record<string, unknown> = {}) =>
  computeColumnsByWorkflow({
    workflow,
    metadataFields: [],
    showSampleOwnerName: false,
    ...extra,
  } as any) as any[];

const column = (columns: any[], dataKey: string) => {
  const col = columns.find(c => c.dataKey === dataKey);
  if (!col) throw new Error(`no column for ${dataKey}`);
  return col;
};

const getCellData = (columns: any[], dataKey: string, rowData: any) =>
  column(columns, dataKey).cellDataGetter({ dataKey, rowData });

const renderCell = (columns: any[], dataKey: string, args: any) =>
  render(<div>{column(columns, dataKey).cellRenderer(args)}</div>);

describe("short read mNGS cell functions", () => {
  const columns = build(WorkflowType.SHORT_READ_MNGS);

  it("prefers the latest pipeline run createdAt and falls back to the sample's", () => {
    expect(
      getCellData(columns, "createdAt", {
        createdAt: "2020-01-01",
        sample: { pipelineRunCreatedAt: "2021-06-06" },
      }),
    ).toBe("2021-06-06");

    expect(
      getCellData(columns, "createdAt", {
        createdAt: "2020-01-01",
        sample: {},
      }),
    ).toBe("2020-01-01");
  });

  it("formats read counts with thousands separators", () => {
    expect(getCellData(columns, "totalReads", { totalReads: 1234567 })).toBe(
      "1,234,567",
    );
    expect(getCellData(columns, "erccReads", { erccReads: 0 })).toBe("0");
  });

  it("formats percentages and passes falsy values straight through", () => {
    expect(getCellData(columns, "qcPercent", { qcPercent: 98.7654 })).toBe(
      "98.77%",
    );
    expect(getCellData(columns, "qcPercent", { qcPercent: 0 })).toBe(0);
    expect(getCellData(columns, "qcPercent", {})).toBeUndefined();
  });

  it("formats ratios to two decimals", () => {
    expect(
      getCellData(columns, "duplicateCompressionRatio", {
        duplicateCompressionRatio: 1.23456,
      }),
    ).toBe("1.23");
    expect(
      getCellData(columns, "subsampledFraction", { subsampledFraction: null }),
    ).toBeNull();
  });

  it("formats total runtime as hours and minutes", () => {
    expect(getCellData(columns, "totalRuntime", { totalRuntime: 3660 })).toBe(
      "1 hour, 1 minute",
    );
    expect(getCellData(columns, "totalRuntime", { totalRuntime: 7320 })).toBe(
      "2 hours, 2 minutes",
    );
    expect(getCellData(columns, "totalRuntime", { totalRuntime: 30 })).toBe("");
  });

  it("renders the sample cell from cellData", () => {
    const { container } = renderCell(columns, "sample", {
      cellData: { name: "Sample A", user: "Owner", project: "Proj" },
    });
    expect(container.textContent).toContain("Sample A");
  });
});

describe("long read mNGS cell functions", () => {
  const columns = build(WorkflowType.LONG_READ_MNGS);

  it("shares the short read createdAt fallback", () => {
    expect(
      getCellData(columns, "createdAt", {
        createdAt: "2020-01-01",
        sample: { pipelineRunCreatedAt: "2022-02-02" },
      }),
    ).toBe("2022-02-02");
  });
});

describe("consensus genome cell functions", () => {
  const columns = build(WorkflowType.CONSENSUS_GENOME);

  it("formats the coverage / genome quality numbers", () => {
    expect(
      getCellData(columns, "coverageDepth", { coverageDepth: 12.3456 }),
    ).toBe("12.35");
    expect(getCellData(columns, "totalReadsCG", { totalReadsCG: 98765 })).toBe(
      "98,765",
    );
    expect(getCellData(columns, "nActg", { nActg: 29903 })).toBe("29,903");
    expect(getCellData(columns, "nMissing", { nMissing: 1000 })).toBe("1,000");
    expect(getCellData(columns, "nAmbiguous", { nAmbiguous: 25 })).toBe("25");
    expect(
      getCellData(columns, "referenceAccessionLength", {
        referenceAccessionLength: 29903,
      }),
    ).toBe("29,903");
  });

  it("formats the percentage columns and clamps above 100", () => {
    // formatPercentage rounds to 2dp then re-coerces through Math.min, so the
    // trailing zero is dropped.
    expect(getCellData(columns, "gcPercent", { gcPercent: 37.5 })).toBe(
      "37.5%",
    );
    expect(
      getCellData(columns, "percentIdentity", { percentIdentity: 99.999 }),
    ).toBe("100%");
    expect(
      getCellData(columns, "percentGenomeCalled", {
        percentGenomeCalled: 0.001,
      }),
    ).toBe("<0.01%");
  });

  it("renders the sample cell from rowData and the reference accession", () => {
    const sampleCell = renderCell(columns, "sample", {
      rowData: {
        sample: { name: "CG Sample", user: "Owner", project: "Proj" },
      },
    });
    expect(sampleCell.container.textContent).toContain("CG Sample");

    const accession = renderCell(columns, "referenceAccession", {
      cellData: {
        accessionName: "Wuhan-Hu-1",
        referenceAccessionId: "MN908947",
        taxonName: "SARS-CoV-2",
      },
    });
    expect(accession.container.textContent).toContain("MN908947 - Wuhan-Hu-1");
    expect(accession.container.textContent).toContain("SARS-CoV-2");

    // Missing accession data falls back to the em-dash placeholders.
    const emptyAccession = renderCell(columns, "referenceAccession", {
      cellData: {},
    });
    expect(emptyAccession.container.textContent).toBe("\u2014\u2014");
  });
});

describe("AMR cell functions", () => {
  const columns = build(WorkflowType.AMR, { showSampleOwnerName: true });

  it("formats the AMR read and QC columns", () => {
    expect(
      getCellData(columns, "totalReadsAMR", { totalReadsAMR: 4200000 }),
    ).toBe("4,200,000");
    expect(getCellData(columns, "qcPercent", { qcPercent: 55.555 })).toBe(
      "55.55%",
    );
    expect(
      getCellData(columns, "duplicateCompressionRatio", {
        duplicateCompressionRatio: 2,
      }),
    ).toBe("2.00");
  });

  it("renders the sample cell with the owner name enabled", () => {
    const { container } = renderCell(columns, "sample", {
      rowData: {
        sample: { name: "AMR Sample", user: "Ada", project: "Proj" },
      },
    });
    expect(container.textContent).toContain("AMR Sample");
  });
});

describe("benchmark cell functions", () => {
  const columns = build(WorkflowType.BENCHMARK);

  it("passes additionalInfo through for the sample id column, defaulting to {}", () => {
    const additionalInfo = { "1": { pipelineVersion: "8.0" } };
    expect(getCellData(columns, "sampleId", { additionalInfo })).toEqual(
      additionalInfo,
    );
    expect(getCellData(columns, "sampleId", {})).toEqual({});
    expect(getCellData(columns, "sampleId", null)).toEqual({});
  });

  it("extracts a per-run value list from additionalInfo", () => {
    const rowData = {
      additionalInfo: {
        "10": { pipelineVersion: "8.0", ncbiIndexVersion: "2021", runId: 10 },
        "11": { pipelineVersion: "8.1", ncbiIndexVersion: "2022", runId: 11 },
      },
    };
    expect(getCellData(columns, "pipelineVersion", rowData)).toEqual([
      "8.0",
      "8.1",
    ]);
    expect(getCellData(columns, "ncbiIndexVersion", rowData)).toEqual([
      "2021",
      "2022",
    ]);
    expect(getCellData(columns, "runId", rowData)).toEqual([10, 11]);
  });

  it("extracts an empty list when there is no additionalInfo", () => {
    expect(getCellData(columns, "pipelineVersion", {})).toEqual([]);
    expect(getCellData(columns, "runId", null)).toEqual([]);
  });

  it("renders the benchmark sample and NT/NR metric cells", () => {
    const sampleCell = renderCell(columns, "sample", {
      rowData: {
        sample: { name: "Benchmark Sample", user: "Ada", project: "Proj" },
      },
    });
    expect(sampleCell.container.textContent).toContain("Benchmark Sample");

    const aupr = renderCell(columns, "aupr", {
      cellData: { nt: 0.98765, nr: 0.87654 },
    });
    expect(aupr.container.textContent).toContain("NT");
    expect(aupr.container.textContent).toContain("0.988");
    expect(aupr.container.textContent).toContain("NR");
  });
});
