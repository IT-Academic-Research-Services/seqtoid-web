// Coverage: app/assets/src/components/views/DiscoveryView/components/MapPreviewSidebar/MapPreviewSidebar.tsx
//
// MapPreviewSidebar owns the tab strip on the map preview panel plus the
// selection maths for the samples table (shift-range select, select-all,
// row clicks) and the project row reshaping fed to BaseDiscoveryView. The two
// virtualized tables and the summary sidebar are stubbed -- react-virtualized
// needs real layout to render rows -- so the assertions land on the props and
// callbacks this component computes.
import { fireEvent, render, screen } from "@testing-library/react";

const mockInfiniteTableProps: $TSFixMe[] = [];
const mockBaseDiscoveryViewProps: $TSFixMe[] = [];
const mockResetSamplesTable = jest.fn();
const mockResetProjectsTable = jest.fn();

// jest.config maps webpack aliases before the css/scss rule, so a "~/..." scss
// import escapes the style mock and is parsed as JS. Stub it explicitly.
jest.mock(
  "~/components/common/TableRenderers/table_renderers.scss",
  () => ({}),
  { virtual: true },
);

jest.mock("~/components/visualizations/table/InfiniteTable", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: ReactLib.forwardRef((props: $TSFixMe, ref: $TSFixMe) => {
      mockInfiniteTableProps.push(props);
      if (typeof ref === "function") ref({ reset: mockResetSamplesTable });
      return ReactLib.createElement("div", {
        "data-testid": "infinite-table",
        "data-selectallchecked": String(props.selectAllChecked),
        "data-selectedcount": String(props.selected ? props.selected.size : 0),
      });
    }),
  };
});

jest.mock(
  "~/components/views/DiscoveryView/components/BaseDiscoveryView",
  () => {
    const ReactLib = require("react");
    return {
      BaseDiscoveryView: ReactLib.forwardRef(
        (props: $TSFixMe, ref: $TSFixMe) => {
          mockBaseDiscoveryViewProps.push(props);
          if (typeof ref === "function") ref({ reset: mockResetProjectsTable });
          return ReactLib.createElement("div", {
            "data-testid": "base-discovery-view",
          });
        },
      ),
    };
  },
);

jest.mock(
  "~/components/views/DiscoveryView/components/DiscoverySidebar",
  () => {
    const ReactLib = require("react");
    return {
      DiscoverySidebar: (props: $TSFixMe) =>
        ReactLib.createElement("div", {
          "data-testid": "discovery-sidebar",
          "data-currenttab": String(props.currentTab),
          "data-loading": String(props.loading),
        }),
    };
  },
);

import { MapPreviewSidebar } from "~/components/views/DiscoveryView/components/MapPreviewSidebar/MapPreviewSidebar";

const makeSamples = (ids: string[]) => ({
  getIds: () => ids,
  get: (id: string) => ({ id, name: `sample-${id}` }),
  getIntermediateIds: ({ id1, id2 }: $TSFixMe) => {
    const start = ids.indexOf(id1);
    const end = ids.indexOf(id2);
    return ids.slice(Math.min(start, end), Math.max(start, end) + 1);
  },
  handleLoadObjectRows: jest.fn(),
});

const makeProjects = (projects: $TSFixMe[]) => ({
  get: (id: string) => projects.find(p => String(p.id) === String(id)),
  handleLoadObjectRows: jest.fn(async () => projects),
});

const defaultProps = () => ({
  currentTab: "summary",
  discoveryCurrentTab: "samples",
  onSelectionUpdate: jest.fn(),
  projectStats: { count: 4 },
  sampleStats: { count: 12 },
  samples: makeSamples(["1", "2", "3", "4"]) as $TSFixMe,
  projects: makeProjects([]) as $TSFixMe,
  selectedSampleIds: new Set<string>(),
});

const renderSidebar = (overrides: $TSFixMe = {}) => {
  const props = { ...defaultProps(), ...overrides };
  const utils = render(<MapPreviewSidebar {...props} />);
  return { ...utils, props };
};

