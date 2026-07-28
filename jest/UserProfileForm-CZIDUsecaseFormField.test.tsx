// Coverage: app/assets/src/components/views/UserProfileForm/components/
//   CZIDUsecaseFormField/CZIDUsecaseFormField.tsx
//
// CZIDUsecaseFormField is the referral field's capped sibling: it renders one
// Checkbox per CZID_USECASE_OPTIONS entry plus an "Other:" free-text
// checkbox, but refuses to add a new selection once MAX_SELECTIONS is
// reached (un-checking is always allowed) and marks every child as
// selection-disabled at the cap. The effect deriving isOtherCheckboxChecked
// from the "Other:" prefix is exercised both ways.
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

import { CZIDUsecaseFormField } from "~/components/views/UserProfileForm/components/CZIDUsecaseFormField/CZIDUsecaseFormField";
import {
  AMR_DETECTION_OPTION,
  CLINICAL_RESEARCH_OPTION,
  CZID_USECASE_OPTIONS,
  DISCOVER_NOVEL_VIRUSES_OPTION,
  IDENTIFY_KNOWN_PATHOGEN_OPTION,
  MICROBIOME_ANALYSIS_OPTION,
  OUTBREAK_DETECTION_OPTION,
} from "~/components/views/UserProfileForm/components/CZIDUsecaseFormField/constants";

function renderComp(selected: string[] = []) {
  const setSelectedUsecaseCheckboxes = jest.fn();
  const utils = render(
    <CZIDUsecaseFormField
      selectedUsecaseCheckboxes={selected}
      setSelectedUsecaseCheckboxes={setSelectedUsecaseCheckboxes}
    />,
  );
  return { setSelectedUsecaseCheckboxes, ...utils };
}

describe("CZIDUsecaseFormField", () => {
  it("renders the question copy including the selection cap", () => {
    renderComp();
    expect(screen.getByText("How do you plan to use SeqtoID?")).toBeTruthy();
    expect(screen.getByText(/select up to 3/)).toBeTruthy();
  });

  it("renders one checkbox per usecase option", () => {
    renderComp();
    expect(screen.getAllByTestId("czid-usecase-checkbox")).toHaveLength(
      CZID_USECASE_OPTIONS.length,
    );
  });

  it("appends a newly checked option below the cap", () => {
    const { setSelectedUsecaseCheckboxes } = renderComp([
      IDENTIFY_KNOWN_PATHOGEN_OPTION,
    ]);
    fireEvent.click(screen.getByText(OUTBREAK_DETECTION_OPTION));
    expect(setSelectedUsecaseCheckboxes).toHaveBeenCalledWith([
      IDENTIFY_KNOWN_PATHOGEN_OPTION,
      OUTBREAK_DETECTION_OPTION,
    ]);
  });

  it("refuses to append once the cap is reached", () => {
    const { setSelectedUsecaseCheckboxes } = renderComp([
      IDENTIFY_KNOWN_PATHOGEN_OPTION,
      OUTBREAK_DETECTION_OPTION,
      DISCOVER_NOVEL_VIRUSES_OPTION,
    ]);
    fireEvent.click(screen.getByText(AMR_DETECTION_OPTION));
    // called, but the list is unchanged - the new value was not pushed
    expect(setSelectedUsecaseCheckboxes).toHaveBeenCalledWith([
      IDENTIFY_KNOWN_PATHOGEN_OPTION,
      OUTBREAK_DETECTION_OPTION,
      DISCOVER_NOVEL_VIRUSES_OPTION,
    ]);
  });

  it("still allows un-checking at the cap", () => {
    const { setSelectedUsecaseCheckboxes } = renderComp([
      IDENTIFY_KNOWN_PATHOGEN_OPTION,
      OUTBREAK_DETECTION_OPTION,
      CLINICAL_RESEARCH_OPTION,
    ]);
    fireEvent.click(screen.getByText(OUTBREAK_DETECTION_OPTION));
    expect(setSelectedUsecaseCheckboxes).toHaveBeenCalledWith([
      IDENTIFY_KNOWN_PATHOGEN_OPTION,
      CLINICAL_RESEARCH_OPTION,
    ]);
  });

  it("does not show disabled tooltips below the cap", () => {
    renderComp([IDENTIFY_KNOWN_PATHOGEN_OPTION, OUTBREAK_DETECTION_OPTION]);
    expect(screen.queryAllByTestId("tooltip")).toHaveLength(0);
  });

  it("shows a disabled tooltip on every unselected checkbox at the cap", () => {
    renderComp([
      IDENTIFY_KNOWN_PATHOGEN_OPTION,
      OUTBREAK_DETECTION_OPTION,
      MICROBIOME_ANALYSIS_OPTION,
    ]);
    const tooltips = screen.getAllByTestId("tooltip");
    // every option except the 3 selected ones, plus the "Other:" checkbox
    expect(tooltips).toHaveLength(CZID_USECASE_OPTIONS.length - 3 + 1);
    expect(tooltips[0].getAttribute("data-title")).toBe(
      "Remove a selection to select again.",
    );
  });

  it("marks the Other checkbox unchecked with no prefixed entry", () => {
    renderComp([IDENTIFY_KNOWN_PATHOGEN_OPTION]);
    const stages = screen
      .getAllByTestId("input-checkbox")
      .map(node => node.getAttribute("data-stage"));
    expect(stages[stages.length - 1]).toBe("unchecked");
  });

  it("marks the Other checkbox checked when a prefixed entry is selected", () => {
    renderComp([IDENTIFY_KNOWN_PATHOGEN_OPTION, "Other: teaching"]);
    const stages = screen
      .getAllByTestId("input-checkbox")
      .map(node => node.getAttribute("data-stage"));
    expect(stages[stages.length - 1]).toBe("checked");
  });

  it("blocks free-text typing when the cap is reached and Other is unchecked", () => {
    const { setSelectedUsecaseCheckboxes } = renderComp([
      IDENTIFY_KNOWN_PATHOGEN_OPTION,
      OUTBREAK_DETECTION_OPTION,
      CLINICAL_RESEARCH_OPTION,
    ]);
    fireEvent.change(screen.getByTestId("text-input"), {
      target: { value: "blocked" },
    });
    expect(setSelectedUsecaseCheckboxes).not.toHaveBeenCalled();
  });
});
