// Coverage: app/assets/src/components/visualizations/table/DataTable.tsx
//
// DataTable is a class component with a fair amount of branching that is not
// reachable from a single render: the static filter/index helpers, the
// derived-state merge, row filtering (multi-term, `__`-prefixed columns, null /
// undefined / empty cells), the two column-width strategies, tooltip and
// disabled-row rendering, and the select-all vs single-row checkbox paths.
// Each of those is driven here, from both sides where a branch has two sides.
import { fireEvent, render } from "@testing-library/react";
import React from "react";
import DataTable from "~/components/visualizations/table/DataTable";

const COLUMNS = ["Name", "Location"];

const rows = () => [
  { Name: "alpha", Location: "USA" },
  { Name: "beta", Location: "Canada" },
  { Name: "gamma", Location: null },
];

const bodyRowText = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("tbody tr")).map(tr =>
    Array.from(tr.querySelectorAll("td"))
      .map(td => td.textContent)
      .join("|"),
  );

const nameCells = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("td.column-Name")).map(
    td => td.textContent,
  );

describe("DataTable.prepareFilter", () => {
  it("normalizes a filter string to trimmed lowercase", () => {
    expect((DataTable as $TSFixMe).prepareFilter("  MiXeD Case  ")).toBe(
      "mixed case",
    );
  });

  it("returns an empty string for undefined and for null", () => {
    expect((DataTable as $TSFixMe).prepareFilter(undefined)).toBe("");
    expect((DataTable as $TSFixMe).prepareFilter(null)).toBe("");
  });

  it("stringifies a non-string filter rather than throwing", () => {
    expect((DataTable as $TSFixMe).prepareFilter(42)).toBe("42");
  });

  it("keeps an empty-string filter empty (not undefined)", () => {
    expect((DataTable as $TSFixMe).prepareFilter("   ")).toBe("");
  });
});

describe("DataTable.indexData", () => {
  it("stamps each row with its original index", () => {
    const indexed = (DataTable as $TSFixMe).indexData(rows());
    expect(indexed.map((r: $TSFixMe) => r.__originalIndex)).toEqual([0, 1, 2]);
    expect(indexed[1].Name).toBe("beta");
  });

  it("returns an empty array for empty data", () => {
    expect((DataTable as $TSFixMe).indexData([])).toEqual([]);
  });
});

describe("DataTable.getDerivedStateFromProps", () => {
  it("returns an empty patch when neither the filter nor the data changed", () => {
    const data = rows();
    const patch = (DataTable as $TSFixMe).getDerivedStateFromProps(
      { filter: "abc", data },
      { filter: "abc", originalData: data },
    );
    expect(patch).toEqual({});
  });

  it("patches only the filter when only the filter changed", () => {
    const data = rows();
    const patch = (DataTable as $TSFixMe).getDerivedStateFromProps(
      { filter: " NEW ", data },
      { filter: "old", originalData: data },
    );
    expect(patch).toEqual({ filter: "new" });
  });

  it("re-indexes when the data identity changed", () => {
    const nextData = rows();
    const patch = (DataTable as $TSFixMe).getDerivedStateFromProps(
      { filter: "", data: nextData },
      { filter: "", originalData: rows() },
    );
    expect(patch.originalData).toBe(nextData);
    expect(patch.indexedData.map((r: $TSFixMe) => r.__originalIndex)).toEqual([
      0, 1, 2,
    ]);
    expect(patch.filter).toBeUndefined();
  });
});

