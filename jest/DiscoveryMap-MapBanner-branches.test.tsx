// Branch coverage for
// app/assets/src/components/views/DiscoveryView/components/DiscoveryMap/components/MapBanner/MapBanner.tsx
//
// Two conditionals: the `if (!itemCount)` empty-state guard (both arms) and
// the `itemCount > 1 ? "s" : ""` pluralization ternary inside the populated
// arm. BasicPopup wraps semantic-ui's Popup, which only mounts its content on
// hover, so it is stubbed down to its trigger.
import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("~/components/common/BasicPopup", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: (props: $TSFixMe) =>
      ReactLib.createElement(
        "span",
        { "data-testid": "popup", "data-content": props.content },
        props.trigger,
      ),
  };
});

import MapBanner from "~/components/views/DiscoveryView/components/DiscoveryMap/components/MapBanner/MapBanner";

describe("MapBanner", () => {
  it("renders the empty state and fires onClearFilters when itemCount is 0", () => {
    const onClearFilters = jest.fn();
    render(
      <MapBanner
        item="samples"
        itemCount={0}
        onClearFilters={onClearFilters}
      />,
    );

    expect(
      screen.getByText(
        "No samples with locations found. Try adjusting search or filters.",
        { exact: false },
      ),
    ).toBeTruthy();
    expect(screen.queryByTestId("popup")).toBeNull();

    fireEvent.click(screen.getByText("Clear all"));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it("renders the empty state when itemCount is undefined", () => {
    render(<MapBanner item="projects" />);

    expect(
      screen.getByText("No projects with locations found.", { exact: false }),
    ).toBeTruthy();
  });

  it("renders a singular count without the trailing s when itemCount is 1", () => {
    render(<MapBanner item="samples" itemCount={1} />);

    expect(screen.getByText("1 sample")).toBeTruthy();
    expect(screen.queryByText("Clear all")).toBeNull();
    expect(screen.getByTestId("popup").getAttribute("data-content")).toBe(
      "Help out by adding more location data to your samples.",
    );
  });

  it("pluralizes the trimmed item name when itemCount is greater than 1", () => {
    render(<MapBanner item="projects" itemCount={7} />);

    // "projects".slice(0, -1) === "project", then re-pluralized by the ternary.
    expect(screen.getByText("7 projects")).toBeTruthy();
    expect(
      screen.getByText("with location data.", { exact: false }),
    ).toBeTruthy();
  });
});