beforeEach(() => {
  mockInfiniteTableProps.length = 0;
  mockBaseDiscoveryViewProps.length = 0;
  jest.clearAllMocks();
});

describe("MapPreviewSidebar tabs", () => {
  it("labels the second tab from the discovery tab and shows its count", () => {
    renderSidebar();
    expect(screen.getByTestId("sample-tablabel").textContent).toBe("Samples");
    expect(screen.getByTestId("sample-count").textContent).toBe("12");
    expect(screen.getByTestId("summary-tablabel").textContent).toBe("Summary");
  });

  it("uses the project count when the discovery tab is projects", () => {
    renderSidebar({ discoveryCurrentTab: "projects" });
    expect(screen.getByTestId("sample-tablabel").textContent).toBe("Projects");
    expect(screen.getByTestId("sample-count").textContent).toBe("4");
  });

  it("hides the counter when the count is zero", () => {
    renderSidebar({ sampleStats: { count: 0 } });
    expect(screen.queryByTestId("sample-count")).toBeNull();
  });

  it("fires onTabChange when a tab is clicked", () => {
    const onTabChange = jest.fn();
    renderSidebar({ onTabChange });
    fireEvent.click(screen.getByTestId("sample-tablabel"));
    expect(onTabChange).toHaveBeenCalledWith("samples");
  });

  it("tolerates a missing onTabChange handler", () => {
    renderSidebar();
    fireEvent.click(screen.getByTestId("sample-tablabel"));
    expect(screen.getByTestId("discovery-sidebar")).toBeTruthy();
  });
});

describe("MapPreviewSidebar tab content", () => {
  it("renders the summary sidebar by default", () => {
    renderSidebar({ loading: true });
    const sidebar = screen.getByTestId("discovery-sidebar");
    expect(sidebar.getAttribute("data-currenttab")).toBe("samples");
    expect(sidebar.getAttribute("data-loading")).toBe("true");
    expect(screen.queryByTestId("infinite-table")).toBeNull();
  });

  it("renders the samples table on the samples tab", () => {
    renderSidebar({ currentTab: "samples" });
    expect(screen.getByTestId("infinite-table")).toBeTruthy();
    expect(screen.queryByTestId("discovery-sidebar")).toBeNull();
  });

  it("renders the projects table on the projects tab", () => {
    renderSidebar({ currentTab: "projects" });
    expect(screen.getByTestId("base-discovery-view")).toBeTruthy();
    expect(screen.queryByTestId("infinite-table")).toBeNull();
  });
});

