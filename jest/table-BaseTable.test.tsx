// Frontend coverage: app/assets/src/components/visualizations/table/BaseTable.tsx
//
// BaseTable is the shared wrapper around react-virtualized's Table. Almost all
// of its own logic lives in how it *describes* the table: applying column
// defaults (humanized label, fallback width), choosing between the sortable and
// the basic header renderer per column, dropping the sort props when the table
// is not sortable, adding the selection column and its checkbox renderers, and
// adding the "+" column selector when initialActiveColumns is supplied.
//
// react-virtualized renders nothing useful in jsdom (AutoSizer measures a
// zero-sized container and the Grid virtualizes everything away), so Table and
// Column are stubbed to capture the props BaseTable hands them. The renderers
// BaseTable owns are then invoked and rendered for real, which is where the
// branch coverage is.
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import BaseTable from "~/components/visualizations/table/BaseTable";

// Keeps organize-imports from dropping the React import the classic JSX
// runtime needs in scope.
const _React: typeof React = React;

/* eslint-disable @typescript-eslint/no-explicit-any */

// Single mutable holder so the jest.mock factories (which may only close over
// `mock`-prefixed bindings) and the tests share the same object.
const mockCapture: {
  table: any;
  tableRef: any;
  columns: any[];
  dropdown: any;
} = { table: null, tableRef: null, columns: [], dropdown: null };

jest.mock("react-virtualized", () => {
  const react = require("react");
  return {
    __esModule: true,
    AutoSizer: ({ children }: any) => children({ width: 1000, height: 500 }),
    Column: () => null,
    Table: react.forwardRef((props: any, ref: any) => {
      mockCapture.table = props;
      mockCapture.tableRef = ref;
      mockCapture.columns = react.Children.toArray(props.children).map(
        (child: any) => child.props,
      );
      return react.createElement("div", { "data-testid": "virtualized-table" });
    }),
  };
});

jest.mock("~/components/ui/containers/ColumnHeaderTooltip", () => ({
  __esModule: true,
  default: ({ trigger, title, content, link }: any) => (
    <div
      data-testid="header-tooltip"
      data-title={title === undefined ? "" : String(title)}
      data-content={content === undefined ? "" : String(content)}
      data-link={link === undefined ? "" : String(link)}
    >
      {trigger}
    </div>
  ),
}));

jest.mock("~/components/common/BasicPopup", () => ({
  __esModule: true,
  default: ({ trigger, content }: any) => (
    <div data-testid="basic-popup" data-content={String(content)}>
      {trigger}
    </div>
  ),
}));

jest.mock("~ui/controls/dropdowns/MultipleDropdown", () => ({
  __esModule: true,
  default: (props: any) => {
    mockCapture.dropdown = props;
    return <div data-testid="column-selector-dropdown" />;
  },
}));

jest.mock("~ui/icons/SortIcon", () => ({
  __esModule: true,
  default: ({ sortDirection, className }: any) => (
    <div
      data-testid="sort-icon"
      data-direction={sortDirection}
      data-classname={className}
    />
  ),
}));

const COLUMNS = () => [
  { dataKey: "sample_name" },
  { dataKey: "host", label: "Host Organism", width: 120 },
];

const renderTable = (props: Record<string, any> = {}) =>
  render(
    <BaseTable
      columns={COLUMNS()}
      rowCount={3}
      rowGetter={({ index }: any) => ({ id: index })}
      {...props}
    />,
  );

// Renders whatever one of BaseTable's own renderers returned.
const renderNode = (node: React.ReactNode) => render(<div>{node}</div>);

const columnKeys = () => mockCapture.columns.map(c => c.dataKey);
const columnByKey = (dataKey: string) =>
  mockCapture.columns.find(c => c.dataKey === dataKey);

beforeEach(() => {
  mockCapture.table = null;
  mockCapture.tableRef = null;
  mockCapture.columns = [];
  mockCapture.dropdown = null;
});

describe("BaseTable column defaults", () => {
  it("humanizes the dataKey when no label is given and keeps an explicit one", () => {
    renderTable();
    expect(columnByKey("sample_name").label).toBe("Sample Name");
    expect(columnByKey("host").label).toBe("Host Organism");
  });

  it("falls back to defaultColumnWidth only for columns without a width", () => {
    renderTable();
    // 60 is the component default.
    expect(columnByKey("sample_name").width).toBe(60);
    expect(columnByKey("host").width).toBe(120);
  });

  it("honours an overridden defaultColumnWidth", () => {
    renderTable({ defaultColumnWidth: 250 });
    expect(columnByKey("sample_name").width).toBe(250);
    expect(columnByKey("host").width).toBe(120);
  });

  it("renders one Column per column and no selection or placeholder column", () => {
    renderTable();
    expect(columnKeys()).toEqual(["sample_name", "host"]);
  });

  it("skips entries of initialActiveColumns that have no matching column", () => {
    renderTable({ initialActiveColumns: ["host", "does_not_exist"] });
    expect(columnKeys()).toEqual(["host", "plusPlaceholder"]);
  });

  it("orders the columns by initialActiveColumns rather than by the columns prop", () => {
    renderTable({ initialActiveColumns: ["host", "sample_name"] });
    expect(columnKeys()).toEqual(["host", "sample_name", "plusPlaceholder"]);
  });
});

