// Coverage: app/assets/src/components/views/PipelineViz/PipelineViz.tsx
//
// The existing PipelineViz spec mounts the component with an EMPTY stage list,
// which skips every drawing / layout / interaction path. This spec mounts it
// with a POPULATED two-stage DAG behind a fake NetworkGraph so the whole
// generate-edges -> generate-nodes -> layout -> draw pipeline runs for real,
// and then drives the interaction handlers (stage toggle, node click, mouse
// move / hover / blur, sidebar close, zoom, window resize, poll-and-diff
// update) through the DOM and the instance ref.
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

// ---- Fake NetworkGraph -----------------------------------------------------
// Records every graph vis.js would have built so the layout output can be
// asserted, and lets tests decide which node sits under the cursor.
const mockGraphInstances: $TSFixMe[] = [];
let mockNodeAtResult: number | null = 0;

jest.mock("~/components/visualizations/NetworkGraph", () => ({
  __esModule: true,
  default: jest
    .fn()
    .mockImplementation(
      (
        container: $TSFixMe,
        nodeData: $TSFixMe,
        edgeData: $TSFixMe,
        options: $TSFixMe,
      ) => {
        const instance: $TSFixMe = {
          container,
          nodeData,
          edgeData,
          options,
          afterDrawingOnce: (cb: $TSFixMe) => cb(),
          minimizeSizeGivenScale: jest.fn(),
          updateNodes: jest.fn(),
          updateEdges: jest.fn(),
          selectNodes: jest.fn(),
          unselectAll: jest.fn(),
          getEdges: jest.fn((predicate: $TSFixMe) =>
            edgeData
              .filter((e: $TSFixMe) => predicate(e))
              .map((e: $TSFixMe) => e.id),
          ),
          getNodeAt: jest.fn(() => mockNodeAtResult),
        };
        mockGraphInstances.push(instance);
        return instance;
      },
    ),
}));

// The DOM-matrix inversion needs a laid-out, CSS-transformed element that jsdom
// cannot provide; it has its own unit spec (pipelineVizUtils.test.ts).
jest.mock("~/components/views/PipelineViz/utils", () => ({
  __esModule: true,
  inverseTransformDOMCoordinates: (_el: $TSFixMe, x: number, y: number) => ({
    x,
    y,
  }),
}));

const mockGetGraph = jest.fn();
jest.mock("~/api/pipelineViz", () => ({
  __esModule: true,
  getGraph: (...args: $TSFixMe[]) => mockGetGraph(...args),
}));

// PanZoom must expose the imperative handle PipelineViz reaches through
// (dragContainer for hit-testing, zoomIn/zoomOut for the +/- control).
jest.mock("react-easy-panzoom", () => {
  const ReactLib = require("react");
  class PanZoom extends ReactLib.Component {
    dragContainer = { current: global.document.createElement("div") };
    zoomIn = jest.fn();
    zoomOut = jest.fn();
    render() {
      return ReactLib.createElement(
        "div",
        { "data-testid": "panzoom" },
        this.props.children,
      );
    }
  }
  return { __esModule: true, PanZoom };
});

jest.mock("~/components/common/DetailsSidebar/DetailsSidebar", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => (
    <div
      data-testid="details-sidebar"
      data-visible={String(props.visible)}
      data-step={String(props.params.stepName)}
    >
      <button data-testid="close-sidebar" onClick={props.onClose}>
        close
      </button>
    </div>
  ),
}));

jest.mock("~/components/ui/controls/PlusMinusControl", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => (
    <div data-testid="plus-minus">
      <button data-testid="zoom-in" onClick={props.onPlusClick} />
      <button data-testid="zoom-out" onClick={props.onMinusClick} />
    </div>
  ),
}));

jest.mock("~/components/views/PipelineViz/PipelineVizHeader", () => ({
  __esModule: true,
  default: () => <div data-testid="viz-header" />,
}));

jest.mock("~/components/views/PipelineViz/PipelineVizStatusIcon", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => (
    <span data-testid="status-icon" data-type={props.type} />
  ),
}));

import PipelineViz from "~/components/views/PipelineViz/PipelineViz";

