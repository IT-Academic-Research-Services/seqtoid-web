// Coverage: app/assets/src/components/views/SampleView/components/AmrView/
//   components/AmrSampleReport/AmrSampleReport.tsx
//
// AmrSampleReport assembles the three AMR column groups, seeds the table's
// initial column visibility from localStorage (module-level), picks the
// open/closed wrapper class from hideFilters, and only renders the
// column-visibility dropdown once the child Table has handed back a react-table
// instance. The Table, the dropdown, the column definitions and the storage
// helper are all stubbed so the assertions target this component's own wiring:
// the group builder arguments (row count / table reference), the visibility
// seed (with and without a stored value) and both wrapper branches.
import { fireEvent, render, screen } from "@testing-library/react";

// The component reads its class names from a relative .scss import, which the
// jest style mock resolves to an empty object; substitute real strings so the
// hideFilters branch is observable in the DOM.
jest.mock(
  "../app/assets/src/components/views/SampleView/components/AmrView/components/AmrSampleReport/amr_sample_report.scss",
  () => ({
    reportWrapper: "reportWrapper",
    reportWrapperFiltersClosed: "reportWrapperFiltersClosed",
    reportWrapperFiltersOpen: "reportWrapperFiltersOpen",
    tableWrapper: "tableWrapper",
    dropdownWrapper: "dropdownWrapper",
  }),
);

const mockLoadState = jest.fn();
jest.mock("~/helpers/storage", () => ({
  loadState: (...args: $TSFixMe[]) => mockLoadState(...args),
  setState: jest.fn(),
}));

let lastTableProps: $TSFixMe = null;
jest.mock("~/components/ui/Table", () => {
  const ReactLib = require("react");
  return {
    Table: (props: $TSFixMe) => {
      lastTableProps = props;
      return ReactLib.createElement(
        "button",
        {
          "data-testid": "amr-table",
          onClick: () =>
            props.setTableReference({ id: "react-table-instance" }),
        },
        "table",
      );
    },
  };
});

jest.mock(
  "~/components/views/SampleView/components/AmrView/components/AmrSampleReport/components/ToggleVisibleColumnsDropdown",
  () => {
    const ReactLib = require("react");
    return {
      ToggleVisibleColumnsDropdown: (props: $TSFixMe) =>
        ReactLib.createElement("div", {
          "data-testid": "toggle-columns-dropdown",
          "data-table-id": props.table.id,
        }),
    };
  },
);

jest.mock(
  "~/components/views/SampleView/components/AmrView/components/AmrSampleReport/components/StyledTableRow",
  () => ({ StyledTableRow: () => null }),
);

jest.mock(
  "~/components/views/SampleView/components/AmrView/components/AmrSampleReport/columnDefinitions",
  () => ({
    contigPercentCoverageColumn: { id: "contigCoverageBreadth" },
    contigPercentIdColumn: { id: "contigPercentId" },
    contigsColumn: { id: "contigs" },
    contigSpeciesColumn: { id: "contigSpecies" },
    cutoffColumn: { id: "cutoff" },
    drugClassColumn: { id: "drugClass" },
    geneFamilyColumn: { id: "geneFamily" },
    highLevelDrugClassColumn: { id: "highLevelDrugClass" },
    mechanismColumn: { id: "mechanism" },
    modelColumn: { id: "model" },
    readCoverageBreadthColumn: { id: "readCoverageBreadth" },
    readCoverageDepthColumn: { id: "readCoverageDepth" },
    readDepthPerMillionColumn: { id: "dpm" },
    readsColumn: { id: "reads" },
    readSpeciesColumn: { id: "readSpecies" },
    readsPerMillionColumn: { id: "rpm" },
    getGeneColumn: (
      setDetailsSidebarGeneName: $TSFixMe,
      id: $TSFixMe,
      wdl: $TSFixMe,
    ) => ({
      id: "gene",
      setDetailsSidebarGeneName,
      workflowRunId: id,
      wdlVersion: wdl,
    }),
    getGeneInfoColumnGroup: (columns: $TSFixMe, nRows: $TSFixMe) => ({
      id: "geneInfoHeaderGroup",
      columns,
      nRows,
    }),
    getContigsColumnGroup: (columns: $TSFixMe, table: $TSFixMe) => ({
      id: "contigsHeaderGroup",
      columns,
      table,
    }),
    getReadsColumnGroup: (columns: $TSFixMe, table: $TSFixMe) => ({
      id: "readsHeaderGroup",
      columns,
      table,
    }),
  }),
);

const REPORT_DATA = {
  aadA: { gene: "aadA" },
  tetM: { gene: "tetM" },
} as $TSFixMe;

const WORKFLOW_RUN = { id: 4242, wdl_version: "1.2.3" } as $TSFixMe;

// The visibility seed is computed at module scope, so each localStorage variant
// needs its own module registry.
const loadComponent = (storedState: $TSFixMe) => {
  mockLoadState.mockReset();
  mockLoadState.mockReturnValue(storedState);
  let Component: $TSFixMe;
  jest.isolateModules(() => {
    Component =
      require("~/components/views/SampleView/components/AmrView/components/AmrSampleReport/AmrSampleReport").AmrSampleReport;
  });
  return Component;
};

const renderReport = (
  Component: $TSFixMe,
  props: $TSFixMe = {},
  setDetailsSidebarGeneName = jest.fn(),
) => {
  lastTableProps = null;
  const utils = render(
    <Component
      reportTableData={REPORT_DATA}
      sample={{ id: 1 } as $TSFixMe}
      workflowRun={WORKFLOW_RUN}
      setDetailsSidebarGeneName={setDetailsSidebarGeneName}
      hideFilters={false}
      {...props}
    />,
  );
  return { setDetailsSidebarGeneName, ...utils };
};

