// Frontend coverage: app/assets/src/components/visualizations/table/InfiniteTable.tsx
//
// InfiniteTable wraps BaseTable in react-virtualized's InfiniteLoader and owns
// the paging bookkeeping: which row indices have been requested, splicing the
// fetched page into its row buffer, deciding whether more rows exist (a short
// page means end of data), cancelling an in-flight fetch on unmount/reset, and
// the default cell / row / row-height renderers.
//
// InfiniteLoader and BaseTable are stubbed so the props InfiniteTable computes
// can be read directly, and the component instance is reached through a ref so
// the paging methods can be driven the way react-virtualized drives them.
import { act, render } from "@testing-library/react";
import React from "react";
import InfiniteTable from "~/components/visualizations/table/InfiniteTable";

// Keeps organize-imports from dropping the React import the classic JSX
// runtime needs in scope.
const _React: typeof React = React;

/* eslint-disable @typescript-eslint/no-explicit-any */

const mockCapture: {
  loader: any;
  base: any;
  resetCalls: any[];
  onRowsRendered: any;
  registerChild: any;
} = {
  loader: null,
  base: null,
  resetCalls: [],
  onRowsRendered: jest.fn(),
  registerChild: jest.fn(),
};

jest.mock("react-virtualized", () => {
  const react = require("react");
  class MockInfiniteLoader extends react.Component<any> {
    resetLoadMoreRowsCache = (autoReload: boolean) => {
      mockCapture.resetCalls.push(autoReload);
    };
    render() {
      mockCapture.loader = this.props;
      return this.props.children({
        onRowsRendered: mockCapture.onRowsRendered,
        registerChild: mockCapture.registerChild,
      });
    }
  }
  return {
    __esModule: true,
    InfiniteLoader: MockInfiniteLoader,
    defaultTableRowRenderer: (props: any) =>
      react.createElement("div", {
        "data-testid": "default-row",
        "data-classname": props.className,
      }),
  };
});

jest.mock("~/components/visualizations/table/BaseTable", () => ({
  __esModule: true,
  default: (props: any) => {
    mockCapture.base = props;
    return <div data-testid="base-table" />;
  },
}));

const renderTable = (props: Record<string, any> = {}) => {
  const ref = React.createRef<any>();
  const utils = render(
    <InfiniteTable
      ref={ref}
      columns={[{ dataKey: "name" }]}
      onLoadRows={jest.fn().mockResolvedValue([])}
      {...props}
    />,
  );
  return { ...utils, instance: ref.current };
};

const rowsFor = (start: number, count: number) =>
  Array.from({ length: count }, (_, i) => ({ name: `row-${start + i}` }));

beforeEach(() => {
  mockCapture.loader = null;
  mockCapture.base = null;
  mockCapture.resetCalls = [];
  mockCapture.onRowsRendered = jest.fn();
  mockCapture.registerChild = jest.fn();
});

describe("InfiniteTable defaults and wiring", () => {
  it("defaults the batch size, threshold and row count to the page size", () => {
    renderTable();
    // DEFAULT_PAGE_SIZE
    expect(mockCapture.loader.minimumBatchSize).toBe(20);
    expect(mockCapture.loader.threshold).toBe(20);
    expect(mockCapture.loader.rowCount).toBe(20);
    expect(mockCapture.base.rowCount).toBe(20);
  });

  it("honours explicit paging props", () => {
    renderTable({ minimumBatchSize: 5, threshold: 3, rowCount: 7 });
    expect(mockCapture.loader.minimumBatchSize).toBe(5);
    expect(mockCapture.loader.threshold).toBe(3);
    expect(mockCapture.loader.rowCount).toBe(7);
  });

  it("hands the loader callbacks down to BaseTable", () => {
    const onSelectRow = jest.fn();
    const onSelectAllRows = jest.fn();
    const onSortColumn = jest.fn();
    renderTable({
      onSelectRow,
      onSelectAllRows,
      onSortColumn,
      sortable: true,
      sortBy: "name",
      sortDirection: "ASC",
      draggableColumns: true,
    });

    expect(mockCapture.base.forwardRef).toBe(mockCapture.registerChild);
    expect(mockCapture.base.onRowsRendered).toBe(mockCapture.onRowsRendered);
    expect(mockCapture.base.onSelectRow).toBe(onSelectRow);
    expect(mockCapture.base.onSelectAllRows).toBe(onSelectAllRows);
    // onSortColumn is renamed to onSort for BaseTable.
    expect(mockCapture.base.onSort).toBe(onSortColumn);
    expect(mockCapture.base.sortable).toBe(true);
    expect(mockCapture.base.sortBy).toBe("name");
    expect(mockCapture.base.sortDirection).toBe("ASC");
    expect(mockCapture.base.draggableColumns).toBe(true);
    // defaultRowHeight/threshold/minimumBatchSize are consumed here, not passed on.
    expect(mockCapture.base.defaultRowHeight).toBeUndefined();
    expect(mockCapture.base.threshold).toBeUndefined();
  });

  it("uses a caller-supplied defaultCellRenderer over its own", () => {
    const defaultCellRenderer = jest.fn();
    renderTable({ defaultCellRenderer });
    expect(mockCapture.base.defaultCellRenderer).toBe(defaultCellRenderer);
  });

  it("falls back to its own defaultCellRenderer", () => {
    const { instance } = renderTable();
    expect(mockCapture.base.defaultCellRenderer).toBe(
      instance.defaultCellRenderer,
    );
  });
});

