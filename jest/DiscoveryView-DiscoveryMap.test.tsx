// Coverage: app/assets/src/components/views/DiscoveryView/components/DiscoveryMap/DiscoveryMap.tsx
//
// DiscoveryMap is a thin controller around BaseMap: it turns the raw location
// hash into markers, throttles viewport/zoom-level reporting, and owns the
// hover tooltip lifecycle. BaseMap/ShapeMarker/MapTooltip/MapBanner pull in
// react-map-gl (WebGL, no jsdom support), so they are replaced with stubs that
// expose the props DiscoveryMap computes -- which is exactly what these tests
// assert on.
import { act, fireEvent, render, screen } from "@testing-library/react";

const mockTrackEvent = jest.fn();

jest.mock("~/api/analytics", () => ({
  useTrackEvent: () => mockTrackEvent,
}));

let capturedUpdateViewport: (viewport: $TSFixMe) => void = () => undefined;
let capturedMapOnClick: () => void = () => undefined;

jest.mock(
  "~/components/views/DiscoveryView/components/DiscoveryMap/components/BaseMap/BaseMap",
  () => ({
    __esModule: true,
    default: ({
      banner,
      markers,
      tooltip,
      updateViewport,
      onClick,
      mapTilerKey,
    }: $TSFixMe) => {
      capturedUpdateViewport = updateViewport;
      capturedMapOnClick = onClick;
      return (
        <div data-testid="base-map" data-maptilerkey={String(mapTilerKey)}>
          <div data-testid="banner">{banner}</div>
          <div data-testid="markers">{markers}</div>
          <div data-testid="tooltip">{tooltip}</div>
        </div>
      );
    },
  }),
);

jest.mock(
  "~/components/views/DiscoveryView/components/DiscoveryMap/components/MapBanner/MapBanner",
  () => ({
    __esModule: true,
    default: ({ item, itemCount, onClearFilters }: $TSFixMe) => (
      <div data-testid="map-banner">
        <span data-testid="banner-item">{item}</span>
        <span data-testid="banner-count">{itemCount}</span>
        <button data-testid="banner-clear" onClick={onClearFilters} />
      </div>
    ),
  }),
);

jest.mock(
  "~/components/views/DiscoveryView/components/DiscoveryMap/components/MapTooltip/MapTooltip",
  () => ({
    __esModule: true,
    default: ({
      title,
      body,
      onMouseEnter,
      onMouseLeave,
      onTitleClick,
    }: $TSFixMe) => (
      <div data-testid="map-tooltip">
        <span data-testid="tooltip-title" onClick={onTitleClick}>
          {title}
        </span>
        <span data-testid="tooltip-body">{body}</span>
        <button data-testid="tooltip-enter" onClick={onMouseEnter} />
        <button data-testid="tooltip-leave" onClick={onMouseLeave} />
      </div>
    ),
  }),
);

jest.mock(
  "~/components/views/DiscoveryView/components/DiscoveryMap/components/ShapeMarker/ShapeMarker",
  () => ({
    __esModule: true,
    default: ({
      active,
      title,
      pointCount,
      rectangular,
      zoom,
      onClick,
      onMouseEnter,
      onMouseLeave,
    }: $TSFixMe) => (
      <div
        data-testid="shape-marker"
        data-active={String(active)}
        data-rectangular={String(rectangular)}
        data-pointcount={String(pointCount)}
        data-zoom={String(zoom)}
        data-title={title}
      >
        <button data-testid={`marker-click-${title}`} onClick={onClick} />
        <button data-testid={`marker-enter-${title}`} onClick={onMouseEnter} />
        <button data-testid={`marker-leave-${title}`} onClick={onMouseLeave} />
      </div>
    ),
  }),
);

import {
  DEFAULT_THROTTLE_MS,
  DiscoveryMap,
  TOOLTIP_TIMEOUT_MS,
} from "~/components/views/DiscoveryView/components/DiscoveryMap/DiscoveryMap";

