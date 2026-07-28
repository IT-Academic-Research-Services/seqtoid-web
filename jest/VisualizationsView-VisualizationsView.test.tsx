// Coverage for
// app/assets/src/components/views/DiscoveryView/components/VisualizationsView/VisualizationsView.tsx
//
// The class component owns the visualizations table column definitions plus a
// set of cell renderers (name/status/visibility-icon/details), a row-click
// navigation handler, the load-and-format reshaper, sort forwarding and a
// display-gated reset. The heavy BaseDiscoveryView child and the openUrl
// navigation side effect are stubbed so the logic this file owns is exercised
// directly, including every branch of visibilityIconRenderer.
import { render } from "@testing-library/react";
import React from "react";
import { VisualizationsView } from "~/components/views/DiscoveryView/components/VisualizationsView/VisualizationsView";
import { GlobalContext } from "~/globalContext/reducer";

const _React: typeof React = React;

/* eslint-disable @typescript-eslint/no-explicit-any */

const mockOpenUrl = jest.fn();

jest.mock(
  "~/components/views/DiscoveryView/components/BaseDiscoveryView",
  () => ({
    BaseDiscoveryView: () => <div data-testid="base-discovery-view" />,
  }),
);

jest.mock("~utils/links", () => ({
  openUrl: (...args: unknown[]) => mockOpenUrl(...args),
}));

jest.mock("@czi-sds/components", () => ({
  Icon: (props: any) => (
    <svg data-testid="viz-icon" data-icon={props.sdsIcon} />
  ),
}));

jest.mock("~ui/labels/StatusLabel", () => ({
  __esModule: true,
  default: (props: any) => (
    <span
      data-testid="status-label"
      data-status={props.status}
      data-type={props.type}
    />
  ),
}));

jest.mock("~/components/common/TableRenderers", () => ({
  TableRenderers: {
    renderVisualization: (opts: any) => (
      <span data-testid="rendered-viz">{opts.cellData?.name}</span>
    ),
    renderDateWithElapsed: () => null,
  },
}));

const globalContextValue = { discoveryProjectIds: [1, 2] } as any;

const renderView = (props: Record<string, any> = {}) => {
  const ref = React.createRef<any>();
  const utils = render(
    <GlobalContext.Provider value={globalContextValue}>
      <VisualizationsView
        ref={ref}
        currentDisplay="table"
        visualizations={{} as any}
        onLoadRows={jest.fn()}
        {...props}
      />
    </GlobalContext.Provider>,
  );
  return { ...utils, instance: ref.current };
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("VisualizationsView render + columns", () => {
  it("renders through BaseDiscoveryView", () => {
    const { getByTestId } = renderView();
    expect(getByTestId("base-discovery-view")).toBeTruthy();
  });

  it("defines the expected column data keys", () => {
    const { instance } = renderView();
    expect(instance.columns.map((c: any) => c.dataKey)).toEqual([
      "visualization",
      "updated_at",
      "project_name",
      "samples_count",
    ]);
  });

  it("sorts the visualization column by updated_at, tolerating a null cell", () => {
    const { instance } = renderView();
    const sortKey = instance.columns[0].sortKey;
    expect(sortKey({ updated_at: "2021-01-01" })).toBe("2021-01-01");
    expect(sortKey(null)).toBeNull();
  });

  it("renders the visualization cell through the table renderer", () => {
    const { instance } = renderView();
    const { container } = render(
      <div>
        {instance.columns[0].cellRenderer({ cellData: { name: "My Heatmap" } })}
      </div>,
    );
    expect(container.textContent).toContain("My Heatmap");
  });
});

describe("VisualizationsView nameRenderer", () => {
  it("prefers the explicit name", () => {
    const { instance } = renderView();
    const { container } = render(
      <div>
        {instance.nameRenderer({
          name: "Cool Viz",
          visualization_type: "heatmap",
        })}
      </div>,
    );
    expect(container.textContent).toBe("Cool Viz");
  });

  it("humanizes the visualization type when no name is set", () => {
    const { instance } = renderView();
    const { container } = render(
      <div>
        {instance.nameRenderer({ name: "", visualization_type: "phylo_tree" })}
      </div>,
    );
    expect(container.textContent).toBe("Phylo Tree");
  });

  it("blanks out a missing visualization", () => {
    const { instance } = renderView();
    const { container } = render(<div>{instance.nameRenderer(null)}</div>);
    expect(container.textContent).toBe("");
  });
});

describe("VisualizationsView statusRenderer", () => {
  it("maps the raw status onto a StatusLabel", () => {
    const { instance } = renderView();
    const { getByTestId } = render(
      <div>{instance.statusRenderer({ status: "SUCCEEDED" })}</div>,
    );
    const label = getByTestId("status-label");
    expect(label.getAttribute("data-status")).toBe("COMPLETE");
    expect(label.getAttribute("data-type")).toBe("success");
  });

  it("renders nothing when the visualization has no status", () => {
    const { instance } = renderView();
    const { queryByTestId } = render(
      <div>{instance.statusRenderer({ status: undefined })}</div>,
    );
    expect(queryByTestId("status-label")).toBeNull();
  });

  it("renders nothing for a missing visualization", () => {
    const { instance } = renderView();
    const { queryByTestId } = render(
      <div>{instance.statusRenderer(null)}</div>,
    );
    expect(queryByTestId("status-label")).toBeNull();
  });
});

describe("VisualizationsView visibilityIconRenderer", () => {
  it("returns a placeholder for a missing visualization", () => {
    const { instance } = renderView();
    const { container } = render(
      <div>{instance.visibilityIconRenderer(null)}</div>,
    );
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector("div")).toBeTruthy();
  });

  it("renders public vs private heatmap icons", () => {
    const { instance } = renderView();
    const pub = render(
      <div>
        {instance.visibilityIconRenderer({
          visualization_type: "heatmap",
          publicAccess: true,
        })}
      </div>,
    );
    expect(pub.container.querySelector("svg")?.getAttribute("data-icon")).toBe(
      "gridPublic",
    );

    const priv = render(
      <div>
        {instance.visibilityIconRenderer({
          visualization_type: "heatmap",
          publicAccess: false,
        })}
      </div>,
    );
    expect(priv.container.querySelector("svg")?.getAttribute("data-icon")).toBe(
      "gridPrivate",
    );
  });

  it("renders public vs private phylo tree icons", () => {
    const { instance } = renderView();
    const pub = render(
      <div>
        {instance.visibilityIconRenderer({
          visualization_type: "phylo_tree_ng",
          publicAccess: true,
        })}
      </div>,
    );
    expect(pub.container.querySelector("svg")?.getAttribute("data-icon")).toBe(
      "treeHorizontalPublic",
    );

    const priv = render(
      <div>
        {instance.visibilityIconRenderer({
          visualization_type: "phylo_tree",
          publicAccess: false,
        })}
      </div>,
    );
    expect(priv.container.querySelector("svg")?.getAttribute("data-icon")).toBe(
      "treeHorizontalPrivate",
    );
  });

  it("renders no icon for a table/tree type", () => {
    const { instance } = renderView();
    const { container } = render(
      <div>
        {instance.visibilityIconRenderer({ visualization_type: "table" })}
      </div>,
    );
    expect(container.querySelector("svg")).toBeNull();
  });

  it("logs an error for an unknown visualization type", () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const { instance } = renderView();
    render(
      <div>
        {instance.visibilityIconRenderer({ visualization_type: "mystery" })}
      </div>,
    );
    expect(errorSpy).toHaveBeenCalledWith(
      "Unknown visualization type: mystery",
    );
    errorSpy.mockRestore();
  });
});

