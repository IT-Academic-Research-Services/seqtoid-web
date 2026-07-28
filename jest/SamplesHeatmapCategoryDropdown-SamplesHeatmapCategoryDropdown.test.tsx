// Coverage: app/assets/src/components/views/SamplesHeatmapView/components/
//   SamplesHeatmapFilters/components/SamplesHeatmapCategoryDropdown/
//   SamplesHeatmapCategoryDropdown.tsx
//
// This dropdown translates between the parent view's {categories,
// subcategories} shape and the flat SDS option list, splicing the synthetic
// "Viruses - Phage" / "Viruses - Non-Phage" entries in and out. The tests
// drive the SDS Dropdown's onChange (save path) and the child filter-tags
// removal callback to exercise both the phage subcategory move and the
// non-phage rename, in both directions. The SDS Dropdown and the filter-tags
// child are stubbed so assertions target this file's conversion logic.
import { fireEvent, render, screen } from "@testing-library/react";

let lastDropdownProps: $TSFixMe = null;
jest.mock("@czi-sds/components", () => {
  const ReactLib = require("react");
  return {
    Dropdown: (props: $TSFixMe) => {
      lastDropdownProps = props;
      return ReactLib.createElement("div", {
        "data-testid": "dropdown",
        "data-disabled": String(!!props.InputDropdownProps?.disabled),
        "data-value": JSON.stringify(props.value),
        "data-options": JSON.stringify(props.options),
      });
    },
  };
});

let lastTagProps: $TSFixMe = null;
jest.mock(
  "~/components/views/SamplesHeatmapView/components/SamplesHeatmapFilters/components/SamplesHeatmapCategoryDropdown/components/SamplesHeatmapCategoryFilterTags",
  () => {
    const ReactLib = require("react");
    return {
      __esModule: true,
      default: (props: $TSFixMe) => {
        lastTagProps = props;
        return ReactLib.createElement("button", {
          "data-testid": "remove-tag",
          onClick: () => props.handleRemoveCategoryFromTags("Phage"),
        });
      },
    };
  },
);

import { SamplesHeatmapCategoryDropdown } from "~/components/views/SamplesHeatmapView/components/SamplesHeatmapFilters/components/SamplesHeatmapCategoryDropdown/SamplesHeatmapCategoryDropdown";

function renderComp(overrides: $TSFixMe = {}) {
  const onSelectedOptionsChange = jest.fn();
  const props = {
    selectedOptions: {
      categories: ["Bacteria"],
      subcategories: {},
      ...(overrides.selectedOptions || {}),
    },
    onSelectedOptionsChange,
    disabled: false,
    options: { categories: ["Bacteria", "Viruses", "Eukaryota"] },
    ...overrides,
  };
  delete (props as $TSFixMe).selectedOptionsRaw;
  const utils = render(<SamplesHeatmapCategoryDropdown {...props} />);
  return { onSelectedOptionsChange, ...utils };
}

describe("SamplesHeatmapCategoryDropdown", () => {
  beforeEach(() => {
    lastDropdownProps = null;
    lastTagProps = null;
  });

  it("builds category options with a spliced Viruses - Phage entry", () => {
    renderComp();
    const options = lastDropdownProps.options.map((o: $TSFixMe) => o.name);
    // Viruses is renamed to Non-Phage, and Phage is inserted before the last two
    expect(options).toContain("Viruses - Phage");
    expect(options).toContain("Viruses - Non-Phage");
    expect(options).not.toContain("Viruses");
  });

  it("converts selected Viruses category into the Non-Phage display value", () => {
    renderComp({
      selectedOptions: { categories: ["Viruses"], subcategories: {} },
    });
    const value = lastDropdownProps.value.map((o: $TSFixMe) => o.name);
    expect(value).toEqual(["Viruses - Non-Phage"]);
  });

  it("adds the Phage display value when the Viruses subcategory includes Phage", () => {
    renderComp({
      selectedOptions: {
        categories: ["Viruses"],
        subcategories: { Viruses: ["Phage"] },
      },
    });
    const value = lastDropdownProps.value.map((o: $TSFixMe) => o.name);
    expect(value).toContain("Viruses - Phage");
    expect(value).toContain("Viruses - Non-Phage");
  });

  it("moves Phage into subcategories on save", () => {
    const { onSelectedOptionsChange } = renderComp();
    lastDropdownProps.onChange([
      { name: "Bacteria" },
      { name: "Viruses - Phage" },
    ]);
    expect(onSelectedOptionsChange).toHaveBeenCalledWith({
      categories: ["Bacteria"],
      subcategories: { Viruses: ["Phage"] },
    });
  });

  it("renames Viruses - Non-Phage back to Viruses on save", () => {
    const { onSelectedOptionsChange } = renderComp();
    lastDropdownProps.onChange([
      { name: "Bacteria" },
      { name: "Viruses - Non-Phage" },
    ]);
    expect(onSelectedOptionsChange).toHaveBeenCalledWith({
      categories: ["Bacteria", "Viruses"],
      subcategories: {},
    });
  });

  it("handles a null selection on save as an empty category list", () => {
    const { onSelectedOptionsChange } = renderComp();
    lastDropdownProps.onChange(null);
    expect(onSelectedOptionsChange).toHaveBeenCalledWith({
      categories: [],
      subcategories: {},
    });
  });

  it("removes the Phage tag by mapping it to Viruses - Phage before filtering", () => {
    const { onSelectedOptionsChange } = renderComp({
      selectedOptions: {
        categories: ["Viruses"],
        subcategories: { Viruses: ["Phage"] },
      },
    });
    fireEvent.click(screen.getByTestId("remove-tag"));
    // Phage removed; Viruses - Non-Phage remains and is renamed back to Viruses
    expect(onSelectedOptionsChange).toHaveBeenCalledWith({
      categories: ["Viruses"],
      subcategories: {},
    });
  });

  it("passes the disabled flag through to the SDS dropdown", () => {
    renderComp({ disabled: true });
    expect(screen.getByTestId("dropdown").getAttribute("data-disabled")).toBe(
      "true",
    );
  });

  it("hands the conversion helper and remove callback to the filter tags child", () => {
    renderComp();
    expect(typeof lastTagProps.handleRemoveCategoryFromTags).toBe("function");
    expect(
      typeof lastTagProps.convertSelectedOptionsToSdsFormattedOptions,
    ).toBe("function");
  });
});
