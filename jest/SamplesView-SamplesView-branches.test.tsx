// Branch coverage: app/assets/src/components/views/DiscoveryView/components/
//   SamplesView/SamplesView.tsx
//
// Complements SamplesView-SamplesView.test.tsx by driving the *unhit* sides of
// SamplesView's conditionals: the `currentDisplay` / `workflow` destructuring
// defaults, the `userContext || {}` fallback, the right-hand side of the
// shift-select range predicate, the Nextclade ceiling guard, the
// `fullGroundTruthFilePath = ""` default, the singular form of the ineligible
// benchmark notification, and the `?? "-"` fallback in the filtered count.
import { act, render, screen } from "@testing-library/react";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------- api mocks
const mockBenchmarkSamples = jest.fn();
const mockBulkKickoffWorkflowRuns = jest.fn();
jest.mock("~/api", () => ({
  benchmarkSamples: (...a: any[]) => mockBenchmarkSamples(...a),
  bulkKickoffWorkflowRuns: (...a: any[]) => mockBulkKickoffWorkflowRuns(...a),
}));

const mockTrackEvent = jest.fn();
jest.mock("~/api/analytics", () => ({
  useTrackEvent: () => mockTrackEvent,
  ANALYTICS_EVENT_NAMES: {
    SAMPLES_VIEW_RUNS_BULK_DELETED: "bulk_deleted",
    SAMPLES_VIEW_ROW_CLICKED: "row_clicked",
    SAMPLES_VIEW_BULK_KICKOFF_AMR_WORKFLOW_TRIGGER_CLICKED: "amr_kickoff",
    SAMPLES_VIEW_BULK_KICKOFF_AMR_WORKFLOW_TRIGGER_CLICKED_ALLISON_TESTING:
      "amr_kickoff_2",
  },
}));

const mockGetSampleMetadataFields = jest.fn();
const mockGetWorkflowRunMetadataFields = jest.fn();
jest.mock("~/api/metadata", () => ({
  getSampleMetadataFields: (...a: any[]) => mockGetSampleMetadataFields(...a),
  getWorkflowRunMetadataFields: (...a: any[]) =>
    mockGetWorkflowRunMetadataFields(...a),
}));

jest.mock("~/components/common/BulkDownloadNotification", () => ({
  showBulkDownloadNotification: jest.fn(),
}));

const mockShowToast = jest.fn();
jest.mock("~/components/utils/toast", () => ({
  showToast: (...a: any[]) => mockShowToast(...a),
}));

// The "~/" webpack alias wins over jest's scss->styleMock mapping for this
// absolute stylesheet import, so it has to be stubbed by hand.
jest.mock(
  "~/components/common/TableRenderers/table_renderers.scss",
  () => ({}),
  { virtual: true },
);

// ------------------------------------------------------------- child stubs
jest.mock("@czi-sds/components", () => {
  const ReactLib = require("react");
  return {
    Button: (props: any) =>
      ReactLib.createElement(
        "button",
        { type: "button", onClick: props.onClick },
        props.children,
      ),
  };
});

jest.mock("react-router-dom", () => ({
  Link: (props: any) =>
    require("react").createElement(
      "a",
      { href: props.to, "data-testid": "router-link" },
      props.children,
    ),
}));

jest.mock("~ui/controls/dropdowns/BareDropdown", () => {
  const ReactLib = require("react");
  const Item = (props: any) => ReactLib.createElement("span", null, props.text);
  const Dropdown = (props: any) =>
    ReactLib.createElement(
      "div",
      { "data-testid": "bare-dropdown" },
      props.trigger,
      props.items,
    );
  Dropdown.Item = Item;
  return { __esModule: true, default: Dropdown };
});

jest.mock("~ui/icons", () => ({
  IconLoading: () =>
    require("react").createElement("div", { "data-testid": "icon-loading" }),
}));

jest.mock("~ui/labels/Label", () => ({
  __esModule: true,
  default: (props: any) =>
    require("react").createElement(
      "div",
      { "data-testid": "selected-counter" },
      props.text,
    ),
}));

jest.mock("~ui/notifications/Notification", () => ({
  __esModule: true,
  default: (props: any) =>
    require("react").createElement(
      "div",
      { "data-testid": "notification" },
      props.children,
    ),
}));

jest.mock("~ui/notifications/AccordionNotification", () => ({
  __esModule: true,
  default: (props: any) =>
    require("react").createElement(
      "div",
      { "data-testid": "accordion-notification" },
      props.header,
      props.content,
    ),
}));

