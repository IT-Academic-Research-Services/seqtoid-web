// Coverage: app/assets/src/components/views/SamplesHeatmapView/components/SamplesHeatmapFilters/components/SamplesHeatmapBackgroundDropdown/SamplesHeatmapBackgroundDropdown.tsx
//
// This dropdown formats the raw background list into SDS options: it always
// prepends the "None" background, marks mass-normalized backgrounds disabled
// unless the enableMassNormalizedBackgrounds flag is set, and tags each option
// with a "Normalized by input mass" / "Standard" subtext. The SDS <Dropdown> is
// stubbed so we can read the computed options, the resolved display value (via
// the real valueToName helper) and drive its onChange guard (only forwards a
// value when one is actually present).
import { fireEvent, render, screen } from "@testing-library/react";
import { SamplesHeatmapBackgroundDropdown } from "~/components/views/SamplesHeatmapView/components/SamplesHeatmapFilters/components/SamplesHeatmapBackgroundDropdown/SamplesHeatmapBackgroundDropdown";

let lastDropdownProps: $TSFixMe;

jest.mock("@czi-sds/components", () => ({
  Dropdown: (props: $TSFixMe) => {
    lastDropdownProps = props;
    return (
      <div data-testid="dropdown">
        <span data-testid="dd-disabled">
          {String(props.InputDropdownProps?.disabled)}
        </span>
        <span data-testid="dd-value">{props.InputDropdownProps?.value}</span>
        <ul>
          {props.options.map((o: $TSFixMe, i: number) => (
            <li
              key={i}
              data-testid={`opt-${o.value}`}
              data-disabled={String(
                props.DropdownMenuProps?.getOptionDisabled?.(o),
              )}
              data-subtext={o.subtext || ""}
            >
              {o.name}
            </li>
          ))}
        </ul>
        <button
          data-testid="change-valid"
          onClick={() => props.onChange({ value: 42 })}
        >
          valid
        </button>
        <button
          data-testid="change-undefined"
          onClick={() => props.onChange({})}
        >
          undefined
        </button>
        <button data-testid="change-null" onClick={() => props.onChange(null)}>
          null
        </button>
      </div>
    );
  },
}));

const BACKGROUNDS = [
  { name: "Standard BG", value: 10, mass_normalized: false },
  { name: "Mass BG", value: 20, mass_normalized: true },
];

const renderDropdown = (overrides: $TSFixMe = {}) => {
  const onChange = overrides.onChange || jest.fn();
  render(
    <SamplesHeatmapBackgroundDropdown
      allBackgrounds={BACKGROUNDS as $TSFixMe}
      onChange={onChange}
      {...overrides}
    />,
  );
  return { onChange };
};

describe("SamplesHeatmapBackgroundDropdown", () => {
  it("always prepends the None background option", () => {
    renderDropdown();
    // value 0 is the None option.
    expect(screen.getByTestId("opt-0").textContent).toBe("None");
    expect(screen.getByTestId("opt-10")).toBeTruthy();
    expect(screen.getByTestId("opt-20")).toBeTruthy();
  });

  it("disables mass-normalized backgrounds when the flag is off", () => {
    renderDropdown({ enableMassNormalizedBackgrounds: false });
    // Mass BG is mass_normalized -> disabled; Standard BG is not.
    expect(screen.getByTestId("opt-20").getAttribute("data-disabled")).toBe(
      "true",
    );
    expect(screen.getByTestId("opt-10").getAttribute("data-disabled")).toBe(
      "false",
    );
    // subtext reflects normalization state
    expect(screen.getByTestId("opt-20").getAttribute("data-subtext")).toBe(
      "Normalized by input mass",
    );
    expect(screen.getByTestId("opt-10").getAttribute("data-subtext")).toBe(
      "Standard",
    );
  });

  it("enables mass-normalized backgrounds when the flag is on", () => {
    renderDropdown({ enableMassNormalizedBackgrounds: true });
    expect(screen.getByTestId("opt-20").getAttribute("data-disabled")).toBe(
      "false",
    );
  });

  it("shows None as the display value when no value is selected", () => {
    renderDropdown({ value: null });
    expect(screen.getByTestId("dd-value").textContent).toBe("None");
  });

  it("resolves the display value to the selected background name", () => {
    renderDropdown({ value: 10 });
    expect(screen.getByTestId("dd-value").textContent).toBe("Standard BG");
  });

  it("honors the disabled prop", () => {
    renderDropdown({ disabled: true });
    expect(screen.getByTestId("dd-disabled").textContent).toBe("true");
  });

  it("is not disabled by default", () => {
    renderDropdown();
    expect(screen.getByTestId("dd-disabled").textContent).toBe("false");
  });

  it("forwards the new value on change only when a value is present", () => {
    const { onChange } = renderDropdown();
    fireEvent.click(screen.getByTestId("change-valid"));
    expect(onChange).toHaveBeenCalledWith(42);

    onChange.mockClear();
    // newValue with no `value` field -> guarded out
    fireEvent.click(screen.getByTestId("change-undefined"));
    expect(onChange).not.toHaveBeenCalled();

    // null newValue -> guarded out
    fireEvent.click(screen.getByTestId("change-null"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("treats options with equal values as equal (isOptionEqualToValue)", () => {
    renderDropdown();
    const isEqual = lastDropdownProps.DropdownMenuProps.isOptionEqualToValue;
    expect(isEqual({ value: 10 }, { value: 10 })).toBe(true);
    expect(isEqual({ value: 10 }, { value: 20 })).toBe(false);
  });
});
