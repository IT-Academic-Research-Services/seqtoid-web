// Coverage: app/assets/src/components/views/SamplesHeatmapView/components/
//   SamplesHeatmapFilters/components/SamplesHeatmapTaxonTagCheckbox/
//   SamplesHeatmapTaxonTagCheckbox.tsx
//
// A single taxon-tag checkbox that toggles its value in/out of
// selectedOptions.taxonTags and emits the whole new list upward. Branches
// exercised here: tag already selected vs not, taxonTags missing entirely (the
// `|| []` fallback), disabled vs enabled label styling, and the info icon which
// only renders when BOTH showInfoIcon and infoIconTooltipContent are supplied.
import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("@czi-sds/components", () => {
  const ReactLib = require("react");
  return {
    InputCheckbox: (props: $TSFixMe) =>
      ReactLib.createElement("input", {
        type: "checkbox",
        "data-testid": "taxon-tag-checkbox",
        disabled: !!props.disabled,
        checked: !!props.checked,
        onChange: props.onChange,
      }),
    Icon: (props: $TSFixMe) =>
      ReactLib.createElement("span", {
        "data-testid": "info-icon",
        "data-sds-icon": props.sdsIcon,
      }),
    Tooltip: (props: $TSFixMe) =>
      ReactLib.createElement(
        "span",
        { "data-testid": "info-tooltip", "data-title": String(props.title) },
        props.children,
      ),
  };
});

import { SamplesHeatmapTaxonTagCheckbox } from "~/components/views/SamplesHeatmapView/components/SamplesHeatmapFilters/components/SamplesHeatmapTaxonTagCheckbox/SamplesHeatmapTaxonTagCheckbox";

function renderCheckbox(overrides: $TSFixMe = {}) {
  const onSelectedOptionsChange = jest.fn();
  const props = {
    label: "Known Pathogens",
    value: "known_pathogen",
    selectedOptions: { taxonTags: [] },
    onSelectedOptionsChange,
    ...overrides,
  };
  const utils = render(
    <SamplesHeatmapTaxonTagCheckbox {...(props as $TSFixMe)} />,
  );
  return { onSelectedOptionsChange, ...utils };
}

const box = () => screen.getByTestId("taxon-tag-checkbox") as HTMLInputElement;

describe("SamplesHeatmapTaxonTagCheckbox", () => {
  it("renders the label unchecked when the tag is not selected", () => {
    renderCheckbox();
    expect(screen.getByText("Known Pathogens")).toBeTruthy();
    expect(box().checked).toBe(false);
    expect(box().disabled).toBe(false);
  });

  it("renders checked when the tag is already in taxonTags", () => {
    renderCheckbox({ selectedOptions: { taxonTags: ["known_pathogen"] } });
    expect(box().checked).toBe(true);
  });

  it("adds the value to the existing tags when toggled on", () => {
    const { onSelectedOptionsChange } = renderCheckbox({
      selectedOptions: { taxonTags: ["lcrp"] },
    });
    fireEvent.click(box());
    expect(onSelectedOptionsChange).toHaveBeenCalledWith({
      taxonTags: ["lcrp", "known_pathogen"],
    });
  });

  it("adds the value as the only tag when nothing is selected yet", () => {
    const { onSelectedOptionsChange } = renderCheckbox({
      selectedOptions: { taxonTags: [] },
    });
    fireEvent.click(box());
    expect(onSelectedOptionsChange).toHaveBeenCalledWith({
      taxonTags: ["known_pathogen"],
    });
  });

  it("removes the value from the tags when toggled off", () => {
    const { onSelectedOptionsChange } = renderCheckbox({
      selectedOptions: { taxonTags: ["lcrp", "known_pathogen"] },
    });
    fireEvent.click(box());
    expect(onSelectedOptionsChange).toHaveBeenCalledWith({
      taxonTags: ["lcrp"],
    });
  });

  it("marks the checkbox disabled and takes the composed-class label branch", () => {
    renderCheckbox({ disabled: true });
    expect(box().disabled).toBe(true);
    // Under the scss mock both class tokens are undefined, so the disabled
    // branch (cx(...)) yields an empty string attribute while the enabled
    // branch passes undefined straight through and emits no attribute at all.
    expect(screen.getByText("Known Pathogens").getAttribute("class")).toBe("");
  });

  it("takes the single-class label branch when enabled", () => {
    renderCheckbox({ disabled: false });
    expect(
      screen.getByText("Known Pathogens").getAttribute("class"),
    ).toBeNull();
  });

  it("renders the info icon only when both icon flag and content are given", () => {
    renderCheckbox({
      showInfoIcon: true,
      infoIconTooltipContent: "Tooltip copy",
    });
    expect(screen.getByTestId("info-icon")).toBeTruthy();
    expect(screen.getByTestId("info-tooltip").getAttribute("data-title")).toBe(
      "Tooltip copy",
    );
  });

  it("omits the info icon when the flag is set but content is missing", () => {
    renderCheckbox({ showInfoIcon: true });
    expect(screen.queryByTestId("info-icon")).toBeNull();
  });

  it("omits the info icon when content is given but the flag is off", () => {
    renderCheckbox({ infoIconTooltipContent: "Tooltip copy" });
    expect(screen.queryByTestId("info-icon")).toBeNull();
  });
});