// ---- Fixture ---------------------------------------------------------------
// Stage 0 is a diamond (validate -> {star -> trimmomatic, bowtie}) so the
// layout code hits multi-node levels (and therefore the sort comparator) and
// enough distinct levels to switch the stagger multiplier on. Stage 1 is a
// single alignment step fed by both stage-0 leaves.
const makeGraphData = (status = "running") => ({
  status,
  stages: [
    {
      name: "Host Filtering",
      jobStatus: "finished",
      steps: [
        {
          name: "Validate Input",
          status: "finished",
          description: "checks the reads",
          inputEdges: [0],
          outputEdges: [1, 2],
        },
        {
          name: "Star",
          status: "finished",
          inputEdges: [1],
          outputEdges: [3],
        },
        {
          name: "Trimmomatic",
          status: "finished",
          inputEdges: [3],
          outputEdges: [4],
        },
        {
          name: "Bowtie",
          status: "finished",
          inputEdges: [2],
          outputEdges: [5],
        },
      ],
    },
    {
      name: "Alignment",
      jobStatus: "inProgress",
      steps: [
        {
          name: "GSNAP",
          status: "inProgress",
          inputEdges: [4, 5],
          outputEdges: [6],
        },
      ],
    },
  ],
  edges: [
    // 0: external input -- no `from`.
    {
      to: { stageIndex: 0, stepIndex: 0 },
      isIntraStage: false,
      files: [{ displayName: "raw.fastq", url: "/raw" }],
    },
    {
      from: { stageIndex: 0, stepIndex: 0 },
      to: { stageIndex: 0, stepIndex: 1 },
      isIntraStage: true,
      files: [{ displayName: "valid.fa", url: "/valid" }],
    },
    {
      from: { stageIndex: 0, stepIndex: 0 },
      to: { stageIndex: 0, stepIndex: 3 },
      isIntraStage: true,
      files: [{ displayName: "valid.fa", url: "/valid" }],
    },
    {
      from: { stageIndex: 0, stepIndex: 1 },
      to: { stageIndex: 0, stepIndex: 2 },
      isIntraStage: true,
      files: [{ displayName: "star.fa", url: "/star" }],
    },
    {
      from: { stageIndex: 0, stepIndex: 2 },
      to: { stageIndex: 1, stepIndex: 0 },
      isIntraStage: false,
      files: [{ displayName: "shared.fa", url: "/shared" }],
    },
    // 5: carries the SAME file as edge 4 so the output de-duplication runs.
    {
      from: { stageIndex: 0, stepIndex: 3 },
      to: { stageIndex: 1, stepIndex: 0 },
      isIntraStage: false,
      files: [{ displayName: "shared.fa", url: "/shared" }],
    },
    // 6: terminal output -- no `to`.
    {
      from: { stageIndex: 1, stepIndex: 0 },
      isIntraStage: false,
      files: [{ displayName: "final.m8", url: "/final" }],
    },
  ],
});

const renderViz = (props: $TSFixMe = {}) => {
  const ref = React.createRef<$TSFixMe>();
  const utils = render(
    <PipelineViz
      ref={ref}
      graphData={makeGraphData(props.status)}
      sample={{ id: 42 } as $TSFixMe}
      pipelineRun={{ version: { pipeline: "8.1" } } as $TSFixMe}
      updateInterval={1000000}
      edgeColor="#999999"
      inputEdgeColor="#00f"
      outputEdgeColor="#f00"
      {...props}
    />,
  );
  return { ...utils, ref };
};

// The clickable stage button wraps <span><icon/><span>NAME</span></span>.
const stageButtonFor = (name: string) =>
  screen.getAllByText(name)[0].parentElement?.parentElement as HTMLElement;

beforeEach(() => {
  jest.clearAllMocks();
  mockGraphInstances.length = 0;
  mockNodeAtResult = 0;
  mockGetGraph.mockResolvedValue(makeGraphData("running"));
  window.history.replaceState(null, "", "/samples/42/pipeline_viz/8.1");
});