describe("BaseTable sort wiring", () => {
  it("blanks out the sort props when the table is not sortable", () => {
    const onSort = jest.fn();
    renderTable({
      sortable: false,
      onSort,
      sortBy: "host",
      sortDirection: "ASC",
    });
    expect(mockCapture.table.sort).toBeNull();
    expect(mockCapture.table.sortBy).toBe("");
    expect(mockCapture.table.sortDirection).toBe("DESC");
  });

  it("passes the sort props through when the table is sortable", () => {
    const onSort = jest.fn();
    renderTable({
      sortable: true,
      onSort,
      sortBy: "host",
      sortDirection: "ASC",
    });
    expect(mockCapture.table.sort).toBe(onSort);
    expect(mockCapture.table.sortBy).toBe("host");
    expect(mockCapture.table.sortDirection).toBe("ASC");
  });

  it("uses the sortable header renderer only for sortable columns", () => {
    renderTable({
      columns: [{ dataKey: "host" }, { dataKey: "reads", disableSort: true }],
      sortable: true,
    });

    renderNode(
      columnByKey("host").headerRenderer({
        columnData: null,
        dataKey: "host",
        label: "Host",
        sortBy: "host",
        sortDirection: "ASC",
      }),
    );
    expect(screen.getByTestId("sort-icon")).toBeTruthy();

    renderNode(
      columnByKey("reads").headerRenderer({
        columnData: null,
        label: "Reads",
      }),
    );
    // Still exactly one sort icon in the document -- the disableSort column
    // got the basic renderer.
    expect(screen.getAllByTestId("sort-icon")).toHaveLength(1);
  });

  it("uses the basic header renderer for every column when sortable is off", () => {
    renderTable({ sortable: false });
    renderNode(
      columnByKey("host").headerRenderer({
        columnData: null,
        label: "Host Organism",
      }),
    );
    expect(screen.queryByTestId("sort-icon")).toBeNull();
    expect(screen.getByText("Host Organism")).toBeTruthy();
  });
});

describe("BaseTable header renderers", () => {
  it("shows the column tooltip metadata when columnData is present", () => {
    renderTable({ sortable: false });
    renderNode(
      columnByKey("host").headerRenderer({
        columnData: { tooltip: "The host", link: "http://example.org/host" },
        label: "Host Organism",
      }),
    );
    const tooltip = screen.getByTestId("header-tooltip");
    expect(tooltip.getAttribute("data-title")).toBe("Host Organism");
    expect(tooltip.getAttribute("data-content")).toBe("The host");
    expect(tooltip.getAttribute("data-link")).toBe("http://example.org/host");
  });

  it("falls back to the label as tooltip content when columnData is absent", () => {
    renderTable({ sortable: false });
    renderNode(
      columnByKey("host").headerRenderer({
        columnData: undefined,
        label: "Host Organism",
      }),
    );
    const tooltip = screen.getByTestId("header-tooltip");
    expect(tooltip.getAttribute("data-title")).toBe("");
    expect(tooltip.getAttribute("data-content")).toBe("Host Organism");
    expect(tooltip.getAttribute("data-link")).toBe("");
  });

  it("renders the sortable header with a kebab-cased test id and the sort direction", () => {
    renderTable({ sortable: true });
    renderNode(
      columnByKey("host").headerRenderer({
        columnData: { tooltip: "tip" },
        dataKey: "host",
        label: "Host Organism",
        sortBy: "host",
        sortDirection: "DESC",
      }),
    );
    // The wrapper and the label span both carry the kebab-cased test id.
    expect(screen.getAllByTestId("host-organism-column-header").length).toBe(2);
    expect(screen.getByTestId("sort-icon").getAttribute("data-direction")).toBe(
      "descending",
    );
  });

  it("maps ASC to the ascending sort icon", () => {
    renderTable({ sortable: true });
    renderNode(
      columnByKey("host").headerRenderer({
        columnData: null,
        dataKey: "other",
        label: "Host Organism",
        sortBy: "host",
        sortDirection: "ASC",
      }),
    );
    expect(screen.getByTestId("sort-icon").getAttribute("data-direction")).toBe(
      "ascending",
    );
  });
});