describe("InfiniteTable.loadMoreRows", () => {
  it("marks the requested range as loaded and stores the returned rows", async () => {
    const onLoadRows = jest.fn().mockResolvedValue(rowsFor(0, 3));
    const { instance } = renderTable({ onLoadRows, minimumBatchSize: 3 });

    expect(instance.isRowLoadingOrLoaded({ index: 0 })).toBe(false);

    await act(async () => {
      instance.loadMoreRows({ startIndex: 0, stopIndex: 2 });
    });

    expect(onLoadRows).toHaveBeenCalledWith({ startIndex: 0, stopIndex: 2 });
    expect(instance.isRowLoadingOrLoaded({ index: 0 })).toBe(true);
    expect(instance.isRowLoadingOrLoaded({ index: 2 })).toBe(true);
    expect(instance.isRowLoadingOrLoaded({ index: 3 })).toBe(false);
    expect(instance.getRow({ index: 1 })).toEqual({ name: "row-1" });
  });

  it("assumes more rows exist when a full page comes back", async () => {
    const onLoadRows = jest.fn().mockResolvedValue(rowsFor(0, 3));
    const { instance } = renderTable({ onLoadRows, minimumBatchSize: 3 });

    await act(async () => {
      instance.loadMoreRows({ startIndex: 0, stopIndex: 2 });
    });

    // 3 loaded rows + one more batch worth of placeholders.
    expect(mockCapture.loader.rowCount).toBe(6);
  });

  it("stops at the loaded rows when a short page comes back", async () => {
    const onLoadRows = jest.fn().mockResolvedValue(rowsFor(0, 2));
    const { instance } = renderTable({ onLoadRows, minimumBatchSize: 3 });

    await act(async () => {
      instance.loadMoreRows({ startIndex: 0, stopIndex: 2 });
    });

    expect(mockCapture.loader.rowCount).toBe(2);
  });

  it("logs an error when the fetch rejects and keeps the buffer empty", async () => {
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const onLoadRows = jest.fn().mockRejectedValue(new Error("boom"));
    const { instance } = renderTable({ onLoadRows, minimumBatchSize: 2 });

    await act(async () => {
      instance.loadMoreRows({ startIndex: 0, stopIndex: 1 }).catch(() => null);
    });

    expect(consoleError).toHaveBeenCalledWith(
      "Error loading rows",
      expect.any(Error),
    );
    expect(instance.getRow({ index: 0 })).toEqual({});
    consoleError.mockRestore();
  });

  it("swallows the rejection of a fetch cancelled by unmount", async () => {
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    let resolveLoad: (rows: unknown[]) => void = () => undefined;
    const onLoadRows = jest.fn(
      () =>
        new Promise(resolve => {
          resolveLoad = resolve as (rows: unknown[]) => void;
        }),
    );
    const { instance, unmount } = renderTable({
      onLoadRows,
      minimumBatchSize: 2,
    });

    instance.loadMoreRows({ startIndex: 0, stopIndex: 1 }).catch(() => null);
    unmount();

    await act(async () => {
      resolveLoad(rowsFor(0, 2));
    });

    // Cancelled, so nothing landed in the buffer and nothing was logged.
    expect(instance.getRow({ index: 0 })).toEqual({});
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("unmounting without an in-flight fetch is a no-op", () => {
    const { unmount } = renderTable();
    expect(() => unmount()).not.toThrow();
  });
});

describe("InfiniteTable.getRow", () => {
  it("returns an empty object for a row that has not been fetched", () => {
    const { instance } = renderTable();
    expect(instance.getRow({ index: 4 })).toEqual({});
  });
});

describe("InfiniteTable.reset", () => {
  it("drops the buffer, restores the prop row count and clears the loader cache", async () => {
    const onLoadRows = jest.fn().mockResolvedValue(rowsFor(0, 2));
    const { instance } = renderTable({
      onLoadRows,
      minimumBatchSize: 3,
      rowCount: 9,
    });

    await act(async () => {
      instance.loadMoreRows({ startIndex: 0, stopIndex: 2 });
    });
    expect(instance.getRow({ index: 0 })).toEqual({ name: "row-0" });

    await act(async () => {
      instance.reset();
    });

    expect(instance.getRow({ index: 0 })).toEqual({});
    expect(instance.isRowLoadingOrLoaded({ index: 0 })).toBe(false);
    expect(mockCapture.loader.rowCount).toBe(9);
    expect(mockCapture.resetCalls).toEqual([true]);
  });

  it("cancels an in-flight fetch so its result is discarded", async () => {
    let resolveLoad: (rows: unknown[]) => void = () => undefined;
    const onLoadRows = jest.fn(
      () =>
        new Promise(resolve => {
          resolveLoad = resolve as (rows: unknown[]) => void;
        }),
    );
    const { instance } = renderTable({
      onLoadRows,
      minimumBatchSize: 2,
      rowCount: 4,
    });

    instance.loadMoreRows({ startIndex: 0, stopIndex: 1 }).catch(() => null);
    await act(async () => {
      instance.reset();
    });
    await act(async () => {
      resolveLoad(rowsFor(0, 2));
    });

    expect(instance.getRow({ index: 0 })).toEqual({});
    expect(mockCapture.resetCalls).toEqual([true]);
  });
});

describe("InfiniteTable.defaultCellRenderer", () => {
  const renderCell = (instance: any, cellData: unknown) =>
    render(<div>{instance.defaultCellRenderer({ cellData })}</div>).container;

  it("renders a primitive value as a string", () => {
    const { instance } = renderTable();
    expect(renderCell(instance, "abc").textContent).toBe("abc");
    expect(renderCell(instance, 12).textContent).toBe("12");
    expect(renderCell(instance, 0).textContent).toBe("0");
    expect(renderCell(instance, false).textContent).toBe("false");
  });

  it("renders the name of an object value", () => {
    const { instance } = renderTable();
    expect(renderCell(instance, { name: "San Francisco" }).textContent).toBe(
      "San Francisco",
    );
  });

  it("renders an empty cell for null and undefined", () => {
    const { instance } = renderTable();
    expect(renderCell(instance, null).textContent).toBe("");
    expect(renderCell(instance, undefined).textContent).toBe("");
  });
});

describe("InfiniteTable.rowRenderer", () => {
  it("adds the loading class names to a row that has not loaded yet", () => {
    const { instance } = renderTable({ loadingClassName: "isLoading" });
    const rowProps: any = { index: 0, className: "base" };
    const { container } = render(<div>{instance.rowRenderer(rowProps)}</div>);
    expect(rowProps.className).toContain("base");
    expect(rowProps.className).toContain("isLoading");
    expect(
      (
        container.querySelector("[data-testid=default-row]") as Element
      ).getAttribute("data-classname"),
    ).toContain("isLoading");
  });

  it("leaves the class name alone once the row is loaded", async () => {
    const onLoadRows = jest.fn().mockResolvedValue(rowsFor(0, 1));
    const { instance } = renderTable({
      onLoadRows,
      minimumBatchSize: 1,
      loadingClassName: "isLoading",
    });
    await act(async () => {
      instance.loadMoreRows({ startIndex: 0, stopIndex: 0 });
    });

    const rowProps: any = { index: 0, className: "base" };
    instance.rowRenderer(rowProps);
    expect(rowProps.className).toBe("base");
  });

  it("delegates to a caller-supplied rowRenderer", () => {
    const rowRenderer = jest.fn(() => <div data-testid="custom-row" />);
    const { instance } = renderTable({ rowRenderer });
    const { container } = render(
      <div>{instance.rowRenderer({ index: 0, className: "base" })}</div>,
    );
    expect(rowRenderer).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[data-testid=custom-row]")).toBeTruthy();
    expect(container.querySelector("[data-testid=default-row]")).toBeNull();
  });
});

describe("InfiniteTable.handleGetRowHeight", () => {
  it("returns a fixed height when defaultRowHeight is a number", () => {
    const { instance } = renderTable({ defaultRowHeight: 44 });
    expect(instance.handleGetRowHeight({ index: 0 })).toBe(44);
    expect(mockCapture.base.rowHeight).toBe(instance.handleGetRowHeight);
  });

  it("passes the index and the row to a defaultRowHeight function", async () => {
    const defaultRowHeight = jest.fn(({ row }: any) => (row ? 80 : 20));
    const onLoadRows = jest.fn().mockResolvedValue(rowsFor(0, 1));
    const { instance } = renderTable({
      defaultRowHeight,
      onLoadRows,
      minimumBatchSize: 1,
    });

    // No row loaded yet for index 3.
    expect(instance.handleGetRowHeight({ index: 3 })).toBe(20);

    await act(async () => {
      instance.loadMoreRows({ startIndex: 0, stopIndex: 0 });
    });

    expect(instance.handleGetRowHeight({ index: 0 })).toBe(80);
    expect(defaultRowHeight).toHaveBeenLastCalledWith({
      index: 0,
      row: { name: "row-0" },
    });
  });
});
