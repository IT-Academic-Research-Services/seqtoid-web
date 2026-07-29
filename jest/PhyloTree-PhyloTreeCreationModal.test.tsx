// Coverage: app/assets/src/components/views/PhyloTree/PhyloTreeCreationModal.tsx
//
// PhyloTreeCreationModal is a large wizard container. Rather than driving the
// full multi-page wizard (which pulls in InfiniteTable / vis.js / react-virtualized),
// these tests keep the modal in its pre-load "loading" state (getPhyloTrees is
// left unresolved so phyloTreesLoaded stays false and only the Modal + spinner
// render) and then exercise the container's state-machine + validation methods
// directly through an instance ref. Those methods carry the bulk of this file's
// branches: per-row and select-all selection for both the project and "other"
// sample tables, the taxon/project/tree-name continue guards, sample-count
// validation, tree creation, and the low-coverage / error notification logic.
import { act, render } from "@testing-library/react";
import React from "react";

// ---- API mocks -------------------------------------------------------------
// getPhyloTrees returns a promise that never resolves so componentDidMount's
// loadPhylotrees leaves phyloTreesLoaded === false (spinner state).
const mockCreatePhyloTree = jest.fn(() =>
  Promise.resolve({ phylo_tree_id: 5 }),
);
const mockValidatePhyloTreeName = jest.fn(() =>
  Promise.resolve({ sanitizedName: "clean", valid: true }),
);
const mockShowPhyloTreeNotification = jest.fn();

jest.mock("~/api", () => ({
  __esModule: true,
  getPhyloTrees: jest.fn(() => new Promise(() => {})),
  getNewPhyloTreePipelineRunIds: jest.fn(() => Promise.resolve({})),
  getNewPhyloTreePipelineRunInfo: jest.fn(() =>
    Promise.resolve({ samples: [] }),
  ),
  getProjectsToChooseFrom: jest.fn(() => Promise.resolve([])),
  createPhyloTree: (...args: $TSFixMe[]) => mockCreatePhyloTree(...args),
  validatePhyloTreeName: (...args: $TSFixMe[]) =>
    mockValidatePhyloTreeName(...args),
}));

jest.mock("~/api/analytics", () => ({
  __esModule: true,
  ANALYTICS_EVENT_NAMES: new Proxy({}, { get: (_t, p) => String(p) }),
  trackEventFromClassComponent: jest.fn(),
  withAnalyticsFromClassComponent: (_ctx: $TSFixMe, fn: $TSFixMe) => fn,
}));

jest.mock("~/api/phylo_tree_ngs", () => ({
  __esModule: true,
  chooseTaxon: jest.fn(() => Promise.resolve([])),
}));

jest.mock("~/components/views/PhyloTree/PhyloTreeNotification", () => ({
  __esModule: true,
  showPhyloTreeNotification: (...args: $TSFixMe[]) =>
    mockShowPhyloTreeNotification(...args),
}));

// ---- Heavy child stubs -----------------------------------------------------
jest.mock("~ui/containers/Modal", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => <div data-testid="modal">{props.children}</div>,
}));
jest.mock("~ui/containers/Wizard", () => {
  const ReactLib = require("react");
  const Wizard = (props: $TSFixMe) =>
    ReactLib.createElement("div", { "data-testid": "wizard" }, props.children);
  Wizard.Page = (props: $TSFixMe) =>
    ReactLib.createElement("div", null, props.children);
  Wizard.Action = (props: $TSFixMe) =>
    ReactLib.createElement("div", null, props.children);
  return { __esModule: true, default: Wizard };
});
jest.mock("~/components/visualizations/table/InfiniteTable", () => ({
  __esModule: true,
  default: () => <div data-testid="infinite-table" />,
}));
jest.mock("~/components/visualizations/table/DataTable", () => ({
  __esModule: true,
  default: () => <div data-testid="data-table" />,
}));
jest.mock("~/components/common/ProjectSelect", () => ({
  __esModule: true,
  default: () => <div data-testid="project-select" />,
}));

import PhyloTreeCreationModal from "~/components/views/PhyloTree/PhyloTreeCreationModal";
import { GlobalContext } from "~/globalContext/reducer";

const renderModal = (props: $TSFixMe = {}) => {
  const ref = React.createRef<$TSFixMe>();
  const utils = render(
    <GlobalContext.Provider value={{ discoveryProjectIds: [3, 4] } as $TSFixMe}>
      <PhyloTreeCreationModal
        ref={ref}
        onClose={props.onClose || jest.fn()}
        {...props}
      />
    </GlobalContext.Provider>,
  );
  return { ...utils, ref };
};

const setState = (ref: $TSFixMe, partial: $TSFixMe) =>
  act(() => {
    ref.current.setState(partial);
  });

beforeEach(() => {
  jest.clearAllMocks();
});