describe("DataTable rendering", () => {
  it("renders one row per datum and one header per column", () => {
    const { container } = render(<DataTable columns={COLUMNS} data={rows()} />);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(3);
    expect(
      Array.from(container.querySelectorAll("th")).map(th => th.textContent),
    ).toEqual(["Name", "Location"]);
    expect(bodyRowText(container)).toEqual([
      "alpha|USA",
      "beta|Canada",
      "gamma|",
    ]);
  });

  it("uses the headers map for the header labels when one is supplied", () => {
    const { container } = render(
      <DataTable
        columns={COLUMNS}
        data={rows()}
        headers={{ Name: "Sample name", Location: "Collection location" }}
      />,
    );
    expect(
      Array.from(container.querySelectorAll("th")).map(th => th.textContent),
    ).toEqual(["Sample name", "Collection location"]);
  });

  it("is striped by default and carries the extra className", () => {
    const { container } = render(
      <DataTable columns={COLUMNS} data={rows()} className="my-table" />,
    );
    const table = container.querySelector("table") as HTMLElement;
    expect(table.className).toContain("striped");
    expect(table.className).toContain("my-table");
    // No selection handler => not selectable, and no checkbox column.
    expect(table.className).not.toContain("selectable");
    expect(container.querySelectorAll("input[type=checkbox]")).toHaveLength(0);
  });

  it("drops the striped class when striped is false", () => {
    const { container } = render(
      <DataTable columns={COLUMNS} data={rows()} striped={false} />,
    );
    expect(
      (container.querySelector("table") as HTMLElement).className,
    ).not.toContain("striped");
  });

  it("adds the selectable class and a checkbox column when a selection handler is given", () => {
    const { container } = render(
      <DataTable
        columns={COLUMNS}
        data={rows()}
        onSelectedRowsChanged={jest.fn()}
      />,
    );
    expect(
      (container.querySelector("table") as HTMLElement).className,
    ).toContain("selectable");
    // one header checkbox + one per row
    expect(container.querySelectorAll("input[type=checkbox]")).toHaveLength(4);
  });

  it("lowercases and dash-joins the column name into the cell test id", () => {
    const { container } = render(
      <DataTable
        columns={["Host Organism"]}
        data={[{ "Host Organism": "Human" }]}
      />,
    );
    expect(
      container.querySelector('[data-testid="host-organism"]')?.textContent,
    ).toBe("Human");
  });

  it("renders the name field of an object cell instead of the object", () => {
    const { container } = render(
      <DataTable
        columns={["Location"]}
        data={[{ Location: { name: "San Francisco", id: 7 } }]}
      />,
    );
    expect(container.querySelector("td")?.textContent).toBe("San Francisco");
  });

  it("renders nothing for an empty data set and leaves select-all unchecked", () => {
    const { container } = render(
      <DataTable
        columns={COLUMNS}
        data={[]}
        onSelectedRowsChanged={jest.fn()}
      />,
    );
    expect(container.querySelectorAll("tbody tr")).toHaveLength(0);
    const headerBox = container.querySelector(
      "thead input[type=checkbox]",
    ) as HTMLInputElement;
    expect(headerBox.checked).toBe(false);
  });
});

describe("DataTable column widths", () => {
  it("applies a fixed columnWidth to headers and cells", () => {
    const { container } = render(
      <DataTable columns={COLUMNS} data={rows()} columnWidth={120} />,
    );
    expect((container.querySelector("th") as HTMLElement).style.width).toBe(
      "120px",
    );
    expect((container.querySelector("td") as HTMLElement).style.width).toBe(
      "120px",
    );
  });

  it("falls back to getColumnWidth when no fixed width is given", () => {
    const getColumnWidth = jest.fn((column: string) =>
      column === "Name" ? 200 : 80,
    );
    const { container } = render(
      <DataTable
        columns={COLUMNS}
        data={rows()}
        getColumnWidth={getColumnWidth}
      />,
    );
    const headers = container.querySelectorAll("th");
    expect((headers[0] as HTMLElement).style.width).toBe("200px");
    expect((headers[1] as HTMLElement).style.width).toBe("80px");
    expect(getColumnWidth).toHaveBeenCalledWith("Name");
  });

  it("prefers columnWidth over getColumnWidth when both are supplied", () => {
    const getColumnWidth = jest.fn(() => 999);
    const { container } = render(
      <DataTable
        columns={COLUMNS}
        data={rows()}
        columnWidth={50}
        getColumnWidth={getColumnWidth}
      />,
    );
    expect((container.querySelector("th") as HTMLElement).style.width).toBe(
      "50px",
    );
    expect(getColumnWidth).not.toHaveBeenCalled();
  });

  it("sets no inline width when neither strategy is supplied", () => {
    const { container } = render(<DataTable columns={COLUMNS} data={rows()} />);
    expect((container.querySelector("th") as HTMLElement).style.width).toBe("");
  });
});

