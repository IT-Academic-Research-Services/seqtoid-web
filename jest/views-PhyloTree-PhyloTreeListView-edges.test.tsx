// Coverage: app/assets/src/components/views/PhyloTree/PhyloTreeListView.tsx
//
// Supplements views-PhyloTree-PhyloTreeListView.test.tsx with the paths that
// spec leaves untouched: the remaining in-progress status codes, the legacy
// READY download button, the tree-container callback, the sidebar close button
// and the URL-persistence failure branch.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

jest.mock("~/components/common/SampleMessage/sample_message.scss", () => ({}), {
  virtual: true,
});

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

let visProps: $TSFixMe = null;
jest.mock("~/components/views/PhyloTree/PhyloTreeVis", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => {
    visProps = props;
    return <div data-testid="phylo-tree-vis" />;
  },
}));

let downloadProps: $TSFixMe = null;
jest.mock("~/components/views/PhyloTree/PhyloTreeDownloadButton", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => {
    downloadProps = props;
    return (
      <div
        data-testid="phylo-tree-download"
        data-ng={String(props.showPhyloTreeNgOptions)}
      />
    );
  },
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
      <div data-testid="details-sidebar" data-visible={String(props.visible)}>
        <button data-testid="sidebar-close" onClick={props.onClose} />
      </div>
    );
  },
}));

import { UserContext } from "~/components/common/UserContext";
import PhyloTreeListView from "~/components/views/PhyloTree/PhyloTreeListView";

const TREE = {
  id: 5,
  name: "NG Tree",
  tax_name: "Klebsiella",
  taxid: 570,
  parent_taxid: 100,
  status: "SUCCEEDED",
  nextGeneration: true,
  newick: "(a:0.1,b:0.2);",
  sampleDetailsByNodeName: {
    a: { sample_id: 1, pipeline_run_id: 11, metadata: {} },
  },
};

const renderView = (props: $TSFixMe = {}) =>
  render(
    <UserContext.Provider value={{ admin: false } as $TSFixMe}>
      <PhyloTreeListView {...props} />
    </UserContext.Provider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  visProps = null;
  sidebarProps = null;
  downloadProps = null;
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/phylo_tree_ngs/5");
  mockGetPhyloTrees.mockResolvedValue({ phyloTrees: [] });
  mockGetPhyloTreeNg.mockResolvedValue(TREE);
  mockGetPhyloTree.mockResolvedValue({ ...TREE, nextGeneration: false });
});

describe("PhyloTreeListView remaining status codes", () => {
  it("treats the next-generation CREATED status as in progress", async () => {
    mockGetPhyloTreeNg.mockResolvedValue({
      ...TREE,
      newick: undefined,
      status: "CREATED",
    });
    renderView({ selectedPhyloTreeNgId: 5 });

    expect(await screen.findByText("Generating Tree")).toBeTruthy();
    expect(screen.queryByText("Tree unavailable!")).toBeNull();
  });

  it("treats the legacy INITIALIZED (0) status as in progress", async () => {
    mockGetPhyloTreeNg.mockResolvedValue({
      ...TREE,
      newick: undefined,
      status: 0,
    });
    renderView({ selectedPhyloTreeNgId: 5 });

    expect(await screen.findByText("Generating Tree")).toBeTruthy();
  });

  it("shows the download button for a legacy READY (1) tree without NG options", async () => {
    mockGetPhyloTree.mockResolvedValue({
      ...TREE,
      id: 7,
      status: 1,
      nextGeneration: false,
    });
    renderView({ phyloTrees: [{ id: 7, name: "Old", nextGeneration: false }] });

    await screen.findByTestId("phylo-tree-vis");
    const button = await screen.findByTestId("phylo-tree-download");
    // Legacy trees are not selected by an NG id, so NG options stay off.
    expect(button.dataset.ng).toBe("false");
  });
});

describe("PhyloTreeListView container + sidebar plumbing", () => {
  it("passes the rendered tree container through to the download button", async () => {
    renderView({ selectedPhyloTreeNgId: 5 });
    await screen.findByTestId("phylo-tree-vis");
    await waitFor(() => expect(visProps).not.toBeNull());

    // Before the visualization reports its container there is nothing to pass.
    expect(downloadProps.treeContainer).toBeNull();

    const container = document.createElement("div");
    visProps.onNewTreeContainer(container);
    await waitFor(() => expect(downloadProps.treeContainer).toBe(container));
  });

  it("closes the sidebar from its own close control", async () => {
    renderView({ selectedPhyloTreeNgId: 5 });
    await screen.findByTestId("phylo-tree-vis");
    await waitFor(() => expect(visProps).not.toBeNull());

    visProps.onSampleNodeClick(1, 11);
    await waitFor(() => expect(sidebarProps.visible).toBe(true));

    fireEvent.click(screen.getByTestId("sidebar-close"));
    await waitFor(() =>
      expect(screen.getByTestId("details-sidebar").dataset.visible).toBe(
        "false",
      ),
    );
  });

  it("logs and carries on when the URL cannot be rewritten", async () => {
    renderView({ selectedPhyloTreeNgId: 5 });
    await screen.findByTestId("phylo-tree-vis");
    await waitFor(() => expect(visProps).not.toBeNull());

    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const replaceSpy = jest
      .spyOn(window.history, "replaceState")
      .mockImplementation(() => {
        throw new Error("blocked");
      });

    expect(() =>
      visProps.afterSelectedMetadataChange("collection_location"),
    ).not.toThrow();
    expect(errorSpy).toHaveBeenCalled();

    replaceSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
