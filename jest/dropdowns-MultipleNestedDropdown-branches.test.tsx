// Coverage: app/assets/src/components/ui/controls/dropdowns/MultipleNestedDropdown.tsx
//
// Branch-focused companion to jest/dropdowns-MultipleNestedDropdown.test.tsx and
// jest/dropdowns-MultipleNestedDropdown-props.test.tsx. Those two already drive
// the happy paths; what is left unexercised are two *negative* paths:
//
//   1. getDerivedStateFromProps' second guard falling through WITHOUT copying
//      selectedSuboptions into state. Because areSuboptionsEqual() compares
//      `Object.keys(a) !== Object.keys(b)` (two freshly built arrays, never the
//      same reference), it returns false for every pair of truthy objects, so
//      the only way the guard is ever satisfied is through its own falsy
//      early-return (`if (!suboptions1 || !suboptions2) return a === b`). A
//      falsy selectedSuboptions prop is therefore the one input that takes the
//      "props already match state" path.
//
//   2. handleSuboptionClicked's un-check path when the suboption's owning
//      option has no entry in selectedSuboptions at all. suboptionsToOptionMap
//      is keyed by suboption *value*, so when two options declare a suboption
//      with the same value the map only remembers the last one. Un-checking the
//      first option's row then resolves to the second option, which has no
//      selection recorded -- the filter is skipped and state is handed back
//      untouched.
import { fireEvent, render, screen } from "@testing-library/react";
import MultipleNestedDropdown from "~/components/ui/controls/dropdowns/MultipleNestedDropdown";

const OPTIONS = [
  {
    value: "viruses",
    text: "Viruses",
    suboptions: [{ value: "phage", text: "Phage" }],
  },
  { value: "bacteria", text: "Bacteria" },
];

// Two options that both declare a suboption whose `value` is "shared".
const DUPLICATE_SUBOPTION_OPTIONS = [
  {
    value: "optionA",
    text: "Option A",
    suboptions: [{ value: "shared", text: "Shared" }],
  },
  {
    value: "optionB",
    text: "Option B",
    suboptions: [{ value: "shared", text: "Shared" }],
  },
];

const triggerValue = () => screen.getByTestId("filter-value").textContent;

const rowByLabel = (label: string) => {
  const menu = document.querySelector("[data-testid='dropdown-menu']");
  const row = Array.from(menu ? menu.children : []).find(
    node => node.textContent === label,
  );
  if (!row) throw new Error(`no dropdown row labelled "${label}"`);
  return row as HTMLElement;
};

describe("MultipleNestedDropdown branch paths", () => {
  describe("getDerivedStateFromProps with a falsy selectedSuboptions", () => {
    it("leaves the suboption state alone while still adopting new selectedOptions", () => {
      // `false` (rather than null) keeps the component renderable: the render
      // path only ever does `state.selectedSuboptions[value] || []`, which is
      // undefined on a primitive, whereas null would throw.
      const falsySuboptions = false as unknown as object;
      const onChange = jest.fn();

      const { rerender } = render(
        <MultipleNestedDropdown
          options={OPTIONS}
          label="Categories"
          selectedOptions={[]}
          selectedSuboptions={falsySuboptions}
          onChange={onChange}
        />,
      );

      // Nothing selected: the counter collapses to the (absent) placeholder and
      // the label is rendered without its trailing colon.
      expect(triggerValue()).toBe("");
      expect(screen.getByTestId("categories-filter").textContent).toBe(
        "Categories",
      );

      // Same falsy suboptions reference, brand new selectedOptions array. The
      // suboptions guard short-circuits (a === b) and only the selectedOptions
      // half of the derived state is rebuilt.
      rerender(
        <MultipleNestedDropdown
          options={OPTIONS}
          label="Categories"
          selectedOptions={["viruses", "bacteria"]}
          selectedSuboptions={falsySuboptions}
          onChange={onChange}
        />,
      );

      expect(triggerValue()).toBe("2");
      expect(screen.getByTestId("categories-filter").textContent).toBe(
        "Categories:",
      );
      // The suboption half of the state was never touched, so nothing was
      // reported back to the parent.
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe("un-checking a suboption whose owning option has no selection", () => {
    it("is a no-op when the suboption value maps to a different option", () => {
      const onChange = jest.fn();
      render(
        <MultipleNestedDropdown
          options={DUPLICATE_SUBOPTION_OPTIONS}
          label="Categories"
          selectedOptions={[]}
          selectedSuboptions={{ optionA: ["shared"] }}
          onChange={onChange}
        />,
      );

      // Only Option A's row is checked, so the counter is 1.
      expect(triggerValue()).toBe("1");

      // Clicking the checked row asks the component to un-check "shared", but
      // suboptionsToOptionMap resolves "shared" to optionB, which owns no
      // selection -- so nothing is removed.
      fireEvent.click(rowByLabel("Option A - Shared"));

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenLastCalledWith([], { optionA: ["shared"] });
      expect(triggerValue()).toBe("1");
    });

    it("still records a check against the mapped option", () => {
      // Contrast case for the branch above: checking the *other* duplicate row
      // creates the missing optionB entry, which is what makes the un-check
      // path's early exit observable.
      const onChange = jest.fn();
      render(
        <MultipleNestedDropdown
          options={DUPLICATE_SUBOPTION_OPTIONS}
          label="Categories"
          selectedOptions={[]}
          selectedSuboptions={{ optionA: ["shared"] }}
          onChange={onChange}
        />,
      );

      fireEvent.click(rowByLabel("Option B - Shared"));

      expect(onChange).toHaveBeenLastCalledWith([], {
        optionA: ["shared"],
        optionB: ["shared"],
      });
      expect(triggerValue()).toBe("2");
    });
  });
});
