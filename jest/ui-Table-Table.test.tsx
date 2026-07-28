// Coverage: app/assets/src/components/ui/Table/Table.tsx
//
// Table is a generic react-table v8 + react-virtuoso wrapper. react-virtuoso is
// stubbed so the header/body render callbacks actually run in jsdom (the real
// virtualizer renders nothing without layout measurement). Tests cover the
// loading -> EmptyTable branch, the tableData->rows mapping, the table-reference
// effect, the checked-row <-> rowSelection sync effects, and the
// enableMultiRowSelection column-injection branch.
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";

const _React: typeof React = React;

// Stub the virtualizer: drive fixedHeaderContent + itemContent directly so the
// callbacks in Table.tsx are exercised without needing DOM measurement.
jest.mock("react-virtuoso", () => {
  const ReactLib = require("react");
  return {
    TableVirtuoso: ({
      totalCount,
      fixedHeaderContent,
      itemContent,
    }: $TSFixMe) => {
      const rows = [];
      for (let i = 0; i < totalCount; i++) {
        rows.push(
          ReactLib.createElement(
            "tbody",
            { key: i, "data-testid": `vrow-${i}` },
            ReactLib.createElement("tr", null, itemContent(i)),
          ),
        );
      }
      return ReactLib.createElement(
        "table",
        { "data-testid": "virtuoso" },
        ReactLib.createElement("thead", null, fixedHeaderContent()),
        ...rows,
      );
    },
  };
});

import { Table } from "~/components/ui/Table/Table";

type Row = { id: string; name: string };

// Grouped columns: HeaderContent reads headerGroups[0] (parent) AND [1] (child),
// so a single nesting level is required.
const columns = [
  {
    id: "group",
    header: "Group",
    columns: [
      {
        accessorKey: "name",
        header: "Name",
        cell: (info: $TSFixMe) => info.getValue(),
      },
    ],
  },
] as $TSFixMe;

const tableData = {
  "1": { id: "1", name: "Alpha" },
  "2": { id: "2", name: "Bravo" },
};

const baseProps = {
  columns,
  initialVisibilityState: { columnVisibility: {} } as $TSFixMe,
  uniqueIdentifier: "id" as keyof Row,
};

describe("Table", () => {
  it("renders the loading skeleton (EmptyTable) instead of rows when isLoading", () => {
    render(<Table<Row> {...baseProps} tableData={tableData} isLoading />);
    // EmptyTable emits loading-cell placeholders and no virtualized table.
    expect(
      document.querySelectorAll("[data-test-id='loading-cell']").length,
    ).toBeGreaterThan(0);
    expect(screen.queryByTestId("virtuoso")).toBeNull();
  });

  it("maps tableData into rows and renders header + cell content", () => {
    render(<Table<Row> {...baseProps} tableData={tableData} />);
    expect(screen.getByTestId("virtuoso")).toBeTruthy();
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Bravo")).toBeTruthy();
    // Header cells (parent group + child column) render via flexRender.
    expect(screen.getByText("Name")).toBeTruthy();
    expect(screen.getByText("Group")).toBeTruthy();
    expect(screen.getAllByTestId(/vrow-/).length).toBe(2);
  });

  it("renders no data rows when tableData is undefined", () => {
    render(<Table<Row> {...baseProps} tableData={undefined} />);
    expect(screen.getByTestId("virtuoso")).toBeTruthy();
    expect(screen.queryByTestId("vrow-0")).toBeNull();
  });

  it("hands the react-table instance back through setTableReference", () => {
    const setTableReference = jest.fn();
    render(
      <Table<Row>
        {...baseProps}
        tableData={tableData}
        setTableReference={setTableReference}
      />,
    );
    expect(setTableReference).toHaveBeenCalled();
    const tableInstance = setTableReference.mock.calls[0][0];
    // A real react-table instance exposes getRowModel().
    expect(typeof tableInstance.getRowModel).toBe("function");
    expect(tableInstance.getRowModel().rows.length).toBe(2);
  });

  it("reports the initially checked rows through onSetCheckedRows (empty on mount)", () => {
    const onSetCheckedRows = jest.fn();
    render(
      <Table<Row>
        {...baseProps}
        tableData={tableData}
        onSetCheckedRows={onSetCheckedRows}
      />,
    );
    // The rowSelection effect fires on mount with no selection.
    expect(onSetCheckedRows).toHaveBeenCalledWith([]);
  });

  it("syncs the checkedRows prop into row selection and echoes it back", async () => {
    const onSetCheckedRows = jest.fn();
    render(
      <Table<Row>
        {...baseProps}
        tableData={tableData}
        enableMultiRowSelection
        checkedRows={[{ id: "1", name: "Alpha" }]}
        onSetCheckedRows={onSetCheckedRows}
      />,
    );
    // checkedRows -> rowSelection -> onSetCheckedRows echoes the selected original.
    await waitFor(() => {
      const lastCall =
        onSetCheckedRows.mock.calls[onSetCheckedRows.mock.calls.length - 1][0];
      expect(lastCall).toEqual([{ id: "1", name: "Alpha" }]);
    });
  });

  it("injects the selection column when enableMultiRowSelection is set", () => {
    render(
      <Table<Row>
        {...baseProps}
        tableData={tableData}
        enableMultiRowSelection
      />,
    );
    // The row-selection column renders checkbox controls in the header/body.
    expect(
      document.querySelectorAll("input[type='checkbox']").length,
    ).toBeGreaterThan(0);
  });

  it("honors an explicit ascending initial sort without throwing", () => {
    render(
      <Table<Row>
        {...baseProps}
        tableData={tableData}
        initialSortKey="name"
        isInitialSortDescending={false}
      />,
    );
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Bravo")).toBeTruthy();
  });
});
