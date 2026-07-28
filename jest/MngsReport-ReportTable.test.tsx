// Frontend coverage for the mNGS ReportTable container. It decides which column
// sets to hand the virtualized table (Illumina vs Nanopore vs shared), flattens
// the genus/species tree into table rows honouring the expand/collapse state,
// switches the NT/NR database, tracks column sorts, and owns the phylo-tree
// creation modal.
//
// The virtualized Table and the column factories are stubbed: the factories are
// where the per-cell rendering lives (covered by their own specs) and stubbing
// them lets us drive the expand/collapse and NT/NR callbacks the container
// hands down. The container's own logic runs for real.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { WORKFLOW_TABS } from "~/components/utils/workflows";
import { ReportTable } from "~/components/views/SampleView/components/MngsReport/components/ReportTable/ReportTable";

const mockTrackEvent = jest.fn();
const columnArgs: $TSFixMe = {};

jest.mock("~/api/analytics", () => ({
  ANALYTICS_EVENT_NAMES: {
    REPORT_TABLE_COLUMN_SORT_ARROW_CLICKED: "column-sort",
  },
  useTrackEvent: () => mockTrackEvent,
  useWithAnalytics: () => (fn: $TSFixMe) => fn,
}));

jest.mock("~/api/utils", () => ({
  getCsrfToken: () => "csrf-token",
}));

jest.mock(
  "~/components/views/SampleView/components/MngsReport/components/ReportTable/components/columns/nonNumericColumns",
  () => ({
    getNonNumericColumns: (...args: $TSFixMe[]) => {
      columnArgs.nonNumeric = args;
      return [{ dataKey: "name" }];
    },
  }),
);

jest.mock(
  "~/components/views/SampleView/components/MngsReport/components/ReportTable/components/columns/illuminaColumns",
  () => ({
    getIlluminaColumns: (...args: $TSFixMe[]) => {
      columnArgs.illumina = args;
      return [{ dataKey: "illumina" }];
    },
  }),
);

jest.mock(
  "~/components/views/SampleView/components/MngsReport/components/ReportTable/components/columns/nanoporeColumns",
  () => ({
    getNanoporeColumns: (...args: $TSFixMe[]) => {
      columnArgs.nanopore = args;
      return [{ dataKey: "nanopore" }];
    },
  }),
);

jest.mock(
  "~/components/views/SampleView/components/MngsReport/components/ReportTable/components/columns/sharedColumns",
  () => ({
    getSharedColumns: (...args: $TSFixMe[]) => {
      columnArgs.shared = args;
      return [{ dataKey: "shared" }];
    },
  }),
);

jest.mock("~/components/visualizations/table", () => ({
  Table: (props: $TSFixMe) => (
    <div data-testid="table">
      <span data-testid="column-keys">
        {props.columns.map((c: $TSFixMe) => c.dataKey).join(",")}
      </span>
      <span data-testid="row-ids">
        {props.data.map((row: $TSFixMe) => row.taxId).join(",")}
      </span>
      <span data-testid="default-sort-by">{props.defaultSortBy}</span>
      <span data-testid="row-height">{props.defaultRowHeight}</span>
      <button
        data-testid="sort"
        onClick={() =>
          props.onColumnSort({ sortBy: "nt_rpm", sortDirection: "ASC" })
        }
      />
      <div data-testid="rendered-row">
        {props.rowRenderer({
          className: "baseRow",
          columns: [<span key="c">cell</span>],
          index: 0,
          key: "row-0",
          rowData: props.data[0] ?? {},
          style: {},
        })}
      </div>
    </div>
  ),
}));

jest.mock("~/components/views/PhyloTree/PhyloTreeCreationModal", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => (
    <div data-testid="phylo-modal">
      <span data-testid="phylo-taxon">{props.taxonName}</span>
      <span data-testid="phylo-taxid">{props.taxonId}</span>
      <span data-testid="phylo-csrf">{props.csrf}</span>
      <span data-testid="phylo-admin">{props.admin}</span>
      <button data-testid="phylo-close" onClick={() => props.onClose()} />
    </div>
  ),
}));