describe("PipelineViz drawing", () => {
  it("builds one graph per stage with start/end nodes and laid-out coordinates", () => {
    renderViz();

    expect(mockGraphInstances).toHaveLength(2);
    const stage0 = mockGraphInstances[0];

    // 4 real steps + the invisible start and end nodes.
    expect(stage0.nodeData).toHaveLength(6);
    expect(stage0.nodeData.map((n: $TSFixMe) => n.id)).toEqual([
      0, 1, 2, 3, -1, -2,
    ]);
    expect(stage0.nodeData[0].label).toBe("Validate Input");
    expect(stage0.nodeData[4].group).toBe("startEndNodes");

    // The BFS levels follow the diamond: validate < {star, bowtie} < trimmomatic.
    const levelOf = (id: number) =>
      stage0.nodeData.find((n: $TSFixMe) => n.id === id).level;
    expect(levelOf(-1)).toBe(0);
    expect(levelOf(0)).toBe(1);
    expect(levelOf(1)).toBe(2);
    expect(levelOf(3)).toBe(2);
    expect(levelOf(2)).toBe(3);
    expect(levelOf(-2)).toBeGreaterThan(levelOf(2));

    // X is derived from the level, so deeper nodes sit further right.
    expect(stage0.nodeData.find((n: $TSFixMe) => n.id === 2).x).toBeGreaterThan(
      stage0.nodeData.find((n: $TSFixMe) => n.id === 0).x,
    );
    // The two siblings on the shared level are pushed apart vertically.
    const siblingYs = [1, 3].map(
      id => stage0.nodeData.find((n: $TSFixMe) => n.id === id).y,
    );
    expect(siblingYs[0]).not.toBe(siblingYs[1]);
    // A single-node level sits on the centre line.
    expect(Math.abs(stage0.nodeData.find((n: $TSFixMe) => n.id === 0).y)).toBe(
      0,
    );
  });

  it("emits regular, colored and hidden edges for a stage", () => {
    renderViz();
    const ids = mockGraphInstances[0].edgeData.map((e: $TSFixMe) => e.id);

    // Intra-stage edges plus a start edge into the first step and end edges
    // out of the two leaves.
    expect(ids).toContain("0-1");
    expect(ids).toContain("0-3");
    expect(ids).toContain("1-2");
    expect(ids).toContain("-1-0");
    expect(ids).toContain("2--2");
    expect(ids).toContain("3--2");
    // Star/Trimmomatic/Bowtie are fed intra-stage, so they get no start edge.
    expect(ids).not.toContain("-1-1");

    // Every regular edge is mirrored by a hidden "colored" twin...
    const colored = mockGraphInstances[0].edgeData.filter((e: $TSFixMe) =>
      e.id.endsWith("-colored"),
    );
    expect(colored).toHaveLength(6);
    expect(colored.every((e: $TSFixMe) => e.hidden && e.color === null)).toBe(
      true,
    );
    // ...and every step gets a hidden centering edge to start and to end.
    expect(
      mockGraphInstances[0].edgeData.filter((e: $TSFixMe) =>
        e.id.endsWith("-hidden"),
      ),
    ).toHaveLength(8);
  });

  it("closes an already-finished stage after drawing but leaves a running one open", () => {
    const { ref } = renderViz();
    // Stage 0 is finished and had no stored opened-state, so afterDrawingOnce
    // toggles it shut. Stage 1 is inProgress, so it stays open.
    expect(ref.current.state.stagesOpened[0]).toBe(false);
    expect(ref.current.state.stagesOpened[1]).toBe(true);
    // The URL is rewritten with the opened-state params.
    expect(window.location.search).toContain("=");
  });

  it("keeps a stage open when history already recorded it as opened", () => {
    window.history.replaceState(
      [true, true, false, false],
      "",
      "/samples/42/pipeline_viz/8.1",
    );
    const { ref } = renderViz();
    expect(ref.current.state.stagesOpened[0]).toBe(true);
  });
});

describe("PipelineViz stage rendering + toggling", () => {
  it("renders a status icon per stage and falls back to notStarted for stages without a DAG", () => {
    renderViz();
    const types = screen
      .getAllByTestId("status-icon")
      .map(el => el.dataset.type);
    expect(types).toContain("finished");
    expect(types).toContain("inProgress");
    // "Post Processing" has no stage data -> notStarted + not toggleable.
    expect(types).toContain("notStarted");
  });

  it("toggles a stage open from its button and closed again from the X", () => {
    const { ref } = renderViz();
    expect(ref.current.state.stagesOpened[0]).toBe(false);

    fireEvent.click(stageButtonFor("Host Filtering"));
    expect(ref.current.state.stagesOpened[0]).toBe(true);
    // Toggling pushes the new state into the URL.
    expect(window.history.state[0]).toBe(true);

    fireEvent.click(screen.getAllByTestId("x-close-icon")[0]);
    expect(ref.current.state.stagesOpened[0]).toBe(false);
  });

  it("renders inter-stage arrows and colors them from the hover state", () => {
    const { ref, container } = renderViz();
    // 3 Illumina stage names -> 2 arrows between them (each arrow head is an
    // svg, as is each stage's close icon).
    const arrowCount = () =>
      container.querySelectorAll("svg").length -
      screen.getAllByTestId("x-close-icon").length;
    expect(arrowCount()).toBe(2);

    // Default (empty) arrow value renders with no coloring class; the "from"
    // and "to" values take the other two switch branches.
    act(() => ref.current.setState({ interStageArrows: ["from", "to", ""] }));
    expect(arrowCount()).toBe(2);
    expect(ref.current.state.interStageArrows).toEqual(["from", "to", ""]);
  });
});

