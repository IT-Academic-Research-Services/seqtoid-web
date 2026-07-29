// Coverage: app/assets/src/components/views/UserProfileForm/components/
//   CheckboxWithInput/CheckboxWithInput.tsx
//
// CheckboxWithInput renders an SDS checkbox paired with a free-text input.
// Clicking the checkbox toggles a `${prefix}: ` entry in/out of the selected
// list (respecting the max-selection disabled guard), and typing in the input
// pushes a `${prefix}: <value>` entry - unless selection is disabled and the
// box is unchecked, in which case the input is cleared. When disabled and
// unchecked the checkbox is wrapped in a Tooltip. The SDS primitives are
// stubbed so assertions land on this component's own toggle/input branches.
import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("@czi-sds/components", () => {
  const ReactLib = require("react");
  return {
    InputCheckbox: (props: $TSFixMe) =>
      ReactLib.createElement("button", {
        "data-testid": "checkbox",
        "data-stage": props.stage,
        onClick: props.onClick,
      }),
    InputText: (props: $TSFixMe) =>
      ReactLib.createElement("input", {
        "data-testid": "text-input",
        value: props.value,
        onChange: props.onChange,
      }),
    Tooltip: (props: $TSFixMe) =>
      ReactLib.createElement(
        "span",
        { "data-testid": "tooltip", "data-title": props.title },
        props.children,
      ),
  };
});

import { CheckboxWithInput } from "~/components/views/UserProfileForm/components/CheckboxWithInput/CheckboxWithInput";

const PREFIX = "Other";

function renderComp(overrides: $TSFixMe = {}) {
  const setSelectedCheckboxes = jest.fn();
  const props = {
    selectedCheckboxes: [],
    setSelectedCheckboxes,
    isSelectionDisabled: false,
    isCheckboxChecked: false,
    prefix: PREFIX,
    ...overrides,
  };
  const utils = render(<CheckboxWithInput {...props} />);
  return { setSelectedCheckboxes, ...utils };
}

describe("CheckboxWithInput", () => {
  it("adds a prefixed entry when an unchecked box is clicked", () => {
    const { setSelectedCheckboxes } = renderComp({
      selectedCheckboxes: ["Keep me"],
    });
    fireEvent.click(screen.getByTestId("checkbox"));
    expect(setSelectedCheckboxes).toHaveBeenCalledWith(["Keep me", "Other: "]);
  });

  it("removes the prefixed entry when a checked box is clicked", () => {
    const { setSelectedCheckboxes } = renderComp({
      selectedCheckboxes: ["Keep me", "Other: typed"],
    });
    fireEvent.click(screen.getByTestId("checkbox"));
    expect(setSelectedCheckboxes).toHaveBeenCalledWith(["Keep me"]);
  });

  it("does not add an entry when selection is disabled and box is unchecked", () => {
    const { setSelectedCheckboxes } = renderComp({
      selectedCheckboxes: ["a", "b"],
      isSelectionDisabled: true,
      isCheckboxChecked: false,
    });
    fireEvent.click(screen.getByTestId("checkbox"));
    expect(setSelectedCheckboxes).not.toHaveBeenCalled();
  });

  it("reflects checked stage on the checkbox", () => {
    renderComp({ isCheckboxChecked: true });
    expect(screen.getByTestId("checkbox").getAttribute("data-stage")).toBe(
      "checked",
    );
  });

  it("reflects unchecked stage on the checkbox", () => {
    renderComp({ isCheckboxChecked: false });
    expect(screen.getByTestId("checkbox").getAttribute("data-stage")).toBe(
      "unchecked",
    );
  });

  it("wraps the checkbox in a tooltip when disabled and unchecked", () => {
    renderComp({ isSelectionDisabled: true, isCheckboxChecked: false });
    const tooltip = screen.getByTestId("tooltip");
    expect(tooltip.getAttribute("data-title")).toBe(
      "Remove a selection to select again.",
    );
  });

  it("does not wrap in a tooltip when disabled but already checked", () => {
    renderComp({ isSelectionDisabled: true, isCheckboxChecked: true });
    expect(screen.queryByTestId("tooltip")).toBeNull();
  });

  it("pushes a prefixed value entry when text is typed", () => {
    const { setSelectedCheckboxes } = renderComp({
      selectedCheckboxes: ["Other: old", "keep"],
    });
    fireEvent.change(screen.getByTestId("text-input"), {
      target: { value: "hello" },
    });
    expect(setSelectedCheckboxes).toHaveBeenCalledWith([
      "keep",
      "Other: hello",
    ]);
    // the input reflects the typed value
    expect((screen.getByTestId("text-input") as HTMLInputElement).value).toBe(
      "hello",
    );
  });

  it("clears input and does not update list when disabled and unchecked while typing", () => {
    const { setSelectedCheckboxes } = renderComp({
      selectedCheckboxes: ["Other: old"],
      isSelectionDisabled: true,
      isCheckboxChecked: false,
    });
    fireEvent.change(screen.getByTestId("text-input"), {
      target: { value: "blocked" },
    });
    expect(setSelectedCheckboxes).not.toHaveBeenCalled();
    expect((screen.getByTestId("text-input") as HTMLInputElement).value).toBe(
      "",
    );
  });

  it("allows typing when disabled but the box is already checked", () => {
    const { setSelectedCheckboxes } = renderComp({
      selectedCheckboxes: ["Other: prev"],
      isSelectionDisabled: true,
      isCheckboxChecked: true,
    });
    fireEvent.change(screen.getByTestId("text-input"), {
      target: { value: "world" },
    });
    expect(setSelectedCheckboxes).toHaveBeenCalledWith(["Other: world"]);
  });

  it("renders the prefix label", () => {
    renderComp({ prefix: "Referral" });
    expect(screen.getByText("Referral")).toBeTruthy();
  });
});