const locations = {
  1: {
    id: 1,
    name: "USA",
    lat: "37.09",
    lng: "-95.71",
    geo_level: "country",
    sample_ids: [1, 2, 3],
  },
  2: {
    id: 2,
    name: "California",
    lat: "36.77",
    lng: "-119.41",
    geo_level: "state",
    sample_ids: [2, 4],
  },
};

describe("DiscoveryMap markers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders one marker per location and marks the previewed one active", () => {
    render(
      <DiscoveryMap
        currentTab="samples"
        mapLevel="city"
        mapLocationData={locations}
        previewedLocationId={2}
        mapTilerKey="key-123"
      />,
    );
    const markers = screen.getAllByTestId("shape-marker");
    expect(markers).toHaveLength(2);
    expect(markers[0].getAttribute("data-active")).toBe("false");
    expect(markers[1].getAttribute("data-active")).toBe("true");
    expect(markers[0].getAttribute("data-title")).toBe("USA (3)");
    expect(markers[0].getAttribute("data-pointcount")).toBe("3");
    expect(
      screen.getByTestId("base-map").getAttribute("data-maptilerkey"),
    ).toBe("key-123");
  });

  it("uses rectangular markers only for cluster levels above the current map level", () => {
    const { rerender } = render(
      <DiscoveryMap
        currentTab="samples"
        mapLevel="city"
        mapLocationData={locations}
      />,
    );
    // country/state both sit above "city" in the level order -> rectangular.
    expect(
      screen
        .getAllByTestId("shape-marker")
        .map(m => m.getAttribute("data-rectangular")),
    ).toEqual(["true", "true"]);

    rerender(
      <DiscoveryMap
        currentTab="samples"
        mapLevel="country"
        mapLocationData={locations}
      />,
    );
    // At country level, the country marker is no longer "above" the map level.
    expect(
      screen
        .getAllByTestId("shape-marker")
        .map(m => m.getAttribute("data-rectangular")),
    ).toEqual(["false", "false"]);
  });

  it("skips locations with invalid coordinates and logs an error", () => {
    const spy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    render(
      <DiscoveryMap
        currentTab="samples"
        mapLevel="city"
        mapLocationData={{
          9: {
            id: 9,
            name: "Nowhere",
            lat: "not-a-number",
            lng: "0",
            geo_level: "country",
            sample_ids: [1],
          },
        }}
      />,
    );
    expect(screen.queryAllByTestId("shape-marker")).toHaveLength(0);
    expect(spy).toHaveBeenCalledWith("Invalid coordinates for Nowhere (9)");
    spy.mockRestore();
  });

  it("skips locations that have no ids for the current tab", () => {
    render(
      <DiscoveryMap
        currentTab="projects"
        mapLevel="city"
        mapLocationData={locations}
      />,
    );
    // The fixtures only carry sample_ids, so the projects tab renders nothing.
    expect(screen.queryAllByTestId("shape-marker")).toHaveLength(0);
  });

  it("renders no markers at all when there is no location data", () => {
    render(<DiscoveryMap currentTab="samples" mapLevel="city" />);
    expect(screen.queryAllByTestId("shape-marker")).toHaveLength(0);
  });
});

describe("DiscoveryMap banner", () => {
  it("de-duplicates ids across locations when counting samples", () => {
    render(
      <DiscoveryMap
        currentTab="samples"
        mapLevel="city"
        mapLocationData={locations}
      />,
    );
    // ids are 1,2,3 and 2,4 -> 4 unique.
    expect(screen.getByTestId("banner-count").textContent).toBe("4");
    expect(screen.getByTestId("banner-item").textContent).toBe("samples");
  });

  it("forwards the clear-filters callback", () => {
    const onClearFilters = jest.fn();
    render(
      <DiscoveryMap
        currentTab="samples"
        mapLevel="city"
        mapLocationData={locations}
        onClearFilters={onClearFilters}
      />,
    );
    fireEvent.click(screen.getByTestId("banner-clear"));
    expect(onClearFilters).toHaveBeenCalled();
  });

  it("counts project ids instead of sample ids on the projects tab", () => {
    render(
      <DiscoveryMap
        currentTab="projects"
        mapLevel="city"
        mapLocationData={{
          1: {
            id: 1,
            name: "USA",
            lat: "37.09",
            lng: "-95.71",
            geo_level: "country",
            project_ids: [10, 11],
          },
          2: {
            id: 2,
            name: "California",
            lat: "36.77",
            lng: "-119.41",
            geo_level: "state",
            project_ids: [11],
          },
        }}
      />,
    );
    expect(screen.getByTestId("banner-count").textContent).toBe("2");
    expect(screen.getByTestId("banner-item").textContent).toBe("projects");
  });
});