describe("AmrSampleReport", () => {
  it("reads the stored column visibility once, keyed by the AMR storage key", () => {
    loadComponent({ columnVisibility: {} });
    expect(mockLoadState).toHaveBeenCalledTimes(1);
    expect(mockLoadState.mock.calls[0][1]).toBe("amrColumnVisibility");
  });

  it("hides the three optional columns by default when nothing is stored", () => {
    const Component = loadComponent(undefined);
    renderReport(Component);
    expect(lastTableProps.initialVisibilityState).toEqual({
      columnVisibility: {
        geneFamily: false,
        contigSpecies: false,
        readSpecies: false,
      },
    });
  });

  it("lets the stored visibility override the defaults", () => {
    const Component = loadComponent({
      columnVisibility: { geneFamily: true, cutoff: false },
    });
    renderReport(Component);
    expect(lastTableProps.initialVisibilityState.columnVisibility).toEqual({
      geneFamily: true,
      contigSpecies: false,
      readSpecies: false,
      cutoff: false,
    });
  });

  it("configures the table with the AMR sort key and row identity", () => {
    const Component = loadComponent({ columnVisibility: {} });
    renderReport(Component);
    expect(lastTableProps.initialSortKey).toBe("gene");
    expect(lastTableProps.isInitialSortDescending).toBe(false);
    expect(lastTableProps.uniqueIdentifier).toBe("gene");
    expect(lastTableProps.tableData).toBe(REPORT_DATA);
  });

  it("builds the three column groups and passes the workflow run to the gene column", () => {
    const Component = loadComponent({ columnVisibility: {} });
    const setDetailsSidebarGeneName = jest.fn();
    renderReport(Component, {}, setDetailsSidebarGeneName);

    const groups = lastTableProps.columns;
    expect(groups.map((g: $TSFixMe) => g.id)).toEqual([
      "geneInfoHeaderGroup",
      "contigsHeaderGroup",
      "readsHeaderGroup",
    ]);
    const geneColumn = groups[0].columns[0];
    expect(geneColumn.workflowRunId).toBe(4242);
    expect(geneColumn.wdlVersion).toBe("1.2.3");
    geneColumn.setDetailsSidebarGeneName("aadA");
    expect(setDetailsSidebarGeneName).toHaveBeenCalledWith("aadA");
    expect(groups[1].columns.map((c: $TSFixMe) => c.id)).toEqual([
      "contigs",
      "cutoff",
      "contigCoverageBreadth",
      "contigPercentId",
      "contigSpecies",
    ]);
    expect(groups[2].columns.map((c: $TSFixMe) => c.id)).toEqual([
      "reads",
      "rpm",
      "readCoverageBreadth",
      "readCoverageDepth",
      "dpm",
      "readSpecies",
    ]);
  });

  it("passes the report row count to the gene info group", () => {
    const Component = loadComponent({ columnVisibility: {} });
    renderReport(Component);
    expect(lastTableProps.columns[0].nRows).toBe(2);
  });

  it("passes a falsy row count when there is no report data", () => {
    const Component = loadComponent({ columnVisibility: {} });
    renderReport(Component, { reportTableData: null });
    expect(lastTableProps.columns[0].nRows).toBe(false);
  });

  it("passes a zero row count for an empty report", () => {
    const Component = loadComponent({ columnVisibility: {} });
    renderReport(Component, { reportTableData: {} });
    expect(lastTableProps.columns[0].nRows).toBe(0);
  });

  it("uses the filters-open wrapper class when filters are shown", () => {
    const Component = loadComponent({ columnVisibility: {} });
    renderReport(Component, { hideFilters: false });
    const wrapper = screen.getByTestId("amr-sample-report");
    expect(wrapper.className).toContain("reportWrapperFiltersOpen");
    expect(wrapper.className).not.toContain("reportWrapperFiltersClosed");
  });

  it("uses the filters-closed wrapper class when filters are hidden", () => {
    const Component = loadComponent({ columnVisibility: {} });
    renderReport(Component, { hideFilters: true });
    const wrapper = screen.getByTestId("amr-sample-report");
    expect(wrapper.className).toContain("reportWrapperFiltersClosed");
  });

  it("withholds the column dropdown until the table reference arrives", () => {
    const Component = loadComponent({ columnVisibility: {} });
    renderReport(Component);
    expect(screen.queryByTestId("toggle-columns-dropdown")).toBeNull();

    // The child Table hands the react-table instance back through
    // setTableReference; only then does the dropdown mount.
    fireEvent.click(screen.getByTestId("amr-table"));
    expect(
      screen
        .getByTestId("toggle-columns-dropdown")
        .getAttribute("data-table-id"),
    ).toBe("react-table-instance");
  });

  it("builds the contigs and reads groups against the table state at memo time", () => {
    const Component = loadComponent({ columnVisibility: {} });
    renderReport(Component);
    // On first render there is no react-table instance yet.
    expect(lastTableProps.columns[1].table).toBeNull();
    expect(lastTableProps.columns[2].table).toBeNull();

    // The columns memo is keyed on reportTableData only, so receiving the table
    // reference re-renders (the dropdown appears) without rebuilding the groups.
    fireEvent.click(screen.getByTestId("amr-table"));
    expect(screen.getByTestId("toggle-columns-dropdown")).toBeTruthy();
    expect(lastTableProps.columns[1].table).toBeNull();
    expect(lastTableProps.columns[2].table).toBeNull();
  });
});
