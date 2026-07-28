// Coverage for app/assets/src/components/views/PhyloTree/PhyloTreeListView.tsx
//
// The view is a class component behind a hooks wrapper, so it is driven through
// the DOM plus the callbacks it hands down to PhyloTreeVis (which is stubbed --
// the real one owns a D3 dendrogram). Every branch of renderVisualization is
// exercised, along with the sidebar toggles, admin panel, share/save controls
// and the old-vs-next-generation tree loading paths.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// jest.config maps the webpack "~" alias before the css/scss rule, so a
// "~/...scss" import escapes the style mock and jest tries to parse the SCSS.
jest.mock("~/components/common/SampleMessage/sample_message.scss", () => ({}), {
  virtual: true,
});

const mockGetPhyloTree = jest.fn();
const mockGetPhyloTrees = jest.fn();
const mockRetryPhyloTree = jest.fn();
const mockSaveVisualization = jest.fn();
jest.mock("~/api", () => ({
  getPhyloTree: (...a: unknown[]) => mockGetPhyloTree(...a),
  getPhyloTrees: (...a: unknown[]) => mockGetPhyloTrees(...a),
  retryPhyloTree: (...a: unknown[]) => mockRetryPhyloTree(...a),
  saveVisualization: (...a: unknown[]) => mockSaveVisualization(...a),
}));

const mockGetPhyloTreeNg = jest.fn();
const mockRerunPhyloTreeNg = jest.fn();
jest.mock("~/api/phylo_tree_ngs", () => ({
  getPhyloTreeNg: (...a: unknown[]) => mockGetPhyloTreeNg(...a),
  rerunPhyloTreeNg: (...a: unknown[]) => mockRerunPhyloTreeNg(...a),
}));

jest.mock("~/api/analytics", () => ({
  ...jest.requireActual("~/api/analytics"),
  useWithAnalytics: () => jest.fn(),
  useTrackEvent: () => jest.fn(),
  withAnalytics: (fn: $TSFixMe) => fn,
  trackEvent: jest.fn(),
}));

const mockCopyShortUrlToClipboard = jest.fn();
jest.mock("~/helpers/url", () => {
  const actual = jest.requireActual("~/helpers/url");
  return {
    ...actual,
    copyShortUrlToClipboard: (...a: unknown[]) =>
      mockCopyShortUrlToClipboard(...a),
  };
});

// Captured props from the stubbed visualization, so the callbacks the class
// hands down can be invoked directly.
let visProps: $TSFixMe = null;
jest.mock("~/components/views/PhyloTree/PhyloTreeVis", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => {
    visProps = props;
    return <div data-testid="phylo-tree-vis">{props.newick}</div>;
  },
}));

jest.mock("~/components/views/PhyloTree/PhyloTreeDownloadButton", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => (
    <div
      data-testid="phylo-tree-download"
      data-ng={String(props.showPhyloTreeNgOptions)}
    />
  ),
}));