describe("PipelineViz node interaction", () => {
  it("opens the sidebar with de-duplicated output files when a node is clicked", () => {
    renderViz();
    mockNodeAtResult = 0;

    // The alignment graph's single step consumes both stage-0 leaves.
    act(() =>
      mockGraphInstances[1].options.onClick({
        pointer: { DOM: { x: 10, y: 10 } },
      }),
    );

    const sidebar = screen.getByTestId("details-sidebar");
    expect(sidebar.dataset.visible).toBe("true");
    expect(sidebar.dataset.step).toBe("GSNAP");
    // Other stages are deselected, the clicked one is selected.
    expect(mockGraphInstances[0].unselectAll).toHaveBeenCalled();
    expect(mockGraphInstances[1].selectNodes).toHaveBeenCalledWith([0]);

    fireEvent.click(screen.getByTestId("close-sidebar"));
    expect(screen.getByTestId("details-sidebar").dataset.visible).toBe("false");
    expect(mockGraphInstances[1].unselectAll).toHaveBeenCalled();
  });

  it("labels the originating step for inputs that come from another step", () => {
    renderViz();
    mockNodeAtResult = 2; // Trimmomatic, fed intra-stage by Star.

    act(() =>
      mockGraphInstances[0].options.onClick({
        pointer: { DOM: { x: 1, y: 1 } },
      }),
    );
    expect(screen.getByTestId("details-sidebar").dataset.step).toBe(
      "Trimmomatic",
    );
  });

  it("ignores a click that does not land on a node", () => {
    renderViz();
    mockNodeAtResult = null;

    act(() =>
      mockGraphInstances[0].options.onClick({
        pointer: { DOM: { x: 1, y: 1 } },
      }),
    );
    expect(screen.getByTestId("details-sidebar").dataset.visible).toBe("false");
    expect(mockGraphInstances[0].selectNodes).not.toHaveBeenCalled();
  });
});

describe("PipelineViz mouse move, hover and blur", () => {
  const graphDivFor = (container: HTMLElement, index: number) =>
    container.querySelectorAll(
      "[data-testid='panzoom'] > div > div > div > div",
    )[index] as HTMLElement;

  it("hovers a node, colors the connecting edges and blurs it on the way out", () => {
    const { ref, container } = renderViz();
    const alignmentGraphDiv = container.querySelectorAll(
      "[data-testid='panzoom'] div",
    );
    // Find the mouse-move target belonging to the second stage by walking the
    // graph containers the component registered.
    const target = mockGraphInstances[1].container as HTMLElement;
    expect(alignmentGraphDiv.length).toBeGreaterThan(0);

    mockNodeAtResult = 0;
    fireEvent.mouseMove(target, { clientX: 200, clientY: 200 });

    // The hovered node gets re-colored and the cross-stage input edge is lit up
    // on the PREVIOUS stage's graph.
    expect(mockGraphInstances[1].updateNodes).toHaveBeenCalledWith(
      [0],
      expect.any(Object),
    );
    expect(mockGraphInstances[0].updateEdges).toHaveBeenCalledWith(
      ["2--2-colored"],
      expect.objectContaining({ width: 2, hidden: false }),
    );
    expect(ref.current.state.hovered).toBe(true);
    expect(ref.current.state.interStageArrows[0]).toBe("from");

    // A tiny movement is below the threshold and is dropped.
    const callsBefore = mockGraphInstances[1].updateNodes.mock.calls.length;
    fireEvent.mouseMove(target, { clientX: 202, clientY: 200 });
    expect(mockGraphInstances[1].updateNodes.mock.calls.length).toBe(
      callsBefore,
    );

    // Moving off the node blurs it and resets the arrows.
    mockNodeAtResult = null;
    fireEvent.mouseMove(target, { clientX: 400, clientY: 400 });
    expect(ref.current.state.hovered).toBe(false);
    expect(ref.current.state.interStageArrows).toEqual(["", "", ""]);
  });

  it("lights up downstream stages when hovering a node that feeds forward", () => {
    const { ref } = renderViz();
    const target = mockGraphInstances[0].container as HTMLElement;

    mockNodeAtResult = 2; // Trimmomatic -> GSNAP in the next stage.
    fireEvent.mouseMove(target, { clientX: 150, clientY: 150 });

    expect(mockGraphInstances[1].updateEdges).toHaveBeenCalledWith(
      ["-1-0-colored"],
      expect.objectContaining({ width: 2 }),
    );
    expect(ref.current.state.interStageArrows[0]).toBe("to");
  });

  it("does nothing on blur when no node was ever hovered", () => {
    const { ref } = renderViz();
    ref.current.handleNodeBlur();
    expect(ref.current.state.hovered).toBe(false);
  });
});

