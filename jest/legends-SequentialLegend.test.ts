// Frontend coverage: app/assets/src/components/visualizations/legends/SequentialLegend.ts
//
// SequentialLegend (exported as HeatmapLegend) is a plain d3 class rather than a
// React component, so it is driven directly against a jsdom container: build it,
// call update(), and assert on the SVG it emits -- how many colour cells, what
// fill each one has, the min/max labels, and where they are placed.
//
// The branches that matter are the option defaults: colours are generated from
// the d3 sequential scale only when the caller does not supply them, and the
// caller's options override every default. Both arms are exercised.
import SequentialLegend from "~/components/visualizations/legends/SequentialLegend";

const makeContainer = (): HTMLElement => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  return container;
};

const svgOf = (container: HTMLElement) =>
  container.querySelector("svg") as SVGSVGElement;

const cellsOf = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("rect"));

const labelsOf = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("text"));

afterEach(() => {
  document.body.innerHTML = "";
});

describe("SequentialLegend setup", () => {
  it("appends a single svg.legend sized from the options", () => {
    const container = makeContainer();
    new SequentialLegend(container, { width: 200, height: 40 });

    const svg = svgOf(container);
    expect(svg).not.toBeNull();
    expect(svg.getAttribute("class")).toBe("legend");
    expect(svg.getAttribute("width")).toBe("200");
    expect(svg.getAttribute("height")).toBe("40");
    // one <g> for the wrapper, one for the cells, one for the labels
    expect(container.querySelectorAll("g")).toHaveLength(3);
  });

  it("falls back to the container width and the default height", () => {
    const container = makeContainer();
    // jsdom reports clientWidth === 0, which is exactly the fallback path.
    Object.defineProperty(container, "clientWidth", { value: 123 });
    new SequentialLegend(container, {});

    const svg = svgOf(container);
    expect(svg.getAttribute("width")).toBe("123");
    expect(svg.getAttribute("height")).toBe("25");
  });

  it("renders no cells until update() is called", () => {
    const container = makeContainer();
    new SequentialLegend(container, { width: 100 });
    expect(cellsOf(container)).toHaveLength(0);
    expect(labelsOf(container)).toHaveLength(0);
  });
});

describe("SequentialLegend colour defaults", () => {
  it("generates numberOfLevels colours when none are supplied", () => {
    const container = makeContainer();
    const legend = new SequentialLegend(container, {
      width: 100,
      numberOfLevels: 4,
    });

    expect(legend.options.colors).toHaveLength(4);
    // The YlOrRd interpolator returns rgb() strings; the ends must differ.
    legend.options.colors.forEach((color: string) =>
      expect(color).toMatch(/^rgb\(/),
    );
    expect(legend.options.colors[0]).not.toEqual(legend.options.colors[3]);
  });

  it("defaults to ten generated colours", () => {
    const container = makeContainer();
    const legend = new SequentialLegend(container, { width: 100 });
    expect(legend.options.colors).toHaveLength(10);
  });

  it("keeps caller-supplied colours untouched", () => {
    const container = makeContainer();
    const colors = ["#000000", "#ffffff"];
    const legend = new SequentialLegend(container, { width: 100, colors });
    expect(legend.options.colors).toBe(colors);
  });
});

describe("SequentialLegend.range", () => {
  it("returns the integers 0..n-1", () => {
    const container = makeContainer();
    const legend = new SequentialLegend(container, { width: 100 });
    expect(legend.range(5)).toEqual([0, 1, 2, 3, 4]);
  });

  it("returns an empty array for zero", () => {
    const container = makeContainer();
    const legend = new SequentialLegend(container, { width: 100 });
    expect(legend.range(0)).toEqual([]);
  });
});

describe("SequentialLegend.update", () => {
  it("draws one rect per colour, filled in order", () => {
    const container = makeContainer();
    const colors = ["#111111", "#222222", "#333333"];
    const legend = new SequentialLegend(container, {
      width: 300,
      colors,
      cellHeight: 12,
    });
    legend.update();

    const cells = cellsOf(container);
    expect(cells).toHaveLength(3);
    expect(cells.map(c => c.style.fill)).toEqual([
      "#111111",
      "#222222",
      "#333333",
    ]);
    cells.forEach(cell => {
      expect(cell.getAttribute("y")).toBe("0");
      expect(cell.getAttribute("height")).toBe("12");
    });
  });

  it("lays the cells out left to right at increasing x", () => {
    const container = makeContainer();
    const legend = new SequentialLegend(container, {
      width: 300,
      colors: ["#111111", "#222222", "#333333"],
    });
    legend.update();

    const xs = cellsOf(container).map(c => Number(c.getAttribute("x")));
    expect(xs[0]).toBeLessThan(xs[1]);
    expect(xs[1]).toBeLessThan(xs[2]);
  });

  it("labels the ends with the rounded min and max", () => {
    const container = makeContainer();
    const legend = new SequentialLegend(container, {
      width: 300,
      colors: ["#111111"],
      min: 2.4,
      max: 9.6,
    });
    legend.update();

    const labels = labelsOf(container);
    expect(labels).toHaveLength(2);
    expect(labels.map(l => l.textContent)).toEqual(["2", "10"]);
    labels.forEach(l => expect(l.getAttribute("class")).toBe("mono"));
  });

  it("abbreviates large bounds", () => {
    const container = makeContainer();
    const legend = new SequentialLegend(container, {
      width: 300,
      colors: ["#111111"],
      min: 0,
      max: 2000000,
    });
    legend.update();

    const labels = labelsOf(container);
    expect(labels[0].textContent).toBe("0");
    expect(labels[1].textContent).toBe("2m");
  });

  it("places the max label to the right of the min label", () => {
    const container = makeContainer();
    const legend = new SequentialLegend(container, {
      width: 300,
      colors: ["#111111", "#222222"],
      height: 30,
    });
    legend.update();

    const [minLabel, maxLabel] = labelsOf(container);
    expect(Number(maxLabel.getAttribute("x"))).toBeGreaterThan(
      Number(minLabel.getAttribute("x")),
    );
    // Both sit on the legend baseline.
    expect(minLabel.getAttribute("y")).toBe("30");
    expect(maxLabel.getAttribute("y")).toBe("30");
  });

  it("clears the previous drawing instead of stacking a second one", () => {
    const container = makeContainer();
    const legend = new SequentialLegend(container, {
      width: 300,
      colors: ["#111111", "#222222"],
    });
    legend.update();
    legend.update();
    legend.update();

    expect(cellsOf(container)).toHaveLength(2);
    expect(labelsOf(container)).toHaveLength(2);
  });
});

describe("SequentialLegend.updateOptions", () => {
  it("merges new options over the existing ones and redraws from them", () => {
    const container = makeContainer();
    const legend = new SequentialLegend(container, {
      width: 300,
      colors: ["#111111", "#222222"],
      min: 0,
      max: 10,
    });
    legend.update();
    expect(cellsOf(container)).toHaveLength(2);

    legend.updateOptions({ colors: ["#ff0000"], max: 50 });
    legend.update();

    const cells = cellsOf(container);
    expect(cells).toHaveLength(1);
    expect(cells[0].style.fill).toBe("#ff0000");
    // Untouched options survive the merge.
    expect(legend.options.width).toBe(300);
    expect(labelsOf(container).map(l => l.textContent)).toEqual(["0", "50"]);
  });
});
