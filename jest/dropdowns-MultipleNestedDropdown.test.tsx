import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import MultipleNestedDropdown from "~/components/ui/controls/dropdowns/MultipleNestedDropdown";

// Keeps prettier's organize-imports plugin from dropping the React import that
// Jest's classic JSX runtime needs in scope (see jest/uiControls.test.tsx).
const _React: typeof React = React;

const OPTIONS = [
  {
    value: "viruses",
    text: "Viruses",
    suboptions: [
      { value: "phage", text: "Phage" },
      { value: "human", text: "Human" },
    ],
  },
  { value: "bacteria", text: "Bacteria" },
];

// Every test passes its own selectedSuboptions object: the component mutates the
// object it is handed (prevState.selectedSuboptions[...] = ...), so sharing the
// defaultProps `{}` would leak state between tests.
const renderDropdown = (props: Record<string, unknown> = {}) =>
  render(
    <MultipleNestedDropdown
      options={OPTIONS}
      selectedOptions={[]}
      selectedSuboptions={{}}
      onChange={jest.fn()}
      {...props}
    />,
  );

const rowLabels = () => {
  const menu = document.querySelector("[data-testid='dropdown-menu']");
  return Array.from(menu ? menu.children : []).map(node => node.textContent);
};

const clickRow = (label: string) => {
  const menu = document.querySelector("[data-testid='dropdown-menu']");
  const row = Array.from(menu ? menu.children : []).find(
    node => node.textContent === label,
  );
  if (!row) throw new Error(`No dropdown row labelled "${label}"`);
  fireEvent.click(row);
};

const triggerValue = () => screen.getByTestId("filter-value").textContent;