describe("BaseTable selection column", () => {
  const withSelection = (props: Record<string, any> = {}) =>
    renderTable({
      selectableKey: "id",
      selected: new Set([1]),
      onSelectRow: jest.fn(),
      onSelectAllRows: jest.fn(),
      ...props,
    });

  it("prepends a selection column sized by defaultSelectColumnWidth", () => {
    withSelection({ defaultSelectColumnWidth: 44 });
    expect(mockCapture.columns[0].dataKey).toBe("id");
    expect(mockCapture.columns[0].width).toBe(44);
    expect(mockCapture.columns[0].disableSort).toBe(true);
    expect(columnKeys()).toEqual(["id", "sample_name", "host"]);
  });

  it("renders a checked checkbox for a selected row and an unchecked one otherwise", () => {
    withSelection();
    const cellRenderer = mockCapture.columns[0].cellRenderer;

    const { container: selectedCell } = renderNode(
      cellRenderer({ cellData: 1 }),
    );
    expect(
      (selectedCell.querySelector("input") as HTMLInputElement).checked,
    ).toBe(true);

    const { container: unselectedCell } = renderNode(
      cellRenderer({ cellData: 2 }),
    );
    expect(
      (unselectedCell.querySelector("input") as HTMLInputElement).checked,
    ).toBe(false);
  });

  it("disables the checkbox and swaps in -1 when the row has no id", () => {
    withSelection();
    const { container } = renderNode(
      mockCapture.columns[0].cellRenderer({ cellData: null }),
    );
    const input = container.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("-1");
    expect(input.disabled).toBe(true);
  });

  it("keeps the checkbox enabled for a real row id", () => {
    withSelection();
    const { container } = renderNode(
      mockCapture.columns[0].cellRenderer({ cellData: 7 }),
    );
    const input = container.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("7");
    expect(input.disabled).toBe(false);
  });

  it("calls onSelectRow with the row id when a row checkbox is clicked", () => {
    const onSelectRow = jest.fn();
    withSelection({ onSelectRow });
    const { container } = renderNode(
      mockCapture.columns[0].cellRenderer({ cellData: 7 }),
    );
    fireEvent.click(
      container.querySelector("[data-testid=row-select-checkbox]") as Element,
    );
    expect(onSelectRow).toHaveBeenCalledTimes(1);
    expect(onSelectRow.mock.calls[0][0]).toBe(7);
    expect(onSelectRow.mock.calls[0][1]).toBe(true);
  });

  it("defers to a custom selectableCellRenderer when one is given", () => {
    const selectableCellRenderer = jest.fn(({ cellData }: any) => (
      <span data-testid="custom-cell">{`row-${cellData}`}</span>
    ));
    withSelection({ selectableCellRenderer, selectableCellClassName: "sel" });

    renderNode(mockCapture.columns[0].cellRenderer({ cellData: 9 }));
    expect(screen.getByTestId("custom-cell").textContent).toBe("row-9");
    expect(
      selectableCellRenderer.mock.calls[0][0].selectableCellClassName,
    ).toBe("sel");
    // No checkbox at all -- the default renderer was bypassed.
    expect(screen.queryByTestId("row-select-checkbox")).toBeNull();
  });

  it("renders the select-all header and reports the new checked state", () => {
    const onSelectAllRows = jest.fn();
    withSelection({ onSelectAllRows, selectAllChecked: false });
    const { container } = renderNode(mockCapture.columns[0].headerRenderer({}));
    const input = container.querySelector("input") as HTMLInputElement;
    expect(input.checked).toBe(false);
    expect(input.value).toBe("all");

    fireEvent.click(input);
    expect(onSelectAllRows).toHaveBeenCalledWith(true);
  });

  it("reflects selectAllChecked in the header checkbox", () => {
    withSelection({ selectAllChecked: true });
    const { container } = renderNode(mockCapture.columns[0].headerRenderer({}));
    expect((container.querySelector("input") as HTMLInputElement).checked).toBe(
      true,
    );
  });
});

