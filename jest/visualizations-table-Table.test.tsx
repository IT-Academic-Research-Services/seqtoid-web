// Coverage: app/assets/src/components/visualizations/table/Table.tsx
//
// Table is a thin sorting/selection wrapper around BaseTable. Its own logic is:
// deriving sortedData (custom sortFunction vs lodash orderBy vs unsorted),
// computing selectAllChecked, the handleSort callback, the per-row height
// function, and syncing sortBy from a changing defaultSortBy prop. BaseTable is
// stubbed to capture the props Table computes, and those captured callbacks are
// invoked to exercise the branches. react-virtualized is not needed.
import { act, render } from "@testing-library/react";
import React from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */

const _React: typeof React = React;

const mockBase: { props: any } = { props: null };

jest.mock("~/components/visualizations/table/BaseTable", () => ({
  __esModule: true,
  default: (props: any) => {
    mockBase.props = props;
    return require("react").createElement("div", {
      "data-testid": "base-table",
    });
  },
}));

import Table from "~/components/visualizations/table/Table";

const DATA = [
  { id: 1, name: "beta", reads: 30 },
  { id: 2, name: "alpha", reads: 10 },
  { id: 3, name: "gamma", reads: 20 },
];

const COLUMNS = [{ dataKey: "name" }, { dataKey: "reads" }];

const rows = () =>
  Array.from({ length: mockBase.props.rowCount }, (_, i) =>
    mockBase.props.rowGetter({ index: i }),
  );

function renderComp(props: Record<string, any> = {}) {
  return render(<Table columns={COLUMNS} data={DATA} {...props} />);
}

beforeEach(() => {
  mockBase.props = null;
});

describe("Table sorting", () => {
  it("leaves the data unsorted when sortable is off", () => {
    renderComp({ sortable: false, defaultSortBy: "name" });
    expect(rows().map(r => r.name)).toEqual(["beta", "alpha", "gamma"]);
  });

  it("orders ascending by the sort key via lodash when no sortFunction is set", () => {
    renderComp({ sortable: true, defaultSortBy: "name" });
    expect(rows().map(r => r.name)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("orders descending when the sort direction is DESC", () => {
    renderComp({
      sortable: true,
      defaultSortBy: "name",
      defaultSortDirection: "DESC",
    });
    expect(rows().map(r => r.name)).toEqual(["gamma", "beta", "alpha"]);
  });

  it("uses a column's custom sortFunction when present", () => {
    const sortFunction = jest.fn(({ data, sortDirection }) => {
      const sorted = [...data].sort((a, b) => a.reads - b.reads);
      return sortDirection === "asc" ? sorted : sorted.reverse();
    });
    renderComp({
      sortable: true,
      defaultSortBy: "reads",
      columns: [{ dataKey: "name" }, { dataKey: "reads", sortFunction }],
    });
    expect(sortFunction).toHaveBeenCalledWith({
      data: DATA,
      sortDirection: "asc",
    });
    expect(rows().map(r => r.reads)).toEqual([10, 20, 30]);
  });

  it("honours a column sortKey that differs from the dataKey", () => {
    renderComp({
      sortable: true,
      defaultSortBy: "label",
      columns: [{ dataKey: "label", sortKey: "reads" }],
    });
    expect(rows().map(r => r.reads)).toEqual([10, 20, 30]);
  });

  it("updates the sort and notifies onColumnSort when handleSort fires", () => {
    const onColumnSort = jest.fn();
    renderComp({ sortable: true, onColumnSort });
    act(() => {
      mockBase.props.onSort({ sortBy: "reads", sortDirection: "DESC" });
    });
    expect(onColumnSort).toHaveBeenCalledWith({
      sortBy: "reads",
      sortDirection: "DESC",
    });
    // The new sort is applied to the data.
    expect(rows().map(r => r.reads)).toEqual([30, 20, 10]);
  });

  it("does not throw when handleSort fires without an onColumnSort", () => {
    renderComp({ sortable: true });
    act(() => {
      mockBase.props.onSort({ sortBy: "name", sortDirection: "ASC" });
    });
    expect(rows().map(r => r.name)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("re-syncs sortBy when the defaultSortBy prop changes", () => {
    const { rerender } = renderComp({ sortable: true, defaultSortBy: "name" });
    expect(rows().map(r => r.name)).toEqual(["alpha", "beta", "gamma"]);
    rerender(
      <Table columns={COLUMNS} data={DATA} sortable defaultSortBy="reads" />,
    );
    expect(rows().map(r => r.reads)).toEqual([10, 20, 30]);
  });
});

describe("Table select-all", () => {
  it("reports unchecked when there is no selectableKey", () => {
    renderComp({});
    expect(mockBase.props.selectAllChecked).toBe(false);
  });

  it("reports checked when every row's key is in the selected set", () => {
    renderComp({
      selectableKey: "id",
      selected: new Set([1, 2, 3]),
    });
    expect(mockBase.props.selectAllChecked).toBe(true);
  });

  it("reports unchecked when only some rows are selected", () => {
    renderComp({
      selectableKey: "id",
      selected: new Set([1]),
    });
    expect(mockBase.props.selectAllChecked).toBe(false);
  });

  it("reports unchecked when the data is empty", () => {
    renderComp({
      data: [],
      selectableKey: "id",
      selected: new Set([1]),
    });
    expect(mockBase.props.selectAllChecked).toBe(false);
  });
});

describe("Table row height", () => {
  it("passes through a numeric defaultRowHeight", () => {
    renderComp({ defaultRowHeight: 40 });
    expect(mockBase.props.defaultRowHeight({ index: 0 })).toBe(40);
  });

  it("invokes a functional defaultRowHeight with the sorted row", () => {
    const defaultRowHeight = jest.fn(({ row }) =>
      row.name === "alpha" ? 80 : 20,
    );
    renderComp({ sortable: true, defaultSortBy: "name", defaultRowHeight });
    // Sorted ascending -> index 0 is "alpha".
    expect(mockBase.props.defaultRowHeight({ index: 0 })).toBe(80);
    expect(defaultRowHeight).toHaveBeenCalledWith({
      index: 0,
      row: { id: 2, name: "alpha", reads: 10 },
    });
  });
});

describe("Table passthrough", () => {
  it("forwards columns, selection and extra props to BaseTable", () => {
    const rowRenderer = jest.fn();
    renderComp({
      selectableKey: "id",
      selected: new Set([1]),
      rowRenderer,
      headerRowClassName: "hdr",
    });
    expect(mockBase.props.columns).toBe(COLUMNS);
    expect(mockBase.props.selectableKey).toBe("id");
    expect(mockBase.props.rowRenderer).toBe(rowRenderer);
    expect(mockBase.props.headerRowClassName).toBe("hdr");
    expect(mockBase.props.rowCount).toBe(3);
  });
});
