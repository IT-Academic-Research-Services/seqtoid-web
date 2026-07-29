// Coverage: app/assets/src/components/views/PhyloTree/ColumnConfiguration.tsx
//
// The module is a static column spec whose only executable code lives in two
// cellRenderers and one cellDataGetter. Every branch is driven here: the date
// renderer with and without cell data, the coverage-breadth getter across the
// pipeline-version / zero-contig / fallback cases, and the coverage renderer's
// tooltip-vs-percent split.
import { render, screen } from "@testing-library/react";
import { COLUMNS } from "~/components/views/PhyloTree/ColumnConfiguration";

const columnFor = (dataKey: string) => {
  const col = COLUMNS.find(c => c.dataKey === dataKey);
  if (!col) throw new Error(`no column for ${dataKey}`);
  return col as $TSFixMe;
};

describe("PhyloTree ColumnConfiguration COLUMNS", () => {
  it("declares the expected columns in order", () => {
    expect(COLUMNS.map(c => c.dataKey)).toEqual([
      "project_name",
      "name",
      "host",
      "tissue",
      "location",
      "created_at",
      "num_contigs",
      "coverage_breadth",
    ]);
    // Every column is flexible and carries a human label.
    COLUMNS.forEach(col => {
      expect(col.flexGrow).toBe(1);
      expect(typeof col.label).toBe("string");
      expect(col.label.length).toBeGreaterThan(0);
    });
    expect(columnFor("name").width).toBe(200);
  });

  it("plain columns declare no renderers", () => {
    [
      "project_name",
      "name",
      "host",
      "tissue",
      "location",
      "num_contigs",
    ].forEach(key => {
      expect(columnFor(key).cellRenderer).toBeUndefined();
      expect(columnFor(key).cellDataGetter).toBeUndefined();
    });
  });
});

describe("created_at cellRenderer", () => {
  const renderCell = (cellData: $TSFixMe) =>
    columnFor("created_at").cellRenderer({ cellData });

  it("renders a relative date when cell data is present", () => {
    const element = renderCell("2020-01-01T00:00:00Z");
    expect(element).toBeTruthy();
    const { container } = render(<div>{element}</div>);
    // react-moment renders the humanised "... ago" string.
    expect(container.textContent).toMatch(/ago$/);
  });

  it("renders nothing when there is no cell data", () => {
    expect(renderCell(undefined)).toBeUndefined();
    expect(renderCell(null)).toBeUndefined();
    expect(renderCell("")).toBeUndefined();
  });
});

describe("coverage_breadth cellDataGetter", () => {
  const getData = (rowData: $TSFixMe) =>
    columnFor("coverage_breadth").cellDataGetter({ rowData });

  it("returns the value when the pipeline version supports coverage stats", () => {
    expect(
      getData({
        num_contigs: 12,
        coverage_breadth: 0.42,
        pipeline_version: "6.0",
      }),
    ).toBe(0.42);
  });

  it("returns the value on an older pipeline when there are zero contigs", () => {
    expect(
      getData({
        num_contigs: 0,
        coverage_breadth: 0,
        pipeline_version: "5.0",
      }),
    ).toBe(0);
  });

  it("returns a dash on an older pipeline with contigs", () => {
    expect(
      getData({
        num_contigs: 7,
        coverage_breadth: 0.9,
        pipeline_version: "5.9",
      }),
    ).toBe("-");
  });

  it("returns a dash when the row has no pipeline version at all", () => {
    expect(getData({ num_contigs: 3, coverage_breadth: 0.1 })).toBe("-");
  });
});

describe("coverage_breadth cellRenderer", () => {
  const renderCell = (cellData: $TSFixMe) =>
    render(
      <div>{columnFor("coverage_breadth").cellRenderer({ cellData })}</div>,
    );

  it("formats a numeric value as a percentage", () => {
    const { container } = renderCell(0.256);
    expect(container.textContent).toBe("25.6%");
    expect(screen.queryByText("-")).toBeNull();
  });

  it("formats zero coverage as 0.0%", () => {
    const { container } = renderCell(0);
    expect(container.textContent).toBe("0.0%");
  });

  it("wraps the dash in an explanatory tooltip trigger", () => {
    renderCell("-");
    // The tooltip trigger renders the dash itself.
    expect(screen.getByText("-")).toBeTruthy();
  });
});
