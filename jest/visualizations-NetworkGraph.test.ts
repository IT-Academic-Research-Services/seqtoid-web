// Coverage for app/assets/src/components/visualizations/NetworkGraph.ts
//
// NetworkGraph is a thin, stateful adapter over vis.js: every method either
// forwards to the underlying Network/DataSet or performs a small coordinate
// computation on top of it. vis.js itself needs a real canvas, which jsdom does
// not provide, so the whole `visjs-network` module is replaced with a
// double that records what the adapter asked it to do. That is exactly the
// contract worth pinning here -- the adapter's own arithmetic and its
// translation of adapter calls into vis.js calls.
jest.mock("visjs-network", () => {
  class DataSet {
    items: $TSFixMe[];
    constructor(items: $TSFixMe[] = []) {
      this.items = items.map(item => ({ ...item }));
    }
    getIds(opts?: $TSFixMe) {
      const filter = opts && opts.filter;
      return this.items
        .filter(item => (filter ? filter(item) : true))
        .map(item => item.id);
    }
    get(id: $TSFixMe) {
      return this.items.find(item => item.id === id);
    }
    update(update: $TSFixMe) {
      const existing = this.items.find(item => item.id === update.id);
      if (existing) {
        Object.assign(existing, update);
      } else {
        this.items.push({ ...update });
      }
    }
  }

  class Network {
    container: $TSFixMe;
    data: $TSFixMe;
    options: $TSFixMe;
    handlers: Record<string, $TSFixMe>;
    onceHandlers: Record<string, $TSFixMe>;
    on: $TSFixMe;
    once: $TSFixMe;
    moveNode: $TSFixMe;
    moveTo: $TSFixMe;
    setSize: $TSFixMe;
    unselectAll: $TSFixMe;
    selectNodes: $TSFixMe;
    getNodeAt: $TSFixMe;
    getEdgeAt: $TSFixMe;
    getPositions: $TSFixMe;
    getBoundingBox: $TSFixMe;
    // The two coordinate transforms are inverses of each other so that a
    // round trip through them is easy to reason about in the assertions.
    DOMtoCanvas: $TSFixMe;
    canvasToDOM: $TSFixMe;

    constructor(container: $TSFixMe, data: $TSFixMe, options: $TSFixMe) {
      this.container = container;
      this.data = data;
      this.options = options;
      this.handlers = {};
      this.onceHandlers = {};
      this.on = jest.fn((name: string, handler: $TSFixMe) => {
        this.handlers[name] = handler;
      });
      this.once = jest.fn((name: string, handler: $TSFixMe) => {
        this.onceHandlers[name] = handler;
      });
      this.moveNode = jest.fn();
      this.moveTo = jest.fn();
      this.setSize = jest.fn();
      this.unselectAll = jest.fn();
      this.selectNodes = jest.fn();
      this.getNodeAt = jest.fn(() => "node-at");
      this.getEdgeAt = jest.fn(() => "edge-at");
      this.getPositions = jest.fn((ids: $TSFixMe[]) => ({
        [ids[0]]: { x: 10, y: 20 },
      }));
      // Node n occupies a 5-wide, 2-tall box starting at (n * 10, n).
      this.getBoundingBox = jest.fn((id: number) => ({
        left: id * 10,
        right: id * 10 + 5,
        top: id,
        bottom: id + 2,
      }));
      this.DOMtoCanvas = jest.fn(({ x, y }: $TSFixMe) => ({
        x: x * 2,
        y: y * 2,
      }));
      this.canvasToDOM = jest.fn(({ x, y }: $TSFixMe) => ({
        x: x / 2,
        y: y / 2,
      }));
    }
  }

  return { DataSet, Network };
});

import NetworkGraph from "~/components/visualizations/NetworkGraph";

const NODES = [
  { id: 1, label: "one" },
  { id: 2, label: "two" },
];
const EDGES = [
  { id: "e1", from: 1, to: 2, weight: 5 },
  { id: "e2", from: 2, to: 1, weight: 1 },
];

function buildGraph(options: $TSFixMe = {}) {
  const container = document.createElement("div");
  const callbacks = {
    onClick: jest.fn(),
    onNodeHover: jest.fn(),
    onNodeBlur: jest.fn(),
  };
  const graph = new NetworkGraph(container, NODES, EDGES, {
    ...callbacks,
    ...options,
  });
  return { graph, container, callbacks, network: (graph as $TSFixMe).graph };
}

