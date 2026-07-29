// Branch coverage: app/assets/src/components/views/PhyloTree/PhyloTreeCreationModal.tsx
//
// Companion to views-PhyloTree-PhyloTreeCreationModal-wizard.test.tsx. That
// suite builds every wizard page; this one drives the conditionals inside them
// that stay untaken there: the second half of the continue-enabled guard, the
// "additional samples" arm of the low-coverage scan (the project arm alone is
// what the other suite hits), the errored tree-name input class, and both
// outcomes of the project table's row-selectability getter.
import { act, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";

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
  trackPageTransition: jest.fn(),
  // The low-coverage notification renders an <ExternalLink>, which is a hook
  // consumer -- the wizard suite never reaches it.
  useTrackEvent: () => jest.fn(),
  useWithAnalytics: () => (fn: $TSFixMe) => fn,
}));

jest.mock("~/components/views/PhyloTree/PhyloTreeNotification", () => ({
  __esModule: true,
  showPhyloTreeNotification: jest.fn(),
}));

jest.mock("~ui/containers/Modal", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => <div data-testid="modal">{props.children}</div>,
}));

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
  Wizard.Page = (props: $TSFixMe) =>
    ReactLib.createElement(
      "div",
      { "data-testid": "wizard-page" },
      props.children,
    );
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

jest.mock("~/components/visualizations/table/DataTable", () => ({
  __esModule: true,
  default: () => <div data-testid="data-table" />,
}));

jest.mock("~/components/common/ProjectSelect", () => ({
  __esModule: true,
  default: () => <div data-testid="project-select" />,
}));

jest.mock("~ui/controls/dropdowns", () => ({
  __esModule: true,
  SubtextDropdown: () => <div data-testid="taxon-dropdown" />,
}));

const mockInputProps: $TSFixMe[] = [];
jest.mock("~/components/ui/controls/Input", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => {
    mockInputProps.push(props);
    return <input data-testid="text-input" placeholder={props.placeholder} />;
  },
}));

import PhyloTreeCreationModal from "~/components/views/PhyloTree/PhyloTreeCreationModal";
import { GlobalContext } from "~/globalContext/reducer";

// React can invoke a mocked function component more than once per commit; only
// the calls that actually carry props are meaningful.
const lastPropsWith = (calls: $TSFixMe[], key: string) =>
  calls.filter(props => props?.[key] !== undefined).pop();

const treeNameInput = () =>
  mockInputProps.filter(props => props?.placeholder === "Tree Name").pop();

const renderModal = async (props: $TSFixMe = {}) => {
  const ref = React.createRef<$TSFixMe>();
  const utils = render(
    <MemoryRouter>
      <GlobalContext.Provider value={{ discoveryProjectIds: [3] } as $TSFixMe}>
        <PhyloTreeCreationModal ref={ref} onClose={jest.fn()} {...props} />
      </GlobalContext.Provider>
    </MemoryRouter>,
  );
  await waitFor(() => expect(ref.current.state.phyloTreesLoaded).toBe(true));
  return { ...utils, ref };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockInfiniteTableProps.length = 0;
  mockInputProps.length = 0;
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

describe("PhyloTreeCreationModal continue-enabled guard", () => {
  it("checks the project id once a taxon has been chosen", async () => {
    const { ref } = await renderModal();
    act(() => ref.current.setState({ taxonId: 5, projectId: 7 }));

    await act(async () => {
      ref.current.loadProjectSearchContext();
    });

    expect(mockGetProjectsToChooseFrom).toHaveBeenCalled();
    // Both halves of the guard are truthy, so the project id itself is passed.
    expect(mockHandleContinueEnabled).toHaveBeenCalledWith(7);
  });

  it("short-circuits on a missing taxon", async () => {
    const { ref } = await renderModal();
    act(() => ref.current.setState({ taxonId: undefined, projectId: 7 }));

    await act(async () => {
      ref.current.loadProjectSearchContext();
    });

    expect(mockHandleContinueEnabled).toHaveBeenCalledWith(undefined);
  });
});

describe("PhyloTreeCreationModal low-coverage warning", () => {
  it("warns when only an additional-samples run is under the threshold", async () => {
    const { ref } = await renderModal();
    act(() =>
      ref.current.setState({
        // The project run is well above the 25% floor.
        selectedProjectPipelineRuns: new Set([1]),
        projectCoverageBreadths: { 1: 0.9 },
        // The additional-samples run is not, so the second scan trips.
        selectedOtherPipelineRuns: new Set([2]),
        otherCoverageBreadths: { 2: 0.1 },
      }),
    );

    expect(document.body.textContent).toContain("low coverage breadth");
  });

  it("stays quiet when the additional-samples runs clear the threshold", async () => {
    const { ref } = await renderModal();
    act(() =>
      ref.current.setState({
        selectedProjectPipelineRuns: new Set([1]),
        projectCoverageBreadths: { 1: 0.9 },
        selectedOtherPipelineRuns: new Set([2]),
        otherCoverageBreadths: { 2: 0.8 },
      }),
    );

    expect(document.body.textContent).not.toContain("low coverage breadth");
  });

  it("skips runs that have no recorded coverage breadth at all", async () => {
    const { ref } = await renderModal();
    act(() =>
      ref.current.setState({
        selectedOtherPipelineRuns: new Set([2]),
        otherCoverageBreadths: null,
      }),
    );

    expect(document.body.textContent).not.toContain("low coverage breadth");
  });
});

describe("PhyloTreeCreationModal tree name input", () => {
  it("marks the name input as errored for a taken name", async () => {
    const { ref } = await renderModal();
    mockInputProps.length = 0;
    act(() =>
      ref.current.setState({
        showErrorName: true,
        treeNameValid: false,
        treeName: "taken",
      }),
    );

    const nameInput = treeNameInput();
    expect(nameInput.className).toBe("error");
    expect(document.body.textContent).toContain("tree name is taken");
  });

  it("leaves the name input unstyled while the name is still blank", async () => {
    const { ref } = await renderModal();
    mockInputProps.length = 0;
    act(() =>
      ref.current.setState({
        showErrorName: true,
        treeNameValid: false,
        treeName: "",
      }),
    );

    expect(treeNameInput().className).toBe("");
  });
});

describe("PhyloTreeCreationModal project row selectability", () => {
  const projectTable = async () => {
    const { ref } = await renderModal();
    act(() =>
      ref.current.setState({
        projectPipelineRunsLoaded: true,
        projectPipelineRunIds: new Set([1, 2]),
        // Leave the additional-samples table unrendered so the only
        // InfiniteTable on screen is the project one.
        otherPipelineRunsLoaded: false,
      }),
    );
    expect(screen.getAllByTestId("infinite-table")).toHaveLength(1);
    return lastPropsWith(mockInfiniteTableProps, "selectRowDataGetter");
  };

  it("returns the pipeline run id for a row that has contigs", async () => {
    const table = await projectTable();
    expect(
      table.selectRowDataGetter({
        rowData: { num_contigs: 4, pipeline_run_id: 42 },
      }),
    ).toBe(42);
  });

  it("returns null for a row with no contigs", async () => {
    const table = await projectTable();
    expect(
      table.selectRowDataGetter({
        rowData: { num_contigs: 0, pipeline_run_id: 42 },
      }),
    ).toBeNull();
  });
});
