// Frontend coverage:
// .../WorkflowSelector/components/ConsensusGenomeSequencingPlatformOptions/
//   components/ConsensusGenomeWithNanopore/components/
//   ConsensusGenomeNanoporeSettings/ConsensusGenomeNanoporeSettings.tsx
//
// The Nanopore settings panel is driven entirely by the usedClearLabs flag:
// with Clear Labs on, the wetlab protocol and medaka model collapse to the
// fixed "ARTIC v3" / "r941_min_high_g360" text and their pickers disappear, and
// the medaka tooltip copy swaps to the short Clear-Labs blurb. The panel also
// translates the Toggle's label-based onChange ("Yes"/"No") into the boolean
// the upload flow stores, and stops click propagation so toggling does not
// re-trigger the enclosing analysis-type card.
//
// The two pickers, the tooltip and the Toggle are stubbed so their callbacks
// can be driven directly. The Toggle in particular has to be stubbed: it is a
// semantic-ui Radio, which by design refuses to fire onChange when it is
// already checked, so a real one could never produce the "No" label.
import { fireEvent, render, screen } from "@testing-library/react";
import { ConsensusGenomeNanoporeSettings } from "~/components/views/SampleUploadFlow/components/WorkflowSelector/components/ConsensusGenomeSequencingPlatformOptions/components/ConsensusGenomeWithNanopore/components/ConsensusGenomeNanoporeSettings/ConsensusGenomeNanoporeSettings";
import { SEQUENCING_TECHNOLOGY_OPTIONS } from "~/components/views/SampleUploadFlow/constants";

// scss reached through the `~/` alias bypasses jest's global style mock.
jest.mock(
  "~/components/views/SampleUploadFlow/components/WorkflowSelector/workflow_selector.scss",
  () => ({}),
  { virtual: true },
);

jest.mock("~/components/ui/containers/ColumnHeaderTooltip", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => (
    <span data-testid="header-tooltip" data-link={props.link}>
      {props.content}
    </span>
  ),
}));

let mockSectionsDropdownProps: $TSFixMe = null;
jest.mock("~/components/ui/controls/dropdowns/SectionsDropdown", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => {
    mockSectionsDropdownProps = props;
    return (
      <button
        data-testid="medaka-dropdown"
        data-selected={props.selectedValue}
        onClick={() => props.onChange("r941_min_high_g344")}
      >
        medaka
      </button>
    );
  },
}));

jest.mock("~/components/ui/controls/Toggle", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => (
    <span
      data-testid="clear-labs-toggle"
      data-initial-checked={String(props.initialChecked)}
      data-on-label={props.onLabel}
      data-off-label={props.offLabel}
    >
      <button
        data-testid="clear-labs-on"
        onClick={() => props.onChange(props.onLabel)}
      >
        on
      </button>
      <button
        data-testid="clear-labs-off"
        onClick={() => props.onChange(props.offLabel)}
      >
        off
      </button>
    </span>
  ),
}));

let mockWetlabProps: $TSFixMe = null;
jest.mock(
  "~/components/views/SampleUploadFlow/components/WorkflowSelector/components/WetlabSelector",
  () => ({
    __esModule: true,
    WetlabSelector: (props: $TSFixMe) => {
      mockWetlabProps = props;
      return (
        <button
          data-testid="wetlab-selector"
          data-technology={props.technology}
          data-selected={props.selectedWetlabProtocol}
          onClick={() => props.onWetlabProtocolChange("artic_v4")}
        >
          wetlab
        </button>
      );
    },
  }),
);

const baseProps = {
  onClearLabsChange: jest.fn(),
  onMedakaModelChange: jest.fn(),
  selectedMedakaModel: "r941_min_high_g360",
  usedClearLabs: false,
  onWetlabProtocolChange: jest.fn(),
  selectedWetlabProtocol: "artic",
};

const renderSettings = (overrides: $TSFixMe = {}) =>
  render(<ConsensusGenomeNanoporeSettings {...baseProps} {...overrides} />);

beforeEach(() => {
  mockSectionsDropdownProps = null;
  mockWetlabProps = null;
  jest.clearAllMocks();
});

