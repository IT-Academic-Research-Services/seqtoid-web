// Coverage: app/assets/src/components/views/SamplesHeatmapView/components/
//   SamplesHeatmapFilters/components/SamplesHeatmapTaxonSlider/
//   SamplesHeatmapTaxonSlider.tsx
//
// The slider is a label-style InputDropdown that toggles a Popover anchored on
// itself; the popover holds an SDS InputSlider whose drag (onChange) only moves
// local state and whose release (onChangeCommitted) calls back to the parent.
// The SDS controls and MUI Popover are stubbed so the tests can drive the raw
// handlers and observe the anchorEl toggle in both directions.
import { act, fireEvent, render, screen } from "@testing-library/react";

let lastSliderProps: $TSFixMe = null;
let lastInputDropdownProps: $TSFixMe = null;

jest.mock("@czi-sds/components", () => {
  const ReactLib = require("react");
  return {
    InputDropdown: (props: $TSFixMe) => {
      lastInputDropdownProps = props;
      return ReactLib.createElement(
        "button",
        {
          "data-testid": "taxa-input-dropdown",
          "data-disabled": String(!!props.disabled),
          "data-value": props.value,
          onClick: props.onClick,
        },
        props.label,
      );
    },
    InputSlider: (props: $TSFixMe) => {
      lastSliderProps = props;
      return ReactLib.createElement("div", {
        "data-testid": "taxa-slider",
        "data-value": String(props.value),
        "data-min": String(props.min),
        "data-max": String(props.max),
        "data-disabled": String(!!props.disabled),
      });
    },
  };
});

jest.mock("@mui/material/Popover", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: (props: $TSFixMe) =>
      ReactLib.createElement(
        "div",
        {
          "data-testid": "taxa-popover",
          "data-open": String(props.open),
        },
        // Mirror MUI: children only mount while the popover is open.
        props.open ? props.children : null,
        ReactLib.createElement("button", {
          "data-testid": "popover-close",
          onClick: props.onClose,
        }),
      ),
  };
});

import { SamplesHeatmapTaxonSlider } from "~/components/views/SamplesHeatmapView/components/SamplesHeatmapFilters/components/SamplesHeatmapTaxonSlider/SamplesHeatmapTaxonSlider";

function renderSlider(overrides: $TSFixMe = {}) {
  const onChangeCommitted = jest.fn();
  const utils = render(
    <SamplesHeatmapTaxonSlider
      isDisabled={false}
      onChangeCommitted={onChangeCommitted}
      min={0}
      max={100}
      value={30}
      {...overrides}
    />,
  );
  return { onChangeCommitted, ...utils };
}

const popover = () => screen.getByTestId("taxa-popover");

describe("SamplesHeatmapTaxonSlider", () => {
  beforeEach(() => {
    lastSliderProps = null;
    lastInputDropdownProps = null;
  });

  it("renders the current value on the closed dropdown", () => {
    renderSlider({ value: 42 });
    const dropdown = screen.getByTestId("taxa-input-dropdown");
    expect(dropdown.getAttribute("data-value")).toBe("42");
    expect(dropdown.textContent).toBe("Taxa Per Sample");
    expect(popover().getAttribute("data-open")).toBe("false");
    // Closed popover means the slider is not mounted yet.
    expect(screen.queryByTestId("taxa-slider")).toBeNull();
  });

  it("opens the popover on the first click and closes it on the second", () => {
    renderSlider();
    fireEvent.click(screen.getByTestId("taxa-input-dropdown"));
    expect(popover().getAttribute("data-open")).toBe("true");

    fireEvent.click(screen.getByTestId("taxa-input-dropdown"));
    expect(popover().getAttribute("data-open")).toBe("false");
  });

  it("closes the popover through the onClose handler", () => {
    renderSlider();
    fireEvent.click(screen.getByTestId("taxa-input-dropdown"));
    expect(popover().getAttribute("data-open")).toBe("true");

    fireEvent.click(screen.getByTestId("popover-close"));
    expect(popover().getAttribute("data-open")).toBe("false");
  });

  it("seeds the slider from the value prop and forwards the bounds", () => {
    renderSlider({ value: 30, min: 5, max: 80 });
    fireEvent.click(screen.getByTestId("taxa-input-dropdown"));
    const slider = screen.getByTestId("taxa-slider");
    expect(slider.getAttribute("data-value")).toBe("30");
    expect(slider.getAttribute("data-min")).toBe("5");
    expect(slider.getAttribute("data-max")).toBe("80");
    expect(lastSliderProps.marks.map((m: $TSFixMe) => m.value)).toEqual([
      0, 50, 100,
    ]);
  });

  it("updates only local state while dragging, without notifying the parent", () => {
    const { onChangeCommitted } = renderSlider();
    fireEvent.click(screen.getByTestId("taxa-input-dropdown"));
    act(() => lastSliderProps.onChange({}, 77));
    expect(screen.getByTestId("taxa-slider").getAttribute("data-value")).toBe(
      "77",
    );
    expect(onChangeCommitted).not.toHaveBeenCalled();
    // The closed-state label still shows the committed prop value.
    expect(
      screen.getByTestId("taxa-input-dropdown").getAttribute("data-value"),
    ).toBe("30");
  });

  it("notifies the parent with the committed value on release", () => {
    const { onChangeCommitted } = renderSlider();
    fireEvent.click(screen.getByTestId("taxa-input-dropdown"));
    act(() => lastSliderProps.onChange({}, 77));
    act(() => lastSliderProps.onChangeCommitted({}, 77));
    expect(onChangeCommitted).toHaveBeenCalledWith(77);
  });

  it("propagates the disabled flag to both the dropdown and the slider", () => {
    renderSlider({ isDisabled: true });
    expect(
      screen.getByTestId("taxa-input-dropdown").getAttribute("data-disabled"),
    ).toBe("true");
    // A disabled dropdown still opens in this stub, letting us read the slider.
    fireEvent.click(screen.getByTestId("taxa-input-dropdown"));
    expect(
      screen.getByTestId("taxa-slider").getAttribute("data-disabled"),
    ).toBe("true");
  });
});