jest.mock("~/components/layout/NarrowContainer", () => ({
  __esModule: true,
  default: (props: any) =>
    require("react").createElement(
      "div",
      { "data-testid": "narrow-container" },
      props.children,
    ),
}));

jest.mock("~/components/common/LoadingPage", () => ({
  LoadingPage: () =>
    require("react").createElement("div", { "data-testid": "loading-page" }),
}));

let mockToolbarIcons: any[] = [];
jest.mock(
  "~/components/views/DiscoveryView/components/SamplesView/components/ToolbarButtonIcon/ToolbarButtonIcon",
  () => ({
    __esModule: true,
    default: (props: any) => {
      mockToolbarIcons.push(props);
      return require("react").createElement("button", {
        type: "button",
        "data-testid": props.testId || `toolbar-${props.icon}`,
        "data-subtitle": props.popupSubtitle,
        "data-disabled": String(!!props.disabled),
        onClick: props.onClick,
      });
    },
  }),
);

let mockCollectionProps: any = null;
jest.mock(
  "~/components/views/DiscoveryView/components/SamplesView/components/CollectionModal/CollectionModal",
  () => ({
    __esModule: true,
    default: (props: any) => {
      mockCollectionProps = props;
      return require("react").createElement(
        "div",
        { "data-testid": "collection-modal" },
        props.trigger,
      );
    },
  }),
);

let mockBulkMenuProps: any = null;
jest.mock(
  "~/components/views/DiscoveryView/components/SamplesView/components/BulkSamplesActionsMenu/BulkSamplesActionsMenu",
  () => ({
    __esModule: true,
    default: (props: any) => {
      mockBulkMenuProps = props;
      return require("react").createElement("div", {
        "data-testid": "bulk-actions-menu",
      });
    },
  }),
);

jest.mock(
  "~/components/views/DiscoveryView/components/SamplesView/components/BulkDeleteTrigger",
  () => ({
    BulkDeleteTrigger: () =>
      require("react").createElement("button", {
        type: "button",
        "data-testid": "bulk-delete-trigger",
      }),
  }),
);

jest.mock(
  "~/components/views/DiscoveryView/components/SamplesView/components/BulkDeleteModal",
  () => ({
    __esModule: true,
    default: () =>
      require("react").createElement("div", {
        "data-testid": "bulk-delete-modal",
      }),
  }),
);

let mockBenchmarkModalProps: any = null;
jest.mock(
  "~/components/views/DiscoveryView/components/SamplesView/components/BenchmarkModal",
  () => ({
    BenchmarkModal: (props: any) => {
      mockBenchmarkModalProps = props;
      return require("react").createElement("div", {
        "data-testid": "benchmark-modal",
      });
    },
  }),
);

jest.mock(
  "~/components/views/DiscoveryView/components/SamplesView/components/BulkDownloadModal",
  () => ({
    BulkDownloadModal: () =>
      require("react").createElement("div", {
        "data-testid": "bulk-download-modal",
      }),
  }),
);

jest.mock(
  "~/components/views/DiscoveryView/components/SamplesView/components/NextcladeModal",
  () => ({
    NextcladeModal: () =>
      require("react").createElement("div", {
        "data-testid": "nextclade-modal",
      }),
  }),
);

jest.mock("~/components/views/PhyloTree/PhyloTreeCreationModal", () => ({
  __esModule: true,
  default: () =>
    require("react").createElement("div", { "data-testid": "phylo-modal" }),
}));

let mockFilteredCountProps: any = null;
jest.mock(
  "~/components/views/DiscoveryView/components/SamplesView/components/FilteredCount",
  () => ({
    FilteredCount: (props: any) => {
      mockFilteredCountProps = props;
      return require("react").createElement("div", {
        "data-testid": "filtered-count",
      });
    },
  }),
);

jest.mock(
  "~/components/views/DiscoveryView/components/SamplesView/components/QualityControl",
  () => ({
    __esModule: true,
    default: () =>
      require("react").createElement("div", {
        "data-testid": "quality-control",
      }),
  }),
);

jest.mock(
  "~/components/views/DiscoveryView/components/DiscoveryMap/DiscoveryMap",
  () => ({
    DiscoveryMap: () =>
      require("react").createElement("div", { "data-testid": "discovery-map" }),
  }),
);

let mockToggleProps: any = null;
jest.mock(
  "~/components/views/DiscoveryView/components/DiscoveryViewToggle/DiscoveryViewToggle",
  () => ({
    DiscoveryViewToggle: (props: any) => {
      mockToggleProps = props;
      return require("react").createElement("div", {
        "data-testid": "display-toggle",
      });
    },
  }),
);

