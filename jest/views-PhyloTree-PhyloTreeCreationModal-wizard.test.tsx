// Coverage: app/assets/src/components/views/PhyloTree/PhyloTreeCreationModal.tsx
//
// The existing spec keeps this modal permanently in its pre-load spinner state,
// so none of the wizard construction runs. Here getPhyloTrees RESOLVES, which
// lets the wizard mount and every page() branch build: the tree list, the
// project/taxon picker, the name + project-samples page and the additional
// samples page. On top of that the data-loading callbacks (pipeline run ids,
// row paging, project search), the reset-on-reselect handlers, the debounced
// filter/taxon inputs and the disabled-row renderer are all driven.
import { act, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";

// ---- API -------------------------------------------------------------------
const mockGetPhyloTrees = jest.fn();
const mockGetNewPhyloTreePipelineRunIds = jest.fn();
const mockGetNewPhyloTreePipelineRunInfo = jest.fn();
const mockGetProjectsToChooseFrom = jest.fn();
const mockCreatePhyloTree = jest.fn();
const mockValidatePhyloTreeName = jest.fn();

jest.mock("~/api", () => ({
  __esModule: true,
  getPhyloTrees: (...a: $TSFixMe[]) => mockGetPhyloTrees(...a),
  getNewPhyloTreePipelineRunIds: (...a: $TSFixMe[]) =>
    mockGetNewPhyloTreePipelineRunIds(...a),
  getNewPhyloTreePipelineRunInfo: (...a: $TSFixMe[]) =>
    mockGetNewPhyloTreePipelineRunInfo(...a),
  getProjectsToChooseFrom: (...a: $TSFixMe[]) =>
    mockGetProjectsToChooseFrom(...a),
  createPhyloTree: (...a: $TSFixMe[]) => mockCreatePhyloTree(...a),
  validatePhyloTreeName: (...a: $TSFixMe[]) => mockValidatePhyloTreeName(...a),
}));

const mockChooseTaxon = jest.fn();
jest.mock("~/api/phylo_tree_ngs", () => ({
  __esModule: true,
  chooseTaxon: (...a: $TSFixMe[]) => mockChooseTaxon(...a),
}));

jest.mock("~/api/analytics", () => ({
  __esModule: true,
  ANALYTICS_EVENT_NAMES: new Proxy({}, { get: (_t, p) => String(p) }),
  trackEventFromClassComponent: jest.fn(),
  withAnalyticsFromClassComponent: (_ctx: $TSFixMe, fn: $TSFixMe) => fn,
}));

const mockShowPhyloTreeNotification = jest.fn();
jest.mock("~/components/views/PhyloTree/PhyloTreeNotification", () => ({
  __esModule: true,
  showPhyloTreeNotification: (...a: $TSFixMe[]) =>
    mockShowPhyloTreeNotification(...a),
}));

// ---- Heavy child stubs -----------------------------------------------------
jest.mock("~ui/containers/Modal", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => <div data-testid="modal">{props.children}</div>,
}));

// The wizard renders EVERY page it is handed so each page() branch executes,
// and exposes the imperative handleContinueEnabled the modal reaches through.
const mockWizardPageProps: $TSFixMe[] = [];
const mockHandleContinueEnabled = jest.fn();
jest.mock("~ui/containers/Wizard", () => {
  const ReactLib = require("react");
  class Wizard extends ReactLib.Component {
    handleContinueEnabled = mockHandleContinueEnabled;
    render() {
      return ReactLib.createElement(
        "div",
        { "data-testid": "wizard" },
        this.props.children,
      );
    }
  }
  Wizard.Page = (props: $TSFixMe) => {
    mockWizardPageProps.push(props);
    return ReactLib.createElement(
      "div",
      { "data-testid": "wizard-page", "data-title": String(props.title) },
      props.children,
    );
  };
  Wizard.Action = (props: $TSFixMe) =>
    ReactLib.createElement("div", null, props.children);
  return { __esModule: true, default: Wizard };
});

