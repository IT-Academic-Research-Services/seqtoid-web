// Branch coverage for
// app/assets/src/components/views/DiscoveryView/components/DiscoveryViewToggle/DiscoveryViewToggle.tsx
//
// Conditionals: the `includePLQC ? PROJECT_DISPLAYS : MAP_DISPLAYS` fork (which
// also decides whether the "plqc" icon arm is ever reached), the three
// `display === "..." &&` icon selectors, and the `currentDisplay === display`
// active flag in both states.
import { fireEvent, render, screen } from "@testing-library/react";
import { DiscoveryViewToggle } from "~/components/views/DiscoveryView/components/DiscoveryViewToggle/DiscoveryViewToggle";

describe("DiscoveryViewToggle", () => {
  it("renders only the table and map entries by default", () => {
    render(
      <DiscoveryViewToggle
        currentDisplay="table"
        onDisplaySwitch={jest.fn()}
      />,
    );

    expect(screen.getByTestId("table-view")).toBeTruthy();
    expect(screen.getByTestId("map-view")).toBeTruthy();
    expect(screen.queryByTestId("plqc-view")).toBeNull();
  });

  it("adds the PLQC entry between table and map when includePLQC is true", () => {
    render(
      <DiscoveryViewToggle
        currentDisplay="plqc"
        onDisplaySwitch={jest.fn()}
        includePLQC={true}
      />,
    );

    const menu = screen.getByTestId("menu-icons");
    const items = Array.from(
      menu.querySelectorAll("[data-testid$='-view']"),
    ).map(node => node.getAttribute("data-testid"));

    expect(items).toEqual(["table-view", "plqc-view", "map-view"]);
  });

  it("marks only the current display as active", () => {
    render(
      <DiscoveryViewToggle
        currentDisplay="map"
        onDisplaySwitch={jest.fn()}
        includePLQC={true}
      />,
    );

    // Semantic's Menu.Item reflects `active` onto the DOM class list.
    expect(screen.getByTestId("map-view").className).toContain("active");
    expect(screen.getByTestId("table-view").className).not.toContain("active");
    expect(screen.getByTestId("plqc-view").className).not.toContain("active");
  });

  it("reports the clicked display back through onDisplaySwitch", () => {
    const onDisplaySwitch = jest.fn();
    render(
      <DiscoveryViewToggle
        currentDisplay="table"
        onDisplaySwitch={onDisplaySwitch}
        includePLQC={true}
      />,
    );

    fireEvent.click(screen.getByTestId("plqc-view"));
    fireEvent.click(screen.getByTestId("map-view"));
    fireEvent.click(screen.getByTestId("table-view"));

    expect(onDisplaySwitch.mock.calls.map(call => call[0])).toEqual([
      "plqc",
      "map",
      "table",
    ]);
  });

  it("renders one icon per entry even when no display is selected", () => {
    const { container } = render(
      <DiscoveryViewToggle onDisplaySwitch={jest.fn()} includePLQC={true} />,
    );

    expect(container.querySelectorAll("svg").length).toBe(3);
    expect(screen.getByTestId("table-view").className).not.toContain("active");
  });
});