const mockComputeColumns = jest.fn();
jest.mock(
  "~/components/views/DiscoveryView/components/SamplesView/columnConfiguration",
  () => ({
    computeColumnsByWorkflow: (...a: any[]) => mockComputeColumns(...a),
    DEFAULT_ACTIVE_COLUMNS_BY_WORKFLOW: { "short-read-mngs": ["sample"] },
    DEFAULT_SORTED_COLUMN_BY_TAB: { samples: "createdAt" },
  }),
);

let mockInfiniteTableProps: any = null;
jest.mock("~/components/visualizations/table/InfiniteTable", () => {
  const ReactLib = require("react");
  class InfiniteTableStub extends ReactLib.Component {
    reset = jest.fn();
    render() {
      mockInfiniteTableProps = this.props;
      return ReactLib.createElement("div", { "data-testid": "infinite-table" });
    }
  }
  return { __esModule: true, default: InfiniteTableStub };
});

import { UserContext } from "~/components/common/UserContext";
import { WORKFLOW_ENTITIES, WorkflowType } from "~/components/utils/workflows";
import { SARS_COV_2 } from "~/components/views/DiscoveryView/components/SamplesView/constants";
import { SamplesView } from "~/components/views/DiscoveryView/components/SamplesView/SamplesView";

// -------------------------------------------------------------- fixtures
const sample = (id: string, overrides: any = {}) => ({
  id,
  pipelineVersion: "8.0.0",
  creation_source: "mNGS report",
  sample: {
    id,
    name: `sample-${id}`,
    pipelineRunStatus: "complete",
    workflowRunsCountByWorkflow: { amr: 0 },
    ...(overrides.sample || {}),
  },
  ...(() => {
    const rest = { ...overrides };
    delete rest.sample;
    return rest;
  })(),
});

const DEFAULT_CONTEXT = {
  allowedFeatures: [],
  admin: false,
  appConfig: { maxObjectsBulkDownload: 100 },
};

// `ctx` is passed straight through to the provider so a test can hand it
// `null` and exercise the `userContext || {}` fallback.
const renderView = (props: any = {}, ctx: any = DEFAULT_CONTEXT) => {
  const rows = props.rows ?? [sample("1"), sample("2")];
  const merged = {
    currentTab: "samples",
    domain: "my_data",
    getRows: () => rows,
    handleNewWorkflowRunsCreated: jest.fn(),
    onDeleteSample: jest.fn(),
    onLoadRows: jest.fn(),
    onUpdateSelectedIds: jest.fn(),
    selectableIds: rows.map((r: any) => r.id),
    selectedIds: new Set(rows.map((r: any) => r.id)),
    showAllMetadata: false,
    workflowEntity: WORKFLOW_ENTITIES.SAMPLES,
    ...props,
  };
  delete merged.rows;
  const utils = render(
    <UserContext.Provider value={ctx as any}>
      <SamplesView {...(merged as any)} />
    </UserContext.Provider>,
  );
  return { ...utils, props: merged };
};

// Runs the element factory that the component handed to showToast and mounts
// the result, so the notification's own JSX is asserted rather than the call.
const renderLastToast = () => {
  const factory =
    mockShowToast.mock.calls[mockShowToast.mock.calls.length - 1][0];
  return render(<div>{factory({ closeToast: jest.fn() })}</div>);
};

beforeEach(() => {
  jest.clearAllMocks();
  mockToolbarIcons = [];
  mockCollectionProps = null;
  mockBulkMenuProps = null;
  mockBenchmarkModalProps = null;
  mockFilteredCountProps = null;
  mockToggleProps = null;
  mockInfiniteTableProps = null;
  mockComputeColumns.mockReturnValue([
    { dataKey: "sample" },
    { dataKey: "createdAt" },
  ]);
});