describe("DataTable filtering", () => {
  it("keeps only rows matching the filter, case-insensitively", () => {
    const { container } = render(
      <DataTable columns={COLUMNS} data={rows()} filter="ALPHA" />,
    );
    expect(nameCells(container)).toEqual(["alpha"]);
  });

  it("requires every space-separated term to match somewhere in the row", () => {
    const { container } = render(
      <DataTable columns={COLUMNS} data={rows()} filter="a canada" />,
    );
    expect(nameCells(container)).toEqual(["beta"]);
  });

  it("shows every row when the filter is empty", () => {
    const { container } = render(
      <DataTable columns={COLUMNS} data={rows()} filter="   " />,
    );
    expect(nameCells(container)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("never matches against internal `__`-prefixed columns", () => {
    // "1" only appears in the injected __originalIndex, never in a real cell.
    const { container } = render(
      <DataTable columns={COLUMNS} data={rows()} filter="1" />,
    );
    expect(container.querySelectorAll("tbody tr")).toHaveLength(0);
  });

  it("tolerates null, undefined and empty-string cells while filtering", () => {
    const data = [
      { Name: "gamma", Location: null },
      { Name: "delta", Location: undefined },
      { Name: "", Location: "Peru" },
    ];
    const { container } = render(
      <DataTable columns={COLUMNS} data={data} filter="a" />,
    );
    // gamma and delta match on Name; the empty-name row does not.
    expect(nameCells(container)).toEqual(["gamma", "delta"]);
  });

  it("renders no rows when nothing matches", () => {
    const { container } = render(
      <DataTable columns={COLUMNS} data={rows()} filter="zzzz" />,
    );
    expect(container.querySelectorAll("tbody tr")).toHaveLength(0);
  });
});

describe("DataTable selection", () => {
  const renderSelectable = (extra: Record<string, unknown> = {}) => {
    const onSelectedRowsChanged = jest.fn();
    const utils = render(
      <DataTable
        columns={COLUMNS}
        data={rows()}
        onSelectedRowsChanged={onSelectedRowsChanged}
        {...extra}
      />,
    );
    return { ...utils, onSelectedRowsChanged };
  };

  it("seeds the selection from the selectedRows prop", () => {
    const { container } = renderSelectable({ selectedRows: [1] });
    const boxes = container.querySelectorAll(
      "tbody input[type=checkbox]",
    ) as NodeListOf<HTMLInputElement>;
    expect([boxes[0].checked, boxes[1].checked, boxes[2].checked]).toEqual([
      false,
      true,
      false,
    ]);
  });

  it("marks select-all as checked only when every visible row is selected", () => {
    const { container } = renderSelectable({ selectedRows: [0, 1, 2] });
    expect(
      (
        container.querySelector(
          "thead input[type=checkbox]",
        ) as HTMLInputElement
      ).checked,
    ).toBe(true);
  });

  it("selects a single row and reports the new selection", () => {
    const { container, onSelectedRowsChanged } = renderSelectable();
    const boxes = container.querySelectorAll("tbody input[type=checkbox]");
    fireEvent.click(boxes[2]);

    expect(onSelectedRowsChanged).toHaveBeenCalledTimes(1);
    expect(Array.from(onSelectedRowsChanged.mock.calls[0][0])).toEqual([2]);
  });

  it("deselects a previously selected row", () => {
    const { container, onSelectedRowsChanged } = renderSelectable({
      selectedRows: [0, 1],
    });
    const boxes = container.querySelectorAll("tbody input[type=checkbox]");
    fireEvent.click(boxes[0]);

    expect(Array.from(onSelectedRowsChanged.mock.calls[0][0])).toEqual([1]);
  });

  it("select-all adds every visible row, and clicking again removes them", () => {
    const { container, onSelectedRowsChanged } = renderSelectable();
    const headerBox = container.querySelector("thead input[type=checkbox]");

    fireEvent.click(headerBox as Element);
    expect(Array.from(onSelectedRowsChanged.mock.calls[0][0]).sort()).toEqual([
      0, 1, 2,
    ]);

    fireEvent.click(
      container.querySelector("thead input[type=checkbox]") as Element,
    );
    expect(Array.from(onSelectedRowsChanged.mock.calls[1][0])).toEqual([]);
  });

  it("select-all only touches rows that survive the current filter", () => {
    const { container, onSelectedRowsChanged } = renderSelectable({
      filter: "beta",
    });
    fireEvent.click(
      container.querySelector("thead input[type=checkbox]") as Element,
    );
    expect(Array.from(onSelectedRowsChanged.mock.calls[0][0])).toEqual([1]);
  });

  it("select-all on an empty table still reports an (empty) selection", () => {
    const onSelectedRowsChanged = jest.fn();
    const { container } = render(
      <DataTable
        columns={COLUMNS}
        data={[]}
        onSelectedRowsChanged={onSelectedRowsChanged}
      />,
    );
    fireEvent.click(
      container.querySelector("thead input[type=checkbox]") as Element,
    );
    expect(onSelectedRowsChanged).toHaveBeenCalledTimes(1);
    expect(Array.from(onSelectedRowsChanged.mock.calls[0][0])).toEqual([]);
  });

  it("ignores a change event with an undefined checked value", () => {
    const onSelectedRowsChanged = jest.fn();
    const ref = React.createRef<$TSFixMe>();
    render(
      <DataTable
        ref={ref}
        columns={COLUMNS}
        data={rows()}
        onSelectedRowsChanged={onSelectedRowsChanged}
      />,
    );
    ref.current.handleCheckBoxChange(0, undefined);
    expect(onSelectedRowsChanged).not.toHaveBeenCalled();
  });
});

describe("DataTable disabled rows and tooltips", () => {
  const dataWithDisabled = () => [
    { Name: "alpha", Location: "USA" },
    {
      Name: "beta",
      Location: "Canada",
      shouldDisable: true,
      tooltipInfo: {
        content: "Not available for this sample",
        position: "top center",
      },
    },
    { Name: "gamma", Location: "Peru" },
  ];

  it("renders a disabled checkbox for a row flagged shouldDisable", () => {
    const { container } = render(
      <DataTable
        columns={COLUMNS}
        data={dataWithDisabled()}
        onSelectedRowsChanged={jest.fn()}
      />,
    );
    const boxes = container.querySelectorAll(
      "tbody input[type=checkbox]",
    ) as NodeListOf<HTMLInputElement>;
    expect(boxes).toHaveLength(3);
    expect(boxes[0].disabled).toBe(false);
    expect(boxes[1].disabled).toBe(true);
    expect(boxes[2].disabled).toBe(false);
  });

  it("never selects a disabled row via select-all", () => {
    const onSelectedRowsChanged = jest.fn();
    const { container } = render(
      <DataTable
        columns={COLUMNS}
        data={dataWithDisabled()}
        onSelectedRowsChanged={onSelectedRowsChanged}
      />,
    );
    fireEvent.click(
      container.querySelector("thead input[type=checkbox]") as Element,
    );
    expect(Array.from(onSelectedRowsChanged.mock.calls[0][0]).sort()).toEqual([
      0, 2,
    ]);
  });

  it("keeps a disabled row's checkbox unchecked even if its index is selected", () => {
    const { container } = render(
      <DataTable
        columns={COLUMNS}
        data={dataWithDisabled()}
        selectedRows={[0, 1]}
        onSelectedRowsChanged={jest.fn()}
      />,
    );
    const boxes = container.querySelectorAll(
      "tbody input[type=checkbox]",
    ) as NodeListOf<HTMLInputElement>;
    expect(boxes[0].checked).toBe(true);
    expect(boxes[1].checked).toBe(false);
  });

  it("still renders the cell contents of a disabled row", () => {
    const { container } = render(
      <DataTable columns={COLUMNS} data={dataWithDisabled()} />,
    );
    expect(nameCells(container)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("wraps only the columns named in columnTooltips, leaving the rest as plain cells", () => {
    const data = [
      {
        Name: "alpha",
        Location: "USA",
        columnTooltips: {
          Name: { content: "The sample name", position: "top center" },
        },
      },
    ];
    const { container } = render(<DataTable columns={COLUMNS} data={data} />);
    // Both cells still render their values; the tooltip wrapper is transparent
    // until hovered.
    expect(nameCells(container)).toEqual(["alpha"]);
    expect(container.querySelector("td.column-Location")?.textContent).toBe(
      "USA",
    );
  });
});