const mockInfiniteTableProps: $TSFixMe[] = [];
jest.mock("~/components/visualizations/table/InfiniteTable", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => {
    mockInfiniteTableProps.push(props);
    return <div data-testid="infinite-table" />;
  },
}));

const mockDataTableProps: $TSFixMe[] = [];
jest.mock("~/components/visualizations/table/DataTable", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => {
    mockDataTableProps.push(props);
    return <div data-testid="data-table" data-rows={props.data.length} />;
  },
}));

let mockProjectSelectProps: $TSFixMe = null;
jest.mock("~/components/common/ProjectSelect", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => {
    mockProjectSelectProps = props;
    return (
      <div data-testid="project-select" data-value={String(props.value)} />
    );
  },
}));

let mockTaxonDropdownProps: $TSFixMe = null;
jest.mock("~ui/controls/dropdowns", () => ({
  __esModule: true,
  SubtextDropdown: (props: $TSFixMe) => {
    mockTaxonDropdownProps = props;
    return (
      <div
        data-testid="taxon-dropdown"
        data-options={props.options.length}
        data-initial={String(props.initialSelectedValue)}
      />
    );
  },
}));

const mockInputProps: $TSFixMe[] = [];
jest.mock("~/components/ui/controls/Input", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => {
    mockInputProps.push(props);
    return (
      <input
        data-testid="text-input"
        placeholder={props.placeholder}
        onChange={e => props.onChange(e.target.value)}
      />
    );
  },
}));

import PhyloTreeCreationModal from "~/components/views/PhyloTree/PhyloTreeCreationModal";
import { GlobalContext } from "~/globalContext/reducer";

const renderModal = async (props: $TSFixMe = {}) => {
  const ref = React.createRef<$TSFixMe>();
  const utils = render(
    <MemoryRouter>
      <GlobalContext.Provider value={{ discoveryProjectIds: [3] } as $TSFixMe}>
        <PhyloTreeCreationModal
          ref={ref}
          onClose={props.onClose || jest.fn()}
          {...props}
        />
      </GlobalContext.Provider>
    </MemoryRouter>,
  );
  await waitFor(() => expect(ref.current.state.phyloTreesLoaded).toBe(true));
  return { ...utils, ref };
};

const titles = () =>
  screen.getAllByTestId("wizard-page").map(el => el.dataset.title);

beforeEach(() => {
  jest.clearAllMocks();
  mockWizardPageProps.length = 0;
  mockInfiniteTableProps.length = 0;
  mockDataTableProps.length = 0;
  mockInputProps.length = 0;
  mockProjectSelectProps = null;
  mockTaxonDropdownProps = null;
  mockGetPhyloTrees.mockResolvedValue({ phyloTrees: [] });
  mockGetNewPhyloTreePipelineRunIds.mockResolvedValue({
    pipelineRunIds: [1, 2, 3],
    coverageBreadths: { 1: 0.9, 2: 0.1, 3: 0.5 },
    runsWithContigs: [1, 3],
  });
  mockGetNewPhyloTreePipelineRunInfo.mockResolvedValue({ samples: [] });
  mockGetProjectsToChooseFrom.mockResolvedValue([{ id: 1, name: "Proj" }]);
  mockCreatePhyloTree.mockResolvedValue({ phylo_tree_id: 5 });
  mockValidatePhyloTreeName.mockResolvedValue({
    sanitizedName: "clean",
    valid: true,
  });
  mockChooseTaxon.mockResolvedValue([]);
});

