// Coverage for LocationFilter's `expandParents` roll-up: discovery returns a
// flat list of leaf locations with their ancestor chain, and the filter has to
// synthesise one selectable option per ancestor whose count is the sum of its
// descendants. Both sides of each "have I seen this key already?" branch are
// exercised here, plus the missing-`parents` fallback.
import { render, screen } from "@testing-library/react";
import { FilterOption } from "~/components/common/filters/BaseMultipleFilter";
import LocationFilter from "~/components/common/filters/LocationFilter";

// LocationFilter delegates rendering to BaseMultipleFilter (a search dropdown
// built on semantic-ui). Stub the barrel it imports from so the assertions can
// be about the computed option list rather than dropdown internals.
const capturedProps: {
  options?: FilterOption[];
  selected?: unknown;
  label?: string;
  onChange?: unknown;
} = {};

jest.mock("~/components/common/filters", () => ({
  BaseMultipleFilter: (props: {
    options: FilterOption[];
    selected: unknown;
    label: string;
    onChange: unknown;
  }) => {
    capturedProps.options = props.options;
    capturedProps.selected = props.selected;
    capturedProps.label = props.label;
    capturedProps.onChange = props.onChange;
    return (
      <div data-testid="base-multiple-filter">
        {props.options.map(option => (
          <span key={option.value} data-testid={`option-${option.value}`}>
            {`${option.text}:${option.count}`}
          </span>
        ))}
      </div>
    );
  },
}));

const renderFilter = (
  options: {
    count: number;
    parents: string[];
    text: string;
    value: string;
  }[],
  selected: string[] = [],
  onChange = jest.fn(),
) =>
  render(
    <LocationFilter
      options={options}
      selected={selected}
      onChange={onChange}
      label="Location"
    />,
  );

describe("LocationFilter", () => {
  beforeEach(() => {
    delete capturedProps.options;
  });

  it("passes through selected, label and onChange untouched", () => {
    const onChange = jest.fn();
    renderFilter(
      [{ count: 1, parents: [], text: "Oakland", value: "oakland" }],
      ["oakland"],
      onChange,
    );
    expect(capturedProps.label).toBe("Location");
    expect(capturedProps.selected).toEqual(["oakland"]);
    expect(capturedProps.onChange).toBe(onChange);
    expect(screen.getByTestId("base-multiple-filter")).toBeTruthy();
  });

  it("adds a synthetic option per parent and sums sibling counts into it", () => {
    renderFilter([
      { count: 3, parents: ["USA", "California"], text: "Oakland", value: "1" },
      { count: 5, parents: ["USA", "California"], text: "Fresno", value: "2" },
    ]);

    const byValue = Object.fromEntries(
      (capturedProps.options ?? []).map(o => [o.value, o]),
    );
    // First option creates each parent; the second hits the "already tallied"
    // branch and accumulates.
    expect(byValue["USA"]).toEqual({ text: "USA", value: "USA", count: 8 });
    expect(byValue["California"].count).toBe(8);
    expect(byValue["1"]).toEqual({ text: "Oakland", value: "1", count: 3 });
    expect(byValue["2"].count).toBe(5);
  });

  it("merges duplicate leaf values instead of emitting them twice", () => {
    renderFilter([
      { count: 2, parents: [], text: "Oakland", value: "oakland" },
      { count: 4, parents: [], text: "Oakland", value: "oakland" },
    ]);

    expect(capturedProps.options).toEqual([
      { text: "Oakland", value: "oakland", count: 6 },
    ]);
  });

  it("tolerates options that carry no parents array", () => {
    // `parents` is required by the prop type but discovery has shipped rows
    // without it; the `|| []` fallback must not throw.
    renderFilter([
      {
        count: 7,
        text: "Unknown",
        value: "unknown",
      } as unknown as {
        count: number;
        parents: string[];
        text: string;
        value: string;
      },
    ]);

    expect(capturedProps.options).toEqual([
      { text: "Unknown", value: "unknown", count: 7 },
    ]);
  });

  it("sorts the merged options alphabetically by text", () => {
    renderFilter([
      { count: 1, parents: ["Zambia"], text: "Lusaka", value: "lusaka" },
      { count: 1, parents: ["Argentina"], text: "Cordoba", value: "cordoba" },
    ]);

    expect((capturedProps.options ?? []).map(o => o.text)).toEqual([
      "Argentina",
      "Cordoba",
      "Lusaka",
      "Zambia",
    ]);
  });

  it("renders nothing but an empty option list when there are no locations", () => {
    renderFilter([]);
    expect(capturedProps.options).toEqual([]);
    expect(screen.getByTestId("base-multiple-filter").textContent).toBe("");
  });

  it("keeps a parent's own count separate when it is also a leaf option", () => {
    // "California" appears both as an ancestor (tallied under the parent loop)
    // and as a selectable value in its own right; the two tallies key off the
    // same map entry and must add up.
    renderFilter([
      { count: 2, parents: ["California"], text: "Oakland", value: "Oakland" },
      { count: 9, parents: [], text: "California", value: "California" },
    ]);

    const california = (capturedProps.options ?? []).find(
      o => o.value === "California",
    );
    expect(california?.count).toBe(11);
  });
});