describe("PipelineViz zoom, resize and lifecycle", () => {
  it("delegates zoom in/out to the pan-zoom container", () => {
    const { ref } = renderViz();
    ref.current.handleZoom(true)();
    ref.current.handleZoom(false)();
    expect(ref.current.panZoomContainer.current.zoomIn).toHaveBeenCalledWith(3);
    expect(ref.current.panZoomContainer.current.zoomOut).toHaveBeenCalledWith(
      3,
    );
  });

  it("skips zooming when the pan-zoom container has not mounted", () => {
    const { ref } = renderViz();
    ref.current.panZoomContainer = { current: null };
    expect(() => ref.current.handleZoom(true)()).not.toThrow();
  });

  it("only re-fits the graphs of stages that are open on resize", () => {
    const { ref } = renderViz();
    mockGraphInstances.forEach((g: $TSFixMe) =>
      g.minimizeSizeGivenScale.mockClear(),
    );
    // Stage 0 was auto-closed at mount, stage 1 is still open.
    expect(ref.current.state.stagesOpened).toEqual([false, true, false]);

    fireEvent(window, new Event("resize"));
    expect(mockGraphInstances[0].minimizeSizeGivenScale).not.toHaveBeenCalled();
    expect(mockGraphInstances[1].minimizeSizeGivenScale).toHaveBeenCalledWith(
      1.0,
    );
  });

  it("stops polling when unmounted", () => {
    const clearSpy = jest.spyOn(window, "clearInterval");
    const { unmount } = renderViz();
    unmount();
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it("does not start a poll loop for an already finished pipeline", () => {
    const setSpy = jest.spyOn(window, "setInterval");
    const { ref } = renderViz({ status: "finished" });
    expect(ref.current.pipelineIsFinished()).toBe(true);
    expect(setSpy).not.toHaveBeenCalled();
    setSpy.mockRestore();
  });
});

describe("PipelineViz.updateGraphs", () => {
  it("recolors nodes of an existing stage when a step status changes", async () => {
    const { ref } = renderViz();
    const updated = makeGraphData("running");
    updated.stages[1].steps[0].status = "finished";
    mockGetGraph.mockResolvedValue(updated);

    await act(async () => {
      await ref.current.updateGraphs();
    });

    expect(mockGetGraph).toHaveBeenCalledWith(42, "8.1");
    expect(mockGraphInstances[1].updateNodes).toHaveBeenCalledWith(
      [0],
      expect.objectContaining({ group: "finished" }),
    );
    // Only two graphs existed before and no new stage arrived.
    expect(mockGraphInstances).toHaveLength(2);
  });

  it("draws a not-yet-drawn stage and re-colors the preceding stages' edges", async () => {
    const { ref } = renderViz();
    // Simulate the alignment stage having appeared in the poll response before
    // any graph existed for it: drop the graph the mount created.
    ref.current.graphs.pop();
    mockGraphInstances[0].updateEdges.mockClear();

    const updated = makeGraphData("running");
    updated.stages[1].steps[0].status = "finished";
    mockGetGraph.mockResolvedValue(updated);

    await act(async () => {
      await ref.current.updateGraphs();
    });

    // A fresh NetworkGraph was constructed for the newly arrived stage...
    expect(mockGraphInstances).toHaveLength(3);
    expect(ref.current.graphs).toHaveLength(2);
    // ...and the earlier stage had its edges refreshed so the hand-off renders.
    expect(mockGraphInstances[0].updateEdges).toHaveBeenCalled();
  });

  it("stops polling once the refreshed graph reports the pipeline finished", async () => {
    const clearSpy = jest.spyOn(window, "clearInterval");
    const { ref } = renderViz();
    mockGetGraph.mockResolvedValue(makeGraphData("finished"));

    await act(async () => {
      await ref.current.updateGraphs();
    });

    expect(ref.current.pipelineIsFinished()).toBe(true);
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it("makes no graph changes when nothing about the stages changed", async () => {
    const { ref } = renderViz();
    mockGraphInstances.forEach((g: $TSFixMe) => g.updateNodes.mockClear());
    mockGetGraph.mockResolvedValue(makeGraphData("running"));

    await act(async () => {
      await ref.current.updateGraphs();
    });

    expect(mockGraphInstances[0].updateNodes).not.toHaveBeenCalled();
    expect(mockGraphInstances[1].updateNodes).not.toHaveBeenCalled();
  });
});