describe("PhyloTreeCreationModal wizard construction", () => {
  it("skips the tree-list page when the user has no existing trees", async () => {
    const { ref } = await renderModal();
    expect(ref.current.state.skipListTrees).toBe(true);
    expect(screen.getByTestId("wizard")).toBeTruthy();
    expect(titles()).toEqual([
      "Select project and taxon",
      "Name phylogenetic tree and select samples from project 'undefined'",
      "Add additional samples from SeqtoID that contain undefined?",
    ]);
    expect(screen.queryByTestId("data-table")).toBeNull();
  });

  it("shows the tree-list page and merges NG trees ahead of legacy trees", async () => {
    mockGetPhyloTrees.mockImplementation(({ nextGeneration }: $TSFixMe) =>
      Promise.resolve(
        nextGeneration
          ? {
              phyloTrees: [
                {
                  id: 5,
                  name: "NG",
                  nextGeneration: true,
                  user: { name: "A" },
                },
              ],
              taxonNameNg: "Klebsiella",
            }
          : {
              phyloTrees: [
                { id: 7, name: "Old", nextGeneration: false, user: null },
              ],
            },
      ),
    );

    const { ref } = await renderModal();
    expect(ref.current.state.skipListTrees).toBe(false);
    expect(ref.current.state.taxonName).toBe("Klebsiella");
    expect(titles()[0]).toBe("Phylogenetic Trees");
    // NG tree first, legacy second; the legacy row has no creator.
    expect(screen.getByTestId("data-table").dataset.rows).toBe("2");
    const rows = mockDataTableProps[0].data;
    expect(rows[0].name).toBe("NG");
    expect(rows[0].user).toBe("A");
    expect(rows[1].user).toBeUndefined();
  });

  it("skips the project/taxon page when both were supplied as props", async () => {
    await renderModal({
      projectId: "11",
      taxonName: "Salmonella",
      taxonId: 90,
    });
    expect(titles()).toEqual([
      "Name phylogenetic tree and select samples from project 'undefined'",
      "Add additional samples from SeqtoID that contain Salmonella?",
    ]);
  });

  it("renders spinners for the sample tables until the run ids arrive", async () => {
    await renderModal();
    expect(screen.queryByTestId("infinite-table")).toBeNull();
  });
});

