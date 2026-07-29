// Coverage: app/assets/src/components/ui/controls/SearchBoxList.tsx
//
// SearchBoxList is a controlled/uncontrolled hybrid: it keeps `selected` (a Set)
// and `filteredOptions` in local state, sorts selected options to the top, and
// toggles membership on click. These tests exercise the sort ordering, the
// internal filter path, the client-controlled filter override, selection
// toggling (add + remove), the label/count column-title branches, and the
// componentDidUpdate re-sort when the options prop changes.
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import SearchBoxList from "~/components/ui/controls/SearchBoxList";

const _React: typeof React = React;

const OPTIONS = [
  { label: "Zebra", value: "z", count: 3 },
  { label: "Apple", value: "a", count: 7 },
  { label: "Mango", value: "m" },
];

const getFilterInput = () => screen.getByPlaceholderText("Search");
// Class names resolve to undefined under the scss style-mock, so option rows are
// located by the per-label data-testid the component emits (`column-<label>`).
// With no labelTitle set, these testids appear once per option, in list order.
const labels = () =>
  Array.from(document.querySelectorAll('[data-testid^="column-"]')).map(n =>
    n.textContent.trim(),
  );

describe("SearchBoxList", () => {
  it("renders the title and sorts unselected options alphabetically by label", () => {
    render(<SearchBoxList options={OPTIONS} title="Taxa Filter" />);
    expect(screen.getByText("Taxa Filter")).toBeTruthy();
    // Nothing selected -> pure alpha sort.
    expect(labels()).toEqual(["Apple", "Mango", "Zebra"]);
  });

  it("floats selected options to the top of the list", () => {
    render(
      <SearchBoxList options={OPTIONS} selected={["z"]} title="Taxa Filter" />,
    );
    // "Zebra" is selected, so it precedes the alphabetical unselected block.
    expect(labels()).toEqual(["Zebra", "Apple", "Mango"]);
  });

  it("renders the count for options that carry one and omits it otherwise", () => {
    render(<SearchBoxList options={OPTIONS} title="Taxa Filter" />);
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    // Mango carries no count, so its (absent) value is never rendered.
    expect(screen.queryByText("undefined")).toBeNull();
  });

  it("filters options case-insensitively via the internal handler", () => {
    render(<SearchBoxList options={OPTIONS} title="Taxa Filter" />);
    fireEvent.change(getFilterInput(), { target: { value: "an" } });
    expect(labels()).toEqual(["Mango"]);
  });

  it("delegates filtering to onFilterChange when provided (client-controlled)", () => {
    const onFilterChange = jest.fn();
    render(
      <SearchBoxList
        options={OPTIONS}
        title="Taxa Filter"
        onFilterChange={onFilterChange}
      />,
    );
    fireEvent.change(getFilterInput(), { target: { value: "xyz" } });
    expect(onFilterChange).toHaveBeenCalledWith("xyz");
    // Internal filter did NOT run: full list still shown.
    expect(labels()).toEqual(["Apple", "Mango", "Zebra"]);
  });

  it("toggles selection on click and reports the new Set through onChange", () => {
    const onChange = jest.fn();
    render(
      <SearchBoxList
        options={OPTIONS}
        title="Taxa Filter"
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText("Apple"));
    expect(onChange).toHaveBeenCalledTimes(1);
    const firstSet = onChange.mock.calls[0][0];
    expect(firstSet instanceof Set).toBe(true);
    expect(firstSet.has("a")).toBe(true);
    // Clicking again removes it (the delete branch).
    fireEvent.click(screen.getByText("Apple"));
    expect(onChange.mock.calls[1][0].has("a")).toBe(false);
  });

  it("shows a checkmark for the selected option only", () => {
    render(<SearchBoxList options={OPTIONS} selected={["a"]} title="Taxa" />);
    const checkmarks = document.querySelectorAll(
      "[data-testid='item-selector-checkmark']",
    );
    // One checkmark slot per option; only the selected one contains an svg.
    const withIcon = Array.from(checkmarks).filter(
      c => c.querySelector("svg") !== null,
    );
    expect(withIcon.length).toBe(1);
  });

  it("renders the label/count column titles when provided", () => {
    render(
      <SearchBoxList
        options={OPTIONS}
        title="Taxa Filter"
        labelTitle="Name"
        countTitle="Reads"
      />,
    );
    expect(screen.getByText("Name")).toBeTruthy();
    expect(screen.getByText("Reads")).toBeTruthy();
  });

  it("re-sorts filtered options when the options prop changes (componentDidUpdate)", () => {
    const { rerender } = render(
      <SearchBoxList options={OPTIONS} title="Taxa Filter" />,
    );
    expect(labels()).toEqual(["Apple", "Mango", "Zebra"]);
    const nextOptions = [
      { label: "Beta", value: "b" },
      { label: "Alpha", value: "al" },
    ];
    rerender(<SearchBoxList options={nextOptions} title="Taxa Filter" />);
    expect(labels()).toEqual(["Alpha", "Beta"]);
  });
});