describe("DiscoveryMap viewport reporting", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // The map-level reporter is throttled, so only the leading call of each fresh
  // mount is guaranteed to land. Each zoom therefore gets its own mount.
  it.each([
    [1, "country"],
    [4, "state"],
    [12, "city"],
  ])("maps zoom %p to the %s map level", (zoom, expectedLevel) => {
    const onMapLevelChange = jest.fn();
    const { unmount } = render(
      <DiscoveryMap
        currentTab="samples"
        mapLevel="city"
        mapLocationData={locations}
        onMapLevelChange={onMapLevelChange}
        zoomBoundaryCountry={3.5}
        zoomBoundaryState={5}
      />,
    );
    act(() => capturedUpdateViewport({ zoom }));
    expect(onMapLevelChange).toHaveBeenCalledTimes(1);
    expect(onMapLevelChange).toHaveBeenCalledWith(expectedLevel);
    unmount();
  });

  it("tracks a viewport-updated analytics event", () => {
    render(
      <DiscoveryMap
        currentTab="samples"
        mapLevel="city"
        mapLocationData={locations}
      />,
    );
    act(() => capturedUpdateViewport({ zoom: 2 }));
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "DiscoveryMap_viewport_updated",
      undefined,
    );
  });

  it("throttles repeated map-level reports within the throttle window", () => {
    const onMapLevelChange = jest.fn();
    render(
      <DiscoveryMap
        currentTab="samples"
        mapLevel="city"
        mapLocationData={locations}
        onMapLevelChange={onMapLevelChange}
        zoomBoundaryCountry={3.5}
        zoomBoundaryState={5}
      />,
    );
    act(() => {
      capturedUpdateViewport({ zoom: 1 });
      capturedUpdateViewport({ zoom: 1.5 });
      capturedUpdateViewport({ zoom: 2 });
    });
    // Leading edge only; the trailing call lands after DEFAULT_THROTTLE_MS.
    expect(onMapLevelChange).toHaveBeenCalledTimes(1);
    expect(DEFAULT_THROTTLE_MS).toBeGreaterThan(0);
  });

  it("does not call onMapLevelChange when no handler was provided", () => {
    render(
      <DiscoveryMap
        currentTab="samples"
        mapLevel="city"
        mapLocationData={locations}
      />,
    );
    act(() => capturedUpdateViewport({ zoom: 9 }));
    // No throw, and the viewport zoom reaches the markers.
    expect(
      screen.getAllByTestId("shape-marker")[0].getAttribute("data-zoom"),
    ).toBe("9");
  });

  it("passes the current viewport zoom down to markers", () => {
    render(
      <DiscoveryMap
        currentTab="samples"
        mapLevel="city"
        mapLocationData={locations}
      />,
    );
    expect(
      screen.getAllByTestId("shape-marker")[0].getAttribute("data-zoom"),
    ).toBe("undefined");
    act(() => capturedUpdateViewport({ zoom: 4.2 }));
    expect(
      screen.getAllByTestId("shape-marker")[0].getAttribute("data-zoom"),
    ).toBe("4.2");
  });
});