describe("VisualizationsView detailsRenderer", () => {
  it("shows the user name and blanks a missing visualization", () => {
    const { instance } = renderView();
    expect(
      render(<div>{instance.detailsRenderer({ user_name: "Ada" })}</div>)
        .container.textContent,
    ).toBe("Ada");
    expect(
      render(<div>{instance.detailsRenderer(null)}</div>).container.textContent,
    ).toBe("");
  });
});

describe("VisualizationsView row + sort + reset + load", () => {
  it("navigates to the visualization url on row click", () => {
    const { instance } = renderView();
    instance.handleRowClick({
      rowData: { id: 42, visualization: { visualization_type: "heatmap" } },
    });
    expect(mockOpenUrl.mock.calls[0][0]).toBe("/visualizations/heatmap/42");
  });

  it("forwards sort changes to onSortColumn", () => {
    const onSortColumn = jest.fn();
    const { instance } = renderView({ onSortColumn });
    instance.handleSortColumn({ sortBy: "updated_at", sortDirection: "DESC" });
    expect(onSortColumn).toHaveBeenCalledWith({
      sortBy: "updated_at",
      sortDirection: "DESC",
    });
  });

  it("resets the underlying table only in table display", () => {
    const reset = jest.fn();
    const { instance } = renderView({ currentDisplay: "table" });
    instance.discoveryView = { reset };
    instance.reset();
    expect(reset).toHaveBeenCalledTimes(1);

    const mapView = renderView({ currentDisplay: "map" }).instance;
    mapView.discoveryView = { reset };
    mapView.reset();
    // Still only the one call from the table-display instance.
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("tolerates a missing table ref on reset", () => {
    const { instance } = renderView({ currentDisplay: "table" });
    instance.discoveryView = null;
    expect(() => instance.reset()).not.toThrow();
  });

  it("splits each visualization into the nested cell plus the flat columns", async () => {
    const raw = [
      {
        id: 7,
        name: "V7",
        visualization_type: "heatmap",
        publicAccess: true,
        status: "SUCCEEDED",
        user_name: "Ada",
        updated_at: "2021-01-01",
        project_name: "P1",
        samples_count: 3,
        ignored: "dropped",
      },
    ];
    const onLoadRows = jest.fn().mockResolvedValue(raw);
    const { instance } = renderView({ onLoadRows });

    const rows = await instance.handleLoadRowsAndFormat({
      startIndex: 0,
      stopIndex: 10,
    });
    expect(onLoadRows).toHaveBeenCalledWith({ startIndex: 0, stopIndex: 10 });
    expect(rows).toEqual([
      {
        visualization: {
          user_name: "Ada",
          visualization_type: "heatmap",
          name: "V7",
          publicAccess: true,
          status: "SUCCEEDED",
        },
        id: 7,
        updated_at: "2021-01-01",
        project_name: "P1",
        samples_count: 3,
      },
    ]);
  });
});
