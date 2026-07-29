// Coverage: app/assets/src/components/views/UserProfileForm/components/
//   CZIDReferralFormField/CZIDReferralFormField.tsx
//
// CZIDReferralFormField renders one Checkbox per REFERRAL_OPTIONS entry plus a
// free-text "Other:" CheckboxWithInput. Its own logic is (a) an effect that
// derives isOtherCheckboxChecked from whether any selected entry contains the
// "Other:" prefix, and (b) handleCheckboxChange, which removes an already
// selected value and appends an unselected one. The SDS primitives are
// stubbed; the real child Checkbox / CheckboxWithInput components are used so
// clicks flow through to this component's handler.
import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("@czi-sds/components", () => {
  const ReactLib = require("react");
  return {
    InputCheckbox: (props: $TSFixMe) =>
      ReactLib.createElement("span", {
        "data-testid": "input-checkbox",
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

import { CZIDReferralFormField } from "~/components/views/UserProfileForm/components/CZIDReferralFormField/CZIDReferralFormField";
import { REFERRAL_OPTIONS } from "~/components/views/UserProfileForm/components/CZIDReferralFormField/constants";

function renderComp(selected: string[] = []) {
  const setSelectedReferralCheckboxes = jest.fn();
  const utils = render(
    <CZIDReferralFormField
      selectedReferralCheckboxes={selected}
      setSelectedReferralCheckboxes={setSelectedReferralCheckboxes}
    />,
  );
  return { setSelectedReferralCheckboxes, ...utils };
}

describe("CZIDReferralFormField", () => {
  it("renders the question copy marked optional", () => {
    renderComp();
    expect(screen.getByText("How did you learn about SeqtoID?")).toBeTruthy();
    expect(screen.getByText("(select all that apply)")).toBeTruthy();
    expect(screen.getByText("— optional")).toBeTruthy();
  });

  it("renders one checkbox per referral option", () => {
    renderComp();
    REFERRAL_OPTIONS.forEach(option => {
      expect(screen.getByText(option, { exact: false })).toBeTruthy();
    });
    // the fixed options plus the free-text "Other:" checkbox
    expect(screen.getAllByRole("checkbox")).toHaveLength(
      REFERRAL_OPTIONS.length,
    );
  });

  it("appends a newly checked option to the selection", () => {
    const { setSelectedReferralCheckboxes } = renderComp(["Conference"]);
    fireEvent.click(screen.getByText("Colleague"));
    expect(setSelectedReferralCheckboxes).toHaveBeenCalledWith([
      "Conference",
      "Colleague",
    ]);
  });

  it("removes an option that was already selected", () => {
    const { setSelectedReferralCheckboxes } = renderComp([
      "Conference",
      "Colleague",
    ]);
    fireEvent.click(screen.getByText("Conference"));
    expect(setSelectedReferralCheckboxes).toHaveBeenCalledWith(["Colleague"]);
  });

  it("marks the Other checkbox unchecked when no prefixed entry is selected", () => {
    renderComp(["Colleague"]);
    const stages = screen
      .getAllByTestId("input-checkbox")
      .map(node => node.getAttribute("data-stage"));
    // last checkbox is the CheckboxWithInput one
    expect(stages[stages.length - 1]).toBe("unchecked");
  });

  it("marks the Other checkbox checked when a prefixed entry is selected", () => {
    renderComp(["Colleague", "Other: a friend"]);
    const stages = screen
      .getAllByTestId("input-checkbox")
      .map(node => node.getAttribute("data-stage"));
    expect(stages[stages.length - 1]).toBe("checked");
  });

  it("passes typed free-text through to the parent setter", () => {
    const { setSelectedReferralCheckboxes } = renderComp(["Colleague"]);
    fireEvent.change(screen.getByTestId("text-input"), {
      target: { value: "a podcast" },
    });
    // CHECKBOX_WITH_INPUT_PREFIX already carries the colon, so the child
    // composes `${prefix}: ${value}` into "Other:: a podcast".
    expect(setSelectedReferralCheckboxes).toHaveBeenCalledWith([
      "Colleague",
      "Other:: a podcast",
    ]);
  });

  it("never disables selection (no tooltip on the referral field)", () => {
    renderComp([
      "Colleague",
      "Conference",
      "Publication",
      "Social Media",
      "Training",
    ]);
    expect(screen.queryByTestId("tooltip")).toBeNull();
  });
});