describe("PhyloTreeCreationModal pipeline run loading", () => {
  it("loads project and additional run ids once and enables continue", async () => {
    const { ref } = await renderModal();
    act(() => ref.current.setState({ treeName: "myTree" }));

    await act(async () => {
      await ref.current.loadPipelineRunIds();
    });

    expect(mockGetNewPhyloTreePipelineRunIds).toHaveBeenCalledTimes(2);
    // reverse() flips the id order for display.
    expect([...ref.current.state.projectPipelineRunIds]).toEqual([3, 2, 1]);
    expect([...ref.current.state.selectableProjectPipelineRuns]).toEqual([
      1, 3,
    ]);
    expect(ref.current.state.projectPipelineRunsLoaded).toBe(true);
    expect(ref.current.state.otherPipelineRunsLoaded).toBe(true);
    // A non-empty tree name unlocks the continue button.
    expect(mockHandleContinueEnabled).toHaveBeenCalledWith(true);

    // A second pass must not refetch.
    mockGetNewPhyloTreePipelineRunIds.mockClear();
    await act(async () => {
      await ref.current.loadPipelineRunIds();
    });
    expect(mockGetNewPhyloTreePipelineRunIds).not.toHaveBeenCalled();
  });

  it("leaves continue disabled while the tree name is still empty", async () => {
    const { ref } = await renderModal();
    await act(async () => {
      await ref.current.loadProjectPipelineRunIds();
    });
    expect(mockHandleContinueEnabled).toHaveBeenCalledWith(false);
  });

  it("renders the project sample table once run ids exist", async () => {
    const { ref } = await renderModal();
    await act(async () => {
      await ref.current.loadPipelineRunIds();
    });
    // Both the project table and the additional-samples table now render.
    expect(screen.getAllByTestId("infinite-table")).toHaveLength(2);
    // The project table drops the leading "Project" column.
    const projectTable = mockInfiniteTableProps.at(-2);
    expect(projectTable.columns[0].dataKey).toBe("name");
    expect(mockInfiniteTableProps.at(-1).columns[0].dataKey).toBe(
      "project_name",
    );
  });

  it("renders an empty-state message when the project has no matching samples", async () => {
    mockGetNewPhyloTreePipelineRunIds.mockResolvedValue({
      pipelineRunIds: [],
      coverageBreadths: {},
      runsWithContigs: [],
    });
    const { ref } = await renderModal();
    act(() => ref.current.setState({ taxonName: "Klebsiella" }));
    await act(async () => {
      await ref.current.loadPipelineRunIds();
    });
    expect(screen.queryByTestId("infinite-table")).toBeNull();
    expect(
      screen.getAllByText(/No samples containing/).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("pages rows through the run-info endpoint for both tables", async () => {
    mockGetNewPhyloTreePipelineRunInfo.mockResolvedValue({
      samples: [{ pipeline_run_id: 3 }],
    });
    const { ref } = await renderModal();
    act(() =>
      ref.current.setState({
        taxonId: 90,
        projectPipelineRunIds: new Set([10, 11, 12]),
        otherPipelineRunIds: new Set([20, 21]),
      }),
    );

    const projectRows = await ref.current.handleLoadProjectPipelineRunRows({
      startIndex: 0,
      stopIndex: 1,
    });
    expect(projectRows).toEqual([{ pipeline_run_id: 3 }]);
    expect(mockGetNewPhyloTreePipelineRunInfo).toHaveBeenCalledWith({
      getAdditionalSamples: false,
      pipelineRunIds: [10, 11],
      taxId: 90,
    });

    await ref.current.handleLoadOtherPipelineRunRows({
      startIndex: 1,
      stopIndex: 5,
    });
    expect(mockGetNewPhyloTreePipelineRunInfo).toHaveBeenLastCalledWith({
      getAdditionalSamples: true,
      pipelineRunIds: [21],
      taxId: 90,
    });
  });
});

describe("PhyloTreeCreationModal project + taxon selection", () => {
  it("loads the project list and swaps the spinner for the select", async () => {
    const { ref } = await renderModal();
    expect(screen.queryByTestId("project-select")).toBeNull();

    await act(async () => {
      ref.current.loadProjectSearchContext();
    });

    expect(ref.current.state.projectsLoaded).toBe(true);
    expect(ref.current.state.projectList).toEqual([{ id: 1, name: "Proj" }]);
    expect(screen.getByTestId("project-select")).toBeTruthy();
  });

  it("resets the loaded sample state when a different project is chosen", async () => {
    const { ref } = await renderModal();
    act(() =>
      ref.current.setState({
        taxonId: 90,
        projectPipelineRunsLoaded: true,
        otherPipelineRunsLoaded: true,
        selectedProjectPipelineRuns: new Set([1]),
        otherSamplesFilter: "abc",
      }),
    );

    act(() => ref.current.handleSelectProject({ id: "77", name: "New Proj" }));

    expect(ref.current.state.projectId).toBe("77");
    expect(ref.current.state.projectName).toBe("New Proj");
    expect(ref.current.state.projectPipelineRunsLoaded).toBe(false);
    expect(ref.current.state.otherPipelineRunsLoaded).toBe(false);
    expect(ref.current.state.selectedProjectPipelineRuns.size).toBe(0);
    expect(ref.current.state.otherSamplesFilter).toBe("");
    // A taxon was already chosen, so continue is unlocked.
    expect(mockHandleContinueEnabled).toHaveBeenLastCalledWith(true);
  });

  it("keeps continue locked when a project is chosen but no taxon is set", async () => {
    const { ref } = await renderModal();
    act(() => ref.current.handleSelectProject({ id: "77", name: "New Proj" }));
    expect(mockHandleContinueEnabled).toHaveBeenLastCalledWith(false);
  });

  it("resolves the taxon name from the loaded list and resets samples", async () => {
    const { ref } = await renderModal();
    act(() =>
      ref.current.setState({
        projectId: "11",
        taxonList: [
          { value: 90, title: "Salmonella" },
          { value: 91, title: "Klebsiella" },
        ],
        selectedOtherPipelineRuns: new Set([4]),
      }),
    );

    act(() => ref.current.handleSelectTaxon(91));

    expect(ref.current.state.taxonId).toBe(91);
    expect(ref.current.state.taxonName).toBe("Klebsiella");
    expect(ref.current.state.selectedOtherPipelineRuns.size).toBe(0);
    expect(mockHandleContinueEnabled).toHaveBeenLastCalledWith(true);
  });

  it("searches for taxa and maps the results into dropdown options", async () => {
    mockChooseTaxon.mockResolvedValue([
      { title: "Salmonella enterica", taxid: 28901, description: "bacteria" },
    ]);
    const { ref } = await renderModal();
    act(() => ref.current.setState({ taxonQuery: "salmo", projectId: "11" }));

    await act(async () => {
      await ref.current.handleTaxonSearchAction();
    });

    expect(mockChooseTaxon).toHaveBeenCalledWith({
      query: "salmo",
      projectId: "11",
    });
    expect(ref.current.state.taxonList).toEqual([
      {
        text: "Salmonella enterica",
        value: 28901,
        subtext: "bacteria",
        title: "Salmonella enterica",
        taxid: 28901,
        description: "bacteria",
      },
    ]);
  });

  it("shows the missing-selection message after a blocked continue", async () => {
    const { ref } = await renderModal();
    act(() => {
      ref.current.canContinueWithTaxonAndProject();
    });
    expect(
      screen.getByText("Please select a project and organism"),
    ).toBeTruthy();
  });
});

describe("PhyloTreeCreationModal debounced inputs", () => {
  it("debounces the additional-samples filter before refetching", async () => {
    jest.useFakeTimers();
    try {
      const { ref } = await renderModal();
      act(() =>
        ref.current.setState({
          otherPipelineRunsLoaded: true,
          otherPipelineRunIds: new Set([1]),
        }),
      );
      mockGetNewPhyloTreePipelineRunIds.mockClear();

      act(() => ref.current.handleFilterChange("kleb"));
      // Nothing happens until the delay elapses.
      expect(mockGetNewPhyloTreePipelineRunIds).not.toHaveBeenCalled();

      act(() => {
        jest.advanceTimersByTime(250);
      });
      expect(ref.current.state.otherSamplesFilter).toBe("kleb");
      expect(ref.current.state.otherPipelineRunsLoaded).toBe(false);
      expect(mockGetNewPhyloTreePipelineRunIds).toHaveBeenCalledWith(
        expect.objectContaining({ getAdditionalSamples: true, filter: "kleb" }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it("stores the typed taxon query without searching immediately", async () => {
    const { ref } = await renderModal();
    await act(async () => {
      await ref.current.handleTaxonInputChange("sal");
    });
    // The query lands in state right away; the API call is debounced behind it.
    expect(ref.current.state.taxonQuery).toBe("sal");
    expect(mockChooseTaxon).not.toHaveBeenCalled();
    // The dropdown is what feeds the handler in the real page.
    expect(mockTaxonDropdownProps.onFilterChange).toBe(
      ref.current.handleTaxonInputChange,
    );
    expect(mockTaxonDropdownProps.onChange).toBe(ref.current.handleSelectTaxon);
  });

  it("clears the taxon list and id when the query is emptied", async () => {
    const { ref } = await renderModal();
    act(() =>
      ref.current.setState({
        taxonQuery: "",
        taxonId: 90,
        taxonList: [{ value: 90, title: "Salmonella" }],
      }),
    );
    await act(async () => {
      await ref.current.handleTaxonSearchAction();
    });
    expect(ref.current.state.taxonList).toEqual([]);
    expect(ref.current.state.taxonId).toBeNull();
    expect(mockChooseTaxon).not.toHaveBeenCalled();
    expect(screen.getByTestId("taxon-dropdown").dataset.options).toBe("0");
  });

  it("re-enables continue only when the sanitized name is non-empty", async () => {
    const { ref } = await renderModal();
    mockValidatePhyloTreeName.mockResolvedValue({
      sanitizedName: "",
      valid: false,
    });
    let valid: $TSFixMe;
    await act(async () => {
      valid = await ref.current.isTreeNameValid();
    });
    expect(valid).toBe(false);
    expect(ref.current.state.treeName).toBe("");
    expect(mockHandleContinueEnabled).toHaveBeenLastCalledWith(false);
  });
});

describe("PhyloTreeCreationModal row rendering", () => {
  const baseRowProps = () => ({
    className: "row",
    columns: [] as $TSFixMe[],
    index: 0,
    key: "row-0",
    rowData: undefined as $TSFixMe,
    style: {},
  });

  it("renders a plain row for a sample with contigs", async () => {
    const { ref } = await renderModal();
    const props = { ...baseRowProps(), rowData: { num_contigs: 4 } };
    const node = ref.current.rowRenderer(props);
    const { container } = render(<div>{node}</div>);
    expect(container.querySelector(".row")).not.toBeNull();
  });

  it("wraps a contig-less sample in a disabled tooltip row", async () => {
    const { ref } = await renderModal();
    const props = { ...baseRowProps(), rowData: { num_contigs: 0 } };
    const node = ref.current.rowRenderer(props);
    // The disabled class is appended before the row is wrapped in a tooltip.
    expect(node.type).not.toBe("div");
    expect(node.props.content).toMatch(/at least 1 contig/);
  });

  it("renders a plain row when there is no row data at all", async () => {
    const { ref } = await renderModal();
    const node = ref.current.rowRenderer(baseRowProps());
    expect(node.props.content).toBeUndefined();
  });

  it("only exposes selectable ids for rows that have contigs", async () => {
    const { ref } = await renderModal();
    await act(async () => {
      await ref.current.loadPipelineRunIds();
    });
    const getter = mockInfiniteTableProps.at(-1).selectRowDataGetter;
    expect(getter({ rowData: { num_contigs: 2, pipeline_run_id: 8 } })).toBe(8);
    expect(
      getter({ rowData: { num_contigs: 0, pipeline_run_id: 9 } }),
    ).toBeNull();
  });
});

describe("PhyloTreeCreationModal completion", () => {
  it("closes the modal after a successful creation", async () => {
    const onClose = jest.fn();
    const { ref } = await renderModal({ onClose });
    act(() =>
      ref.current.setState({
        treeName: "myTree",
        projectId: "2",
        taxonId: 9,
        selectedProjectPipelineRuns: new Set([1, 2, 3]),
        selectedOtherPipelineRuns: new Set([4]),
      }),
    );

    await act(async () => {
      ref.current.handleComplete();
    });

    expect(mockCreatePhyloTree).toHaveBeenCalled();
    expect(mockShowPhyloTreeNotification).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("does not close when there are too few samples", async () => {
    const onClose = jest.fn();
    const { ref } = await renderModal({ onClose });
    act(() =>
      ref.current.setState({
        selectedProjectPipelineRuns: new Set([1]),
        selectedOtherPipelineRuns: new Set(),
      }),
    );

    act(() => ref.current.handleComplete());

    expect(mockCreatePhyloTree).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(ref.current.state.showErrorSamples).toBe(true);
  });

  it("logs instead of closing when the API returns no tree id", async () => {
    const onClose = jest.fn();
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockCreatePhyloTree.mockResolvedValue({ phylo_tree_id: null });
    const { ref } = await renderModal({ onClose });
    act(() =>
      ref.current.setState({
        selectedProjectPipelineRuns: new Set([1, 2, 3, 4]),
        selectedOtherPipelineRuns: new Set(),
      }),
    );

    await act(async () => {
      ref.current.handleCreation();
    });

    expect(errorSpy).toHaveBeenCalledWith("Error creating tree");
    expect(mockShowPhyloTreeNotification).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("records the default page the wizard should open on", async () => {
    const { ref } = await renderModal();
    act(() => ref.current.setPage(2));
    expect(ref.current.state.defaultPage).toBe(2);
  });
});