describe("MapPreviewSidebar selection", () => {
  it("adds and removes a single row without the shift key", () => {
    const onSelectionUpdate = jest.fn();
    renderSidebar({ currentTab: "samples", onSelectionUpdate });
    const { onSelectRow } = mockInfiniteTableProps[0];

    onSelectRow("2", true, { shiftKey: false });
    expect(Array.from(onSelectionUpdate.mock.calls[0][0])).toEqual(["2"]);

    onSelectionUpdate.mockClear();
    onSelectRow("2", false, { shiftKey: false });
    expect(Array.from(onSelectionUpdate.mock.calls[0][0])).toEqual([]);
  });

  it("shift-selects the range from the previous reference row", () => {
    const onSelectionUpdate = jest.fn();
    renderSidebar({ currentTab: "samples", onSelectionUpdate });
    const { onSelectRow } = mockInfiniteTableProps[0];

    onSelectRow("1", true, { shiftKey: false });
    onSelectRow("4", true, { shiftKey: true });
    expect(Array.from(onSelectionUpdate.mock.calls[1][0]).sort()).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
  });

  it("shift-deselects the range from the previous reference row", () => {
    const onSelectionUpdate = jest.fn();
    renderSidebar({
      currentTab: "samples",
      onSelectionUpdate,
      selectedSampleIds: new Set(["1", "2", "3", "4"]),
    });
    const { onSelectRow } = mockInfiniteTableProps[0];

    onSelectRow("1", false, { shiftKey: false });
    onSelectRow("3", false, { shiftKey: true });
    expect(Array.from(onSelectionUpdate.mock.calls[1][0]).sort()).toEqual([
      "4",
    ]);
  });

  it("ignores the shift key when there is no reference row yet", () => {
    const onSelectionUpdate = jest.fn();
    renderSidebar({ currentTab: "samples", onSelectionUpdate });
    const { onSelectRow } = mockInfiniteTableProps[0];

    onSelectRow("3", true, { shiftKey: true });
    expect(Array.from(onSelectionUpdate.mock.calls[0][0])).toEqual(["3"]);
  });

  it("select-all unions the visible ids, and unselect-all removes only those", () => {
    const onSelectionUpdate = jest.fn();
    renderSidebar({
      currentTab: "samples",
      onSelectionUpdate,
      selectedSampleIds: new Set(["99"]),
    });
    const { onSelectAllRows } = mockInfiniteTableProps[0];

    onSelectAllRows(true);
    expect(Array.from(onSelectionUpdate.mock.calls[0][0]).sort()).toEqual([
      "1",
      "2",
      "3",
      "4",
      "99",
    ]);

    onSelectionUpdate.mockClear();
    onSelectAllRows(false);
    expect(Array.from(onSelectionUpdate.mock.calls[0][0])).toEqual(["99"]);
  });

  it("reports select-all as checked only when every visible id is selected", () => {
    renderSidebar({
      currentTab: "samples",
      selectedSampleIds: new Set(["1", "2", "3"]),
    });
    expect(
      screen
        .getByTestId("infinite-table")
        .getAttribute("data-selectallchecked"),
    ).toBe("false");

    mockInfiniteTableProps.length = 0;
    renderSidebar({
      currentTab: "samples",
      selectedSampleIds: new Set(["1", "2", "3", "4"]),
    });
    expect(
      screen
        .getAllByTestId("infinite-table")[1]
        .getAttribute("data-selectallchecked"),
    ).toBe("true");
  });

  it("reports select-all as unchecked when there are no rows at all", () => {
    renderSidebar({
      currentTab: "samples",
      samples: makeSamples([]) as $TSFixMe,
      selectedSampleIds: new Set<string>(),
    });
    expect(
      screen
        .getByTestId("infinite-table")
        .getAttribute("data-selectallchecked"),
    ).toBe("false");
  });
});

describe("MapPreviewSidebar row clicks", () => {
  it("resolves the clicked sample and forwards the event", () => {
    const onSampleClicked = jest.fn();
    renderSidebar({ currentTab: "samples", onSampleClicked });
    const { onRowClick } = mockInfiniteTableProps[0];

    const currentEvent = { type: "click" };
    onRowClick({ event: currentEvent, rowData: { id: "3" } });
    expect(onSampleClicked).toHaveBeenCalledWith({
      object: { id: "3", name: "sample-3" },
      currentEvent,
    });
  });

  it("does nothing when no sample click handler is supplied", () => {
    renderSidebar({ currentTab: "samples" });
    const { onRowClick } = mockInfiniteTableProps[0];
    expect(() => onRowClick({ event: {}, rowData: { id: "1" } })).not.toThrow();
  });

  it("resolves the clicked project", () => {
    const onProjectSelected = jest.fn();
    const projects = makeProjects([{ id: 5, name: "Zika" }]);
    renderSidebar({
      currentTab: "projects",
      onProjectSelected,
      projects: projects as $TSFixMe,
    });
    const { handleRowClick } = mockBaseDiscoveryViewProps[0];

    handleRowClick({ rowData: { id: 5 } });
    expect(onProjectSelected).toHaveBeenCalledWith({
      project: { id: 5, name: "Zika" },
    });
  });
});

