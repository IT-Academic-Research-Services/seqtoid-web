// Branch coverage: app/assets/src/components/views/PhyloTree/PhyloTreeListView.tsx
//
// Supplements views-PhyloTree-PhyloTreeListView.test.tsx and
// views-PhyloTree-PhyloTreeListView-edges.test.tsx with the conditional legs
// neither of them reaches:
//   * handleTreeChange's `nextGeneration = false` default parameter (the
//     dropdown hands it `undefined` when a tree record omits the flag),
//   * the `currentTree.taxid || currentTree.tax_id` fallback and the matching
//     `tax_id === sidebarConfig.taxonId` half of the taxon-sidebar toggle,
//   * every case of the getTreeStatus switch other than `default`,
//   * the `currentTree ? ... : false` guard in renderVisualization,
//   * the `showOldTreeWarning ? cs.show : cs.hide` class ternary.
// The last three are only reachable on the class instance: the render path
// guards them out (render bails on a null tree, and renderOldTreeWarning is
// only called while the warning is showing), so they are exercised directly.
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

jest.mock("~/components/common/SampleMessage/sample_message.scss", () => ({}), {
  virtual: true,
});

// jest.config maps every relative *.scss import to this stub, which exports an
// empty object -- that makes class-name ternaries unobservable (both legs
// produce ""). Swap in an identity map so `cs.show` / `cs.hide` are real,
// distinguishable strings. `__esModule` must stay undefined, otherwise babel's
// interop would hand the component the string "default" instead of the map.
jest.mock(
  "./__mocks__/styleMock",
  () =>
    new Proxy(
      {},
      {
        get: (_target, prop) =>
          typeof prop === "string" && prop !== "__esModule" ? prop : undefined,
      },
    ),
);

const mockGetPhyloTree = jest.fn();
const mockGetPhyloTrees = jest.fn();
jest.mock("~/api", () => ({
  getPhyloTree: (...a: unknown[]) => mockGetPhyloTree(...a),
  getPhyloTrees: (...a: unknown[]) => mockGetPhyloTrees(...a),
  retryPhyloTree: jest.fn(),
  saveVisualization: jest.fn(),
}));

const mockGetPhyloTreeNg = jest.fn();
jest.mock("~/api/phylo_tree_ngs", () => ({
  getPhyloTreeNg: (...a: unknown[]) => mockGetPhyloTreeNg(...a),
  rerunPhyloTreeNg: jest.fn(),
}));

jest.mock("~/api/analytics", () => ({
  ...jest.requireActual("~/api/analytics"),
  useWithAnalytics: () => jest.fn(),
  useTrackEvent: () => jest.fn(),
  withAnalytics: (fn: $TSFixMe) => fn,
  trackEvent: jest.fn(),
}));

jest.mock("~/components/views/PhyloTree/PhyloTreeVis", () => ({
  __esModule: true,
  default: () => <div data-testid="phylo-tree-vis" />,
}));

jest.mock("~/components/views/PhyloTree/PhyloTreeDownloadButton", () => ({
  __esModule: true,
  default: () => <div data-testid="phylo-tree-download" />,
}));

jest.mock(
  "~/components/views/PhyloTree/PairwiseDistanceMatrixErrorModal",
  () => ({
    __esModule: true,
    default: () => <div data-testid="matrix-error-modal" />,
  }),
);

let sidebarProps: $TSFixMe = null;
jest.mock("~/components/common/DetailsSidebar", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => {
    sidebarProps = props;
    return (
      <div
        data-testid="details-sidebar"
        data-visible={String(props.visible)}
        data-mode={String(props.mode)}
      />
    );
  },
}));

import { UserContext } from "~/components/common/UserContext";
import PhyloTreeListView from "~/components/views/PhyloTree/PhyloTreeListView";

const IN_PROGRESS_MESSAGE = "Computation in progress. Please check back later!";
const UNAVAILABLE_MESSAGE = "Tree unavailable!";

const NG_TREE = {
  id: 5,
  name: "NG Tree",
  tax_name: "Klebsiella",
  // No `taxid` on purpose: this tree only carries the legacy `tax_id` key, so
  // the sidebar has to fall back to it.
  tax_id: 999,
  parent_taxid: 100,
  status: "SUCCEEDED",
  nextGeneration: true,
  newick: "(a:0.1,b:0.2);",
  log_url: "https://logs.example/5",
  sampleDetailsByNodeName: {},
};

const renderView = (props: $TSFixMe = {}) =>
  render(
    <UserContext.Provider value={{ admin: false } as $TSFixMe}>
      <PhyloTreeListView {...props} />
    </UserContext.Provider>,
  );

// The class component sits behind a hooks wrapper that does not forward refs,
// so the instance is picked up off the React fiber of a node it rendered.
const getInstance = (): $TSFixMe => {
  const host = screen.getByTestId("details-sidebar") as $TSFixMe;
  const fiberKey = Object.keys(host).find(k => k.startsWith("__reactFiber$"));
  expect(fiberKey).toBeDefined();
  let fiber = host[fiberKey as string];
  while (
    fiber &&
    !(fiber.stateNode && typeof fiber.stateNode.getTreeStatus === "function")
  ) {
    fiber = fiber.return;
  }
  expect(fiber).toBeTruthy();
  return fiber.stateNode;
};

