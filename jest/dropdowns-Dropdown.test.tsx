// Coverage for app/assets/src/components/ui/controls/dropdowns/Dropdown.tsx
//
// Dropdown is a thin wrapper around BareDropdown: it keeps a local copy of the
// selected value, builds label/subtext maps out of `options`, and renders a
// DropdownTrigger whose text is derived from those maps. The branching worth
// pinning down lives in renderTrigger (selected value vs nullLabel vs
// placeholder, label with/without a value, subtext shown only when
// showSelectedItemSubtext is set) and in the propsValue effect's NaN guard.
//
// BareDropdown and DropdownTrigger run unmocked -- the trigger text is read off
// the `filter-value` testid that DropdownTrigger renders, and options are
// clicked through the kebab-cased testids BareDropdown gives them.
import { fireEvent, render, screen } from "@testing-library/react";
import Dropdown from "~/components/ui/controls/dropdowns/Dropdown";

const OPTIONS = [
  { value: "a", text: "Alpha", subtext: "first letter" },
  { value: "b", text: "Beta gamma", subtext: "second letter" },
];

const triggerText = () => screen.getByTestId("filter-value").textContent;

describe("Dropdown", () => {
  it("shows the label text of the selected value in the trigger", () => {
    render(<Dropdown options={OPTIONS} value="b" onChange={jest.fn()} />);
    expect(triggerText()).toBe("Beta gamma");
  });

  it("falls back to nullLabel when no value is selected", () => {
    render(
      <Dropdown
        options={OPTIONS}
        nullLabel="Any taxon"
        placeholder="Pick one"
        onChange={jest.fn()}
      />,
    );
    expect(triggerText()).toBe("Any taxon");
  });

  it("falls back to the placeholder when there is neither a value nor a nullLabel", () => {
    render(
      <Dropdown
        options={OPTIONS}
        placeholder="Pick one"
        onChange={jest.fn()}
      />,
    );
    expect(triggerText()).toBe("Pick one");
  });

  it("appends a colon to the label only when the trigger also has a value", () => {
    const { unmount } = render(
      <Dropdown
        options={OPTIONS}
        label="Metric"
        value="a"
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByText("Metric:")).toBeTruthy();
    unmount();

    // No value and no nullLabel -> text is undefined -> bare label, no colon.
    render(
      <Dropdown
        options={OPTIONS}
        label="Metric"
        placeholder="Pick one"
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByText("Metric")).toBeTruthy();
    expect(screen.queryByText("Metric:")).toBeNull();
  });

  it("renders the selected option's subtext only when showSelectedItemSubtext is set", () => {
    const { unmount } = render(
      <Dropdown
        options={OPTIONS}
        value="a"
        showSelectedItemSubtext
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByText("first letter")).toBeTruthy();
    unmount();

    render(<Dropdown options={OPTIONS} value="a" onChange={jest.fn()} />);
    expect(screen.queryByText("first letter")).toBeNull();
  });

  it("does not render a subtext for the null selection even with showSelectedItemSubtext", () => {
    render(
      <Dropdown
        options={OPTIONS}
        nullLabel="Any taxon"
        showSelectedItemSubtext
        onChange={jest.fn()}
      />,
    );
    expect(triggerText()).toBe("Any taxon");
    expect(screen.queryByText("first letter")).toBeNull();
    expect(screen.queryByText("second letter")).toBeNull();
  });

  it("calls onChange with the value AND its display name, and updates the trigger", () => {
    const onChange = jest.fn();
    render(<Dropdown options={OPTIONS} value="a" onChange={onChange} />);
    expect(triggerText()).toBe("Alpha");

    fireEvent.click(screen.getByTestId("beta-gamma"));

    expect(onChange).toHaveBeenCalledWith("b", "Beta gamma");
    expect(triggerText()).toBe("Beta gamma");
  });

  it("adopts a new value pushed in through props", () => {
    const { rerender } = render(
      <Dropdown options={OPTIONS} value="a" onChange={jest.fn()} />,
    );
    expect(triggerText()).toBe("Alpha");

    rerender(<Dropdown options={OPTIONS} value="b" onChange={jest.fn()} />);
    expect(triggerText()).toBe("Beta gamma");
  });

  it("ignores a NaN value pushed in through props (keeps the previous selection)", () => {
    const { rerender } = render(
      <Dropdown options={OPTIONS} value="b" onChange={jest.fn()} />,
    );
    expect(triggerText()).toBe("Beta gamma");

    rerender(<Dropdown options={OPTIONS} value={NaN} onChange={jest.fn()} />);
    // The Number.isNaN guard short-circuits setValue, so the trigger is unchanged.
    expect(triggerText()).toBe("Beta gamma");
  });

  it("rebuilds its label map when the options change", () => {
    const { rerender } = render(
      <Dropdown
        options={[{ value: 1, text: "One" }]}
        value={1}
        onChange={jest.fn()}
      />,
    );
    expect(triggerText()).toBe("One");

    // Numeric option values are keyed by their string form; a fresh options
    // array must re-derive the labels rather than reuse the stale map.
    rerender(
      <Dropdown
        options={[{ value: 1, text: "Uno" }]}
        value={1}
        onChange={jest.fn()}
      />,
    );
    expect(triggerText()).toBe("Uno");
  });

  it("passes the disabled flag through to the trigger without breaking selection state", () => {
    render(
      <Dropdown options={OPTIONS} value="a" disabled onChange={jest.fn()} />,
    );
    // Trigger still reports the selection; BareDropdown owns the open/closed
    // behavior, Dropdown only forwards the flag.
    expect(triggerText()).toBe("Alpha");
    expect(screen.getByTestId("filters")).toBeTruthy();
  });
});
