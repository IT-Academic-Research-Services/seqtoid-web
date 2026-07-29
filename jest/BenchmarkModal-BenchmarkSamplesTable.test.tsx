// Coverage: app/assets/src/components/views/DiscoveryView/components/SamplesView/
//   components/BenchmarkModal/BenchmarkSamplesTable/BenchmarkSamplesTable.tsx
//
// The component picks a nested subset out of each selected object, sizes its
// own wrapper from the row count (Autosizer needs a fixed parent height), and
// hands a static column config to the virtualized Table. Table is stubbed so we
// can read back the data/columns it computes and drive the name column's
// cellDataGetter + cellRenderer directly.
import { render, screen } from "@testing-library/react";

const mockTable: { props: $TSFixMe } = { props: null };

jest.mock("~/components/visualizations/table", () => ({
  __esModule: true,
  Table: (props: $TSFixMe) => {
    mockTable.props = props;
    return require("react").createElement("div", {
      "data-testid": "samples-table",
    });
  },
}));

import { BenchmarkSamplesTable } from "~/components/views/DiscoveryView/components/SamplesView/components/BenchmarkModal/BenchmarkSamplesTable/BenchmarkSamplesTable";

const entry = (name: string, overrides: $TSFixMe = {}) =>
  ({
    id: name,
    pipelineVersion: "8.0.0",
    createdAt: "2024-01-01",
    sample: {
      name,
      ncbiIndexVersion: "2024-02-06",
      project: "ignored",
    },
    ...overrides,
  } as $TSFixMe);

const renderTable = (selectedObjects: $TSFixMe[]) =>
  render(<BenchmarkSamplesTable selectedObjects={selectedObjects} />);

const columnByKey = (key: string) =>
  mockTable.props.columns.find((c: $TSFixMe) => c.dataKey === key);

beforeEach(() => {
  mockTable.props = null;
});

describe("BenchmarkSamplesTable data shaping", () => {
  it("keeps only the three displayed fields from each entry", () => {
    renderTable([entry("sample-a")]);
    expect(mockTable.props.data).toEqual([
      {
        pipelineVersion: "8.0.0",
        sample: { name: "sample-a", ncbiIndexVersion: "2024-02-06" },
      },
    ]);
  });

  it("maps every selected object, preserving order", () => {
    renderTable([entry("first"), entry("second")]);
    expect(mockTable.props.data.map((d: $TSFixMe) => d.sample.name)).toEqual([
      "first",
      "second",
    ]);
  });

  it("renders an empty table for an empty selection", () => {
    renderTable([]);
    expect(mockTable.props.data).toEqual([]);
    expect(screen.getByTestId("samples-table")).toBeTruthy();
  });
});

describe("BenchmarkSamplesTable wrapper height", () => {
  const wrapperHeight = () =>
    (screen.getByTestId("samples-table").parentElement as HTMLElement).style
      .height;

  it("is header-only when nothing is selected", () => {
    renderTable([]);
    expect(wrapperHeight()).toBe("36px");
  });

  it("grows by one row height per selected object", () => {
    renderTable([entry("a")]);
    expect(wrapperHeight()).toBe("74px");
  });

  it("grows again for a second selected object", () => {
    renderTable([entry("a"), entry("b")]);
    expect(wrapperHeight()).toBe("112px");
  });
});

describe("BenchmarkSamplesTable column config", () => {
  it("disables sorting and pins the row/header heights", () => {
    renderTable([entry("a")]);
    expect(mockTable.props.sortable).toBe(false);
    expect(mockTable.props.defaultRowHeight).toBe(38);
    expect(mockTable.props.headerHeight).toBe(36);
  });

  it("exposes the three expected columns with their labels", () => {
    renderTable([entry("a")]);
    expect(
      mockTable.props.columns.map((c: $TSFixMe) => [c.dataKey, c.label]),
    ).toEqual([
      ["name", "Name"],
      ["pipelineVersion", "Pipeline Version"],
      ["ncbiIndexVersion", "NCBI Index"],
    ]);
  });

  it("reads the name and ncbi columns out of the nested sample object", () => {
    renderTable([entry("a")]);
    const rowData = { sample: { name: "sample-a", ncbiIndexVersion: "v9" } };
    expect(
      columnByKey("name").cellDataGetter({ dataKey: "name", rowData }),
    ).toBe("sample-a");
    expect(
      columnByKey("ncbiIndexVersion").cellDataGetter({
        dataKey: "ncbiIndexVersion",
        rowData,
      }),
    ).toBe("v9");
  });

  it("returns undefined from the getter when the sample is missing", () => {
    renderTable([entry("a")]);
    expect(
      columnByKey("name").cellDataGetter({ dataKey: "name", rowData: {} }),
    ).toBeUndefined();
  });

  it("leaves the pipeline version column reading the top level (no getter)", () => {
    renderTable([entry("a")]);
    expect(columnByKey("pipelineVersion").cellDataGetter).toBeUndefined();
  });

  it("renders the sample name cell inside a tooltip", () => {
    renderTable([entry("a")]);
    const cell = columnByKey("name").cellRenderer({ cellData: "sample-a" });
    render(cell);
    expect(screen.getByText("sample-a")).toBeTruthy();
  });
});