jest.mock(
  "~/components/views/PhyloTree/PairwiseDistanceMatrixErrorModal",
  () => ({
    __esModule: true,
    default: (props: $TSFixMe) => (
      <div
        data-testid="matrix-error-modal"
        data-low-coverage={String(props.showLowCoverageWarning)}
      >
        <button onClick={props.onContinue}>Continue</button>
      </div>
    ),
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

const NG_TREE = {
  id: 5,
  name: "NG Tree",
  tax_name: "Klebsiella",
  taxid: 570,
  parent_taxid: 100,
  status: "SUCCEEDED",
  nextGeneration: true,
  newick: "(a:0.1,b:0.2);",
  log_url: "https://logs.example/5",
  sampleDetailsByNodeName: {
    a: { sample_id: 1, pipeline_run_id: 11, metadata: {} },
    b: { sample_id: 2, pipeline_run_id: 22, metadata: {} },
    ncbi: { metadata: {} },
  },
};

const renderView = (props: $TSFixMe = {}, isAdmin = false) =>
  render(
    <UserContext.Provider value={{ admin: isAdmin } as $TSFixMe}>
      <PhyloTreeListView {...props} />
    </UserContext.Provider>,
  );

describe("PhyloTreeListView", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    visProps = null;
    sidebarProps = null;
    window.sessionStorage.clear();
    window.history.replaceState({}, "", "/phylo_tree_ngs/5");
    mockGetPhyloTrees.mockResolvedValue({ phyloTrees: [] });
    mockGetPhyloTreeNg.mockResolvedValue(NG_TREE);
    mockGetPhyloTree.mockResolvedValue({ ...NG_TREE, nextGeneration: false });
  });

  it("shows the empty banner when there is no tree to display", async () => {
    renderView();
    expect(screen.getByText(/No phylogenetic trees were found/)).toBeTruthy();
    expect(mockGetPhyloTreeNg).not.toHaveBeenCalled();
    // The dropdown list is still populated in the background.
    await waitFor(() => expect(mockGetPhyloTrees).toHaveBeenCalledTimes(2));
  });

  it("loads a next-generation tree, renders the visualization and hides the old-tree warning", async () => {
    const replaceSpy = jest.spyOn(window.history, "replaceState");
    renderView({ selectedPhyloTreeNgId: 5 });

    await screen.findByTestId("phylo-tree-vis");
    expect(mockGetPhyloTreeNg).toHaveBeenCalledWith(5);
    expect(screen.getByTestId("phylo-tree-vis").textContent).toBe(
      "(a:0.1,b:0.2);",
    );
    // No clustermap on this tree -> matrix=false in the URL.
    expect(replaceSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "/phylo_tree_ngs/5?matrix=false",
    );
    expect(
      screen.queryByText(/previous version of our phylogenetic/),
    ).toBeNull();
    // SUCCEEDED status -> the download button appears with NG options on.
    expect(screen.getByTestId("phylo-tree-download").dataset.ng).toBe("true");
    // NG trees get the tools attribution banner, including IQTree.
    expect(screen.getByText("SKA v1.0")).toBeTruthy();
    expect(screen.getByText("IQTree v1.6.1")).toBeTruthy();
    replaceSpy.mockRestore();
  });

  it("renders the pairwise distance matrix image and error modal when there is no newick", async () => {
    mockGetPhyloTreeNg.mockResolvedValue({
      ...NG_TREE,
      newick: undefined,
      clustermap_svg_url: "https://example.com/matrix.svg",
      has_low_coverage: true,
    });
    renderView({ selectedPhyloTreeNgId: 5 });

    const img = (await screen.findByAltText(
      "Pairwise distance matrix",
    )) as HTMLImageElement;
    expect(img.src).toBe("https://example.com/matrix.svg");
    const modal = screen.getByTestId("matrix-error-modal");
    expect(modal.dataset.lowCoverage).toBe("true");
    // Matrix-only trees drop the IQTree half of the attribution banner.
    expect(screen.queryByText("IQTree v1.6.1")).toBeNull();

    fireEvent.click(screen.getByText("Continue"));
    await waitFor(() =>
      expect(screen.queryByTestId("matrix-error-modal")).toBeNull(),
    );
  });

  it("renders the failure message for a FAILED tree", async () => {
    mockGetPhyloTreeNg.mockResolvedValue({
      ...NG_TREE,
      newick: undefined,
      status: "FAILED",
    });
    renderView({ selectedPhyloTreeNgId: 5 });

    expect(await screen.findByText("Tree Failed")).toBeTruthy();
    expect(
      screen.getByText("Sorry, we were unable to compute a phylogenetic tree."),
    ).toBeTruthy();
    // Not SUCCEEDED -> no download button.
    expect(screen.queryByTestId("phylo-tree-download")).toBeNull();
  });

  it("renders the in-progress message for a RUNNING tree", async () => {
    mockGetPhyloTreeNg.mockResolvedValue({
      ...NG_TREE,
      newick: undefined,
      status: "RUNNING",
    });
    renderView({ selectedPhyloTreeNgId: 5 });

    expect(await screen.findByText("Generating Tree")).toBeTruthy();
    expect(screen.getByText("Your tree is being created.")).toBeTruthy();
  });

  it("falls back to the plain status banner for an unrecognised status", async () => {
    mockGetPhyloTreeNg.mockResolvedValue({
      ...NG_TREE,
      newick: undefined,
      status: "MYSTERY",
    });
    renderView({ selectedPhyloTreeNgId: 5 });

    expect(await screen.findByText("Tree unavailable!")).toBeTruthy();
  });

  it("uses the in-progress banner text for legacy numeric statuses", async () => {
    mockGetPhyloTreeNg.mockResolvedValue({
      ...NG_TREE,
      newick: undefined,
      clustermap_svg_url: undefined,
      status: 3, // STATUS_IN_PROGRESS
    });
    renderView({ selectedPhyloTreeNgId: 5 });

    expect(await screen.findByText("Generating Tree")).toBeTruthy();
  });

  it("shows and dismisses the old-tree warning for a legacy tree", async () => {
    const trees = [{ id: 7, name: "Old Tree", nextGeneration: false }];
    renderView({ phyloTrees: trees });

    await waitFor(() => expect(mockGetPhyloTree).toHaveBeenCalledWith(7));
    const warning = await screen.findByText(
      /previous version of our phylogenetic/,
    );
    expect(warning).toBeTruthy();
    // Legacy trees do not get the SKA/IQTree attribution banner.
    expect(screen.queryByText("SKA v1.0")).toBeNull();

    const closeIcon = screen.getByTestId("x-close-icon");
    fireEvent.click(closeIcon);
    await waitFor(() =>
      expect(
        screen.queryByText(/previous version of our phylogenetic/),
      ).toBeNull(),
    );
  });

  it("prefers the tree id from sessionStorage when it exists in the list", async () => {
    window.sessionStorage.setItem("treeId", "8");
    const trees = [
      { id: 7, name: "Old Tree", nextGeneration: false },
      { id: 8, name: "Other Old Tree", nextGeneration: false },
    ];
    renderView({ phyloTrees: trees });
    await waitFor(() => expect(mockGetPhyloTree).toHaveBeenCalledWith(8));
  });

  it("falls back to the first tree when the stored id is not in the list", async () => {
    window.sessionStorage.setItem("treeId", "999");
    const trees = [{ id: 7, name: "Old Tree", nextGeneration: false }];
    renderView({ phyloTrees: trees });
    await waitFor(() => expect(mockGetPhyloTree).toHaveBeenCalledWith(7));
  });

  it("copies a short url when Share is clicked", async () => {
    renderView({ selectedPhyloTreeNgId: 5 });
    await screen.findByTestId("phylo-tree-vis");

    fireEvent.click(screen.getByText("Share"));
    await waitFor(() => expect(mockCopyShortUrlToClipboard).toHaveBeenCalled());
  });

  it("saves the visualization with the de-duplicated sample ids", async () => {
    renderView({ selectedPhyloTreeNgId: 5 });
    await screen.findByTestId("phylo-tree-vis");

    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(mockSaveVisualization).toHaveBeenCalled());
    const [type, params] = mockSaveVisualization.mock.calls[0];
    expect(type).toBe("phylo_tree");
    // Nodes without a sample_id (NCBI references) are filtered out.
    expect([...params.sampleIds]).toEqual([1, 2]);
  });

  it("toggles the taxon details sidebar from the taxon name", async () => {
    renderView({ selectedPhyloTreeNgId: 5 });
    await screen.findByTestId("phylo-tree-vis");

    expect(screen.getByTestId("details-sidebar").dataset.visible).toBe("false");

    fireEvent.click(screen.getByText("Klebsiella"));
    await waitFor(() =>
      expect(screen.getByTestId("details-sidebar").dataset.visible).toBe(
        "true",
      ),
    );
    expect(sidebarProps.mode).toBe("taxonDetails");
    expect(sidebarProps.params).toEqual({
      parentTaxonId: 100,
      taxonId: 570,
      taxonName: "Klebsiella",
    });

    // Clicking the same taxon again closes the sidebar.
    fireEvent.click(screen.getByText("Klebsiella"));
    await waitFor(() =>
      expect(screen.getByTestId("details-sidebar").dataset.visible).toBe(
        "false",
      ),
    );
  });

  it("opens the sample details sidebar from a node click and closes it on re-click", async () => {
    renderView({ selectedPhyloTreeNgId: 5 });
    await screen.findByTestId("phylo-tree-vis");

    await waitFor(() => expect(visProps).not.toBeNull());
    visProps.onSampleNodeClick(1, 11);
    await waitFor(() => expect(sidebarProps.mode).toBe("sampleDetails"));
    expect(sidebarProps.visible).toBe(true);
    expect(sidebarProps.params.sampleId).toBe(1);
    expect(sidebarProps.params.showReportLink).toBe(true);

    visProps.onSampleNodeClick(1, 11);
    await waitFor(() => expect(sidebarProps.visible).toBe(false));
  });

  it("switches the sidebar to a different sample rather than closing it", async () => {
    renderView({ selectedPhyloTreeNgId: 5 });
    await screen.findByTestId("phylo-tree-vis");
    await waitFor(() => expect(visProps).not.toBeNull());

    visProps.onSampleNodeClick(1, 11);
    await waitFor(() => expect(sidebarProps.visible).toBe(true));
    visProps.onSampleNodeClick(2, 22);
    await waitFor(() => expect(sidebarProps.params.sampleId).toBe(2));
    expect(sidebarProps.visible).toBe(true);
  });

  it("closes the sidebar when a node click carries no sample id", async () => {
    renderView({ selectedPhyloTreeNgId: 5 });
    await screen.findByTestId("phylo-tree-vis");
    await waitFor(() => expect(visProps).not.toBeNull());

    visProps.onSampleNodeClick(1, 11);
    await waitFor(() => expect(sidebarProps.visible).toBe(true));
    visProps.onSampleNodeClick(null, null);
    await waitFor(() => expect(sidebarProps.visible).toBe(false));
  });

  it("persists the selected metadata field in the URL", async () => {
    renderView({ selectedPhyloTreeNgId: 5 });
    await screen.findByTestId("phylo-tree-vis");
    await waitFor(() => expect(visProps).not.toBeNull());

    visProps.afterSelectedMetadataChange("sample_type");
    await waitFor(() =>
      expect(window.location.search).toContain("selectedMetadata=sample_type"),
    );
  });

  it("stores an updated metadata value on the current tree", async () => {
    renderView({ selectedPhyloTreeNgId: 5 });
    await screen.findByTestId("phylo-tree-vis");
    await waitFor(() => expect(visProps).not.toBeNull());

    // Select a sample so selectedPipelineRunId is set, then update metadata.
    visProps.onSampleNodeClick(1, 11);
    await waitFor(() => expect(sidebarProps.visible).toBe(true));
    sidebarProps.params.onMetadataUpdate("sample_type", "Serum");

    // The update is keyed by the selected pipeline run id.
    await waitFor(() =>
      expect(visProps.nodeData[11]?.metadata?.sample_type).toBe("Serum"),
    );
    // The original node data is preserved alongside the new key.
    expect(visProps.nodeData.a.sample_id).toBe(1);
  });

  it("hides the admin toggle entirely for non-admins", async () => {
    renderView({ selectedPhyloTreeNgId: 5 }, false);
    await screen.findByTestId("phylo-tree-vis");

    expect(screen.queryByText("Admin Tools")).toBeNull();
    // Only Share and Save remain in the control bar.
    const buttonLabels = Array.from(document.querySelectorAll("button")).map(
      b => b.textContent,
    );
    expect(buttonLabels).toEqual(["Klebsiella", "Share", "Save"]);
  });

  it("toggles the admin panel open and closed for admins", async () => {
    renderView({ selectedPhyloTreeNgId: 5 }, true);
    await screen.findByTestId("phylo-tree-vis");

    // The panel is closed until the admin button is pressed.
    expect(screen.queryByText("Rerun Tree")).toBeNull();

    const adminButton = Array.from(document.querySelectorAll("button")).pop();
    fireEvent.click(adminButton as Element);

    expect(await screen.findByText("Admin Tools")).toBeTruthy();
    expect(screen.getByText("Rerun Tree")).toBeTruthy();
    const logLink = screen.getByText("Link to Pipeline") as HTMLAnchorElement;
    expect(logLink.getAttribute("href")).toBe("https://logs.example/5");

    fireEvent.click(adminButton as Element);
    await waitFor(() => expect(screen.queryByText("Rerun Tree")).toBeNull());
  });

  it("retries a legacy tree instead of rerunning it", async () => {
    const reload = jest.fn();
    const originalLocation = window.location;
    delete (window as $TSFixMe).location;
    (window as $TSFixMe).location = { ...originalLocation, reload };

    mockGetPhyloTree.mockResolvedValue({
      ...NG_TREE,
      id: 7,
      nextGeneration: false,
    });
    renderView(
      { phyloTrees: [{ id: 7, name: "Old", nextGeneration: false }] },
      true,
    );
    await screen.findByTestId("phylo-tree-vis");

    const adminButton = Array.from(document.querySelectorAll("button")).pop();
    fireEvent.click(adminButton as Element);
    fireEvent.click(await screen.findByText("Rerun Tree"));

    await waitFor(() => expect(mockRetryPhyloTree).toHaveBeenCalledWith(7));
    expect(mockRerunPhyloTreeNg).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalled();

    (window as $TSFixMe).location = originalLocation;
  });

  it("switches to a legacy tree from the header dropdown and remembers it", async () => {
    mockGetPhyloTrees.mockResolvedValue({ phyloTrees: [] });
    const trees = [
      { id: 7, name: "Old Tree", nextGeneration: false },
      { id: 9, name: "Second Old Tree", nextGeneration: false },
    ];
    renderView({ phyloTrees: trees });
    await waitFor(() => expect(mockGetPhyloTree).toHaveBeenCalledWith(7));
    await screen.findByTestId("phylo-tree-vis");

    // The dropdown lists every tree except the selected one.
    fireEvent.click(screen.getByText("Old Tree"));
    fireEvent.click(await screen.findByText("Second Old Tree"));

    await waitFor(() => expect(mockGetPhyloTree).toHaveBeenCalledWith(9));
    expect(window.sessionStorage.getItem("treeId")).toBe("9");
    expect(window.location.pathname + window.location.search).toBe(
      "/phylo_trees/index?treeId=9",
    );
  });

  it("reruns a next-generation tree and switches to the new tree", async () => {
    mockRerunPhyloTreeNg.mockResolvedValue({ id: 42 });
    renderView({ selectedPhyloTreeNgId: 5 }, true);
    await screen.findByTestId("phylo-tree-vis");

    // Open the admin panel via the SDS ButtonIcon (the only unnamed button).
    const buttons = Array.from(document.querySelectorAll("button"));
    const adminButton = buttons[buttons.length - 1];
    fireEvent.click(adminButton);

    const rerun = await screen.findByText("Rerun Tree");
    mockGetPhyloTreeNg.mockResolvedValue({ ...NG_TREE, id: 42 });
    fireEvent.click(rerun);

    await waitFor(() => expect(mockRerunPhyloTreeNg).toHaveBeenCalledWith(5));
    await waitFor(() => expect(mockGetPhyloTreeNg).toHaveBeenCalledWith(42));
    expect(mockRetryPhyloTree).not.toHaveBeenCalled();
  });

  it("merges next-generation trees ahead of legacy trees in the dropdown", async () => {
    mockGetPhyloTrees.mockImplementation((opts?: $TSFixMe) =>
      Promise.resolve({
        phyloTrees: opts?.nextGeneration
          ? [{ id: 5, name: "NG Tree", nextGeneration: true }]
          : [],
      }),
    );
    const trees = [{ id: 7, name: "Old Tree", nextGeneration: false }];
    renderView({ phyloTrees: trees });

    await waitFor(() => expect(mockGetPhyloTree).toHaveBeenCalledWith(7));
    // Only the NG list is fetched when phyloTrees was supplied as a prop.
    await waitFor(() => expect(mockGetPhyloTrees).toHaveBeenCalledTimes(1));
    expect(mockGetPhyloTrees).toHaveBeenCalledWith({ nextGeneration: true });
  });
});