// ------------------------------------------------------------------ tests
describe("SamplesView prop defaults", () => {
  it("falls back to the table display and the short-read mNGS workflow when neither prop is supplied", () => {
    // Neither currentDisplay nor workflow is passed, so both destructuring
    // defaults have to fire for the mNGS toolbar + table to appear.
    renderView({ currentDisplay: undefined, workflow: undefined });

    // currentDisplay === "table": toolbar renders bare (no NarrowContainer)
    // and renderDisplay() takes the table case rather than map/plqc.
    expect(screen.getByTestId("infinite-table")).toBeTruthy();
    expect(screen.queryByTestId("narrow-container")).toBeNull();
    expect(screen.queryByTestId("discovery-map")).toBeNull();
    expect(mockToggleProps.currentDisplay).toBe("table");

    // workflow === short-read-mngs: only that tab offers the background-model
    // and heatmap triggers, and it is what the child modals are told about.
    expect(screen.getByTestId("bare-dropdown")).toBeTruthy();
    expect(screen.getByTestId("collection-modal")).toBeTruthy();
    expect(screen.getByTestId("bulk-actions-menu")).toBeTruthy();
    expect(screen.queryByTestId("toolbar-treeDendogram")).toBeNull();
    expect(mockCollectionProps.workflow).toBe(WorkflowType.SHORT_READ_MNGS);
    expect(mockComputeColumns).toHaveBeenCalledWith(
      expect.objectContaining({ workflow: WorkflowType.SHORT_READ_MNGS }),
    );
  });
});

describe("SamplesView missing user context", () => {
  it("renders with an empty feature/config fallback when the UserContext value is null", () => {
    renderView(
      { currentDisplay: "table", workflow: WorkflowType.SHORT_READ_MNGS },
      null,
    );

    // `const { allowedFeatures } = userContext || {}` -> undefined, which is
    // what gets forwarded to the background-model modal.
    expect(screen.getByTestId("infinite-table")).toBeTruthy();
    expect(mockCollectionProps).not.toBeNull();
    expect(mockCollectionProps.allowedFeatures).toBeUndefined();
  });
});

describe("SamplesView shift-select range", () => {
  it("expands the range when the shift-clicked row, not the anchor, is the first matching id", () => {
    const rows = ["1", "2", "3", "4"].map(id => sample(id));
    const onUpdateSelectedIds = jest.fn();
    renderView({
      currentDisplay: "table",
      workflow: WorkflowType.SHORT_READ_MNGS,
      rows,
      selectedIds: new Set<string>(),
      onUpdateSelectedIds,
    });

    // Plain click on "3" anchors the range there.
    act(() => {
      mockInfiniteTableProps.onSelectRow("3", true, { shiftKey: false });
    });
    expect(Array.from(onUpdateSelectedIds.mock.calls[0][0])).toEqual(["3"]);

    // Shift-click "1": findIndex walks ids 1,2,3 and the anchor only matches
    // last, so the `id === value` side of the predicate does the work.
    act(() => {
      mockInfiniteTableProps.onSelectRow("1", true, { shiftKey: true });
    });
    expect(Array.from(onUpdateSelectedIds.mock.calls[1][0]).sort()).toEqual([
      "1",
      "2",
      "3",
    ]);
  });

  it("clears the same range when the shift-click unchecks it", () => {
    const rows = ["1", "2", "3", "4"].map(id => sample(id));
    const onUpdateSelectedIds = jest.fn();
    renderView({
      currentDisplay: "table",
      workflow: WorkflowType.SHORT_READ_MNGS,
      rows,
      selectedIds: new Set(["1", "2", "3", "4"]),
      onUpdateSelectedIds,
    });

    act(() => {
      mockInfiniteTableProps.onSelectRow("4", false, { shiftKey: false });
    });
    act(() => {
      mockInfiniteTableProps.onSelectRow("2", false, { shiftKey: true });
    });
    expect(Array.from(onUpdateSelectedIds.mock.calls[1][0]).sort()).toEqual([
      "1",
    ]);
  });
});

describe("SamplesView Nextclade ceiling", () => {
  const cgSample = (id: string) => ({
    ...sample(id),
    referenceAccession: { taxonName: SARS_COV_2 },
  });

  it("swaps the Nextclade subtitle to the ceiling message above 200 SARS-CoV-2 samples", () => {
    const rows = Array.from({ length: 201 }, (_, i) => cgSample(String(i)));
    renderView({
      currentDisplay: "table",
      workflow: WorkflowType.CONSENSUS_GENOME,
      workflowEntity: WORKFLOW_ENTITIES.WORKFLOW_RUNS,
      rows,
    });

    const nextclade = screen.getByTestId("toolbar-treeDendogram");
    expect(nextclade.getAttribute("data-subtitle")).toBe(
      "Select at most 200 SARS-CoV-2 samples",
    );
    expect(nextclade.getAttribute("data-disabled")).toBe("true");
  });

  it("leaves the subtitle empty when the SARS-CoV-2 count is inside the window", () => {
    const rows = Array.from({ length: 3 }, (_, i) => cgSample(String(i)));
    renderView({
      currentDisplay: "table",
      workflow: WorkflowType.CONSENSUS_GENOME,
      workflowEntity: WORKFLOW_ENTITIES.WORKFLOW_RUNS,
      rows,
    });

    const nextclade = screen.getByTestId("toolbar-treeDendogram");
    expect(nextclade.getAttribute("data-subtitle")).toBe("");
    expect(nextclade.getAttribute("data-disabled")).toBe("false");
  });
});

