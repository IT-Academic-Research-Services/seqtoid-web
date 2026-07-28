// Coverage: app/assets/src/components/views/DiscoveryView/components/DiscoveryMap/components/BaseMap/BaseMap.tsx
//
// BaseMap is a thin class wrapper around react-map-gl's <MapGL>. react-map-gl
// pulls in WebGL (unavailable in jsdom), so it is stubbed with a component that
// simply renders its children and captures the props BaseMap computes -- the
// style URL, the initial viewport (defaultProps) and the onViewportChange /
// onLoad callbacks. The assertions land on the clamping logic in updateViewport
// (limitToRange against the default viewBounds) and the compact-attribution DOM
// side effect.
import { act, render, screen } from "@testing-library/react";

let capturedMapProps: $TSFixMe = null;
let capturedNavProps: $TSFixMe = null;

jest.mock("react-map-gl", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: (props: $TSFixMe) => {
      capturedMapProps = props;
      return ReactLib.createElement(
        "div",
        { "data-testid": "map-gl", "data-mapstyle": props.mapStyle },
        props.children,
      );
    },
    NavigationControl: (props: $TSFixMe) => {
      capturedNavProps = props;
      return ReactLib.createElement("div", { "data-testid": "nav-control" });
    },
  };
});

import BaseMap, {
  MAP_STYLE_ID,
} from "~/components/views/DiscoveryView/components/DiscoveryMap/components/BaseMap/BaseMap";

beforeEach(() => {
  capturedMapProps = null;
  capturedNavProps = null;
  document.body.innerHTML = "";
});

describe("BaseMap render", () => {
  it("builds the MapTiler style URL from the style id and key", () => {
    render(<BaseMap mapTilerKey="secret-key" />);
    expect(capturedMapProps.mapStyle).toBe(
      `https://api.maptiler.com/maps/${MAP_STYLE_ID}/style.json?key=secret-key`,
    );
    expect(screen.getByTestId("nav-control")).toBeTruthy();
  });

  it("renders the banner, markers, popups and tooltip children", () => {
    render(
      <BaseMap
        mapTilerKey="k"
        banner={<div data-testid="my-banner" />}
        markers={<div data-testid="my-marker" />}
        popups={<div data-testid="my-popup" />}
        tooltip={<div data-testid="my-tooltip" />}
      />,
    );
    expect(screen.getByTestId("my-banner")).toBeTruthy();
    expect(screen.getByTestId("my-marker")).toBeTruthy();
    expect(screen.getByTestId("my-popup")).toBeTruthy();
    expect(screen.getByTestId("my-tooltip")).toBeTruthy();
  });

  it("seeds the viewport from defaultProps when no position is given", () => {
    render(<BaseMap mapTilerKey="k" />);
    // defaultProps: latitude 27, longitude 0, zoom 1.4, width/height "100%".
    expect(capturedMapProps.latitude).toBe(27);
    expect(capturedMapProps.longitude).toBe(0);
    expect(capturedMapProps.zoom).toBe(1.4);
    expect(capturedMapProps.width).toBe("100%");
    expect(capturedMapProps.height).toBe("100%");
  });

  it("seeds the viewport from explicit position props", () => {
    render(
      <BaseMap
        mapTilerKey="k"
        latitude={10}
        longitude={20}
        zoom={5}
        width={640}
        height={480}
      />,
    );
    expect(capturedMapProps.latitude).toBe(10);
    expect(capturedMapProps.longitude).toBe(20);
    expect(capturedMapProps.zoom).toBe(5);
    expect(capturedMapProps.width).toBe(640);
  });

  it("wires the same updateViewport handler to the map and nav control", () => {
    render(<BaseMap mapTilerKey="k" />);
    expect(typeof capturedMapProps.onViewportChange).toBe("function");
    expect(capturedNavProps.onViewportChange).toBe(
      capturedMapProps.onViewportChange,
    );
  });
});

describe("BaseMap updateViewport clamping", () => {
  it("clamps latitude, longitude and zoom to the default viewBounds", () => {
    const updateViewport = jest.fn();
    render(<BaseMap mapTilerKey="k" updateViewport={updateViewport} />);
    act(() =>
      capturedMapProps.onViewportChange({
        latitude: 200,
        longitude: -400,
        zoom: 99,
      }),
    );
    const reported = updateViewport.mock.calls[0][0];
    // Default viewBounds: lat [-60,60], lng [-180,180], zoom [1.2,17].
    expect(reported.latitude).toBe(60);
    expect(reported.longitude).toBe(-180);
    expect(reported.zoom).toBe(17);
    // width/height are re-applied from props on every viewport change.
    expect(reported.width).toBe("100%");
    expect(reported.height).toBe("100%");
  });

  it("clamps to the lower bounds and leaves in-range values untouched", () => {
    const updateViewport = jest.fn();
    render(<BaseMap mapTilerKey="k" updateViewport={updateViewport} />);
    act(() =>
      capturedMapProps.onViewportChange({
        latitude: -999,
        longitude: 0,
        zoom: 0,
      }),
    );
    const reported = updateViewport.mock.calls[0][0];
    expect(reported.latitude).toBe(-60);
    expect(reported.longitude).toBe(0);
    expect(reported.zoom).toBe(1.2);
  });

  it("propagates the clamped viewport into the map on re-render", () => {
    render(<BaseMap mapTilerKey="k" />);
    act(() => capturedMapProps.onViewportChange({ latitude: 100, zoom: 8 }));
    // After setState, the map re-renders with the stored (clamped) viewport.
    expect(capturedMapProps.latitude).toBe(60);
    expect(capturedMapProps.zoom).toBe(8);
  });

  it("does not throw when no updateViewport handler is provided", () => {
    render(<BaseMap mapTilerKey="k" />);
    expect(() =>
      act(() => capturedMapProps.onViewportChange({ latitude: 5, zoom: 3 })),
    ).not.toThrow();
  });
});

describe("BaseMap compact attribution", () => {
  it("adds the compact class to an existing attribution tag on load", () => {
    const tag = document.createElement("div");
    tag.className = "mapboxgl-ctrl-attrib";
    document.body.appendChild(tag);
    render(<BaseMap mapTilerKey="k" />);
    act(() => capturedMapProps.onLoad());
    expect(tag.classList.contains("mapboxgl-compact")).toBe(true);
  });

  it("is a no-op when there is no attribution tag in the DOM", () => {
    render(<BaseMap mapTilerKey="k" />);
    expect(() => act(() => capturedMapProps.onLoad())).not.toThrow();
  });
});
