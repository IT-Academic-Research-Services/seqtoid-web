// Coverage: app/assets/src/components/views/SampleView/components/AmrView/
//   components/AmrSampleReport/components/ToggleVisibleColumnsDropdown/
//   ToggleVisibleColumnsDropdown.tsx
//
// ToggleVisibleColumnsDropdown turns a react-table instance into a grouped
// column-visibility DropdownMenu. formatDropdownOption (exported) maps a column
// to a {name, section}. The component builds dropdown options from every leaf
// column except "gene", seeds the selected value from the currently-visible
// columns, and on change flips react-table visibility for exactly the columns
// that crossed the selected boundary, persisting the result to localStorage. A
// hand-built fake table drives getAllLeafColumns / getVisibleLeafColumns /
// getColumn, the SDS primitives are stubbed to capture the menu props, and the
// persistence helper is mocked so the show/hide branches are asserted directly.
import { act, fireEvent, render, screen } from "@testing-library/react";

let lastMenuProps: $TSFixMe = null;
jest.mock("@czi-sds/components", () => {
  const ReactLib = require("react");
  return {
    ButtonIcon: (props: $TSFixMe) =>
      ReactLib.createElement("button", {
        "data-testid": "toggle-visible-columns-button",
        onClick: props.onClick,
      }),
    Tooltip: (props: $TSFixMe) => props.children,
    DropdownMenu: (props: $TSFixMe) => {
      lastMenuProps = props;
      return props.open
        ? ReactLib.createElement("div", { "data-testid": "columns-menu" })
        : null;
    },
    DefaultDropdownMenuOption: {},
  };
});

const mockPersistColumnVisibility = jest.fn();
jest.mock(
  "~/components/views/SampleView/components/AmrView/components/AmrSampleReport/columnDefinitions/columnDefUtils",
  () => ({
    persistColumnVisibilityToLocalStorage: (...args: $TSFixMe[]) =>
      mockPersistColumnVisibility(...args),
  }),
);

// ToggleAllButton pulls in more constants machinery; stub it to a marker.
jest.mock(
  "~/components/views/SampleView/components/AmrView/components/AmrSampleReport/components/ToggleVisibleColumnsDropdown/components/ToggleAllButton",
  () => ({
    ToggleAllButton: () => null,
  }),
);

import {
  formatDropdownOption,
  ToggleVisibleColumnsDropdown,
} from "~/components/views/SampleView/components/AmrView/components/AmrSampleReport/components/ToggleVisibleColumnsDropdown/ToggleVisibleColumnsDropdown";
import { COLUMN_ID_TO_NAME } from "~/components/views/SampleView/components/AmrView/constants";

// A minimal react-table column stub with a mutable visibility flag.
const makeColumn = (id: string, visible: boolean) => {
  let isVisible = visible;
  return {
    id,
    getIsVisible: () => isVisible,
    toggleVisibility: jest.fn((next: boolean) => {
      isVisible = next;
    }),
  };
};

// leaf columns: gene (always first/visible), contigs (visible), reads (hidden)
const buildTable = () => {
  const gene = makeColumn("gene", true);
  const contigs = makeColumn("contigs", true);
  const reads = makeColumn("reads", false);
  const all = [gene, contigs, reads];
  // Stable array reference: the component's useEffect depends on the visible
  // columns array, so returning a fresh array each call would loop forever.
  const visible = [gene, contigs];
  const byId: $TSFixMe = { gene, contigs, reads };
  return {
    columns: byId,
    table: {
      getAllLeafColumns: () => all,
      // visible leaf columns: gene + contigs (reads hidden)
      getVisibleLeafColumns: () => visible,
      getColumn: (id: string) => byId[id],
    } as $TSFixMe,
  };
};

beforeEach(() => {
  jest.clearAllMocks();
  lastMenuProps = null;
});

describe("formatDropdownOption", () => {
  it("maps a column id to its display name and section", () => {
    expect(formatDropdownOption({ id: "contigs" } as $TSFixMe)).toEqual({
      name: COLUMN_ID_TO_NAME.get("contigs"),
      section: "Contigs",
    });
    expect(formatDropdownOption({ id: "reads" } as $TSFixMe)).toEqual({
      name: COLUMN_ID_TO_NAME.get("reads"),
      section: "Reads",
    });
  });
});

describe("ToggleVisibleColumnsDropdown", () => {
  it("builds dropdown options from every leaf column except gene", () => {
    const { table } = buildTable();
    render(<ToggleVisibleColumnsDropdown table={table} />);
    const names = lastMenuProps.options.map((o: $TSFixMe) => o.name);
    expect(names).toContain(COLUMN_ID_TO_NAME.get("contigs"));
    expect(names).toContain(COLUMN_ID_TO_NAME.get("reads"));
    expect(names).not.toContain(COLUMN_ID_TO_NAME.get("gene"));
  });

  it("seeds the selected value from the visible columns (dropping the first)", () => {
    const { table } = buildTable();
    render(<ToggleVisibleColumnsDropdown table={table} />);
    // visibleColumns = [gene, contigs]; slice(1) -> [contigs]
    const value = lastMenuProps.value.map((o: $TSFixMe) => o.name);
    expect(value).toEqual([COLUMN_ID_TO_NAME.get("contigs")]);
  });

  it("opens and closes the menu via the trigger button", () => {
    const { table } = buildTable();
    render(<ToggleVisibleColumnsDropdown table={table} />);
    expect(screen.queryByTestId("columns-menu")).toBeNull();

    fireEvent.click(screen.getByTestId("toggle-visible-columns-button"));
    expect(screen.getByTestId("columns-menu")).toBeTruthy();

    fireEvent.click(screen.getByTestId("toggle-visible-columns-button"));
    expect(screen.queryByTestId("columns-menu")).toBeNull();
  });

  it("shows a newly-selected column and persists the visibility set", () => {
    const { table, columns } = buildTable();
    render(<ToggleVisibleColumnsDropdown table={table} />);

    // Select both contigs and reads -> reads (currently hidden) is shown.
    act(() =>
      lastMenuProps.onChange({} as $TSFixMe, [
        { name: COLUMN_ID_TO_NAME.get("contigs") },
        { name: COLUMN_ID_TO_NAME.get("reads") },
      ]),
    );

    expect(columns.reads.toggleVisibility).toHaveBeenCalledWith(true);
    // contigs was already visible and stays selected -> not toggled
    expect(columns.contigs.toggleVisibility).not.toHaveBeenCalled();
    // gene is always present + the selected ids get persisted
    expect(mockPersistColumnVisibility).toHaveBeenCalledWith([
      "gene",
      "contigs",
      "reads",
    ]);
  });

  it("hides a column that is deselected", () => {
    const { table, columns } = buildTable();
    render(<ToggleVisibleColumnsDropdown table={table} />);

    // Deselect contigs (currently visible) -> it gets hidden.
    act(() => lastMenuProps.onChange({} as $TSFixMe, []));

    expect(columns.contigs.toggleVisibility).toHaveBeenCalledWith(false);
    // reads was already hidden and not selected -> untouched
    expect(columns.reads.toggleVisibility).not.toHaveBeenCalled();
    expect(mockPersistColumnVisibility).toHaveBeenCalledWith(["gene"]);
  });
});
