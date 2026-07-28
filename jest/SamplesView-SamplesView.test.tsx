// Coverage: app/assets/src/components/views/DiscoveryView/components/SamplesView/
//   SamplesView.tsx
//
// SamplesView is the toolbar + table shell for the discovery sample lists. Its
// own logic is almost entirely branching: which triggers a workflow tab shows,
// the enable/disable predicates behind each trigger, the AMR + benchmark
// eligibility partitions, the bulk-download guard rails, shift-select range
// maths, the filtered-count numerator/denominator, and the table/map/plqc
// display switch. Every heavy child (modals, InfiniteTable, DiscoveryMap,
// QualityControl, toasts) is stubbed so the assertions land on this component's
// decisions rather than its descendants.
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

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

const mockShowBulkDownloadNotification = jest.fn();
jest.mock("~/components/common/BulkDownloadNotification", () => ({
  showBulkDownloadNotification: (...a: any[]) =>
    mockShowBulkDownloadNotification(...a),
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

let mockLastNotificationProps: any = null;
jest.mock("~ui/notifications/Notification", () => ({
  __esModule: true,
  default: (props: any) => {
    mockLastNotificationProps = props;
    return require("react").createElement(
      "div",
      { "data-testid": "notification" },
      props.children,
    );
  },
}));

let mockLastAccordionProps: any = null;
jest.mock("~ui/notifications/AccordionNotification", () => ({
  __esModule: true,
  default: (props: any) => {
    mockLastAccordionProps = props;
    return require("react").createElement(
      "div",
      { "data-testid": "accordion-notification" },
      props.header,
      props.content,
    );
  },
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

let mockLastToolbarIcons: any[] = [];
jest.mock(
  "~/components/views/DiscoveryView/components/SamplesView/components/ToolbarButtonIcon/ToolbarButtonIcon",
  () => ({
    __esModule: true,
    default: (props: any) => {
      mockLastToolbarIcons.push(props);
      return require("react").createElement("button", {
        type: "button",
        "data-testid": props.testId || `toolbar-${props.icon}`,
        "data-subtitle": props.popupSubtitle,
        "data-text": props.popupText,
        "data-disabled": String(!!props.disabled),
        onClick: props.onClick,
      });
    },
  }),
);

let mockLastCollectionProps: any = null;
jest.mock(
  "~/components/views/DiscoveryView/components/SamplesView/components/CollectionModal/CollectionModal",
  () => ({
    __esModule: true,
    default: (props: any) => {
      mockLastCollectionProps = props;
      return require("react").createElement(
        "div",
        { "data-testid": "collection-modal" },
        props.trigger,
      );
    },
  }),
);

let mockLastBulkMenuProps: any = null;
jest.mock(
  "~/components/views/DiscoveryView/components/SamplesView/components/BulkSamplesActionsMenu/BulkSamplesActionsMenu",
  () => ({
    __esModule: true,
    default: (props: any) => {
      mockLastBulkMenuProps = props;
      return require("react").createElement("div", {
        "data-testid": "bulk-actions-menu",
      });
    },
  }),
);

let mockLastBulkDeleteTriggerProps: any = null;
jest.mock(
  "~/components/views/DiscoveryView/components/SamplesView/components/BulkDeleteTrigger",
  () => ({
    BulkDeleteTrigger: (props: any) => {
      mockLastBulkDeleteTriggerProps = props;
      return require("react").createElement("button", {
        type: "button",
        "data-testid": "bulk-delete-trigger",
        onClick: props.onClick,
      });
    },
  }),
);

let mockLastBulkDeleteModalProps: any = null;
jest.mock(
  "~/components/views/DiscoveryView/components/SamplesView/components/BulkDeleteModal",
  () => ({
    __esModule: true,
    default: (props: any) => {
      mockLastBulkDeleteModalProps = props;
      return require("react").createElement("div", {
        "data-testid": "bulk-delete-modal",
        "data-open": String(!!props.isOpen),
        "data-label": props.workflowLabel,
      });
    },
  }),
);

let mockLastBenchmarkModalProps: any = null;
jest.mock(
  "~/components/views/DiscoveryView/components/SamplesView/components/BenchmarkModal",
  () => ({
    BenchmarkModal: (props: any) => {
      mockLastBenchmarkModalProps = props;
      return require("react").createElement("div", {
        "data-testid": "benchmark-modal",
      });
    },
  }),
);

let mockLastBulkDownloadModalProps: any = null;
jest.mock(
  "~/components/views/DiscoveryView/components/SamplesView/components/BulkDownloadModal",
  () => ({
    BulkDownloadModal: (props: any) => {
      mockLastBulkDownloadModalProps = props;
      return require("react").createElement("div", {
        "data-testid": "bulk-download-modal",
      });
    },
  }),
);

let mockLastNextcladeModalProps: any = null;
jest.mock(
  "~/components/views/DiscoveryView/components/SamplesView/components/NextcladeModal",
  () => ({
    NextcladeModal: (props: any) => {
      mockLastNextcladeModalProps = props;
      return require("react").createElement("div", {
        "data-testid": "nextclade-modal",
      });
    },
  }),
);

let mockLastPhyloModalProps: any = null;
jest.mock("~/components/views/PhyloTree/PhyloTreeCreationModal", () => ({
  __esModule: true,
  default: (props: any) => {
    mockLastPhyloModalProps = props;
    return require("react").createElement("div", {
      "data-testid": "phylo-modal",
      "data-csrf": props.csrf,
    });
  },
}));

let mockLastFilteredCountProps: any = null;
jest.mock(
  "~/components/views/DiscoveryView/components/SamplesView/components/FilteredCount",
  () => ({
    FilteredCount: (props: any) => {
      mockLastFilteredCountProps = props;
      return require("react").createElement("div", {
        "data-testid": "filtered-count",
      });
    },
  }),
);

let mockLastQualityControlProps: any = null;
jest.mock(
  "~/components/views/DiscoveryView/components/SamplesView/components/QualityControl",
  () => ({
    __esModule: true,
    default: (props: any) => {
      mockLastQualityControlProps = props;
      return require("react").createElement("div", {
        "data-testid": "quality-control",
      });
    },
  }),
);

let mockLastDiscoveryMapProps: any = null;
jest.mock(
  "~/components/views/DiscoveryView/components/DiscoveryMap/DiscoveryMap",
  () => ({
    DiscoveryMap: (props: any) => {
      mockLastDiscoveryMapProps = props;
      return require("react").createElement("div", {
        "data-testid": "discovery-map",
      });
    },
  }),
);

let mockLastToggleProps: any = null;
jest.mock(
  "~/components/views/DiscoveryView/components/DiscoveryViewToggle/DiscoveryViewToggle",
  () => ({
    DiscoveryViewToggle: (props: any) => {
      mockLastToggleProps = props;
      return require("react").createElement("div", {
        "data-testid": "display-toggle",
        "data-include-plqc": String(!!props.includePLQC),
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

let mockLastInfiniteTableProps: any = null;
const mockTableReset = jest.fn();
jest.mock("~/components/visualizations/table/InfiniteTable", () => {
  const ReactLib = require("react");
  class InfiniteTableStub extends ReactLib.Component {
    reset = mockTableReset;
    render() {
      mockLastInfiniteTableProps = this.props;
      return ReactLib.createElement("div", {
        "data-testid": "infinite-table",
      });
    }
  }
  return { __esModule: true, default: InfiniteTableStub };
});

import { UserContext } from "~/components/common/UserContext";
import { WORKFLOW_ENTITIES, WorkflowType } from "~/components/utils/workflows";
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

const renderView = (props: any = {}, ctx: any = {}, ref?: any) => {
  const rows = props.rows ?? [sample("1"), sample("2")];
  const merged = {
    currentDisplay: "table",
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
    workflow: WorkflowType.SHORT_READ_MNGS,
    workflowEntity: WORKFLOW_ENTITIES.SAMPLES,
    ...props,
  };
  delete merged.rows;
  const utils = render(
    <UserContext.Provider value={{ ...DEFAULT_CONTEXT, ...ctx } as any}>
      <SamplesView ref={ref} {...(merged as any)} />
    </UserContext.Provider>,
  );
  return { ...utils, props: merged };
};

const iconByTestId = (testId: string) => screen.getByTestId(testId);

beforeEach(() => {
  jest.clearAllMocks();
  mockLastToolbarIcons = [];
  mockLastCollectionProps = null;
  mockLastBulkMenuProps = null;
  mockLastBulkDeleteTriggerProps = null;
  mockLastBulkDeleteModalProps = null;
  mockLastBenchmarkModalProps = null;
  mockLastBulkDownloadModalProps = null;
  mockLastNextcladeModalProps = null;
  mockLastPhyloModalProps = null;
  mockLastFilteredCountProps = null;
  mockLastQualityControlProps = null;
  mockLastDiscoveryMapProps = null;
  mockLastToggleProps = null;
  mockLastInfiniteTableProps = null;
  mockLastNotificationProps = null;
  mockLastAccordionProps = null;
  mockComputeColumns.mockReturnValue([
    { dataKey: "sample" },
    { dataKey: "createdAt" },
  ]);
});

// ------------------------------------------------------------------ tests
describe("SamplesView metadata loading", () => {
  it("skips the metadata fetch and renders the table when showAllMetadata is off", () => {
    renderView();
    expect(mockGetSampleMetadataFields).not.toHaveBeenCalled();
    expect(screen.getByTestId("infinite-table")).toBeTruthy();
  });

  it("shows the loading spinner until sample metadata fields resolve", async () => {
    mockGetSampleMetadataFields.mockResolvedValue([{ key: "host" }]);
    renderView({ showAllMetadata: true });
    expect(screen.getByTestId("icon-loading")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId("infinite-table")).toBeTruthy(),
    );
    expect(mockGetSampleMetadataFields).toHaveBeenCalledWith(["1", "2"]);
  });

  it("uses the workflow-run metadata endpoint for workflow-run workflows", async () => {
    mockGetWorkflowRunMetadataFields.mockResolvedValue([]);
    renderView({
      showAllMetadata: true,
      workflow: WorkflowType.CONSENSUS_GENOME,
      workflowEntity: WORKFLOW_ENTITIES.WORKFLOW_RUNS,
    });
    await waitFor(() =>
      expect(mockGetWorkflowRunMetadataFields).toHaveBeenCalledTimes(1),
    );
    expect(mockGetSampleMetadataFields).not.toHaveBeenCalled();
  });

  it("stays loading when there are no selectable ids to fetch for", () => {
    renderView({ showAllMetadata: true, selectableIds: undefined });
    expect(screen.getByTestId("icon-loading")).toBeTruthy();
    expect(mockGetSampleMetadataFields).not.toHaveBeenCalled();
  });
});

describe("SamplesView heatmap trigger", () => {
  const heatmapSubtitle = () =>
    iconByTestId("heatmap-icon").getAttribute("data-subtitle");

  it("disables the heatmap with a floor message below 2 samples", () => {
    renderView({ selectedIds: new Set(["1"]) });
    expect(heatmapSubtitle()).toBe("Select at least 2 samples");
    expect(iconByTestId("heatmap-icon").getAttribute("data-disabled")).toBe(
      "true",
    );
  });

  it("disables the heatmap with a ceiling message above 500 samples", () => {
    const ids = Array.from({ length: 501 }, (_, i) => String(i));
    renderView({ selectedIds: new Set(ids), selectableIds: ids });
    expect(heatmapSubtitle()).toBe("Select at most 500 samples");
  });

  it("offers both heatmap destinations when the selection is in range", () => {
    renderView();
    expect(screen.getByText("Taxon Heatmap")).toBeTruthy();
    expect(screen.getByText("AMR Heatmap (Deprecated)")).toBeTruthy();
    const links = screen.getAllByTestId("router-link");
    expect(links[0].getAttribute("href")).toContain("/visualizations/heatmap?");
    expect(links[0].getAttribute("href")).toContain("sampleIds");
    expect(links[1].getAttribute("href")).toContain("/amr_heatmap?");
  });
});

describe("SamplesView background-model trigger", () => {
  it("is a disabled icon below 2 samples", () => {
    renderView({ selectedIds: new Set(["1"]) });
    expect(
      iconByTestId("background-model-icon").getAttribute("data-subtitle"),
    ).toBe("Select at least 2 samples");
    expect(screen.queryByTestId("collection-modal")).toBeNull();
  });

  it("mounts CollectionModal with numeric ids and the matching rows at 2+", () => {
    renderView();
    expect(screen.getByTestId("collection-modal")).toBeTruthy();
    expect(Array.from(mockLastCollectionProps.selectedSampleIds)).toEqual([
      1, 2,
    ]);
    expect(mockLastCollectionProps.fetchedSamples).toHaveLength(2);
    expect(mockLastCollectionProps.workflow).toBe(WorkflowType.SHORT_READ_MNGS);
  });
});

describe("SamplesView bulk download trigger", () => {
  const clickDownload = () => fireEvent.click(iconByTestId("download-icon"));

  it("is disabled with a subtitle when nothing is selected", () => {
    renderView({ selectedIds: new Set() });
    const icon = iconByTestId("download-icon");
    expect(icon.getAttribute("data-disabled")).toBe("true");
    expect(icon.getAttribute("data-subtitle")).toBe("Select at least 1 sample");
  });

  it("opens the bulk download modal within the configured limit", () => {
    renderView();
    clickDownload();
    expect(screen.getByTestId("bulk-download-modal")).toBeTruthy();
    expect(mockLastBulkDownloadModalProps.selectedObjects).toHaveLength(2);
  });

  it("shows a contact-us tooltip when the app config has no limit", () => {
    renderView({}, { appConfig: {} });
    clickDownload();
    expect(screen.queryByTestId("bulk-download-modal")).toBeNull();
    expect(iconByTestId("download-icon").getAttribute("data-text")).toBe(
      "Unexpected issue. Please contact us for help.",
    );
  });

  it("refuses a non-admin selection over the limit, naming samples", () => {
    renderView({}, { appConfig: { maxObjectsBulkDownload: 1 } });
    clickDownload();
    expect(screen.queryByTestId("bulk-download-modal")).toBeNull();
    expect(iconByTestId("download-icon").getAttribute("data-text")).toBe(
      "No more than 1 samples allowed in one download.",
    );
  });

  it("names consensus genomes when the entity is workflow runs", () => {
    renderView(
      {
        workflow: WorkflowType.CONSENSUS_GENOME,
        workflowEntity: WORKFLOW_ENTITIES.WORKFLOW_RUNS,
      },
      { appConfig: { maxObjectsBulkDownload: 1 } },
    );
    clickDownload();
    expect(iconByTestId("download-icon").getAttribute("data-text")).toBe(
      "No more than 1 consensus genomes allowed in one download.",
    );
  });

  it("lets an admin exceed the limit", () => {
    renderView({}, { admin: true, appConfig: { maxObjectsBulkDownload: 1 } });
    clickDownload();
    expect(screen.getByTestId("bulk-download-modal")).toBeTruthy();
  });

  it("closes the modal and fires the notification on generate", () => {
    renderView();
    clickDownload();
    act(() => mockLastBulkDownloadModalProps.onGenerate());
    expect(mockShowBulkDownloadNotification).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("bulk-download-modal")).toBeNull();
  });

  it("closes the modal on dismiss without notifying", () => {
    renderView();
    clickDownload();
    act(() => mockLastBulkDownloadModalProps.onClose());
    expect(screen.queryByTestId("bulk-download-modal")).toBeNull();
    expect(mockShowBulkDownloadNotification).not.toHaveBeenCalled();
  });
});

describe("SamplesView nextclade and gen epi triggers (consensus genome tab)", () => {
  const cgRow = (id: string, taxonName: string, overrides: any = {}) => ({
    id,
    creation_source: "SARS-CoV-2 Consensus Genome",
    referenceAccession: { taxonName },
    sample: { id, name: `cg-${id}` },
    ...overrides,
  });
  const SARS = "Severe acute respiratory syndrome coronavirus 2";

  const renderCg = (rows: any[], ctx: any = {}) =>
    renderView(
      {
        rows,
        workflow: WorkflowType.CONSENSUS_GENOME,
        workflowEntity: WORKFLOW_ENTITIES.WORKFLOW_RUNS,
      },
      ctx,
    );

  it("disables Nextclade when no SARS-CoV-2 run is selected", () => {
    renderCg([cgRow("1", "Influenza A")]);
    const icon = iconByTestId("toolbar-treeDendogram");
    expect(icon.getAttribute("data-disabled")).toBe("true");
    expect(icon.getAttribute("data-subtitle")).toContain(
      "at least 1 SARS-CoV-2",
    );
  });

  it("enables Nextclade and opens its modal for a SARS-CoV-2 run", () => {
    renderCg([cgRow("1", SARS)]);
    const icon = iconByTestId("toolbar-treeDendogram");
    expect(icon.getAttribute("data-disabled")).toBe("false");
    expect(icon.getAttribute("data-subtitle")).toBe("");
    fireEvent.click(icon);
    expect(screen.getByTestId("nextclade-modal")).toBeTruthy();
    act(() => mockLastNextcladeModalProps.onClose());
    expect(screen.queryByTestId("nextclade-modal")).toBeNull();
  });

  it("ignores WGS-sourced runs when counting SARS-CoV-2 samples", () => {
    renderCg([cgRow("1", SARS, { creation_source: "Viral CG Upload" })]);
    expect(
      iconByTestId("toolbar-treeDendogram").getAttribute("data-disabled"),
    ).toBe("true");
  });

  it("hides the gen epi trigger without the genepi feature flag", () => {
    renderCg([cgRow("1", SARS)]);
    expect(screen.queryByTestId("toolbar-share")).toBeNull();
  });

  it("shows an enabled gen epi trigger for a flagged user with SARS-CoV-2", () => {
    renderCg([cgRow("1", SARS)], { allowedFeatures: ["genepi"] });
    const icon = iconByTestId("toolbar-share");
    expect(icon.getAttribute("data-disabled")).toBe("false");
    expect(icon.getAttribute("data-subtitle")).toBe("");
  });

  it("disables the gen epi trigger with a subtitle when nothing qualifies", () => {
    renderCg([cgRow("1", "Influenza A")], { allowedFeatures: ["genepi"] });
    const icon = iconByTestId("toolbar-share");
    expect(icon.getAttribute("data-disabled")).toBe("true");
    expect(icon.getAttribute("data-subtitle")).toBe(
      "Select at least 1 SARS-CoV-2 sample",
    );
  });
});

describe("SamplesView bulk AMR kickoff", () => {
  it("kicks off eligible samples and reports the new runs", async () => {
    const handleNewWorkflowRunsCreated = jest.fn();
    renderView({ handleNewWorkflowRunsCreated });
    await act(async () => {
      await mockLastBulkMenuProps.handleBulkKickoffAmr();
    });
    expect(mockBulkKickoffWorkflowRuns).toHaveBeenCalledWith({
      sampleIds: [1, 2],
      workflow: WorkflowType.AMR,
    });
    expect(handleNewWorkflowRunsCreated).toHaveBeenCalledWith({
      numWorkflowRunsCreated: 2,
      workflow: WorkflowType.AMR,
    });
    expect(mockShowToast).toHaveBeenCalledTimes(1);
  });

  it("does not offer AMR kickoff on the public domain", () => {
    renderView({ domain: "public" });
    expect(mockLastBulkMenuProps.handleBulkKickoffAmr).toBeNull();
  });

  it("skips samples whose upload failed and warns about them", async () => {
    renderView({
      rows: [sample("1", { sample: { uploadError: "boom" } })],
      selectedIds: new Set(["1"]),
      selectableIds: ["1"],
    });
    await act(async () => {
      await mockLastBulkMenuProps.handleBulkKickoffAmr();
    });
    expect(mockBulkKickoffWorkflowRuns).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledTimes(1);
  });

  it("skips samples still processing", async () => {
    renderView({
      rows: [sample("1", { sample: { pipelineRunStatus: "running" } })],
      selectedIds: new Set(["1"]),
      selectableIds: ["1"],
    });
    await act(async () => {
      await mockLastBulkMenuProps.handleBulkKickoffAmr();
    });
    expect(mockBulkKickoffWorkflowRuns).not.toHaveBeenCalled();
  });

  it("skips samples that already have an AMR run", async () => {
    renderView({
      rows: [
        sample("1", { sample: { workflowRunsCountByWorkflow: { amr: 1 } } }),
      ],
      selectedIds: new Set(["1"]),
      selectableIds: ["1"],
    });
    await act(async () => {
      await mockLastBulkMenuProps.handleBulkKickoffAmr();
    });
    expect(mockBulkKickoffWorkflowRuns).not.toHaveBeenCalled();
  });

  it("skips samples run on a pipeline version below the AMR minimum", async () => {
    renderView({
      rows: [sample("1", { pipelineVersion: "4.0.0" })],
      selectedIds: new Set(["1"]),
      selectableIds: ["1"],
    });
    await act(async () => {
      await mockLastBulkMenuProps.handleBulkKickoffAmr();
    });
    expect(mockBulkKickoffWorkflowRuns).not.toHaveBeenCalled();
  });

  it("refuses to kick off the same sample twice in one session", async () => {
    renderView({
      rows: [sample("1")],
      selectedIds: new Set(["1"]),
      selectableIds: ["1"],
    });
    await act(async () => {
      await mockLastBulkMenuProps.handleBulkKickoffAmr();
    });
    expect(mockBulkKickoffWorkflowRuns).toHaveBeenCalledTimes(1);
    await act(async () => {
      await mockLastBulkMenuProps.handleBulkKickoffAmr();
    });
    expect(mockBulkKickoffWorkflowRuns).toHaveBeenCalledTimes(1);
  });

  it("splits a mixed selection into a kickoff and a warning toast", async () => {
    renderView({
      rows: [sample("1"), sample("2", { pipelineVersion: "1.0.0" })],
    });
    await act(async () => {
      await mockLastBulkMenuProps.handleBulkKickoffAmr();
    });
    expect(mockBulkKickoffWorkflowRuns).toHaveBeenCalledWith({
      sampleIds: [1],
      workflow: WorkflowType.AMR,
    });
    expect(mockShowToast).toHaveBeenCalledTimes(2);
  });
});

describe("SamplesView toast contents", () => {
  const renderToast = (index: number) => {
    const renderFn = mockShowToast.mock.calls[index][0];
    render(renderFn({ closeToast: jest.fn() }));
  };

  it("renders the AMR kicked-off notification body", async () => {
    renderView();
    await act(async () => {
      await mockLastBulkMenuProps.handleBulkKickoffAmr();
    });
    renderToast(0);
    expect(screen.getByTestId("notification")).toBeTruthy();
    expect(mockLastNotificationProps.type).toBe("info");
  });

  it("pluralizes the ineligible-samples warning header", async () => {
    renderView({
      rows: [
        sample("1", { pipelineVersion: "1.0.0" }),
        sample("2", { pipelineVersion: "1.0.0" }),
      ],
    });
    await act(async () => {
      await mockLastBulkMenuProps.handleBulkKickoffAmr();
    });
    renderToast(0);
    expect(screen.getByTestId("accordion-notification")).toBeTruthy();
    expect(mockLastAccordionProps.type).toBe("warning");
    expect(
      screen.getByText(/2 samples won’t be run|2 samples won't be run/),
    ).toBeTruthy();
    expect(screen.getByText("sample-1")).toBeTruthy();
    expect(screen.getByText("sample-2")).toBeTruthy();
  });

  it("uses the singular form for one ineligible sample", async () => {
    renderView({
      rows: [sample("1", { pipelineVersion: "1.0.0" })],
      selectedIds: new Set(["1"]),
      selectableIds: ["1"],
    });
    await act(async () => {
      await mockLastBulkMenuProps.handleBulkKickoffAmr();
    });
    renderToast(0);
    expect(
      screen.getByText(/1 sample won’t be run|1 sample won't be run/),
    ).toBeTruthy();
  });
});

describe("SamplesView benchmark flow", () => {
  const openBenchmark = () => {
    renderView({}, { admin: true });
    act(() => mockLastBulkMenuProps.handleClickBenchmark());
  };

  it("opens the benchmark modal from the actions menu", () => {
    openBenchmark();
    expect(screen.getByTestId("benchmark-modal")).toBeTruthy();
    expect(mockLastBenchmarkModalProps.selectedObjects).toHaveLength(2);
  });

  it("closes the benchmark modal", () => {
    openBenchmark();
    act(() => mockLastBenchmarkModalProps.onClose());
    expect(screen.queryByTestId("benchmark-modal")).toBeNull();
  });

  it("kicks off a benchmark for eligible samples with the truth file", async () => {
    const handleNewWorkflowRunsCreated = jest.fn();
    renderView({ handleNewWorkflowRunsCreated }, { admin: true });
    act(() => mockLastBulkMenuProps.handleClickBenchmark());
    await act(async () => {
      await mockLastBenchmarkModalProps.onConfirm({
        fullGroundTruthFilePath: "s3://bench/truth.tsv",
        samplesToBenchmark: [sample("1"), sample("2")],
      });
    });
    expect(mockBenchmarkSamples).toHaveBeenCalledWith({
      sampleIds: [1, 2],
      workflowToBenchmark: WorkflowType.SHORT_READ_MNGS,
      groundTruthFile: "s3://bench/truth.tsv",
    });
    expect(handleNewWorkflowRunsCreated).toHaveBeenCalledWith({
      numWorkflowRunsCreated: 2,
      workflow: WorkflowType.BENCHMARK,
    });
  });

  it("warns instead of benchmarking when every sample is ineligible", async () => {
    renderView({}, { admin: true });
    act(() => mockLastBulkMenuProps.handleClickBenchmark());
    await act(async () => {
      await mockLastBenchmarkModalProps.onConfirm({
        fullGroundTruthFilePath: "",
        samplesToBenchmark: [
          sample("1", { sample: { uploadError: "boom" } }),
          sample("2", { sample: { pipelineRunStatus: "running" } }),
        ],
      });
    });
    expect(mockBenchmarkSamples).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledTimes(1);
    render(mockShowToast.mock.calls[0][0]({ closeToast: jest.fn() }));
    expect(
      screen.getByText(/won’t be included|won't be included/),
    ).toBeTruthy();
  });

  it("renders the benchmark kicked-off notification", async () => {
    renderView({}, { admin: true });
    act(() => mockLastBulkMenuProps.handleClickBenchmark());
    await act(async () => {
      await mockLastBenchmarkModalProps.onConfirm({
        fullGroundTruthFilePath: "",
        samplesToBenchmark: [sample("1")],
      });
    });
    render(mockShowToast.mock.calls[0][0]({ closeToast: jest.fn() }));
    expect(screen.getByText("Benchmark")).toBeTruthy();
  });
});

describe("SamplesView bulk delete", () => {
  it("opens the delete modal from the trigger and passes the selection", () => {
    renderView();
    expect(mockLastBulkDeleteModalProps.isOpen).toBe(false);
    fireEvent.click(screen.getByTestId("bulk-delete-trigger"));
    expect(mockLastBulkDeleteModalProps.isOpen).toBe(true);
    expect(mockLastBulkDeleteModalProps.selectedIds).toEqual(["1", "2"]);
    expect(mockLastBulkDeleteModalProps.isShortReadMngs).toBe(true);
  });

  it("closes the delete modal", () => {
    renderView();
    fireEvent.click(screen.getByTestId("bulk-delete-trigger"));
    act(() => mockLastBulkDeleteModalProps.onClose());
    expect(mockLastBulkDeleteModalProps.isOpen).toBe(false);
  });

  it("tracks, refreshes and clears the selection on delete success", () => {
    const onDeleteSample = jest.fn();
    const onUpdateSelectedIds = jest.fn();
    renderView({ onDeleteSample, onUpdateSelectedIds });
    act(() => mockLastBulkDeleteModalProps.onSuccess());
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "bulk_deleted",
      expect.objectContaining({ workflow: WorkflowType.SHORT_READ_MNGS }),
    );
    expect(onDeleteSample).toHaveBeenCalledTimes(1);
    expect(onUpdateSelectedIds).toHaveBeenCalledWith(new Set());
  });

  it("marks the tab as non-mngs for consensus genome", () => {
    renderView({
      workflow: WorkflowType.CONSENSUS_GENOME,
      workflowEntity: WORKFLOW_ENTITIES.WORKFLOW_RUNS,
    });
    expect(mockLastBulkDeleteModalProps.isShortReadMngs).toBe(false);
  });
});

describe("SamplesView retry upload", () => {
  const originalLocation = window.location;
  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
  });
  const stubLocation = () =>
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { href: "" },
    });

  it("offers retry only when a selected sample failed to upload", () => {
    renderView();
    expect(mockLastBulkMenuProps.canRetryUpload).toBe(false);
    renderView({
      rows: [sample("1", { sample: { uploadError: "boom" } })],
      selectedIds: new Set(["1"]),
      selectableIds: ["1"],
    });
    expect(mockLastBulkMenuProps.canRetryUpload).toBe(true);
  });

  it("routes back into the project upload flow when a project is set", () => {
    stubLocation();
    renderView({ projectId: "55" });
    mockLastBulkMenuProps.onRetryUpload();
    expect(window.location.href).toBe("/samples/upload?projectId=55");
  });

  it("routes to the generic upload flow without a project", () => {
    stubLocation();
    renderView({ projectId: undefined });
    mockLastBulkMenuProps.onRetryUpload();
    expect(window.location.href).toBe("/samples/upload");
  });
});

describe("SamplesView phylo tree modal", () => {
  beforeEach(() => {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "csrf-token");
    (meta as any).content = "token-123";
    document.body.appendChild(meta);
  });

  it("opens with the page csrf token and closes again", () => {
    renderView();
    act(() => mockLastBulkMenuProps.handleClickPhyloTree());
    expect(screen.getByTestId("phylo-modal").getAttribute("data-csrf")).toBe(
      "token-123",
    );
    act(() => mockLastPhyloModalProps.onClose());
    expect(screen.queryByTestId("phylo-modal")).toBeNull();
  });
});

describe("SamplesView row selection", () => {
  const ids = ["1", "2", "3", "4"];
  const rows = ids.map(id => sample(id));

  const renderForSelection = (selected: string[]) => {
    const onUpdateSelectedIds = jest.fn();
    renderView({
      rows,
      selectableIds: ids,
      selectedIds: new Set(selected),
      onUpdateSelectedIds,
    });
    return onUpdateSelectedIds;
  };

  it("adds a single row without shift", () => {
    const onUpdateSelectedIds = renderForSelection([]);
    act(() =>
      mockLastInfiniteTableProps.onSelectRow("2", true, { shiftKey: false }),
    );
    expect(onUpdateSelectedIds).toHaveBeenCalledWith(new Set(["2"]));
  });

  it("removes a single row without shift", () => {
    const onUpdateSelectedIds = renderForSelection(["1", "2"]);
    act(() =>
      mockLastInfiniteTableProps.onSelectRow("2", false, { shiftKey: false }),
    );
    expect(onUpdateSelectedIds).toHaveBeenCalledWith(new Set(["1"]));
  });

  it("shift-selects the inclusive range from the last anchor", () => {
    const onUpdateSelectedIds = renderForSelection([]);
    act(() =>
      mockLastInfiniteTableProps.onSelectRow("1", true, { shiftKey: false }),
    );
    act(() =>
      mockLastInfiniteTableProps.onSelectRow("4", true, { shiftKey: true }),
    );
    expect(onUpdateSelectedIds).toHaveBeenLastCalledWith(
      new Set(["1", "2", "3", "4"]),
    );
  });

  it("shift-deselects the inclusive range", () => {
    const onUpdateSelectedIds = renderForSelection(["1", "2", "3", "4"]);
    act(() =>
      mockLastInfiniteTableProps.onSelectRow("1", false, { shiftKey: false }),
    );
    act(() =>
      mockLastInfiniteTableProps.onSelectRow("3", false, { shiftKey: true }),
    );
    expect(onUpdateSelectedIds).toHaveBeenLastCalledWith(new Set(["4"]));
  });

  it("falls back to single select when shift is held with no anchor", () => {
    const onUpdateSelectedIds = renderForSelection([]);
    act(() =>
      mockLastInfiniteTableProps.onSelectRow("3", true, { shiftKey: true }),
    );
    expect(onUpdateSelectedIds).toHaveBeenCalledWith(new Set(["3"]));
  });

  it("select-all sends every selectable id, and clear sends an empty set", () => {
    const onUpdateSelectedIds = renderForSelection([]);
    act(() => mockLastInfiniteTableProps.onSelectAllRows(true));
    expect(onUpdateSelectedIds).toHaveBeenCalledWith(new Set(ids));
    act(() => mockLastInfiniteTableProps.onSelectAllRows(false));
    expect(onUpdateSelectedIds).toHaveBeenLastCalledWith(new Set());
  });

  it("reports select-all as checked only when every id is selected", () => {
    renderView({ rows, selectableIds: ids, selectedIds: new Set(ids) });
    expect(mockLastInfiniteTableProps.selectAllChecked).toBe(true);
    renderView({ rows, selectableIds: ids, selectedIds: new Set(["1"]) });
    expect(mockLastInfiniteTableProps.selectAllChecked).toBe(false);
  });

  it("reports select-all as unchecked when nothing is selectable", () => {
    renderView({ rows: [], selectableIds: [], selectedIds: new Set() });
    expect(mockLastInfiniteTableProps.selectAllChecked).toBe(false);
  });
});

describe("SamplesView table wiring", () => {
  it("delegates sorting to the caller", () => {
    const onSortColumn = jest.fn();
    renderView({ onSortColumn });
    act(() =>
      mockLastInfiniteTableProps.onSortColumn({
        sortBy: "createdAt",
        sortDirection: "DESC",
      }),
    );
    expect(onSortColumn).toHaveBeenCalledWith({
      sortBy: "createdAt",
      sortDirection: "DESC",
    });
  });

  it("keeps a sortBy that the computed columns actually contain", () => {
    renderView({ sortBy: "sample" });
    expect(mockLastInfiniteTableProps.sortBy).toBe("sample");
  });

  it("falls back to the default sorted column when sortBy is unavailable", () => {
    renderView({ sortBy: "someCustomMetadataField" });
    expect(mockLastInfiniteTableProps.sortBy).toBe("createdAt");
  });

  it("passes the snapshot flag through to the column builder", () => {
    renderView({ snapshotShareId: "abc" });
    expect(mockComputeColumns).toHaveBeenCalledWith(
      expect.objectContaining({ basicIcon: true, showSampleOwnerName: false }),
    );
  });

  it("makes rows unselectable when all triggers are hidden", () => {
    renderView({ hideAllTriggers: true });
    expect(mockLastInfiniteTableProps.selectableKey).toBeNull();
    renderView({ hideAllTriggers: false });
    expect(mockLastInfiniteTableProps.selectableKey).toBe("id");
  });

  it("notifies the caller and tracks the click when a row is clicked", () => {
    const onObjectSelected = jest.fn();
    renderView({ onObjectSelected });
    const event = { type: "click" } as any;
    act(() =>
      mockLastInfiniteTableProps.onRowClick({ event, rowData: { id: "2" } }),
    );
    expect(onObjectSelected).toHaveBeenCalledWith({
      object: expect.objectContaining({ id: "2" }),
      currentEvent: event,
    });
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "row_clicked",
      expect.objectContaining({ sampleId: "2", sampleName: "sample-2" }),
    );
  });

  it("still tracks a row click when no selection handler is supplied", () => {
    renderView({ onObjectSelected: undefined });
    act(() =>
      mockLastInfiniteTableProps.onRowClick({
        event: {} as any,
        rowData: { id: "1" },
      }),
    );
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "row_clicked",
      expect.objectContaining({ sampleId: "1" }),
    );
  });

  it("resets the table through the imperative ref only in table display", () => {
    const ref = { current: null } as any;
    renderView({}, {}, ref);
    act(() => ref.current.reset());
    expect(mockTableReset).toHaveBeenCalledTimes(1);
  });

  it("does not reset the table when the map is displayed", () => {
    const ref = { current: null } as any;
    renderView({ currentDisplay: "map" }, {}, ref);
    act(() => ref.current.reset());
    expect(mockTableReset).not.toHaveBeenCalled();
  });
});

describe("SamplesView filtered count", () => {
  it("renders nothing without workflow counts", () => {
    renderView({ totalWorkflowCounts: undefined });
    expect(screen.queryByTestId("filtered-count")).toBeNull();
  });

  it("shows a plain count and no clear-filters button when unfiltered", () => {
    renderView({
      totalWorkflowCounts: { [WorkflowType.SHORT_READ_MNGS]: 5 },
      hasAtLeastOneFilterApplied: false,
    });
    expect(mockLastFilteredCountProps.count).toBe(2);
    expect(mockLastFilteredCountProps.workflowDisplayText).toBe("samples");
    expect(screen.queryByText("Clear Filters")).toBeNull();
  });

  it("shows a numerator/denominator and a clear-filters button when filtered", () => {
    const onClearFilters = jest.fn();
    renderView({
      totalWorkflowCounts: { [WorkflowType.SHORT_READ_MNGS]: 5 },
      hasAtLeastOneFilterApplied: true,
      onClearFilters,
    });
    expect(mockLastFilteredCountProps.count).toEqual({
      numerator: 2,
      denominator: 5,
    });
    fireEvent.click(screen.getByText("Clear Filters"));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it("uses the singular workflow label when exactly one object exists", () => {
    renderView({
      workflow: WorkflowType.AMR,
      totalWorkflowCounts: { [WorkflowType.AMR]: 1 },
    });
    expect(mockLastFilteredCountProps.workflowDisplayText).toBe(
      "antimicrobial resistance",
    );
  });

  it("falls back to a dash when there are no selectable ids", () => {
    renderView({
      selectableIds: undefined,
      totalWorkflowCounts: { [WorkflowType.SHORT_READ_MNGS]: 5 },
      hasAtLeastOneFilterApplied: true,
    });
    expect(mockLastFilteredCountProps.count).toEqual({
      numerator: "-",
      denominator: 5,
    });
  });
});

describe("SamplesView layout and display switching", () => {
  it("hides the toolbar entirely on a snapshot share link", () => {
    renderView({
      snapshotShareId: "abc",
      totalWorkflowCounts: { [WorkflowType.SHORT_READ_MNGS]: 5 },
    });
    expect(screen.queryByTestId("sample-view-actions")).toBeNull();
    expect(screen.queryByTestId("filtered-count")).toBeNull();
    expect(screen.getByTestId("infinite-table")).toBeTruthy();
  });

  it("hides the triggers but keeps the display switcher when hideAllTriggers is set", () => {
    renderView({ hideAllTriggers: true });
    expect(screen.queryByTestId("sample-view-actions")).toBeNull();
    expect(screen.getByTestId("display-toggle")).toBeTruthy();
  });

  it("hides the display switcher for long read mngs", () => {
    renderView({ workflow: WorkflowType.LONG_READ_MNGS });
    expect(screen.queryByTestId("display-toggle")).toBeNull();
  });

  it("offers PLQC only for a project-scoped mNGS view", () => {
    renderView({ projectId: "3" });
    expect(mockLastToggleProps.includePLQC).toBe(true);
    renderView({ projectId: undefined });
    expect(mockLastToggleProps.includePLQC).toBe(false);
  });

  it("delegates and tracks a display switch", () => {
    const onDisplaySwitch = jest.fn();
    renderView({ onDisplaySwitch });
    act(() => mockLastToggleProps.onDisplaySwitch("map"));
    expect(onDisplaySwitch).toHaveBeenCalledWith("map");
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "SamplesView_map-switch_clicked",
    );
  });

  it("wraps the toolbar in a narrow container and renders the map in map display", () => {
    renderView({ currentDisplay: "map", mapLevel: "country" });
    expect(screen.getByTestId("narrow-container")).toBeTruthy();
    expect(screen.getByTestId("discovery-map")).toBeTruthy();
    expect(mockLastDiscoveryMapProps.mapLevel).toBe("country");
    expect(screen.queryByTestId("infinite-table")).toBeNull();
  });

  it("renders quality control in plqc display when a project is set", () => {
    renderView({ currentDisplay: "plqc", projectId: "7" });
    expect(screen.getByTestId("quality-control")).toBeTruthy();
    expect(mockLastQualityControlProps.projectId).toBe("7");
  });

  it("renders nothing in plqc display without a project", () => {
    renderView({ currentDisplay: "plqc", projectId: undefined });
    expect(screen.queryByTestId("quality-control")).toBeNull();
  });

  it("shows the selected counter alongside the triggers", () => {
    renderView();
    expect(screen.getByTestId("selected-counter").textContent).toBe("2");
  });
});

describe("SamplesView per-workflow trigger sets", () => {
  it("renders download and delete only for the AMR tab", () => {
    renderView({
      workflow: WorkflowType.AMR,
      workflowEntity: WORKFLOW_ENTITIES.WORKFLOW_RUNS,
    });
    expect(screen.getByTestId("download-icon")).toBeTruthy();
    expect(screen.getByTestId("bulk-delete-trigger")).toBeTruthy();
    expect(screen.queryByTestId("heatmap-icon")).toBeNull();
    expect(screen.queryByTestId("bulk-actions-menu")).toBeNull();
  });

  it("renders the full mNGS trigger set", () => {
    renderView();
    expect(screen.getByTestId("collection-modal")).toBeTruthy();
    expect(screen.getByTestId("bare-dropdown")).toBeTruthy();
    expect(screen.getByTestId("download-icon")).toBeTruthy();
    expect(screen.getByTestId("bulk-delete-trigger")).toBeTruthy();
    expect(screen.getByTestId("bulk-actions-menu")).toBeTruthy();
  });
});
