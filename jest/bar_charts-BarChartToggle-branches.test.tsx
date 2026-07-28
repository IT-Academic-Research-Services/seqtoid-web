// Coverage: app/assets/src/components/visualizations/bar_charts/BarChartToggle.tsx
//
// The component maps over a fixed ["count", "percentage"] list, so every
// iteration hits `display === "count" && ...` and `display === "percentage" &&
// ...` from both sides in one render. What still needs both settings of
// currentDisplay is the `active` prop and the two `currentDisplay === display
// && cs.active` class guards.
//
// BasicPopup is a semantic-ui Popup: it renders only its trigger until hovered,
// which is enough here, but it is stubbed so the trigger is always mounted and
// the popup label is assertable too.
import { fireEvent, render, screen } from "@testing-library/react";
import BarChartToggle from "~/components/visualizations/bar_charts/BarChartToggle";

jest.mock("~/components/common/BasicPopup", () => ({
  __esModule: true,
  default: ({
    content,
    trigger,
  }: {
    content: React.ReactNode;
    trigger: React.ReactNode;
  }) => (
    <span data-testid="popup" data-content={String(content)}>
      {trigger}
    </span>
  ),
}));

const renderToggle = (currentDisplay?: string) => {
  const onDisplaySwitch = jest.fn();
  const { container } = render(
    <BarChartToggle
      currentDisplay={currentDisplay}
      onDisplaySwitch={onDisplaySwitch}
    />,
  );
  return { container, onDisplaySwitch };
};

const items = (container: HTMLElement) =>
  Array.from(container.querySelectorAll(".item")) as HTMLElement[];

describe("BarChartToggle branches", () => {
  it("renders one popup-wrapped item per display, capitalised", () => {
    renderToggle("count");

    const popups = screen.getAllByTestId("popup");
    expect(popups).toHaveLength(2);
    expect(popups.map(p => p.getAttribute("data-content"))).toEqual([
      "Count",
      "Percentage",
    ]);
  });

  it("marks only the count item active when count is selected", () => {
    const { container } = renderToggle("count");

    const [count, percentage] = items(container);
    expect(count.className).toContain("active");
    expect(percentage.className).not.toContain("active");
  });

  it("marks only the percentage item active when percentage is selected", () => {
    const { container } = renderToggle("percentage");

    const [count, percentage] = items(container);
    expect(count.className).not.toContain("active");
    expect(percentage.className).toContain("active");
  });

  it("marks neither item active for an unrecognised display", () => {
    const { container } = renderToggle("something-else");

    items(container).forEach(item =>
      expect(item.className).not.toContain("active"),
    );
  });

  it("renders exactly one icon per item -- the bar chart icon then the percent icon", () => {
    const { container } = renderToggle("count");

    const [count, percentage] = items(container);
    // Each item renders exactly one of the two `display === ...` guards.
    expect(count.querySelectorAll("svg")).toHaveLength(1);
    expect(percentage.querySelectorAll("svg")).toHaveLength(1);
    expect(count.querySelector("svg")).not.toBe(
      percentage.querySelector("svg"),
    );
  });

  it("reports the clicked display back to the caller", () => {
    const { container, onDisplaySwitch } = renderToggle("count");

    const [count, percentage] = items(container);

    fireEvent.click(percentage);
    expect(onDisplaySwitch).toHaveBeenCalledWith("percentage");

    fireEvent.click(count);
    expect(onDisplaySwitch).toHaveBeenNthCalledWith(2, "count");
  });

  it("still renders both items when no display is selected at all", () => {
    const { container } = renderToggle(undefined);

    expect(items(container)).toHaveLength(2);
    items(container).forEach(item =>
      expect(item.className).not.toContain("active"),
    );
  });
});