const data = [
  {
    taxId: 100,
    name: "Genus A",
    taxLevel: "genus",
    filteredSpecies: [
      { taxId: 101, name: "Species A1", taxLevel: "species" },
      { taxId: 102, name: "Species A2", taxLevel: "species" },
    ],
  },
  {
    taxId: 200,
    name: "Genus B",
    taxLevel: "genus",
    filteredSpecies: [{ taxId: 201, name: "Species B1", taxLevel: "species" }],
  },
] as $TSFixMe;

const baseProps = {
  data,
  currentTab: WORKFLOW_TABS.SHORT_READ_MNGS,
  isConsensusGenomeEnabled: true,
  isFastaDownloadEnabled: true,
  isPhyloTreeAllowed: true,
  onAnnotationUpdate: jest.fn(),
  onBlastClick: jest.fn(),
  onConsensusGenomeClick: jest.fn(),
  onCoverageVizClick: jest.fn(),
  onPreviousConsensusGenomeClick: jest.fn(),
  pipelineVersion: "8.0",
  projectId: "5",
  projectName: "Project Five",
  sampleId: 42,
};

// The container passes these callbacks down to getNonNumericColumns; grab them
// from the captured arguments so the expand/collapse behavior can be driven.
const NON_NUMERIC_ARG = {
  setPhyloTreeModalParams: 12,
  toggleExpandAllRows: 17,
  toggleExpandGenus: 18,
};

const renderTable = (props = {}) =>
  render(<ReportTable {...(baseProps as $TSFixMe)} {...(props as $TSFixMe)} />);

beforeEach(() => {
  jest.clearAllMocks();
});