describe("MultipleNestedDropdown", () => {
  describe("rendering", () => {
    it("renders each option followed by its suboptions, prefixed with the parent text", () => {
      renderDropdown();
      expect(rowLabels()).toEqual([
        "Viruses",
        "Viruses - Phage",
        "Viruses - Human",
        "Bacteria",
      ]);
    });

    it("renders only the option row when it has no suboptions", () => {
      renderDropdown({ options: [{ value: "bacteria", text: "Bacteria" }] });
      expect(rowLabels()).toEqual(["Bacteria"]);
    });
  });

  describe("option clicks", () => {
    it("checks every suboption when the parent option is checked", () => {
      const onChange = jest.fn();
      renderDropdown({ onChange, selectedSuboptions: {} });

      clickRow("Viruses");

      expect(onChange).toHaveBeenCalledTimes(1);
      const [selectedOptions, selectedSuboptions] = onChange.mock.calls[0];
      expect(selectedOptions).toEqual(["viruses"]);
      expect(selectedSuboptions).toEqual({ viruses: ["phage", "human"] });
    });

    it("adds nothing to the suboption map for an option with no suboptions", () => {
      const onChange = jest.fn();
      renderDropdown({ onChange, selectedSuboptions: {} });

      clickRow("Bacteria");

      const [selectedOptions, selectedSuboptions] = onChange.mock.calls[0];
      expect(selectedOptions).toEqual(["bacteria"]);
      expect(selectedSuboptions).toEqual({});
    });

    it("unchecks an option while leaving its suboptions selected", () => {
      const onChange = jest.fn();
      renderDropdown({
        onChange,
        selectedOptions: ["viruses"],
        selectedSuboptions: { viruses: ["phage"] },
      });

      clickRow("Viruses");

      const [selectedOptions, selectedSuboptions] = onChange.mock.calls[0];
      expect(selectedOptions).toEqual([]);
      // Unchecking the parent deliberately does not clear the suboptions.
      expect(selectedSuboptions).toEqual({ viruses: ["phage"] });
    });
  });

  describe("suboption clicks", () => {
    it("adds a suboption under its parent option key", () => {
      const onChange = jest.fn();
      renderDropdown({ onChange, selectedSuboptions: {} });

      clickRow("Viruses - Phage");

      const [selectedOptions, selectedSuboptions] = onChange.mock.calls[0];
      expect(selectedOptions).toEqual([]);
      expect(selectedSuboptions).toEqual({ viruses: ["phage"] });
    });

    it("appends to an existing suboption list rather than replacing it", () => {
      const onChange = jest.fn();
      renderDropdown({
        onChange,
        selectedSuboptions: { viruses: ["phage"] },
      });

      clickRow("Viruses - Human");

      expect(onChange.mock.calls[0][1]).toEqual({
        viruses: ["phage", "human"],
      });
    });

    it("removes a checked suboption, leaving its siblings alone", () => {
      const onChange = jest.fn();
      renderDropdown({
        onChange,
        selectedSuboptions: { viruses: ["phage", "human"] },
      });

      clickRow("Viruses - Phage");

      expect(onChange.mock.calls[0][1]).toEqual({ viruses: ["human"] });
    });

    it("toggles a suboption off and back on", () => {
      // The component mutates the suboptions object in place, so the argument
      // handed to onChange is the same reference every time -- snapshot it.
      const seen: unknown[] = [];
      const onChange = jest.fn((_options, suboptions) =>
        seen.push(JSON.parse(JSON.stringify(suboptions))),
      );
      renderDropdown({
        onChange,
        selectedSuboptions: { viruses: ["phage"] },
      });

      clickRow("Viruses - Phage"); // checked -> uncheck
      clickRow("Viruses - Phage"); // unchecked -> re-check

      expect(seen).toEqual([{ viruses: [] }, { viruses: ["phage"] }]);
    });
  });

  describe("trigger label", () => {
    it("shows the placeholder and the bare label when nothing is selected", () => {
      renderDropdown({ label: "Categories", placeholder: "Choose" });
      expect(screen.getByTestId("categories-filter").textContent).toBe(
        "Categories",
      );
      expect(triggerValue()).toBe("Choose");
    });

    it("counts options plus suboptions and appends a colon to the label", () => {
      renderDropdown({
        label: "Categories",
        selectedOptions: ["viruses"],
        selectedSuboptions: { viruses: ["phage", "human"] },
      });
      expect(screen.getByTestId("categories-filter").textContent).toBe(
        "Categories:",
      );
      // 1 option + 2 suboptions
      expect(triggerValue()).toBe("3");
    });

    it("renders an 'N selected' string instead of the counter chip when asked", () => {
      renderDropdown({
        label: "Categories",
        useDropdownLabelCounter: false,
        selectedOptions: ["viruses", "bacteria"],
        selectedSuboptions: {},
      });
      expect(triggerValue()).toBe("2 selected");
    });

    it("falls back to the placeholder when useDropdownLabelCounter is off and nothing is selected", () => {
      renderDropdown({
        label: "Categories",
        useDropdownLabelCounter: false,
        placeholder: "Choose",
      });
      expect(triggerValue()).toBe("Choose");
    });

    it("updates the count when the selectedOptions prop changes", () => {
      const { rerender } = render(
        <MultipleNestedDropdown
          options={OPTIONS}
          label="Categories"
          selectedOptions={["viruses"]}
          selectedSuboptions={{}}
          onChange={jest.fn()}
        />,
      );
      expect(triggerValue()).toBe("1");

      rerender(
        <MultipleNestedDropdown
          options={OPTIONS}
          label="Categories"
          selectedOptions={["viruses", "bacteria"]}
          selectedSuboptions={{}}
          onChange={jest.fn()}
        />,
      );
      expect(triggerValue()).toBe("2");
    });
  });

  describe("areSuboptionsEqual", () => {
    const areSuboptionsEqual = (
      MultipleNestedDropdown as $TSFixMe
    ).areSuboptionsEqual.bind(MultipleNestedDropdown);

    it("treats two nullish values as equal only when identical", () => {
      expect(areSuboptionsEqual(null, null)).toBe(true);
      expect(areSuboptionsEqual(undefined, null)).toBe(false);
      expect(areSuboptionsEqual(null, {})).toBe(false);
      expect(areSuboptionsEqual({}, null)).toBe(false);
    });

    it("returns false when a key is missing from the other object", () => {
      expect(areSuboptionsEqual({ viruses: ["phage"] }, {})).toBe(false);
    });

    it("returns false when the value arrays differ", () => {
      expect(
        areSuboptionsEqual({ viruses: ["phage"] }, { viruses: ["human"] }),
      ).toBe(false);
      expect(
        areSuboptionsEqual(
          { viruses: ["phage"] },
          { viruses: ["phage", "human"] },
        ),
      ).toBe(false);
    });

    it("never reports two distinct objects as equal (Object.keys reference compare)", () => {
      // NOTE (observed behaviour): the guard is
      //   if (Object.keys(a) !== Object.keys(b)) return false;
      // and Object.keys always allocates a fresh array, so the comparison is
      // always true and the method short-circuits to false for any two
      // non-nullish objects -- even structurally identical ones, and even the
      // very same object passed twice. getDerivedStateFromProps therefore
      // re-copies props.selectedSuboptions into state on every render. Pinned
      // so that fixing the comparison shows up as a deliberate test change.
      const structurallyEqualA = { viruses: ["phage", "human"], bacteria: [] };
      const structurallyEqualB = { viruses: ["phage", "human"], bacteria: [] };
      expect(areSuboptionsEqual(structurallyEqualA, structurallyEqualB)).toBe(
        false,
      );
      expect(areSuboptionsEqual(structurallyEqualA, structurallyEqualA)).toBe(
        false,
      );
    });
  });
});
