// Coverage: app/assets/src/components/ui/controls/dropdowns/MultipleNestedDropdown.tsx
//
// Complements jest/dropdowns-MultipleNestedDropdown.test.tsx by exercising the
// prop-driven branches that spec does not reach: getDerivedStateFromProps when
// the incoming arrays are the very same reference (no state copy), the
// label-less counter branch, the disabled / rounded / boxed / disableMarginRight
// render paths, the empty-options constructor path, and handleItemClicked.
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

const rowLabels = () => {
  const menu = document.querySelector("[data-testid='dropdown-menu']");
  return Array.from(menu ? menu.children : []).map(node => node.textContent);
};

const triggerValue = () => screen.getByTestId("filter-value").textContent;

describe("MultipleNestedDropdown prop branches", () => {
  describe("getDerivedStateFromProps", () => {
    it("keeps user selections when re-rendered with the identical prop arrays", () => {
      // Same references on both renders: the equality guard for selectedOptions
      // short-circuits, so state is not clobbered by the (unchanged) props.
      const selectedOptions: string[] = [];
      const selectedSuboptions = {};
      const onChange = jest.fn();
      const { rerender } = render(
        <MultipleNestedDropdown
          options={OPTIONS}
          label="Categories"
          selectedOptions={selectedOptions}
          selectedSuboptions={selectedSuboptions}
          onChange={onChange}
        />,
      );

      const menu = document.querySelector("[data-testid='dropdown-menu']");
      const bacteriaRow = Array.from(menu ? menu.children : []).find(
        node => node.textContent === "Bacteria",
      ) as HTMLElement;
      fireEvent.click(bacteriaRow);
      expect(triggerValue()).toBe("1");

      rerender(
        <MultipleNestedDropdown
          options={OPTIONS}
          label="Categories"
          selectedOptions={selectedOptions}
          selectedSuboptions={selectedSuboptions}
          onChange={onChange}
        />,
      );
      expect(triggerValue()).toBe("1");
    });

    it("adopts a structurally equal but freshly allocated selectedOptions array", () => {
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
          selectedOptions={[]}
          selectedSuboptions={{}}
          onChange={jest.fn()}
        />,
      );
      // With no placeholder supplied the trigger value renders empty.
      expect(triggerValue()).toBe("");
    });
  });

  describe("trigger label without a label prop", () => {
    it("shows the counter but no label text when a label is not supplied", () => {
      render(
        <MultipleNestedDropdown
          options={OPTIONS}
          selectedOptions={["viruses", "bacteria"]}
          selectedSuboptions={{}}
          onChange={jest.fn()}
        />,
      );
      expect(triggerValue()).toBe("2");
      expect(screen.queryByText("Categories:")).toBeNull();
    });

    it("renders no counter chip at all when nothing is selected", () => {
      render(
        <MultipleNestedDropdown
          options={OPTIONS}
          label="Categories"
          selectedOptions={[]}
          selectedSuboptions={{}}
          onChange={jest.fn()}
        />,
      );
      // Falls through to the placeholder default rather than a "0" chip.
      expect(triggerValue()).not.toBe("0");
    });
  });

  describe("presentation props", () => {
    it("renders a disabled dropdown whose counter chip is disabled too", () => {
      render(
        <MultipleNestedDropdown
          options={OPTIONS}
          label="Categories"
          disabled
          selectedOptions={["viruses"]}
          selectedSuboptions={{}}
          onChange={jest.fn()}
        />,
      );
      expect(triggerValue()).toBe("1");
      expect(document.querySelector(".disabled")).toBeTruthy();
    });

    it("renders rounded / disableMarginRight / boxed variants with the same rows", () => {
      render(
        <MultipleNestedDropdown
          options={OPTIONS}
          label="Categories"
          rounded
          boxed
          disableMarginRight
          selectedOptions={[]}
          selectedSuboptions={{}}
          onChange={jest.fn()}
        />,
      );
      expect(rowLabels()).toEqual(["Viruses", "Viruses - Phage", "Bacteria"]);
    });

    it("renders an empty menu when no options are supplied", () => {
      render(
        <MultipleNestedDropdown
          options={[]}
          label="Categories"
          selectedOptions={[]}
          selectedSuboptions={{}}
          onChange={jest.fn()}
        />,
      );
      expect(rowLabels()).toEqual([]);
    });
  });

  describe("handleItemClicked", () => {
    it("stops the click from propagating past the item", () => {
      const instance = new (MultipleNestedDropdown as $TSFixMe)({
        options: OPTIONS,
      });
      const stopPropagation = jest.fn();
      instance.handleItemClicked({ stopPropagation });
      expect(stopPropagation).toHaveBeenCalledTimes(1);
    });
  });
});
