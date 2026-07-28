// Coverage: app/assets/src/components/views/UserProfileForm/components/
//   Checkbox/Checkbox.tsx
//
// Checkbox renders an SDS InputCheckbox plus its own label text inside a
// role="checkbox" div. The div reports aria-checked from membership in
// selectedCheckboxes, fires handleCheckboxChange on click and on Enter/Space
// keydown (and on nothing else), and when selection is disabled AND the box
// is unchecked the InputCheckbox is wrapped in a Tooltip carrying the
// "remove a selection" copy. The SDS primitives are stubbed so assertions
// land on this component's own branches.
import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("@czi-sds/components", () => {
  const ReactLib = require("react");
  return {
    InputCheckbox: (props: $TSFixMe) =>
      ReactLib.createElement("span", {
        "data-testid": "input-checkbox",
        "data-stage": props.stage,
      }),
    Tooltip: (props: $TSFixMe) =>
      ReactLib.createElement(
        "span",
        { "data-testid": "tooltip", "data-title": props.title },
        props.children,
      ),
  };
});

import { Checkbox } from "~/components/views/UserProfileForm/components/Checkbox/Checkbox";

function renderComp(overrides: $TSFixMe = {}) {
  const handleCheckboxChange = jest.fn();
  const props = {
    checkBoxValue: "Colleague",
    selectedCheckboxes: [] as string[],
    handleCheckboxChange,
    ...overrides,
  };
  const utils = render(<Checkbox {...props} />);
  return { handleCheckboxChange, ...utils };
}

describe("Checkbox", () => {
  it("renders the value as the visible label", () => {
    renderComp({ checkBoxValue: "Conference" });
    expect(screen.getByRole("checkbox").textContent).toContain("Conference");
  });

  it("reports aria-checked=false and unchecked stage when not selected", () => {
    renderComp({ selectedCheckboxes: ["Something else"] });
    expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe(
      "false",
    );
    expect(
      screen.getByTestId("input-checkbox").getAttribute("data-stage"),
    ).toBe("unchecked");
  });

  it("reports aria-checked=true and checked stage when selected", () => {
    renderComp({ selectedCheckboxes: ["Colleague", "Training"] });
    expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(
      screen.getByTestId("input-checkbox").getAttribute("data-stage"),
    ).toBe("checked");
  });

  it("calls handleCheckboxChange with the value on click", () => {
    const { handleCheckboxChange } = renderComp({ checkBoxValue: "Training" });
    fireEvent.click(screen.getByRole("checkbox"));
    expect(handleCheckboxChange).toHaveBeenCalledWith("Training");
  });

  it("calls handleCheckboxChange on Enter keydown", () => {
    const { handleCheckboxChange } = renderComp();
    fireEvent.keyDown(screen.getByRole("checkbox"), { key: "Enter" });
    expect(handleCheckboxChange).toHaveBeenCalledWith("Colleague");
  });

  it("calls handleCheckboxChange on Space keydown", () => {
    const { handleCheckboxChange } = renderComp();
    fireEvent.keyDown(screen.getByRole("checkbox"), { key: " " });
    expect(handleCheckboxChange).toHaveBeenCalledWith("Colleague");
  });

  it("ignores other keys", () => {
    const { handleCheckboxChange } = renderComp();
    fireEvent.keyDown(screen.getByRole("checkbox"), { key: "a" });
    fireEvent.keyDown(screen.getByRole("checkbox"), { key: "Escape" });
    expect(handleCheckboxChange).not.toHaveBeenCalled();
  });

  it("does not render a tooltip by default (selection enabled)", () => {
    renderComp();
    expect(screen.queryByTestId("tooltip")).toBeNull();
  });

  it("wraps the checkbox in a tooltip when disabled and unchecked", () => {
    renderComp({ isSelectionDisabled: true, selectedCheckboxes: [] });
    const tooltip = screen.getByTestId("tooltip");
    expect(tooltip.getAttribute("data-title")).toBe(
      "Remove a selection to select again.",
    );
    // the underlying checkbox is still rendered inside the tooltip
    expect(
      tooltip.querySelector("[data-testid='input-checkbox']"),
    ).toBeTruthy();
  });

  it("does not wrap in a tooltip when disabled but already checked", () => {
    renderComp({
      isSelectionDisabled: true,
      selectedCheckboxes: ["Colleague"],
    });
    expect(screen.queryByTestId("tooltip")).toBeNull();
    expect(
      screen.getByTestId("input-checkbox").getAttribute("data-stage"),
    ).toBe("checked");
  });

  it("still fires the change handler while disabled (parent decides)", () => {
    const { handleCheckboxChange } = renderComp({ isSelectionDisabled: true });
    fireEvent.click(screen.getByRole("checkbox"));
    expect(handleCheckboxChange).toHaveBeenCalledWith("Colleague");
  });
});