describe("visualizations/NetworkGraph", () => {
  describe("constructor", () => {
    it("loads the nodes and edges into vis.js DataSets", () => {
      const { graph } = buildGraph();
      expect((graph as $TSFixMe).data.nodes.getIds()).toEqual([1, 2]);
      expect((graph as $TSFixMe).data.edges.getIds()).toEqual(["e1", "e2"]);
    });

    it("strips the event callbacks out of the options handed to vis.js", () => {
      const { network } = buildGraph({ physics: false, height: "100px" });
      expect(network.options).toEqual({ physics: false, height: "100px" });
      expect(network.options.onClick).toBeUndefined();
      expect(network.options.onNodeHover).toBeUndefined();
      expect(network.options.onNodeBlur).toBeUndefined();
    });

    it("wires the callbacks to the click, hoverNode and blurNode events", () => {
      const { network, callbacks } = buildGraph();
      expect(network.handlers.click).toBe(callbacks.onClick);
      expect(network.handlers.hoverNode).toBe(callbacks.onNodeHover);
      expect(network.handlers.blurNode).toBe(callbacks.onNodeBlur);
    });
  });

  describe("coordinate helpers", () => {
    it("moveNodeToPosition converts DOM coords to canvas coords first", () => {
      const { graph, network } = buildGraph();
      graph.moveNodeToPosition(1, 7, 9);
      expect(network.DOMtoCanvas).toHaveBeenCalledWith({ x: 7, y: 9 });
      expect(network.moveNode).toHaveBeenCalledWith(1, 14, 18);
    });

    it("getNodePosition converts the node's canvas position back to DOM", () => {
      const { graph, network } = buildGraph();
      expect(graph.getNodePosition(1)).toEqual({ x: 5, y: 10 });
      expect(network.getPositions).toHaveBeenCalledWith([1]);
    });

    it("getNodeAt and getEdgeAt forward the DOM point to vis.js", () => {
      const { graph, network } = buildGraph();
      expect(graph.getNodeAt(3, 4)).toBe("node-at");
      expect(network.getNodeAt).toHaveBeenCalledWith({ x: 3, y: 4 });
      expect(graph.getEdgeAt(5, 6)).toBe("edge-at");
      expect(network.getEdgeAt).toHaveBeenCalledWith({ x: 5, y: 6 });
    });
  });

  describe("data mutation", () => {
    it("getEdges returns every id when the filter accepts everything", () => {
      const { graph } = buildGraph();
      expect(graph.getEdges(() => true)).toEqual(["e1", "e2"]);
    });

    it("getEdges returns only the ids matching the filter", () => {
      const { graph } = buildGraph();
      expect(graph.getEdges((edge: $TSFixMe) => edge.weight > 2)).toEqual([
        "e1",
      ]);
    });

    it("getEdges returns an empty list when nothing matches", () => {
      const { graph } = buildGraph();
      expect(graph.getEdges(() => false)).toEqual([]);
    });

    it("updateEdges merges the options into each named edge only", () => {
      const { graph } = buildGraph();
      graph.updateEdges(["e2"], { color: "red" });
      expect((graph as $TSFixMe).data.edges.get("e2").color).toBe("red");
      expect((graph as $TSFixMe).data.edges.get("e1").color).toBeUndefined();
      // The pre-existing fields survive the merge.
      expect((graph as $TSFixMe).data.edges.get("e2").weight).toBe(1);
    });

    it("updateNodes merges the options into every named node", () => {
      const { graph } = buildGraph();
      graph.updateNodes([1, 2], { hidden: true });
      expect((graph as $TSFixMe).data.nodes.get(1).hidden).toBe(true);
      expect((graph as $TSFixMe).data.nodes.get(2).hidden).toBe(true);
      expect((graph as $TSFixMe).data.nodes.get(1).label).toBe("one");
    });

    it("updateNodes with an empty id list is a no-op", () => {
      const { graph } = buildGraph();
      graph.updateNodes([], { hidden: true });
      expect((graph as $TSFixMe).data.nodes.get(1).hidden).toBeUndefined();
    });
  });

  describe("minimizeSizeGivenScale", () => {
    it("sizes the canvas to the node bounding boxes and resets the zoom", () => {
      const { graph, network } = buildGraph();
      graph.minimizeSizeGivenScale(0.5);

      // Zoom is applied first so the DOM conversion below is measured at the
      // requested scale, then reset once the size has been set.
      expect(network.moveTo).toHaveBeenNthCalledWith(1, { scale: 0.5 });
      expect(network.moveTo).toHaveBeenNthCalledWith(2, {
        scale: 1,
        position: { x: 0, y: 0 },
      });

      // Boxes span canvas x 10..25 and y 1..4; canvasToDOM halves both.
      expect(network.canvasToDOM).toHaveBeenCalledWith({ x: 10, y: 1 });
      expect(network.canvasToDOM).toHaveBeenCalledWith({ x: 25, y: 4 });
      expect(network.setSize).toHaveBeenCalledWith("7.5px", 1.5);
    });
  });

  describe("selection and lifecycle passthroughs", () => {
    it("afterDrawingOnce registers a one-shot afterDrawing handler", () => {
      const { graph, network } = buildGraph();
      const handler = jest.fn();
      graph.afterDrawingOnce(handler);
      expect(network.onceHandlers.afterDrawing).toBe(handler);
    });

    it("unselectAll and selectNodes forward to vis.js", () => {
      const { graph, network } = buildGraph();
      graph.unselectAll();
      expect(network.unselectAll).toHaveBeenCalledTimes(1);
      graph.selectNodes([1, 2]);
      expect(network.selectNodes).toHaveBeenCalledWith([1, 2]);
    });
  });
});
