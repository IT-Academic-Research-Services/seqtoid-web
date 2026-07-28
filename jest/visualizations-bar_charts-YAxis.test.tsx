// Coverage: app/assets/src/components/visualizations/bar_charts/YAxis.tsx
//
// YAxis is a pure presentational SVG component driven by a d3 band scale. It
// had no spec of its own -- the HorizontalStackedBarChart suite stubs it out --
// so all of its lines and its three conditionals were uncovered:
//   * `ticksVisible &&` around the tick line
//   * `pathVisible &&` around the spine path
//   * `Number(ticksVisible || pathVisible)` in the label offset, which has a
//     distinct result for (true,*), (false,true) and (false,false)
// Each of those is driven from both sides below, and the three label handlers
// are fired to assert the arguments they forward.
import { fireEvent, render } from "@testing-library/react";
import { scaleBand } from "d3-scale";
import YAxis from "~/components/visualizations/bar_charts/YAxis";

const DOMAIN = ["alpha", "beta", "gamma"];
const LABELS = ["Alpha label", "Beta label", "Gamma label"];

const makeScale = () => scaleBand().domain(DOMAIN).range([0, 90]);

const handlers = () => ({
  onYAxisLabelClick: jest.fn(),
  onYAxisLabelEnter: jest.fn(),
  onYAxisLabelExit: jest.fn(),
});

const baseProps = () => ({
  y: makeScale(),
  labels: LABELS,
  width: 120,
  height: 90,
  barHeight: 20,
  tickSize: 6,
  ticksVisible: true,
  pathVisible: true,
  textClassName: "y-text",
  ...handlers(),
});

describe("YAxis", () => {
  it("renders one label per domain entry, using the labels array not the domain keys", () => {
    const { container, getByText } = render(<YAxis {...baseProps()} />);
    const texts = Array.from(container.querySelectorAll("text"));
    expect(texts).toHaveLength(DOMAIN.length);
    expect(texts.map(t => t.textContent)).toEqual(LABELS);
    // The raw domain value is not what the user sees.
    expect(container.textContent).not.toContain("alpha");
    expect(getByText("Beta label")).toBeTruthy();
  });

  it("positions each label at its band position plus half the bar height", () => {
    const scale = makeScale();
    const { container } = render(
      <YAxis {...baseProps()} y={scale} barHeight={20} />,
    );
    const groups = Array.from(container.querySelectorAll("svg > g > g"));
    expect(groups).toHaveLength(DOMAIN.length);
    groups.forEach((g, i) => {
      expect(g.getAttribute("transform")).toBe(
        `translate(0, ${(scale(DOMAIN[i]) as number) + 10})`,
      );
    });
  });

  it("shifts the axis group right by the full width", () => {
    const { container } = render(<YAxis {...baseProps()} width={77} />);
    expect(
      (container.querySelector("svg > g") as SVGGElement).getAttribute(
        "transform",
      ),
    ).toBe("translate(77, 0)");
    expect(container.querySelector("svg")?.getAttribute("width")).toBe("77");
    expect(container.querySelector("svg")?.getAttribute("height")).toBe("90");
  });

  it("draws tick lines extending left by tickSize when ticksVisible is true", () => {
    const { container } = render(
      <YAxis {...baseProps()} ticksVisible={true} tickSize={9} />,
    );
    const lines = Array.from(container.querySelectorAll("line"));
    expect(lines).toHaveLength(DOMAIN.length);
    expect(lines[0].getAttribute("x1")).toBe("-9");
    expect(lines[0].getAttribute("stroke")).toBe("currentColor");
  });

  it("omits tick lines when ticksVisible is false", () => {
    const { container } = render(
      <YAxis {...baseProps()} ticksVisible={false} />,
    );
    expect(container.querySelectorAll("line")).toHaveLength(0);
    expect(container.querySelectorAll("text")).toHaveLength(DOMAIN.length);
  });

  it("draws the spine down the full height when pathVisible is true", () => {
    const { container } = render(
      <YAxis {...baseProps()} pathVisible={true} height={90} />,
    );
    const path = container.querySelector("path") as SVGPathElement;
    expect(path).not.toBeNull();
    expect(path.getAttribute("d")).toBe("M 0 0 v 90");
    expect(path.getAttribute("fill")).toBe("none");
  });

  it("omits the spine when pathVisible is false", () => {
    const { container } = render(
      <YAxis {...baseProps()} pathVisible={false} />,
    );
    expect(container.querySelector("path")).toBeNull();
  });

  it("pads labels away from the axis by tickSize when either ticks or the path are shown", () => {
    // ticks on, path off
    const { container: ticksOnly } = render(
      <YAxis
        {...baseProps()}
        ticksVisible={true}
        pathVisible={false}
        tickSize={6}
      />,
    );
    expect(
      (ticksOnly.querySelector("text") as SVGTextElement).getAttribute(
        "transform",
      ),
    ).toBe("translate(-13, 0)");

    // ticks off, path on -- still padded, exercising the right-hand side of the ||
    const { container: pathOnly } = render(
      <YAxis
        {...baseProps()}
        ticksVisible={false}
        pathVisible={true}
        tickSize={6}
      />,
    );
    expect(
      (pathOnly.querySelector("text") as SVGTextElement).getAttribute(
        "transform",
      ),
    ).toBe("translate(-13, 0)");
  });

  it("uses the bare 7px offset when neither ticks nor the path are shown", () => {
    const { container } = render(
      <YAxis
        {...baseProps()}
        ticksVisible={false}
        pathVisible={false}
        tickSize={6}
      />,
    );
    expect(
      (container.querySelector("text") as SVGTextElement).getAttribute(
        "transform",
      ),
    ).toBe("translate(-7, 0)");
  });

  it("applies the caller's text class", () => {
    const { container } = render(
      <YAxis {...baseProps()} textClassName="my-y-label" />,
    );
    expect(
      (container.querySelector("text") as SVGTextElement).getAttribute("class"),
    ).toContain("my-y-label");
  });

  it("forwards the domain value and index on click, the value on enter, and nothing on exit", () => {
    const events = handlers();
    const { getByText } = render(<YAxis {...baseProps()} {...events} />);

    fireEvent.click(getByText("Gamma label"));
    expect(events.onYAxisLabelClick).toHaveBeenCalledWith("gamma", 2);

    fireEvent.mouseEnter(getByText("Beta label"));
    expect(events.onYAxisLabelEnter).toHaveBeenCalledWith("beta");
    expect(events.onYAxisLabelEnter).toHaveBeenCalledTimes(1);

    fireEvent.mouseLeave(getByText("Beta label"));
    expect(events.onYAxisLabelExit).toHaveBeenCalledWith();
  });
});