describe("PhyloTreeCreationModal loading render", () => {
  it("renders the modal with a spinner while trees are loading", () => {
    const { getByTestId, queryByTestId } = renderModal();
    expect(getByTestId("modal")).toBeTruthy();
    // Wizard is not rendered until phyloTreesLoaded flips true.
    expect(queryByTestId("wizard")).toBeNull();
  });
});

describe("PhyloTreeCreationModal project run selection", () => {
  it("adds and removes a project run, tracking the select-all state", () => {
    const { ref } = renderModal();
    setState(ref, {
      selectableProjectPipelineRuns: new Set([1, 2]),
      selectedProjectPipelineRuns: new Set(),
    });

    act(() => ref.current.handleSelectProjectPipelineRunsRow(1, true));
    expect(ref.current.state.selectedProjectPipelineRuns.has(1)).toBe(true);
    expect(ref.current.state.projectPipelineRunsSelectAllChecked).toBe(false);

    // Selecting the second makes the selection size match selectable -> all checked.
    act(() => ref.current.handleSelectProjectPipelineRunsRow(2, true));
    expect(ref.current.state.projectPipelineRunsSelectAllChecked).toBe(true);

    // Unchecking removes it again.
    act(() => ref.current.handleSelectProjectPipelineRunsRow(1, false));
    expect(ref.current.state.selectedProjectPipelineRuns.has(1)).toBe(false);
    expect(ref.current.state.projectPipelineRunsSelectAllChecked).toBe(false);
  });

  it("select-all copies the selectable set, and clears it when unchecked", () => {
    const { ref } = renderModal();
    setState(ref, { selectableProjectPipelineRuns: new Set([1, 2, 3]) });

    act(() => ref.current.handleSelectAllProjectPipelineRuns(true));
    expect([...ref.current.state.selectedProjectPipelineRuns]).toEqual([
      1, 2, 3,
    ]);
    expect(ref.current.state.projectPipelineRunsSelectAllChecked).toBe(true);

    act(() => ref.current.handleSelectAllProjectPipelineRuns(false));
    expect(ref.current.state.selectedProjectPipelineRuns.size).toBe(0);
    expect(ref.current.state.projectPipelineRunsSelectAllChecked).toBe(false);
  });
});

describe("PhyloTreeCreationModal other run selection", () => {
  it("adds/removes an other run and tracks its select-all state", () => {
    const { ref } = renderModal();
    setState(ref, {
      otherPipelineRunIds: new Set([10]),
      selectedOtherPipelineRuns: new Set(),
    });

    act(() => ref.current.handleSelectOtherPipelineRunsRow(10, true));
    expect(ref.current.state.selectedOtherPipelineRuns.has(10)).toBe(true);
    expect(ref.current.state.otherPipelineRunsSelectAllChecked).toBe(true);

    act(() => ref.current.handleSelectOtherPipelineRunsRow(10, false));
    expect(ref.current.state.selectedOtherPipelineRuns.has(10)).toBe(false);
    expect(ref.current.state.otherPipelineRunsSelectAllChecked).toBe(false);
  });

  it("select-all other runs copies then clears the id set", () => {
    const { ref } = renderModal();
    setState(ref, { otherPipelineRunIds: new Set([7, 8]) });

    act(() => ref.current.handleSelectAllOtherPipelineRuns(true));
    expect([...ref.current.state.selectedOtherPipelineRuns]).toEqual([7, 8]);

    act(() => ref.current.handleSelectAllOtherPipelineRuns(false));
    expect(ref.current.state.selectedOtherPipelineRuns.size).toBe(0);
  });
});

describe("PhyloTreeCreationModal continue guards", () => {
  it("allows continuing when both a taxon and project are chosen", () => {
    const { ref } = renderModal();
    setState(ref, { taxonId: 1, projectId: 2 });
    let result: boolean;
    act(() => {
      result = ref.current.canContinueWithTaxonAndProject();
    });
    expect(result!).toBe(true);
    expect(ref.current.state.showErrorTaxonAndProject).toBe(false);
  });

  it("blocks and flags an error when taxon/project are missing", () => {
    const { ref } = renderModal();
    setState(ref, { taxonId: null, projectId: null });
    let result: boolean;
    act(() => {
      result = ref.current.canContinueWithTaxonAndProject();
    });
    expect(result!).toBe(false);
    expect(ref.current.state.showErrorTaxonAndProject).toBe(true);
  });

  it("validates the tree name via the API when continuing", async () => {
    const { ref } = renderModal();
    let result: $TSFixMe;
    await act(async () => {
      result = await ref.current.canContinueWithTreeName();
    });
    expect(mockValidatePhyloTreeName).toHaveBeenCalled();
    expect(result).toBe(true);
    expect(ref.current.state.showErrorName).toBe(true);
    expect(ref.current.state.treeName).toBe("clean");
  });
});

