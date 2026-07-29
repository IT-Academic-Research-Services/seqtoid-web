// Coverage: app/assets/src/components/ui/controls/buttons/FilterButtonWithCounter/FilterButtonWithCounter.tsx
//
// A tiny presentational button whose entire logic lives in ternaries and default
// parameter values: the enabled/disabled click wiring, whether the counter chip
// is rendered, which popup content is built, and how the popup position is
// resolved. These tests drive both sides of each of those branches, including
// omitting the defaulted props so the default-parameter branches are taken.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { FilterButtonWithCounter } from "~/components/ui/controls/buttons/FilterButtonWithCounter/FilterButtonWithCounter";

const getButton = () => document.querySelector("button") as HTMLButtonElement;

// The outer div carries the click handler; it is the button's grandparent
// (div > BasicPopup trigger div > button).
const getTriggerContainer = () =>
  getButton().closest("div")?.parentElement as HTMLElement;

// Semantic-UI's Popup only mounts its content after mouseEnterDelay elapses.
const openPopup = () => {
  fireEvent.mouseEnter(getButton().parentElement as HTMLElement);
  act(() => {
    jest.advanceTimersByTime(1000);
  });
};

describe("FilterButtonWithCounter", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  describe("enabled", () => {
    it("renders an enabled button and the counter chip", () => {
      render(
        <FilterButtonWithCounter
          filterCounter={3}
          onFilterToggle={jest.fn()}
          showFilters={false}
        />,
      );
      expect(getButton().disabled).toBe(false);
      expect(screen.getByText("3")).toBeTruthy();
    });

    it("calls onFilterToggle when the trigger container is clicked", () => {
      const onFilterToggle = jest.fn();
      render(
        <FilterButtonWithCounter
          filterCounter={0}
          onFilterToggle={onFilterToggle}
          showFilters={false}
        />,
      );
      fireEvent.click(getTriggerContainer());
      expect(onFilterToggle).toHaveBeenCalledTimes(1);
    });

    it("shows the plain 'Filters' popup content with no subtitle", () => {
      render(
        <FilterButtonWithCounter
          filterCounter={1}
          onFilterToggle={jest.fn()}
          showFilters
        />,
      );
      openPopup();
      expect(screen.getByText("Filters")).toBeTruthy();
      expect(screen.queryByText("Not available")).toBeNull();
    });

    it("defaults the counter to 0 when filterCounter is omitted", () => {
      render(
        // @ts-expect-error deliberately omitting the defaulted filterCounter prop
        <FilterButtonWithCounter
          onFilterToggle={jest.fn()}
          showFilters={false}
        />,
      );
      expect(screen.getByText("0")).toBeTruthy();
    });

    it("renders the button in the pressed state when showFilters is true", () => {
      const { rerender } = render(
        <FilterButtonWithCounter
          filterCounter={2}
          onFilterToggle={jest.fn()}
          showFilters={false}
        />,
      );
      const offClassName = getButton().className;
      rerender(
        <FilterButtonWithCounter
          filterCounter={2}
          onFilterToggle={jest.fn()}
          showFilters
        />,
      );
      // The `on` prop changes the SDS button styling; the two states differ.
      expect(getButton().className).not.toBe(offClassName);
    });
  });

  describe("disabled", () => {
    it("renders a disabled button and drops the counter chip entirely", () => {
      render(
        <FilterButtonWithCounter
          isDisabled
          filterCounter={7}
          onFilterToggle={jest.fn()}
          showFilters={false}
        />,
      );
      expect(getButton().disabled).toBe(true);
      // The counter is only rendered when the control is usable.
      expect(screen.queryByText("7")).toBeNull();
    });

    it("does not call onFilterToggle when clicked", () => {
      const onFilterToggle = jest.fn();
      render(
        <FilterButtonWithCounter
          isDisabled
          filterCounter={7}
          onFilterToggle={onFilterToggle}
          showFilters={false}
        />,
      );
      fireEvent.click(getTriggerContainer());
      expect(onFilterToggle).not.toHaveBeenCalled();
    });

    it("shows the default 'Not available' subtitle in the popup", () => {
      render(
        <FilterButtonWithCounter
          isDisabled
          filterCounter={0}
          onFilterToggle={jest.fn()}
          showFilters={false}
        />,
      );
      openPopup();
      expect(screen.getByText("Not available")).toBeTruthy();
    });

    it("shows a custom disabled subtitle when one is supplied", () => {
      render(
        <FilterButtonWithCounter
          isDisabled
          filterCounter={0}
          onFilterToggle={jest.fn()}
          showFilters={false}
          popupDisabledSubtitle="Select a project first"
        />,
      );
      openPopup();
      expect(screen.getByText("Select a project first")).toBeTruthy();
      expect(screen.queryByText("Not available")).toBeNull();
    });
  });

  describe("popup position", () => {
    const popupPosition = () => {
      const popup = document.querySelector(".ui.popup") as HTMLElement;
      return popup ? popup.className : "";
    };

    it("defaults to bottom center when enabled", () => {
      render(
        <FilterButtonWithCounter
          filterCounter={0}
          onFilterToggle={jest.fn()}
          showFilters={false}
        />,
      );
      openPopup();
      expect(popupPosition()).toContain("bottom center");
    });

    it("defaults to top left when disabled", () => {
      render(
        <FilterButtonWithCounter
          isDisabled
          filterCounter={0}
          onFilterToggle={jest.fn()}
          showFilters={false}
        />,
      );
      openPopup();
      expect(popupPosition()).toContain("top left");
    });

    it("uses an explicit popupPosition over the disabled-derived default", () => {
      render(
        <FilterButtonWithCounter
          isDisabled
          filterCounter={0}
          onFilterToggle={jest.fn()}
          showFilters={false}
          popupPosition="bottom center"
        />,
      );
      openPopup();
      expect(popupPosition()).toContain("bottom center");
      expect(popupPosition()).not.toContain("top left");
    });
  });
});