describe("ConsensusGenomeNanoporeSettings -- Clear Labs off", () => {
  it("renders both pickers wired to the current selections", () => {
    renderSettings({ usedClearLabs: false });

    expect(
      screen.getByTestId("wetlab-selector").getAttribute("data-selected"),
    ).toBe("artic");
    expect(mockWetlabProps.technology).toBe(
      SEQUENCING_TECHNOLOGY_OPTIONS.NANOPORE,
    );
    expect(
      screen.getByTestId("medaka-dropdown").getAttribute("data-selected"),
    ).toBe("r941_min_high_g360");
    // The fixed Clear-Labs values are not shown while the pickers are live.
    expect(screen.queryByText("ARTIC v3")).toBeNull();
  });

  it("uses the long 'specify the correct model' medaka guidance", () => {
    renderSettings({ usedClearLabs: false });

    const tooltips = screen.getAllByTestId("header-tooltip");
    const medakaTooltip = tooltips[tooltips.length - 1];
    expect(medakaTooltip.textContent).toContain(
      "For best results, specify the correct model",
    );
  });

  it("forwards picker changes to the upload flow", () => {
    const onWetlabProtocolChange = jest.fn();
    const onMedakaModelChange = jest.fn();
    renderSettings({ onWetlabProtocolChange, onMedakaModelChange });

    fireEvent.click(screen.getByTestId("wetlab-selector"));
    fireEvent.click(screen.getByTestId("medaka-dropdown"));

    expect(onWetlabProtocolChange).toHaveBeenCalledWith("artic_v4");
    expect(onMedakaModelChange).toHaveBeenCalledWith("r941_min_high_g344");
    expect(mockSectionsDropdownProps.categories).toBeTruthy();
  });
});

describe("ConsensusGenomeNanoporeSettings -- Clear Labs on", () => {
  it("replaces both pickers with the fixed Clear Labs values", () => {
    renderSettings({ usedClearLabs: true });

    expect(screen.getByText("ARTIC v3")).toBeTruthy();
    expect(screen.getByText("r941_min_high_g360")).toBeTruthy();
    expect(screen.queryByTestId("wetlab-selector")).toBeNull();
    expect(screen.queryByTestId("medaka-dropdown")).toBeNull();
  });

  it("swaps in the short Clear Labs medaka explanation", () => {
    renderSettings({ usedClearLabs: true });

    const tooltips = screen.getAllByTestId("header-tooltip");
    const medakaTooltip = tooltips[tooltips.length - 1];
    expect(medakaTooltip.textContent).toContain(
      "Medaka is a tool to create consensus sequences",
    );
    expect(medakaTooltip.textContent).not.toContain("For best results");
  });
});

describe("ConsensusGenomeNanoporeSettings -- Clear Labs toggle", () => {
  it("seeds the toggle from usedClearLabs and labels it Yes/No", () => {
    renderSettings({ usedClearLabs: true });

    const toggle = screen.getByTestId("clear-labs-toggle");
    expect(toggle.getAttribute("data-initial-checked")).toBe("true");
    expect(toggle.getAttribute("data-on-label")).toBe("Yes");
    expect(toggle.getAttribute("data-off-label")).toBe("No");
  });

  it("maps the 'Yes' label to true when switched on", () => {
    const onClearLabsChange = jest.fn();
    renderSettings({ usedClearLabs: false, onClearLabsChange });

    fireEvent.click(screen.getByTestId("clear-labs-on"));

    expect(onClearLabsChange).toHaveBeenCalledWith(true);
  });

  it("maps the 'No' label to false when switched off", () => {
    const onClearLabsChange = jest.fn();
    renderSettings({ usedClearLabs: true, onClearLabsChange });

    fireEvent.click(screen.getByTestId("clear-labs-off"));

    expect(onClearLabsChange).toHaveBeenCalledWith(false);
  });

  it("stops the toggle click from bubbling up to the enclosing card", () => {
    const onCardClick = jest.fn();
    render(
      <div onClick={onCardClick}>
        <ConsensusGenomeNanoporeSettings {...baseProps} />
      </div>,
    );

    fireEvent.click(screen.getByTestId("clear-labs-on"));

    expect(onCardClick).not.toHaveBeenCalled();
  });
});