describe("ReportTable", () => {
  it("renders only genus rows until a genus is expanded", () => {
    renderTable();
    expect(screen.getByTestId("row-ids").textContent).toBe("100,200");
  });

  it("uses the Illumina columns and the 70px numeric width on the short-read tab", () => {
    renderTable();
    expect(screen.getByTestId("column-keys").textContent).toBe(
      "name,illumina,shared",
    );
    expect(columnArgs.shared[2]).toBe(70);
    expect(columnArgs.illumina[0]).toBe("nt");
    expect(columnArgs.illumina[2]).toBe("8.0");
  });

  it("uses the Nanopore columns and the wider numeric width on the long-read tab", () => {
    renderTable({ currentTab: WORKFLOW_TABS.LONG_READ_MNGS });
    expect(screen.getByTestId("column-keys").textContent).toBe(
      "name,nanopore,shared",
    );
    expect(columnArgs.shared[2]).toBe(80);
  });

  it("defaults sorting to agg_score, or to the reads-per-million key when the background is hidden", () => {
    const { unmount } = renderTable();
    expect(screen.getByTestId("default-sort-by").textContent).toBe("agg_score");
    unmount();

    const shortRead = renderTable({ shouldDisplayNoBackground: true });
    expect(screen.getByTestId("default-sort-by").textContent).toBe("rpm");
    shortRead.unmount();

    renderTable({
      shouldDisplayNoBackground: true,
      currentTab: WORKFLOW_TABS.LONG_READ_MNGS,
    });
    expect(screen.getByTestId("default-sort-by").textContent).toBe("bpm");
  });

  it("honours a custom row height and defaults to 54", () => {
    const { unmount } = renderTable();
    expect(screen.getByTestId("row-height").textContent).toBe("54");
    unmount();

    renderTable({ rowHeight: 30 });
    expect(screen.getByTestId("row-height").textContent).toBe("30");
  });

  it("expands and collapses every genus via the expand-all toggle", () => {
    renderTable();
    act(() => columnArgs.nonNumeric[NON_NUMERIC_ARG.toggleExpandAllRows]());
    expect(screen.getByTestId("row-ids").textContent).toBe(
      "100,101,102,200,201",
    );

    // Toggling again collapses everything back to genus rows.
    act(() => columnArgs.nonNumeric[NON_NUMERIC_ARG.toggleExpandAllRows]());
    expect(screen.getByTestId("row-ids").textContent).toBe("100,200");
  });

  it("expands and collapses a single genus", () => {
    renderTable();
    act(() =>
      columnArgs.nonNumeric[NON_NUMERIC_ARG.toggleExpandGenus]({
        taxonId: 100,
      }),
    );
    expect(screen.getByTestId("row-ids").textContent).toBe("100,101,102,200");

    // Expanding the second genus reaches "all expanded".
    act(() =>
      columnArgs.nonNumeric[NON_NUMERIC_ARG.toggleExpandGenus]({
        taxonId: 200,
      }),
    );
    expect(screen.getByTestId("row-ids").textContent).toBe(
      "100,101,102,200,201",
    );

    // The expand-all toggle now collapses instead of expanding.
    act(() => columnArgs.nonNumeric[NON_NUMERIC_ARG.toggleExpandAllRows]());
    expect(screen.getByTestId("row-ids").textContent).toBe("100,200");
  });

  it("collapses an already expanded genus", () => {
    renderTable();
    act(() =>
      columnArgs.nonNumeric[NON_NUMERIC_ARG.toggleExpandGenus]({
        taxonId: 100,
      }),
    );
    expect(screen.getByTestId("row-ids").textContent).toBe("100,101,102,200");

    act(() =>
      columnArgs.nonNumeric[NON_NUMERIC_ARG.toggleExpandGenus]({
        taxonId: 100,
      }),
    );
    expect(screen.getByTestId("row-ids").textContent).toBe("100,200");
  });

  it("attaches the parent genus to each expanded species row", () => {
    renderTable();
    act(() =>
      columnArgs.nonNumeric[NON_NUMERIC_ARG.toggleExpandGenus]({
        taxonId: 100,
      }),
    );
    expect(data[0].filteredSpecies[0].genus).toBe(data[0]);
  });

  it("switches the columns to the NR database when the shared column asks for it", () => {
    renderTable();
    expect(columnArgs.illumina[0]).toBe("nt");

    act(() => columnArgs.shared[1]("nr"));

    expect(columnArgs.illumina[0]).toBe("nr");
    expect(columnArgs.shared[0]).toBe("nr");
  });

  it("tracks column sorts", () => {
    renderTable();
    fireEvent.click(screen.getByTestId("sort"));
    expect(mockTrackEvent).toHaveBeenCalledWith("column-sort", {
      sortBy: "nt_rpm",
      sortDirection: "ASC",
    });
  });

  it("renders each table row through the row renderer", () => {
    renderTable();
    const row = screen.getByTestId("rendered-row").firstElementChild;
    expect(row).toBeTruthy();
    expect(row?.className).toContain("baseRow");
    expect(screen.getByText("cell")).toBeTruthy();
  });

  it("renders a row for a dimmed not-a-hit species without dropping the base class", () => {
    renderTable({
      data: [
        {
          taxId: 300,
          name: "Species C",
          taxLevel: "species",
          annotation: "not_a_hit",
          highlighted: true,
          filteredSpecies: [],
        },
      ],
    });
    const row = screen.getByTestId("rendered-row").firstElementChild;
    expect(row?.className).toContain("baseRow");
    expect(screen.getByTestId("row-ids").textContent).toBe("300");
  });

  it("does not render the phylo tree modal until a taxon is chosen, then closes it", () => {
    renderTable();
    expect(screen.queryByTestId("phylo-modal")).toBeNull();

    act(() =>
      columnArgs.nonNumeric[NON_NUMERIC_ARG.setPhyloTreeModalParams]({
        taxId: 573,
        taxName: "Klebsiella",
      }),
    );

    expect(screen.getByTestId("phylo-taxon").textContent).toBe("Klebsiella");
    expect(screen.getByTestId("phylo-taxid").textContent).toBe("573");
    expect(screen.getByTestId("phylo-csrf").textContent).toBe("csrf-token");
    // Default UserContext has no admin flag -> 0.
    expect(screen.getByTestId("phylo-admin").textContent).toBe("0");

    fireEvent.click(screen.getByTestId("phylo-close"));
    expect(screen.queryByTestId("phylo-modal")).toBeNull();
  });

  it("renders an empty table when no data is supplied", () => {
    renderTable({ data: undefined });
    expect(screen.getByTestId("row-ids").textContent).toBe("");
  });
});
