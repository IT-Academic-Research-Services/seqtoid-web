// Coverage: app/assets/src/components/views/SampleView/components/MngsReport/components/ReportFilters/components/CategoryFilter.tsx
//
// CategoryFilter turns the flat category/subcategory maps into the nested
// options + selectedSuboptions shapes that MultipleNestedDropdown expects. The
// dropdown is stubbed so the assertions land on this file's option-building
// logic: attaching suboptions only when a category has children, grouping the
// selected subcategories under their parent, and forwarding the disabled/
// margin/label props.
import { render } from "@testing-library/react";

const mockDropdownProps: $TSFixMe[] = [];

jest.mock("~/components/ui/controls/dropdowns/MultipleNestedDropdown", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: (props: $TSFixMe) => {
      mockDropdownProps.push(props);
      return ReactLib.createElement("div", {
        "data-testid": "nested-dropdown",
      });
    },
  };
});

import CategoryFilter from "~/components/views/SampleView/components/MngsReport/components/ReportFilters/components/CategoryFilter";

const lastProps = () => mockDropdownProps[mockDropdownProps.length - 1];

const baseProps = {
  allCategories: [{ name: "Bacteria" }, { name: "Viruses" }],
  categoryParentChild: { Viruses: ["Phages"] },
  categoryChildParent: { Phages: "Viruses" },
  disableMarginRight: false,
  onChange: jest.fn(),
  selectedCategories: [],
  selectedSubcategories: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockDropdownProps.length = 0;
});

describe("CategoryFilter options", () => {
  it("builds one option per category with text and value", () => {
    render(<CategoryFilter {...baseProps} />);
    const { options } = lastProps();
    expect(options.map((o: $TSFixMe) => o.value)).toEqual([
      "Bacteria",
      "Viruses",
    ]);
    expect(options[0]).toEqual({ text: "Bacteria", value: "Bacteria" });
  });

  it("attaches suboptions only to categories that have children", () => {
    render(<CategoryFilter {...baseProps} />);
    const { options } = lastProps();
    // Bacteria has no children -> no suboptions key.
    expect(options[0].suboptions).toBeUndefined();
    // Viruses has one child.
    expect(options[1].suboptions).toEqual([
      { text: "Phages", value: "Phages" },
    ]);
  });

  it("treats a category missing from the parent-child map as childless", () => {
    render(<CategoryFilter {...baseProps} categoryParentChild={{}} />);
    const { options } = lastProps();
    expect(options[0].suboptions).toBeUndefined();
    expect(options[1].suboptions).toBeUndefined();
  });
});

describe("CategoryFilter selected suboptions", () => {
  it("groups selected subcategories under their resolved parent", () => {
    render(
      <CategoryFilter
        {...baseProps}
        categoryChildParent={{ Phages: "Viruses", Other: "Viruses" }}
        selectedSubcategories={["Phages", "Other"]}
      />,
    );
    expect(lastProps().selectedSuboptions).toEqual({
      Viruses: ["Phages", "Other"],
    });
  });

  it("passes an empty selection object when no subcategories are selected", () => {
    render(<CategoryFilter {...baseProps} />);
    expect(lastProps().selectedSuboptions).toEqual({});
  });
});

describe("CategoryFilter forwarded props", () => {
  it("defaults disabled to false and forwards label, margin and selection", () => {
    render(
      <CategoryFilter
        {...baseProps}
        selectedCategories={["Bacteria"]}
        disableMarginRight
      />,
    );
    const props = lastProps();
    expect(props.disabled).toBe(false);
    expect(props.label).toBe("Categories");
    expect(props.disableMarginRight).toBe(true);
    expect(props.selectedOptions).toEqual(["Bacteria"]);
    expect(props.onChange).toBe(baseProps.onChange);
  });

  it("forwards an explicit disabled flag", () => {
    render(<CategoryFilter {...baseProps} disabled />);
    expect(lastProps().disabled).toBe(true);
  });
});