describe("SamplesView benchmark kickoff", () => {
  const openBenchmarkModal = (rows: any[]) => {
    renderView({
      currentDisplay: "table",
      workflow: WorkflowType.SHORT_READ_MNGS,
      rows,
      selectedIds: new Set(rows.map(r => r.id)),
      selectableIds: rows.map(r => r.id),
    });
    act(() => {
      mockBulkMenuProps.handleClickBenchmark();
    });
    return mockBenchmarkModalProps;
  };

  it("substitutes an empty ground truth path when the modal confirms without one", async () => {
    const rows = [sample("7"), sample("8")];
    const modal = openBenchmarkModal(rows);

    // The modal omits fullGroundTruthFilePath entirely -> the
    // `fullGroundTruthFilePath = ""` destructuring default has to supply it.
    await modal.onConfirm({ samplesToBenchmark: rows });

    expect(mockBenchmarkSamples).toHaveBeenCalledWith({
      sampleIds: [7, 8],
      workflowToBenchmark: WorkflowType.SHORT_READ_MNGS,
      groundTruthFile: "",
    });
  });

  it("passes an explicit ground truth path straight through", async () => {
    const rows = [sample("7")];
    const modal = openBenchmarkModal(rows);

    await modal.onConfirm({
      samplesToBenchmark: rows,
      fullGroundTruthFilePath: "s3://truth/file.tsv",
    });

    expect(mockBenchmarkSamples).toHaveBeenCalledWith(
      expect.objectContaining({ groundTruthFile: "s3://truth/file.tsv" }),
    );
  });

  it("uses the singular noun when exactly one sample is ineligible for benchmarking", async () => {
    const bad = sample("9", { sample: { pipelineRunStatus: "running" } });
    const modal = openBenchmarkModal([bad]);

    await modal.onConfirm({ samplesToBenchmark: [bad] });

    expect(mockBenchmarkSamples).not.toHaveBeenCalled();
    const { getByTestId } = renderLastToast();
    const text = getByTestId("accordion-notification").textContent as string;
    expect(text).toContain("1 sample won't be included in the");
    expect(text).not.toContain("1 samples");
    expect(text).toContain("sample-9");
  });

  it("uses the plural noun when more than one sample is ineligible", async () => {
    const bad = [
      sample("9", { sample: { pipelineRunStatus: "running" } }),
      sample("10", { sample: { pipelineRunStatus: "running" } }),
    ];
    const modal = openBenchmarkModal(bad);

    await modal.onConfirm({ samplesToBenchmark: bad });

    const { getByTestId } = renderLastToast();
    expect(getByTestId("accordion-notification").textContent).toContain(
      "2 samples won't be included in the",
    );
  });
});

describe("SamplesView filtered count fallback", () => {
  it("shows a dash instead of a count when nothing is selectable and no filter is applied", () => {
    renderView({
      currentDisplay: "table",
      workflow: WorkflowType.SHORT_READ_MNGS,
      totalWorkflowCounts: { [WorkflowType.SHORT_READ_MNGS]: 12 },
      hasAtLeastOneFilterApplied: false,
      selectableIds: undefined,
      selectedIds: new Set<string>(),
    });

    // `selectableIds?.length ?? "-"` -- the nullish side, in the unfiltered
    // (scalar, not numerator/denominator) shape.
    expect(mockFilteredCountProps.count).toBe("-");
    expect(mockFilteredCountProps.workflowDisplayText).toBe("samples");
    expect(screen.queryByText("Clear Filters")).toBeNull();
  });

  it("reports the selectable length when ids are present", () => {
    renderView({
      currentDisplay: "table",
      workflow: WorkflowType.SHORT_READ_MNGS,
      totalWorkflowCounts: { [WorkflowType.SHORT_READ_MNGS]: 1 },
      hasAtLeastOneFilterApplied: false,
    });

    expect(mockFilteredCountProps.count).toBe(2);
    // totalNumberOfObjects === 1 takes the singular display string.
    expect(mockFilteredCountProps.workflowDisplayText).toBe("sample");
  });
});
