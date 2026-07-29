// Coverage: app/assets/src/components/views/SampleView/components/
//   ConsensusGenomeView/components/ConsensusGenomeHeader/components/
//   ConsensusGenomeDropdown/ConsensusGenomeDropdown.tsx
//
// ConsensusGenomeDropdown turns a list of consensus-genome workflow runs into
// SDS Dropdown options ({name: taxon, details: "accession - accession name",
// value: run id}), resolves the initially-selected run id back to its display
// name, and forwards a selection to onConsensusGenomeSelection -- but only when
// the SDS Dropdown hands back a non-null option. The SDS Dropdown is stubbed so
// the derived options, the InputDropdownProps value and the two option-key
// helpers can all be asserted, and onChange can be driven with both a real
// option and null.
import { render } from "@testing-library/react";

let lastDropdownProps: $TSFixMe = null;
jest.mock("@czi-sds/components", () => {
  const ReactLib = require("react");
  return {
    Dropdown: (props: $TSFixMe) => {
      lastDropdownProps = props;
      return ReactLib.createElement("div", { "data-testid": "cg-dropdown" });
    },
  };
});

import { ConsensusGenomeDropdown } from "~/components/views/SampleView/components/ConsensusGenomeView/components/ConsensusGenomeHeader/components/ConsensusGenomeDropdown/ConsensusGenomeDropdown";

const RUNS = [
  {
    id: 11,
    inputs: {
      accession_id: "MN908947.3",
      accession_name: "Wuhan seafood market pneumonia virus",
      taxon_name: "SARS-CoV-2",
    },
  },
  {
    id: 22,
    inputs: {
      accession_id: "NC_001802.1",
      accession_name: "Human immunodeficiency virus 1",
      taxon_name: "HIV-1",
    },
  },
] as $TSFixMe;

const renderDropdown = (overrides: $TSFixMe = {}) => {
  const onConsensusGenomeSelection = jest.fn();
  const utils = render(
    <ConsensusGenomeDropdown
      workflowRuns={RUNS}
      onConsensusGenomeSelection={onConsensusGenomeSelection}
      {...overrides}
    />,
  );
  return { onConsensusGenomeSelection, ...utils };
};

beforeEach(() => {
  lastDropdownProps = null;
});

describe("ConsensusGenomeDropdown options", () => {
  it("maps each workflow run to a name/details/value option", () => {
    renderDropdown();
    expect(lastDropdownProps.options).toEqual([
      {
        name: "SARS-CoV-2",
        details: "MN908947.3 - Wuhan seafood market pneumonia virus",
        value: 11,
      },
      {
        name: "HIV-1",
        details: "NC_001802.1 - Human immunodeficiency virus 1",
        value: 22,
      },
    ]);
  });

  it("labels the dropdown 'Mapped to'", () => {
    renderDropdown();
    expect(lastDropdownProps.label).toBe("Mapped to");
  });

  it("renders an empty option list when there are no workflow runs", () => {
    renderDropdown({ workflowRuns: [] });
    expect(lastDropdownProps.options).toEqual([]);
    expect(lastDropdownProps.InputDropdownProps.value).toBeUndefined();
  });
});

describe("ConsensusGenomeDropdown initial selection", () => {
  it("shows the taxon name of the initially selected run", () => {
    renderDropdown({ initialSelectedValue: 22 });
    expect(lastDropdownProps.InputDropdownProps.value).toBe("HIV-1");
  });

  it("shows no value when the initial selection matches no run", () => {
    renderDropdown({ initialSelectedValue: 999 });
    expect(lastDropdownProps.InputDropdownProps.value).toBeUndefined();
  });

  it("shows no value when the initial selection is null", () => {
    renderDropdown({ initialSelectedValue: null });
    expect(lastDropdownProps.InputDropdownProps.value).toBeUndefined();
  });

  it("shows no value when no initial selection is provided at all", () => {
    renderDropdown();
    expect(lastDropdownProps.InputDropdownProps.value).toBeUndefined();
  });
});

describe("ConsensusGenomeDropdown selection callback", () => {
  it("forwards the selected run id", () => {
    const { onConsensusGenomeSelection } = renderDropdown();
    lastDropdownProps.onChange({ name: "HIV-1", value: 22 });
    expect(onConsensusGenomeSelection).toHaveBeenCalledWith(22);
  });

  it("ignores a null selection", () => {
    const { onConsensusGenomeSelection } = renderDropdown();
    lastDropdownProps.onChange(null);
    expect(onConsensusGenomeSelection).not.toHaveBeenCalled();
  });
});

describe("ConsensusGenomeDropdown menu helpers", () => {
  it("builds a stable option key from name and value", () => {
    renderDropdown();
    expect(
      lastDropdownProps.DropdownMenuProps.getOptionKey({
        name: "HIV-1",
        value: 22,
      }),
    ).toBe("HIV-122");
  });

  it("compares options by value, not identity", () => {
    renderDropdown();
    const { isOptionEqualToValue } = lastDropdownProps.DropdownMenuProps;
    expect(isOptionEqualToValue({ value: 11 }, { value: 11 })).toBe(true);
    expect(isOptionEqualToValue({ value: 11 }, { value: 22 })).toBe(false);
  });
});
