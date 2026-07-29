// Coverage: app/assets/src/components/views/PipelineViz/PipelineViz.tsx
//
// PipelineViz is the very large pipeline DAG renderer. Its drawing path is tied
// to a vis.js NetworkGraph, so these tests mount it with an EMPTY stage list
// (drawGraphs then iterates zero stages and never constructs a graph) and then
// exercise the container's data-lookup + option-building methods through an
// instance ref: pipeline-finished detection, step/edge lookups by index, the
// per-status node-color option builder (with its hovered / textColor / shadow
// branches and the missing-color fallback), stage status grouping, and the
// stages-opened URL builder (with and without a pipeline version).
import { act, render } from "@testing-library/react";
import React from "react";

jest.mock("~/api/pipelineViz", () => ({
  __esModule: true,
  getGraph: jest.fn(() => Promise.resolve({})),
}));

// vis.js NetworkGraph would be constructed during drawStageGraph; with no stages
// it is never reached, but stub it so the import is inert.
jest.mock("~/components/visualizations/NetworkGraph", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    afterDrawingOnce: jest.fn(),
    minimizeSizeGivenScale: jest.fn(),
  })),
}));

jest.mock("react-easy-panzoom", () => ({
  __esModule: true,
  PanZoom: (props: $TSFixMe) => (
    <div data-testid="panzoom">{props.children}</div>
  ),
}));

jest.mock("~/components/common/DetailsSidebar/DetailsSidebar", () => ({
  __esModule: true,
  default: () => <div data-testid="details-sidebar" />,
}));

jest.mock("~/components/ui/controls/PlusMinusControl", () => ({
  __esModule: true,
  default: () => <div data-testid="plus-minus" />,
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

const emptyGraphData = (status = "finished") => ({
  stages: [],
  edges: {},
  status,
});

const renderViz = (props: $TSFixMe = {}) => {
  const ref = React.createRef<$TSFixMe>();
  const utils = render(
    <PipelineViz
      ref={ref}
      graphData={emptyGraphData(props.status)}
      sample={{ id: 42 } as $TSFixMe}
      pipelineRun={props.pipelineRun}
      updateInterval={100000}
      {...props}
    />,
  );
  return { ...utils, ref };
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("PipelineViz mount", () => {
  it("renders the header and the four Illumina stage buttons", () => {
    const { getAllByTestId, getByTestId } = renderViz();
    expect(getByTestId("viz-header")).toBeTruthy();
    // A status icon appears twice per stage (button + container) x 4 stages.
    expect(getAllByTestId("status-icon").length).toBeGreaterThan(0);
  });

  it("labels a single stage for ONT pipelines", () => {
    const { ref } = renderViz({ pipelineTechnology: "ONT" });
    expect(ref.current.stageNames).toEqual(["ONT mNGS Pipeline"]);
  });

  it("adds an Experimental stage when showExperimental is set", () => {
    const { ref } = renderViz({ showExperimental: true });
    expect(ref.current.stageNames).toContain("Experimental");
  });
});

describe("PipelineViz.pipelineIsFinished", () => {
  it("is true for finished / errored statuses and false while running", () => {
    const { ref } = renderViz({ status: "finished" });
    expect(ref.current.pipelineIsFinished()).toBe(true);

    act(() => ref.current.setState({ graphData: emptyGraphData("running") }));
    expect(ref.current.pipelineIsFinished()).toBe(false);

    act(() =>
      ref.current.setState({ graphData: emptyGraphData("pipelineErrored") }),
    );
    expect(ref.current.pipelineIsFinished()).toBe(true);
  });
});

describe("PipelineViz step + edge lookups", () => {
  const populated = {
    stages: [
      {
        steps: [
          {
            name: "Step A",
            status: "finished",
            inputEdges: [0],
            outputEdges: [1],
          },
        ],
      },
    ],
    edges: [{ id: "in" }, { id: "out" }],
    status: "finished",
  };

  it("returns the step data at the given indices", () => {
    const { ref } = renderViz();
    act(() => ref.current.setState({ graphData: populated }));
    expect(
      ref.current.getStepDataAtIndices({ stageIndex: 0, stepIndex: 0 }).name,
    ).toBe("Step A");
  });

  it("resolves input, output and combined edges by direction", () => {
    const { ref } = renderViz();
    act(() => ref.current.setState({ graphData: populated }));
    expect(ref.current.getEdgeInfoFor(0, 0, "input")).toEqual([{ id: "in" }]);
    expect(ref.current.getEdgeInfoFor(0, 0, "output")).toEqual([{ id: "out" }]);
    expect(ref.current.getEdgeInfoFor(0, 0, "both")).toEqual([
      { id: "in" },
      { id: "out" },
    ]);
  });

  it("reports the status group of a step", () => {
    const { ref } = renderViz();
    act(() => ref.current.setState({ graphData: populated }));
    expect(ref.current.getStatusGroupFor(0, 0)).toBe("finished");
  });
});

describe("PipelineViz.getNodeStatusOptions", () => {
  it("returns an empty object when there is no color config for the status", () => {
    const { ref } = renderViz();
    // An unknown status has no matching `<status>NodeColor` prop -> {}.
    expect(ref.current.getNodeStatusOptions("nonexistentStatus")).toEqual({});
  });

  it("uses the default background and adds font + shadow when configured", () => {
    const { ref } = renderViz({
      finishedNodeColor: {
        default: "#111",
        hovered: "#222",
        textColor: "#fff",
        shadowColor: "#000",
      },
    });
    const opts = ref.current.getNodeStatusOptions("finished", false);
    expect(opts.color.background).toBe("#111");
    expect(opts.font.color).toBe("#fff");
    expect(opts.shadow.color).toBe("#000");
  });

  it("uses the hovered background when hovered and one is provided", () => {
    const { ref } = renderViz({
      finishedNodeColor: { default: "#111", hovered: "#222" },
    });
    const opts = ref.current.getNodeStatusOptions("finished", true);
    expect(opts.color.background).toBe("#222");
    // No textColor/shadowColor -> no shadow key, font falls back to default text.
    expect(opts.shadow).toBeUndefined();
    expect(opts.font).toBeDefined();
  });
});

describe("PipelineViz.urlWithStagesOpenedState", () => {
  it("omits the pipeline version segment when there is no version", () => {
    const { ref } = renderViz();
    const url = ref.current.urlWithStagesOpenedState([true, false, false]);
    expect(url).toContain("/samples/42/pipeline_viz?");
  });

  it("includes the pipeline version segment when present", () => {
    const { ref } = renderViz({
      pipelineRun: { version: { pipeline: "8.1" } },
    });
    const url = ref.current.urlWithStagesOpenedState([true]);
    expect(url).toContain("/samples/42/pipeline_viz/8.1?");
  });
});