describe("DiscoveryMap interaction handlers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("fires onMarkerClick with the location id", () => {
    const onMarkerClick = jest.fn();
    render(
      <DiscoveryMap
        currentTab="samples"
        mapLevel="city"
        mapLocationData={locations}
        onMarkerClick={onMarkerClick}
      />,
    );
    fireEvent.click(screen.getByTestId("marker-click-USA (3)"));
    expect(onMarkerClick).toHaveBeenCalledWith(1);
  });

  it("fires the map onClick handler", () => {
    const onClick = jest.fn();
    render(
      <DiscoveryMap
        currentTab="samples"
        mapLevel="city"
        mapLocationData={locations}
        onClick={onClick}
      />,
    );
    act(() => capturedMapOnClick());
    expect(onClick).toHaveBeenCalled();
  });

  it("shows a pluralized tooltip on marker hover and singularizes single points", () => {
    render(
      <DiscoveryMap
        currentTab="samples"
        mapLevel="city"
        mapLocationData={{
          ...locations,
          3: {
            id: 3,
            name: "Solo",
            lat: "10",
            lng: "10",
            geo_level: "city",
            sample_ids: [7],
          },
        }}
      />,
    );
    fireEvent.click(screen.getByTestId("marker-enter-USA (3)"));
    expect(screen.getByTestId("tooltip-title").textContent).toBe("3 Samples");
    expect(screen.getByTestId("tooltip-body").textContent).toBe("USA");

    fireEvent.click(screen.getByTestId("marker-enter-Solo (1)"));
    expect(screen.getByTestId("tooltip-title").textContent).toBe("1 Sample");
  });

  it("closes the tooltip after the timeout on mouse leave", () => {
    jest.useFakeTimers();
    try {
      render(
        <DiscoveryMap
          currentTab="samples"
          mapLevel="city"
          mapLocationData={locations}
        />,
      );
      fireEvent.click(screen.getByTestId("marker-enter-USA (3)"));
      expect(screen.getByTestId("map-tooltip")).toBeTruthy();

      fireEvent.click(screen.getByTestId("marker-leave-USA (3)"));
      act(() => {
        jest.advanceTimersByTime(TOOLTIP_TIMEOUT_MS + 10);
      });
      expect(screen.queryByTestId("map-tooltip")).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it("keeps the tooltip open when the pointer moves onto the tooltip itself", () => {
    jest.useFakeTimers();
    try {
      render(
        <DiscoveryMap
          currentTab="samples"
          mapLevel="city"
          mapLocationData={locations}
        />,
      );
      fireEvent.click(screen.getByTestId("marker-enter-USA (3)"));
      fireEvent.click(screen.getByTestId("marker-leave-USA (3)"));
      // Entering the tooltip un-flags the pending close.
      fireEvent.click(screen.getByTestId("tooltip-enter"));
      act(() => {
        jest.advanceTimersByTime(TOOLTIP_TIMEOUT_MS + 10);
      });
      expect(screen.getByTestId("map-tooltip")).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it("fires onTooltipTitleClick with the location id", () => {
    const onTooltipTitleClick = jest.fn();
    render(
      <DiscoveryMap
        currentTab="samples"
        mapLevel="city"
        mapLocationData={locations}
        onTooltipTitleClick={onTooltipTitleClick}
      />,
    );
    fireEvent.click(screen.getByTestId("marker-enter-California (2)"));
    fireEvent.click(screen.getByTestId("tooltip-title"));
    expect(onTooltipTitleClick).toHaveBeenCalledWith(2);
  });

  it("tolerates missing marker/tooltip callbacks", () => {
    render(
      <DiscoveryMap
        currentTab="samples"
        mapLevel="city"
        mapLocationData={locations}
      />,
    );
    fireEvent.click(screen.getByTestId("marker-click-USA (3)"));
    fireEvent.click(screen.getByTestId("marker-enter-USA (3)"));
    fireEvent.click(screen.getByTestId("tooltip-title"));
    // The tooltip is still mounted; the no-op handlers did not break rendering.
    expect(screen.getByTestId("map-tooltip")).toBeTruthy();
  });
});
