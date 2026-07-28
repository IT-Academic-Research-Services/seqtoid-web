// Coverage: app/assets/src/components/views/SampleView/components/AmrView/
//   components/AmrSampleReport/components/ToggleVisibleColumnsDropdown/
//   components/ToggleAllButton/ToggleAllButton.tsx
//
// ToggleAllButton decides whether every column in a section is currently
// visible (accounting for COLUMNS_ALWAYS_PRESENT, which count as visible even
// when absent from the dropdown value) and renders either "Deselect All" or
// "Select All". Clicking rebuilds the pending option list: hide drops the whole
// section, show re-adds every option in the section on top of the untouched
// other-section options. The SDS Button is stubbed to a plain <button> so the
// two render branches and both toggle directions are driven directly.
import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("@czi-sds/components", () => {
  const ReactLib = require("react");
  return {
    Button: (props: $TSFixMe) =>
      ReactLib.createElement(
        "button",
        { onClick: props.onClick },
        props.children,
      ),
  };
});

import { ToggleAllButton } from "~/components/views/SampleView/components/AmrView/components/AmrSampleReport/components/ToggleVisibleColumnsDropdown/components/ToggleAllButton/ToggleAllButton";
import {
  COLUMN_ID_TO_NAME,
  ColumnSection,
} from "~/components/views/SampleView/components/AmrView/constants";

// Build an option {name} from a columnId via the shared name map.
const opt = (columnId: string) => ({ name: COLUMN_ID_TO_NAME.get(columnId) });

// All READS-section option names (the columns the dropdown can toggle).
const READS_COLUMN_IDS = [
  "reads",
  "rpm",
  "readCoverageBreadth",
  "readCoverageDepth",
  "dpm",
  "readSpecies",
];
const readsOptions = READS_COLUMN_IDS.map(opt);
const geneInfoOptions = [opt("drugClass")];

const renderButton = (
  dropdownValue: $TSFixMe,
  section = ColumnSection.READS,
) => {
  const setPendingOptions = jest.fn();
  // dropdownOptions = every toggleable option across sections
  const dropdownOptions = [...readsOptions, ...geneInfoOptions];
  const utils = render(
    <ToggleAllButton
      dropdownOptions={dropdownOptions}
      dropdownValue={dropdownValue}
      section={section}
      setPendingOptions={setPendingOptions}
    />,
  );
  return { setPendingOptions, ...utils };
};

describe("ToggleAllButton", () => {
  it("shows Select All when the section is not fully visible", () => {
    // only one of the READS columns present -> not all visible
    renderButton([opt("reads")]);
    expect(screen.getByRole("button").textContent).toContain("Select All");
  });

  it("shows Deselect All when every column in the section is visible", () => {
    renderButton([...readsOptions]);
    expect(screen.getByRole("button").textContent).toContain("Deselect All");
  });

  it("counts always-present columns as visible for a section that contains one", () => {
    // GENE_INFO includes the always-present GENE column, which is never in the
    // dropdown value; the remaining GENE_INFO columns still gate visibility.
    const geneInfoAll = [
      opt("drugClass"),
      opt("highLevelDrugClass"),
      opt("geneFamily"),
      opt("mechanism"),
      opt("model"),
    ];
    render(
      <ToggleAllButton
        dropdownOptions={geneInfoAll}
        dropdownValue={geneInfoAll}
        section={ColumnSection.GENE_INFO}
        setPendingOptions={jest.fn()}
      />,
    );
    expect(screen.getByRole("button").textContent).toContain("Deselect All");
  });

  it("hiding a section drops that section's options, keeping the others", () => {
    // All READS visible + one GENE_INFO option -> Deselect All -> hide.
    const dropdownValue = [...readsOptions, opt("drugClass")];
    const { setPendingOptions } = renderButton(dropdownValue);
    fireEvent.click(screen.getByRole("button"));

    expect(setPendingOptions).toHaveBeenCalledTimes(1);
    const pending = setPendingOptions.mock.calls[0][0];
    // only the other-section (GENE_INFO) option survives
    expect(pending).toEqual([opt("drugClass")]);
  });

  it("showing a section re-adds all of its options on top of the others", () => {
    // Start with just GENE_INFO visible -> READS not all visible -> Select All.
    const dropdownValue = [opt("drugClass")];
    const { setPendingOptions } = renderButton(dropdownValue);
    fireEvent.click(screen.getByRole("button"));

    expect(setPendingOptions).toHaveBeenCalledTimes(1);
    const pending = setPendingOptions.mock.calls[0][0];
    const names = pending.map((o: $TSFixMe) => o.name);
    // the pre-existing other-section option is retained
    expect(names).toContain(COLUMN_ID_TO_NAME.get("drugClass"));
    // and every READS option is now present
    READS_COLUMN_IDS.forEach(id => {
      expect(names).toContain(COLUMN_ID_TO_NAME.get(id));
    });
  });
});
