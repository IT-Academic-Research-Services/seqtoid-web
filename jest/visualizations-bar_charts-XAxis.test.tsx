// Coverage: app/assets/src/components/visualizations/bar_charts/XAxis.tsx
//
// XAxis is a pure presentational SVG component driven by a d3 continuous
// scale. It had no spec of its own -- the HorizontalStackedBarChart suite
// stubs it out -- so every line and both of its conditionals (ticksVisible,
// pathVisible) were uncovered.
//
// The scale is a real d3 scaleLinear rather than a fake, so the emitted
// transforms/offsets are the numbers the chart actually produces; assertions
// are on countable DOM outcomes (how many tick groups, which transform, the
// baseline path's `d`) rather than on d3 internals.
import { render } from "@testing-library/react";
import { scaleLinear } from "d3-scale";
import XAxis from "~/components/visualizations/bar_charts/XAxis";

/* eslint-disable @typescript-eslint/no-explicit-any */

const makeScale = () => scaleLinear().domain([0, 100]).range([0, 200]);

const baseProps = () => ({
  x: makeScale(),
  width: 300,
  marginLeft: 50,
  tickFormat: (value: any) => `${value}u`,
  tickSize: 6,
  tickCount: 5,
  ticksVisible: true,
  pathVisible: true,
  title: "Reads",
  titleClassName: "title-cls",
  textClassName: "text-cls",
  height: 30,
});

describe("XAxis", () => {
  it("renders one labelled tick group per scale tick, formatted and positioned by the scale", () => {
    const scale = makeScale();
    const { container } = render(<XAxis {...baseProps()} x={scale} />);

    const expectedTicks = scale.ticks(5);
    const texts = Array.from(container.querySelectorAll("text"));
    expect(texts).toHaveLength(expectedTicks.length);

    // Every tick label is run through tickFormat.
    expect(texts.map(t => t.textContent)).toEqual(
      expectedTicks.map(v => `${v}u`),
    );

    // ...and positioned at the scaled x offset of its value.
    const outerGroups = Array.from(
      container.querySelectorAll("svg > g > g[transform^='translate(']"),
    ).filter(g => g.querySelector("text"));
    expect(outerGroups[0].getAttribute("transform")).toBe(
      `translate(${scale(expectedTicks[0])}, 0)`,
    );
    expect(outerGroups[outerGroups.length - 1].getAttribute("transform")).toBe(
      `translate(${scale(expectedTicks[expectedTicks.length - 1])}, 0)`,
    );
  });

  it("centres tick text vertically at half the axis height", () => {
    const { container } = render(<XAxis {...baseProps()} height={30} />);
    const text = container.querySelector("text") as SVGTextElement;
    expect(text.getAttribute("transform")).toBe("translate(0, 15)");
    expect(text.getAttribute("text-anchor")).toBe("middle");
  });

  it("applies the caller's text class alongside the module class", () => {
    const { container } = render(
      <XAxis {...baseProps()} textClassName="my-text" />,
    );
    const text = container.querySelector("text") as SVGTextElement;
    expect(text.getAttribute("class")).toContain("my-text");
  });

  it("draws tick marks sized by tickSize when ticksVisible is true", () => {
    const { container } = render(
      <XAxis {...baseProps()} ticksVisible={true} tickSize={8} />,
    );
    const lines = Array.from(container.querySelectorAll("line"));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0].getAttribute("y2")).toBe("-8");
    expect(lines[0].getAttribute("stroke")).toBe("currentColor");
  });

  it("omits tick marks entirely when ticksVisible is false, but keeps the labels", () => {
    const { container } = render(
      <XAxis {...baseProps()} ticksVisible={false} />,
    );
    expect(container.querySelectorAll("line")).toHaveLength(0);
    expect(container.querySelectorAll("text").length).toBeGreaterThan(0);
  });

  it("draws the baseline path across the scale range when pathVisible is true", () => {
    const { container } = render(
      <XAxis {...baseProps()} pathVisible={true} height={30} />,
    );
    const path = container.querySelector("path") as SVGPathElement;
    expect(path).not.toBeNull();
    // range() is [0, 200] for the fixture scale.
    expect(path.getAttribute("d")).toBe("M 0 6 v -6 H 200 v 6");
    expect(path.getAttribute("fill")).toBe("none");
    expect(path.parentElement?.getAttribute("transform")).toBe(
      "translate(0, 30)",
    );
  });

  it("omits the baseline path when pathVisible is false", () => {
    const { container } = render(
      <XAxis {...baseProps()} pathVisible={false} />,
    );
    expect(container.querySelector("path")).toBeNull();
  });

  it("renders the title and insets it by marginLeft", () => {
    const { container, getByText } = render(
      <XAxis {...baseProps()} title="Reads" width={300} marginLeft={50} />,
    );
    const title = getByText("Reads") as HTMLElement;
    expect(title.style.width).toBe("250px");
    expect(title.style.marginLeft).toBe("50px");
    // The outer wrapper carries the full width.
    expect((title.parentElement as HTMLElement).style.width).toBe("300px");
    expect(container.querySelector("svg")?.getAttribute("width")).toBe("300");
  });

  it("shifts the whole axis group by marginLeft", () => {
    const { container } = render(<XAxis {...baseProps()} marginLeft={17} />);
    const group = container.querySelector("svg > g") as SVGGElement;
    expect(group.getAttribute("transform")).toBe("translate(17, 0)");
  });

  it("honours tickCount by producing a different number of ticks", () => {
    const scaleA = makeScale();
    const scaleB = makeScale();
    const { container: few } = render(
      <XAxis {...baseProps()} x={scaleA} tickCount={2} />,
    );
    const { container: many } = render(
      <XAxis {...baseProps()} x={scaleB} tickCount={10} />,
    );
    expect(many.querySelectorAll("text").length).toBeGreaterThan(
      few.querySelectorAll("text").length,
    );
  });
});
