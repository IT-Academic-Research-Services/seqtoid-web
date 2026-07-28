// Coverage: app/assets/src/components/views/UserProfileForm/components/
//   SequencingExpertiseFormField/SequencingExpertiseFormField.tsx
//
// SequencingExpertiseFormField renders a radio per expertise level. The label
// used for both the radio and the reported value is `text || subtext`, which
// matters for NONE_OF_THE_ABOVE (text === null, so it falls back to its
// subtext and renders no bold segment / no " - " separator). Selecting a
// radio reports the derived label upward, and stage is "checked" only for the
// currently selected label. SDS/MUI primitives are stubbed.
import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("@czi-sds/components", () => {
  const ReactLib = require("react");
  return {
    InputRadio: (props: $TSFixMe) =>
      ReactLib.createElement("button", {
        "data-testid": "input-radio",
        "data-label": props.label,
        "data-stage": props.stage,
        onClick: props.onClick,
      }),
  };
});

jest.mock("@mui/material", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    RadioGroup: (props: $TSFixMe) =>
      ReactLib.createElement(
        "div",
        { "data-testid": "radio-group", "data-name": props.name },
        props.children,
      ),
  };
});

import { SequencingExpertiseFormField } from "~/components/views/UserProfileForm/components/SequencingExpertiseFormField/SequencingExpertiseFormField";

function renderComp(selected = "") {
  const setSelectedSequencingExpertise = jest.fn();
  const utils = render(
    <SequencingExpertiseFormField
      selectedSequencingExpertise={selected}
      setSelectedSequencingExpertise={setSelectedSequencingExpertise}
    />,
  );
  return { setSelectedSequencingExpertise, ...utils };
}

describe("SequencingExpertiseFormField", () => {
  it("renders the question copy inside a radio group", () => {
    renderComp();
    expect(
      screen.getByText(/expertise level in analyzing/, { exact: false }),
    ).toBeTruthy();
    expect(screen.getByTestId("radio-group").getAttribute("data-name")).toBe(
      "userform-radio-buttons-group",
    );
  });

  it("renders one option per expertise level", () => {
    renderComp();
    expect(screen.getAllByTestId("expertise-option")).toHaveLength(5);
    expect(screen.getAllByTestId("input-radio")).toHaveLength(5);
  });

  it("labels the titled options with their text and the last with its subtext", () => {
    renderComp();
    const labels = screen
      .getAllByTestId("input-radio")
      .map(node => node.getAttribute("data-label"));
    expect(labels).toEqual([
      "Low",
      "Medium",
      "High",
      "Expert",
      "No experience",
    ]);
  });

  it("renders bold text plus a separator only for titled options", () => {
    renderComp();
    const options = screen.getAllByTestId("expertise-option");
    // "Low" option keeps the bold title and the " - " separator
    expect(options[0].textContent).toContain("Low - ");
    expect(options[0].textContent).toContain("Need training and support");
    // "No experience" has no title, so no separator is rendered
    expect(options[4].textContent).toBe("No experience");
    expect(options[4].textContent).not.toContain(" - ");
  });

  it("reports the derived label when a titled option is clicked", () => {
    const { setSelectedSequencingExpertise } = renderComp();
    fireEvent.click(screen.getAllByTestId("input-radio")[2]);
    expect(setSelectedSequencingExpertise).toHaveBeenCalledWith("High");
  });

  it("reports the subtext fallback when the untitled option is clicked", () => {
    const { setSelectedSequencingExpertise } = renderComp();
    fireEvent.click(screen.getAllByTestId("input-radio")[4]);
    expect(setSelectedSequencingExpertise).toHaveBeenCalledWith(
      "No experience",
    );
  });

  it("marks nothing checked when no expertise has been selected", () => {
    renderComp("");
    const stages = screen
      .getAllByTestId("input-radio")
      .map(node => node.getAttribute("data-stage"));
    expect(stages).toEqual(Array(5).fill("unchecked"));
  });

  it("marks only the selected expertise as checked", () => {
    renderComp("Medium");
    const stages = screen
      .getAllByTestId("input-radio")
      .map(node => node.getAttribute("data-stage"));
    expect(stages).toEqual([
      "unchecked",
      "checked",
      "unchecked",
      "unchecked",
      "unchecked",
    ]);
  });

  it("can mark the untitled option as checked via its subtext value", () => {
    renderComp("No experience");
    const stages = screen
      .getAllByTestId("input-radio")
      .map(node => node.getAttribute("data-stage"));
    expect(stages[4]).toBe("checked");
  });
});
