// Branch coverage for the DiscoveryMap shape markers:
//   app/assets/src/components/views/DiscoveryView/components/DiscoveryMap/components/ShapeMarker/ShapeMarker.tsx
//   .../ShapeMarker/components/CircleMarker/CircleMarker.tsx
//   .../ShapeMarker/components/RectangleMarker/RectangleMarker.tsx
//
// The conditionals under test are ShapeMarker's `size || clamp(...)` override
// and its `rectangular ? Rectangle : Circle` fork, plus the `onMouseEnter &&`
// / `active &&` short circuits inside both leaf markers. react-map-gl needs
// WebGL, so <Marker> is stubbed with a passthrough that records the
// latitude/longitude ShapeMarker hands it.
import { fireEvent, render, screen } from "@testing-library/react";

let capturedMarkerProps: $TSFixMe = null;

jest.mock("react-map-gl", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    Marker: (props: $TSFixMe) => {
      capturedMarkerProps = props;
      return ReactLib.createElement(
        "div",
        { "data-testid": "marker" },
        props.children,
      );
    },
  };
});

import ShapeMarker from "~/components/views/DiscoveryView/components/DiscoveryMap/components/ShapeMarker/ShapeMarker";
import CircleMarker from "~/components/views/DiscoveryView/components/DiscoveryMap/components/ShapeMarker/components/CircleMarker/CircleMarker";
import RectangleMarker from "~/components/views/DiscoveryView/components/DiscoveryMap/components/ShapeMarker/components/RectangleMarker/RectangleMarker";

beforeEach(() => {
  capturedMarkerProps = null;
});

const circleOf = (container: HTMLElement) =>
  container.querySelector("circle") as SVGCircleElement;
const svgOf = (container: HTMLElement) =>
  container.querySelector("svg") as SVGSVGElement;

describe("ShapeMarker size override branch", () => {
  it("uses the explicit size prop verbatim, skipping the clamp", () => {
    const { container } = render(
      <ShapeMarker lat={10} lng={-20} size={44} pointCount={100} />,
    );

    // size || clamp(...) -- truthy arm
    expect(svgOf(container).getAttribute("height")).toBe("44");
    expect(circleOf(container).getAttribute("r")).toBe("22");
    expect(capturedMarkerProps.latitude).toBe(10);
    expect(capturedMarkerProps.longitude).toBe(-20);
  });

  it("computes a clamped size from pointCount when size is absent", () => {
    // defaultProps: divisorConst 400, sizeMultiple 60, zoom 3, min 10, max 90.
    // (100 / (100 + 400)) * 60 * 3 = 36, inside [10, 90].
    const { container } = render(
      <ShapeMarker lat={0} lng={0} pointCount={100} />,
    );

    expect(svgOf(container).getAttribute("height")).toBe("36");
    expect(circleOf(container).getAttribute("r")).toBe("18");
  });

  it("clamps the computed size up to minSize for tiny point counts", () => {
    // (1 / 401) * 60 * 3 = 0.449 -> clamped to minSize 10.
    const { container } = render(
      <ShapeMarker lat={0} lng={0} pointCount={1} />,
    );

    expect(svgOf(container).getAttribute("height")).toBe("10");
  });

  it("clamps the computed size down to maxSize for huge point counts", () => {
    // (100000 / 100400) * 60 * 3 = 179.2 -> clamped to maxSize 90.
    const { container } = render(
      <ShapeMarker lat={0} lng={0} pointCount={100000} />,
    );

    expect(svgOf(container).getAttribute("height")).toBe("90");
  });
});

describe("ShapeMarker rectangular branch", () => {
  it("renders a RectangleMarker carrying the title when rectangular", () => {
    const onClick = jest.fn();
    const { container } = render(
      <ShapeMarker
        lat={1}
        lng={2}
        rectangular={true}
        title="San Francisco"
        onClick={onClick}
      />,
    );

    expect(container.querySelector("svg")).toBeNull();
    expect(screen.getByText("San Francisco")).toBeTruthy();
    fireEvent.click(screen.getByText("San Francisco"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders a CircleMarker when rectangular is falsy", () => {
    const { container } = render(
      <ShapeMarker
        lat={1}
        lng={2}
        title="ignored by circles"
        pointCount={100}
      />,
    );

    expect(container.querySelector("svg")).toBeTruthy();
    expect(screen.queryByText("ignored by circles")).toBeNull();
  });
});

describe("CircleMarker short-circuit branches", () => {
  it("wires up all three handlers when they are supplied", () => {
    const onMouseEnter = jest.fn();
    const onMouseLeave = jest.fn();
    const onClick = jest.fn();
    const { container } = render(
      <CircleMarker
        active={true}
        size={30}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onClick={onClick}
      />,
    );

    const circle = circleOf(container);
    fireEvent.mouseEnter(circle);
    fireEvent.mouseLeave(circle);
    fireEvent.click(circle);

    expect(onMouseEnter).toHaveBeenCalledTimes(1);
    expect(onMouseLeave).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("falls back to the default size and stays inert without handlers or active", () => {
    const { container } = render(<CircleMarker />);

    const svg = svgOf(container);
    // defaultProps size = 20 -> viewBox 0 0 20 20, offset by half the size.
    expect(svg.getAttribute("height")).toBe("20");
    expect(svg.getAttribute("viewBox")).toBe("0 0 20 20");
    expect(svg.style.transform).toBe("translate(-10px, -10px)");
    expect(circleOf(container).getAttribute("r")).toBe("10");
  });
});

describe("RectangleMarker short-circuit branches", () => {
  it("wires up all three handlers when they are supplied", () => {
    const onMouseEnter = jest.fn();
    const onMouseLeave = jest.fn();
    const onClick = jest.fn();
    render(
      <RectangleMarker
        active={true}
        title="Oakland"
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onClick={onClick}
      />,
    );

    const box = screen.getByText("Oakland");
    fireEvent.mouseEnter(box);
    fireEvent.mouseLeave(box);
    fireEvent.click(box);

    expect(onMouseEnter).toHaveBeenCalledTimes(1);
    expect(onMouseLeave).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders an empty box when neither handlers, active nor title are given", () => {
    const { container } = render(<RectangleMarker />);

    const box = container.firstElementChild as HTMLElement;
    expect(box.tagName).toBe("DIV");
    expect(box.textContent).toBe("");
  });
});