describe("BaseTable column selector", () => {
  const COLS = [
    { dataKey: "sample_name" },
    { dataKey: "host", label: "Host Organism" },
    { dataKey: "reads", label: "Reads" },
  ];

  it("is not rendered without initialActiveColumns", () => {
    renderTable();
    expect(screen.queryByTestId("column-selector-dropdown")).toBeNull();
  });

  it("offers every non-protected column and preselects the non-protected active ones", () => {
    renderTable({
      columns: COLS,
      initialActiveColumns: ["sample_name", "host"],
      protectedColumns: ["sample_name"],
    });

    expect(screen.getByTestId("column-selector-dropdown")).toBeTruthy();
    expect(mockCapture.dropdown.options).toEqual([
      { value: "host", text: "Host Organism" },
      { value: "reads", text: "Reads" },
    ]);
    expect(mockCapture.dropdown.value).toEqual(["host"]);
  });

  it("re-adds the protected columns when the selection changes and notifies the caller", () => {
    const onActiveColumnsChange = jest.fn();
    renderTable({
      columns: COLS,
      initialActiveColumns: ["sample_name", "host"],
      protectedColumns: ["sample_name"],
      onActiveColumnsChange,
    });

    act(() => mockCapture.dropdown.onChange(["reads"]));

    expect(onActiveColumnsChange).toHaveBeenCalledWith([
      "sample_name",
      "reads",
    ]);
    expect(columnKeys()).toEqual(["sample_name", "reads", "plusPlaceholder"]);
  });

  it("still updates the columns when no onActiveColumnsChange is supplied", () => {
    renderTable({
      columns: COLS,
      initialActiveColumns: ["sample_name"],
      protectedColumns: [],
    });

    act(() => mockCapture.dropdown.onChange(["reads", "host"]));
    expect(columnKeys()).toEqual(["reads", "host", "plusPlaceholder"]);
  });
});

describe("BaseTable horizontal scrolling (SMP-1794)", () => {
  // AutoSizer is mocked to report a 1000px-wide container.
  const WIDE_COLUMNS = [
    { dataKey: "a", width: 400 },
    { dataKey: "b", width: 400 },
    { dataKey: "c", width: 400 },
  ];

  it("keeps the table bound to the container width by default (no scroll)", () => {
    renderTable({
      columns: WIDE_COLUMNS,
      initialActiveColumns: ["a", "b", "c"],
    });
    // Columns total 1200 + 20 placeholder > 1000, but without the opt-in the
    // table stays at the container width and columns are squeezed -- the
    // pre-existing behaviour.
    expect(mockCapture.table.width).toBe(1000);
    // No horizontal scroller is inserted around the table.
    expect(
      screen.getByTestId("virtualized-table").parentElement?.style.width,
    ).toBe("");
  });

  it("sizes the table to the sum of column widths when horizontallyScrollable and they overflow", () => {
    renderTable({
      columns: WIDE_COLUMNS,
      initialActiveColumns: ["a", "b", "c"],
      selectableKey: "id",
      horizontallyScrollable: true,
    });
    // 30 (select) + 400*3 + 20 (placeholder) = 1250.
    expect(mockCapture.table.width).toBe(1250);
    // The table is wrapped in a scroller constrained to the container size.
    expect(
      screen.getByTestId("virtualized-table").parentElement?.style.width,
    ).toBe("1000px");
  });

  it("stays at the container width when horizontallyScrollable but columns fit", () => {
    renderTable({
      columns: [
        { dataKey: "a", width: 100 },
        { dataKey: "b", width: 100 },
      ],
      initialActiveColumns: ["a", "b"],
      horizontallyScrollable: true,
    });
    // 100 + 100 + 20 = 220 < 1000, so max() keeps the container width and no
    // empty-space regression is introduced.
    expect(mockCapture.table.width).toBe(1000);
  });
});

describe("BaseTable table props", () => {
  it("forwards onRowClick only when the caller supplies one", () => {
    const onRowClick = jest.fn();
    renderTable({ onRowClick, rowClassName: "myRow" });
    expect(mockCapture.table.onRowClick).toBe(onRowClick);
    expect(mockCapture.table.rowClassName).toContain("myRow");

    renderTable({ rowClassName: "myRow" });
    expect(mockCapture.table.onRowClick).toBeUndefined();
    expect(mockCapture.table.rowClassName).toContain("myRow");
  });

  it("passes the sizing, ref and row callbacks straight through", () => {
    const forwardRef = jest.fn();
    const onRowsRendered = jest.fn();
    const rowGetter = jest.fn(({ index }: any) => ({ index }));
    renderTable({
      forwardRef,
      onRowsRendered,
      rowGetter,
      rowCount: 12,
      defaultHeaderHeight: 66,
      defaultRowHeight: 42,
    });

    expect(mockCapture.table.headerHeight).toBe(66);
    expect(mockCapture.table.rowHeight).toBe(42);
    expect(mockCapture.table.rowCount).toBe(12);
    expect(mockCapture.table.rowGetter).toBe(rowGetter);
    expect(mockCapture.tableRef).toBe(forwardRef);
    expect(mockCapture.table.onRowsRendered).toBe(onRowsRendered);
    // AutoSizer dimensions reach the table.
    expect(mockCapture.table.width).toBe(1000);
    expect(mockCapture.table.height).toBe(500);
  });

  it("forwards unrecognised props to the underlying virtualized table", () => {
    renderTable({ headerRowClassName: "hdr", rowRenderer: undefined });
    expect(mockCapture.table.headerRowClassName).toBe("hdr");
  });
});
