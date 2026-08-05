import React from "react";
import MapGL, { NavigationControl } from "react-map-gl";
import { limitToRange } from "~/components/utils/format";
import cs from "./base_map.scss";

interface BaseMapProps {
  banner?: object;
  height?: string | number;
  latitude?: number;
  longitude?: number;
  mapTilerKey: string;
  mapStyleId: string;
  markers?: unknown[];
  onClick?: $TSFixMeFunction;
  popups?: unknown[];
  tooltip?: React.ReactNode;
  updateViewport?: $TSFixMeFunction;
  viewBounds?: Record<string, number>;
  width?: string | number;
  zoom?: number;
}

interface BaseMapState {
  viewport: {
    width;
    height;
    latitude;
    longitude;
    zoom;
  };
  // Measured pixel size of the map container. <MapGL> is not mounted until BOTH
  // are > 0: width/height default to the string "100%", so react-map-gl sizes
  // itself against the container. When the map mounts before its flex container
  // has been laid out that container is 0x0, which feeds a degenerate viewport
  // into react-map-gl's WebMercator projection and throws "Pixel project matrix
  // not invertible" (SMP-1603 / SMP-1587). Gating the mount on a non-zero
  // measured box avoids the degenerate render without changing map behavior once
  // it is sized.
  containerWidth: number;
  containerHeight: number;
}

class BaseMap extends React.Component<BaseMapProps, BaseMapState> {
  containerRef = React.createRef<HTMLDivElement>();
  resizeObserver: ResizeObserver | null = null;

  constructor(props: BaseMapProps) {
    super(props);

    const { width, height, latitude, longitude, zoom } = this.props;
    this.state = {
      viewport: {
        width,
        height,
        latitude,
        longitude,
        zoom,
      },
      containerWidth: 0,
      containerHeight: 0,
    };
  }

  componentDidMount() {
    // Measure now (covers the container that is already laid out) and again on
    // every resize, so <MapGL> mounts as soon as the container has a real box.
    this.measureContainer();
    if (typeof ResizeObserver !== "undefined" && this.containerRef.current) {
      this.resizeObserver = new ResizeObserver(this.measureContainer);
      this.resizeObserver.observe(this.containerRef.current);
    }
  }

  componentWillUnmount() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
  }

  measureContainer = () => {
    const el = this.containerRef.current;
    if (!el) return;
    const containerWidth = el.clientWidth;
    const containerHeight = el.clientHeight;
    if (
      containerWidth !== this.state.containerWidth ||
      containerHeight !== this.state.containerHeight
    ) {
      this.setState({ containerWidth, containerHeight });
    }
  };

  updateViewport = viewport => {
    const { updateViewport, viewBounds } = this.props;
    const { containerWidth, containerHeight } = this.state;

    // Ensure numeric dimensions are positive and non-zero
    const width =
      typeof viewport.width === "number" && viewport.width > 0
        ? viewport.width
        : containerWidth || 800;
    const height =
      typeof viewport.height === "number" && viewport.height > 0
        ? viewport.height
        : containerHeight || 600;

    viewport.width = width;
    viewport.height = height;

    viewport.latitude = limitToRange(
      viewport.latitude,
      // @ts-expect-error CZID-8698 expect strictNullCheck error: error TS2532
      viewBounds.minLatitude,
      // @ts-expect-error CZID-8698 expect strictNullCheck error: error TS2532
      viewBounds.maxLatitude,
    );
    viewport.longitude = limitToRange(
      viewport.longitude,
      // @ts-expect-error CZID-8698 expect strictNullCheck error: error TS2532
      viewBounds.minLongitude,
      // @ts-expect-error CZID-8698 expect strictNullCheck error: error TS2532
      viewBounds.maxLongitude,
    );
    viewport.zoom = limitToRange(
      viewport.zoom,
      // @ts-expect-error CZID-8698 expect strictNullCheck error: error TS2532
      viewBounds.minZoom,
      // @ts-expect-error CZID-8698 expect strictNullCheck error: error TS2532
      viewBounds.maxZoom,
    );

    this.setState({ viewport }, () => this.setCompactAttribution());
    updateViewport && updateViewport(viewport);
  };

  setCompactAttribution = () => {
    // Show compact attribution tags
    const tag = document.getElementsByClassName("mapboxgl-ctrl-attrib")[0];
    tag && tag.classList.add("mapboxgl-compact");
  };

  render() {
    const {
      banner,
      mapStyleId,
      mapTilerKey,
      markers,
      onClick,
      popups,
      tooltip,
    } = this.props;
    const { viewport, containerWidth, containerHeight } = this.state;

    // Use container dimensions if available, otherwise fallback to props or default
    const viewportToRender = {
      ...viewport,
      width:
        containerWidth ||
        (typeof viewport.width === "number" ? viewport.width : 800),
      height:
        containerHeight ||
        (typeof viewport.height === "number" ? viewport.height : 600),
    };

    // Only render <MapGL> once the container has a non-degenerate (non-zero) box;
    // rendering into a 0x0 viewport throws "Pixel project matrix not invertible".
    const hasSize = containerWidth > 0 && containerHeight > 0;

    const styleURL = `https://api.maptiler.com/maps/${mapStyleId}/style.json?key=${mapTilerKey}`;
    return (
      <div className={cs.mapContainer} ref={this.containerRef}>
        {hasSize && (
          <MapGL
            mapStyle={styleURL}
            onClick={onClick}
            onLoad={this.setCompactAttribution}
            onViewportChange={this.updateViewport}
            // Style prop applies to the container and all overlays
            style={{ position: "absolute" }}
            {...viewportToRender}
          >
            {banner}
            {markers}
            {popups}
            {tooltip}

            <NavigationControl
              onViewportChange={this.updateViewport}
              showCompass={false}
              className={cs.zoomControl}
            />
          </MapGL>
        )}
      </div>
    );
  }
}

// @ts-expect-error Property 'defaultProps' does not exist on type
BaseMap.defaultProps = {
  width: "100%",
  height: "100%",
  // Frame most of the world by default
  latitude: 27,
  longitude: 0,
  zoom: 1.4,
  viewBounds: {
    // Limit panning too far north or south
    minLatitude: -60,
    maxLatitude: 60,
    minLongitude: -180,
    maxLongitude: 180,
    // Limit to whole-world view
    minZoom: 1.2,
    // Limit to city-level at most
    maxZoom: 17,
  },
};

export default BaseMap;