describe("PhyloTreeListView branch coverage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sidebarProps = null;
    window.sessionStorage.clear();
    window.history.replaceState({}, "", "/phylo_tree_ngs/5");
    mockGetPhyloTrees.mockResolvedValue({ phyloTrees: [] });
    mockGetPhyloTreeNg.mockResolvedValue(NG_TREE);
    mockGetPhyloTree.mockResolvedValue({ ...NG_TREE, nextGeneration: false });
  });

  it("treats a dropdown tree with no nextGeneration flag as a legacy tree", async () => {
    // Neither record carries `nextGeneration`, so the dropdown calls
    // handleTreeChange(id, undefined) and the default parameter kicks in.
    const trees = [
      { id: 7, name: "Old Tree" },
      { id: 9, name: "Second Old Tree" },
    ];
    renderView({ phyloTrees: trees });
    await waitFor(() => expect(mockGetPhyloTree).toHaveBeenCalledWith(7));
    await screen.findByTestId("phylo-tree-vis");

    fireEvent.click(screen.getByText("Old Tree"));
    fireEvent.click(await screen.findByText("Second Old Tree"));

    await waitFor(() => expect(mockGetPhyloTree).toHaveBeenCalledWith(9));
    // The legacy path, not the next-generation one: session storage and the
    // /phylo_trees URL are only written by the `else` half of handleTreeChange.
    expect(mockGetPhyloTreeNg).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem("treeId")).toBe("9");
    expect(window.location.pathname + window.location.search).toBe(
      "/phylo_trees/index?treeId=9",
    );
  });

  it("falls back to tax_id for the taxon sidebar and toggles it closed again", async () => {
    renderView({ selectedPhyloTreeNgId: 5 });
    await screen.findByTestId("phylo-tree-vis");

    fireEvent.click(screen.getByText("Klebsiella"));
    await waitFor(() =>
      expect(screen.getByTestId("details-sidebar").dataset.visible).toBe(
        "true",
      ),
    );
    // `taxid` is absent, so the config is built from `tax_id`.
    expect(sidebarProps.params).toEqual({
      parentTaxonId: 100,
      taxonId: 999,
      taxonName: "Klebsiella",
    });

    // Re-clicking has to recognise the open sidebar through the `tax_id`
    // comparison as well (the `taxid` comparison is false here) and close it.
    fireEvent.click(screen.getByText("Klebsiella"));
    await waitFor(() =>
      expect(screen.getByTestId("details-sidebar").dataset.visible).toBe(
        "false",
      ),
    );
  });

  it("maps every queued or running status to the in-progress banner text", async () => {
    renderView({ selectedPhyloTreeNgId: 5 });
    await screen.findByTestId("phylo-tree-vis");
    const instance = getInstance();

    // NG_STATUS_CREATED / NG_STATUS_RUNNING and the legacy numeric
    // STATUS_IN_PROGRESS / STATUS_INITIALIZED all fall through to the same arm.
    expect(instance.getTreeStatus("CREATED")).toBe(IN_PROGRESS_MESSAGE);
    expect(instance.getTreeStatus("RUNNING")).toBe(IN_PROGRESS_MESSAGE);
    expect(instance.getTreeStatus(3)).toBe(IN_PROGRESS_MESSAGE);
    expect(instance.getTreeStatus(0)).toBe(IN_PROGRESS_MESSAGE);
    // Anything else, including a succeeded or missing status, is "unavailable".
    expect(instance.getTreeStatus("SUCCEEDED")).toBe(UNAVAILABLE_MESSAGE);
    expect(instance.getTreeStatus(undefined)).toBe(UNAVAILABLE_MESSAGE);
    // The switch matches on identity, so the numeric statuses are not
    // interchangeable with their string forms.
    expect(instance.getTreeStatus("3")).toBe(UNAVAILABLE_MESSAGE);
  });

  it("reports no clustermap for a missing tree, then dereferences it anyway", async () => {
    renderView({ selectedPhyloTreeNgId: 5 });
    await screen.findByTestId("phylo-tree-vis");
    const instance = getInstance();

    act(() => instance.setState({ currentTree: null }));
    // render() bails out before the visualization once the tree is gone.
    expect(screen.queryByTestId("phylo-tree-vis")).toBeNull();
    // Which makes renderVisualization's `currentTree ? ... : false` guard
    // vestigial: it takes the false leg and the next line still dereferences
    // the missing tree.
    expect(() => instance.renderVisualization()).toThrow(TypeError);
  });

  it("swaps the notification class when the old-tree warning is dismissed", async () => {
    renderView({ selectedPhyloTreeNgId: 5 });
    await screen.findByTestId("phylo-tree-vis");
    const instance = getInstance();

    act(() => instance.setState({ showOldTreeWarning: true }));
    const shown = instance.renderOldTreeWarning();
    expect(shown.props.className).toContain("show");
    expect(shown.props.className).not.toContain("hide");

    act(() => instance.setState({ showOldTreeWarning: false }));
    const hidden = instance.renderOldTreeWarning();
    expect(hidden.props.className).toContain("hide");
    expect(hidden.props.className).not.toContain("show");
    // Both variants keep the base notification class and the dismiss handler.
    expect(hidden.props.className).toContain("notification");
    expect(hidden.props.onClose).toBe(instance.hideOldTreeWarning);
  });
});