describe("MapPreviewSidebar project row loading", () => {
  it("nests the display fields under `project` and keeps the flat columns", async () => {
    const projects = makeProjects([
      {
        id: 5,
        name: "Zika",
        description: "desc",
        owner: "alice",
        public_access: 1,
        created_at: "2021-01-01",
        hosts: ["Human"],
        tissues: ["CSF"],
        number_of_samples: 3,
        extraneous: "dropped",
      },
    ]);
    renderSidebar({
      currentTab: "projects",
      projects: projects as $TSFixMe,
    });
    const { onLoadRows } = mockBaseDiscoveryViewProps[0];

    const rows = await onLoadRows({ startIndex: 0, stopIndex: 10 });
    expect(projects.handleLoadObjectRows).toHaveBeenCalledWith({
      startIndex: 0,
      stopIndex: 10,
    });
    expect(rows).toEqual([
      {
        project: {
          name: "Zika",
          description: "desc",
          owner: "alice",
          public_access: 1,
        },
        id: 5,
        created_at: "2021-01-01",
        hosts: ["Human"],
        tissues: ["CSF"],
        number_of_samples: 3,
      },
    ]);
  });
});

describe("MapPreviewSidebar column config", () => {
  it("renders the project cell for public and private projects and empty data", () => {
    renderSidebar({ currentTab: "projects" });
    const { columns } = mockBaseDiscoveryViewProps[0];
    const projectColumn = columns[0];

    const publicCell = render(
      <div>
        {projectColumn.cellRenderer({
          cellData: { name: "Pub", owner: "alice", public_access: 1 },
        })}
      </div>,
    );
    expect(publicCell.container.textContent).toContain("Pub");
    expect(publicCell.container.textContent).toContain("alice");

    const privateCell = render(
      <div>
        {projectColumn.cellRenderer({
          cellData: { name: "Priv", owner: "bob", public_access: 0 },
        })}
      </div>,
    );
    expect(privateCell.container.textContent).toContain("Priv");

    const emptyCell = render(
      <div>{projectColumn.cellRenderer({ cellData: null })}</div>,
    );
    expect(emptyCell.container.textContent).toBe("");

    // sortKey lowercases the name and tolerates a missing project.
    expect(projectColumn.sortKey({ name: "Zika" })).toBe("zika");
    expect(projectColumn.sortKey(null)).toBe("");
  });

  it("formats the numeric sample columns", () => {
    renderSidebar({ currentTab: "samples" });
    const { columns } = mockInfiniteTableProps[0];
    const byKey = (key: string) =>
      columns.find((c: $TSFixMe) => c.dataKey === key);

    expect(
      byKey("totalReads").cellDataGetter({
        dataKey: "totalReads",
        rowData: { totalReads: 1234567 },
      }),
    ).toBe("1,234,567");
    expect(
      byKey("qcPercent").cellDataGetter({
        dataKey: "qcPercent",
        rowData: { qcPercent: 98.7654 },
      }),
    ).toBe("98.77%");
    expect(
      byKey("duplicateCompressionRatio").cellDataGetter({
        dataKey: "duplicateCompressionRatio",
        rowData: { duplicateCompressionRatio: 1.2345 },
      }),
    ).toBe("1.23");
  });
});

describe("MapPreviewSidebar reset", () => {
  it("resets both tables when the samples collection is replaced", () => {
    const props = defaultProps();
    const { rerender } = render(
      <MapPreviewSidebar {...props} currentTab="samples" />,
    );
    expect(mockResetSamplesTable).not.toHaveBeenCalled();

    rerender(
      <MapPreviewSidebar
        {...props}
        currentTab="samples"
        samples={makeSamples(["7"]) as $TSFixMe}
      />,
    );
    expect(mockResetSamplesTable).toHaveBeenCalled();
  });

  it("does not reset when unrelated props change", () => {
    const props = defaultProps();
    const { rerender } = render(
      <MapPreviewSidebar {...props} currentTab="samples" />,
    );
    rerender(
      <MapPreviewSidebar {...props} currentTab="samples" loading={true} />,
    );
    expect(mockResetSamplesTable).not.toHaveBeenCalled();
  });
});
