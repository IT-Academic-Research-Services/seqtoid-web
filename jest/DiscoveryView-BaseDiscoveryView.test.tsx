// Coverage: app/assets/src/components/views/DiscoveryView/components/BaseDiscoveryView/BaseDiscoveryView.tsx
//
// BaseDiscoveryView is a thin class wrapper around InfiniteTable whose only job
// is to (a) forward/rename a fixed set of props, (b) merge its own row class
// into the caller's rowClassName and (c) expose a reset() that delegates to the
// captured table ref -- including the guard for a ref that was never attached.
// InfiniteTable is stubbed so the prop plumbing is observable.
import { render } from "@testing-library/react";
import React from "react";

// jest.config maps the webpack "~" alias before its css/scss -> styleMock rule,
// so a "~/..."-aliased scss import would reach the JS transform. Stub it.
jest.mock(
  "~/components/common/TableRenderers/table_renderers.scss",
  () => ({}),
);

const capturedProps: $TSFixMe[] = [];
const mockReset = jest.fn();

jest.mock("~/components/visualizations/table/InfiniteTable", () => {
  const ReactLib = require("react");
  class FakeInfiniteTable extends ReactLib.Component {
    reset = mockReset;
    render() {
      capturedProps.push(this.props);
      return ReactLib.createElement("div", { "data-testid": "infinite-table" });
    }
  }
  return { __esModule: true, default: FakeInfiniteTable };
});

import { BaseDiscoveryView } from "~/components/views/DiscoveryView/components/BaseDiscoveryView/BaseDiscoveryView";

const lastProps = () => capturedProps[capturedProps.length - 1];

beforeEach(() => {
  capturedProps.length = 0;
  mockReset.mockClear();
});

describe("BaseDiscoveryView prop forwarding", () => {
  it("passes the caller's table configuration through to InfiniteTable", () => {
    const onLoadRows = jest.fn();
    const onSortColumn = jest.fn();
    const handleRowClick = jest.fn();
    const columns = [{ dataKey: "name" }] as $TSFixMe;

    render(
      <BaseDiscoveryView
        columns={columns}
        handleRowClick={handleRowClick}
        headerClassName="my-header"
        initialActiveColumns={["name"]}
        onLoadRows={onLoadRows}
        onSortColumn={onSortColumn}
        protectedColumns={["name"]}
        rowHeight={120}
        sortable
        sortBy="name"
        sortDirection="DESC"
      />,
    );

    const props = lastProps();
    expect(props.columns).toBe(columns);
    expect(props.defaultRowHeight).toBe(120);
    expect(props.headerClassName).toBe("my-header");
    expect(props.initialActiveColumns).toEqual(["name"]);
    expect(props.onLoadRows).toBe(onLoadRows);
    // handleRowClick is renamed to onRowClick on the way down.
    expect(props.onRowClick).toBe(handleRowClick);
    expect(props.onSortColumn).toBe(onSortColumn);
    expect(props.protectedColumns).toEqual(["name"]);
    expect(props.sortable).toBe(true);
    expect(props.sortBy).toBe("name");
    expect(props.sortDirection).toBe("DESC");
    expect(props.draggableColumns).toBe(true);
  });

  it("applies the default row height and empty columns when they are omitted", () => {
    render(<BaseDiscoveryView onLoadRows={jest.fn()} />);
    const props = lastProps();
    expect(props.defaultRowHeight).toBe(68);
    expect(props.columns).toEqual([]);
    expect(props.sortable).toBeUndefined();
    expect(props.onRowClick).toBeUndefined();
  });

  it("accepts a row-height function and forwards it unchanged", () => {
    const rowHeight = jest.fn().mockReturnValue(42);
    render(<BaseDiscoveryView onLoadRows={jest.fn()} rowHeight={rowHeight} />);
    expect(lastProps().defaultRowHeight).toBe(rowHeight);
  });

  it("merges its own data-row class with the caller's rowClassName", () => {
    render(
      <BaseDiscoveryView onLoadRows={jest.fn()} rowClassName="caller-row" />,
    );
    expect(lastProps().rowClassName).toContain("caller-row");

    // Without a caller class the merged value is still a string (no undefined).
    render(<BaseDiscoveryView onLoadRows={jest.fn()} />);
    expect(typeof lastProps().rowClassName).toBe("string");
    expect(lastProps().rowClassName).not.toContain("caller-row");
  });
});

describe("BaseDiscoveryView reset", () => {
  it("delegates reset() to the captured InfiniteTable ref", () => {
    const ref = React.createRef<BaseDiscoveryView>();
    render(<BaseDiscoveryView ref={ref} onLoadRows={jest.fn()} />);
    expect(ref.current).toBeTruthy();

    ref.current?.reset();
    expect(mockReset).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when the table ref was detached", () => {
    const ref = React.createRef<BaseDiscoveryView>();
    render(<BaseDiscoveryView ref={ref} onLoadRows={jest.fn()} />);
    // Simulate React handing back null on unmount.
    (ref.current as $TSFixMe).infiniteTable = null;

    expect(() => ref.current?.reset()).not.toThrow();
    expect(mockReset).not.toHaveBeenCalled();
  });
});