describe("PhyloTreeCreationModal sample-count validation", () => {
  it("is valid at four selected samples and invalid below", () => {
    const { ref } = renderModal();
    setState(ref, {
      selectedProjectPipelineRuns: new Set([1, 2, 3]),
      selectedOtherPipelineRuns: new Set([4]),
    });
    expect(ref.current.isNumberOfSamplesValid()).toBe(true);
    expect(ref.current.getTotalPageRendering()).toBe("4 Total Samples");

    setState(ref, {
      selectedProjectPipelineRuns: new Set([1]),
      selectedOtherPipelineRuns: new Set(),
    });
    expect(ref.current.isNumberOfSamplesValid()).toBe(false);
  });
});

describe("PhyloTreeCreationModal handleCreation", () => {
  it("flags a sample error and does not create with too few samples", () => {
    const { ref } = renderModal();
    setState(ref, {
      selectedProjectPipelineRuns: new Set([1]),
      selectedOtherPipelineRuns: new Set(),
    });
    let created: boolean;
    act(() => {
      created = ref.current.handleCreation();
    });
    expect(created!).toBe(false);
    expect(ref.current.state.showErrorSamples).toBe(true);
    expect(mockCreatePhyloTree).not.toHaveBeenCalled();
  });

  it("creates a tree with a valid sample count", async () => {
    const onClose = jest.fn();
    const { ref } = renderModal({ onClose });
    setState(ref, {
      treeName: "myTree",
      projectId: 2,
      taxonId: 9,
      selectedProjectPipelineRuns: new Set([1, 2, 3]),
      selectedOtherPipelineRuns: new Set([4]),
    });
    let created: boolean;
    await act(async () => {
      created = ref.current.handleCreation();
    });
    expect(created!).toBe(true);
    expect(mockCreatePhyloTree).toHaveBeenCalledWith({
      treeName: "myTree",
      projectId: 2,
      taxId: 9,
      pipelineRunIds: [1, 2, 3, 4],
    });
    expect(mockShowPhyloTreeNotification).toHaveBeenCalled();
  });
});

describe("PhyloTreeCreationModal name + taxon input", () => {
  it("trims the tree name on change", () => {
    const { ref } = renderModal();
    act(() => ref.current.handleNameChange("  spaced  "));
    expect(ref.current.state.treeName).toBe("spaced");
  });

  it("resets the taxon list for an empty query", async () => {
    const { ref } = renderModal();
    setState(ref, { taxonQuery: "" });
    await act(async () => {
      await ref.current.handleTaxonSearchAction();
    });
    expect(ref.current.state.taxonList).toEqual([]);
    expect(ref.current.state.taxonId).toBeNull();
  });
});

describe("PhyloTreeCreationModal notifications", () => {
  it("shows a taken-name error notification", () => {
    const { ref } = renderModal();
    setState(ref, {
      showErrorName: true,
      treeNameValid: false,
      treeName: "dup",
    });
    let node: $TSFixMe;
    act(() => {
      node = ref.current.renderNotifications();
    });
    expect(node.props.type).toBe("error");
  });

  it("shows a sample-count error notification", () => {
    const { ref } = renderModal();
    setState(ref, {
      showErrorSamples: true,
      selectedProjectPipelineRuns: new Set([1]),
      selectedOtherPipelineRuns: new Set(),
    });
    let node: $TSFixMe;
    act(() => {
      node = ref.current.renderNotifications();
    });
    expect(node.props.type).toBe("error");
  });

  it("shows a low-coverage warning when a selected run is under the threshold", () => {
    const { ref } = renderModal({ minCoverageBreadth: 25 });
    setState(ref, {
      selectedProjectPipelineRuns: new Set([1]),
      selectedOtherPipelineRuns: new Set(),
      projectCoverageBreadths: { 1: 0.1 }, // 10% < 25%
    });
    let node: $TSFixMe;
    act(() => {
      node = ref.current.renderNotifications();
    });
    expect(node.props.type).toBe("warning");
  });

  it("returns no notification when nothing is wrong", () => {
    const { ref } = renderModal();
    setState(ref, {
      selectedProjectPipelineRuns: new Set([1, 2, 3, 4]),
      selectedOtherPipelineRuns: new Set(),
      projectCoverageBreadths: { 1: 0.9 },
    });
    let node: $TSFixMe;
    act(() => {
      node = ref.current.renderNotifications();
    });
    expect(node).toBeNull();
  });
});

describe("PhyloTreeCreationModal parsePhyloTreeData", () => {
  it("returns an empty array for empty input", () => {
    const { ref } = renderModal();
    expect(ref.current.parsePhyloTreeData([])).toEqual([]);
  });

  it("maps ng and legacy trees to view rows", () => {
    const { ref } = renderModal();
    const rows = ref.current.parsePhyloTreeData([
      { id: 1, name: "NG Tree", nextGeneration: true, user: { name: "Ann" } },
      { id: 2, name: "Old Tree", nextGeneration: false, user: { name: "Bob" } },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe("NG Tree");
    expect(rows[0].user).toBe("Ann");
    expect(rows[1].name).toBe("Old Tree");
  });
});
