// Coverage: app/assets/src/components/views/SamplesHeatmapView/components/
//   SamplesHeatmapFilters/components/SamplesHeatmapCategoryDropdown/components/
//   SamplesHeatmapCategoryFilterTags/SamplesHeatmapCategoryFilterTags.tsx
//
// The component flattens {categories, subcategories} into tag names via the
// injected converter, rewrites the synthetic "Viruses - Phage" entry to the
// short "Phage" label (moving it to the end of the list), and then renders each
// tag either as a read-only preset tooltip (when "categories" is a preset) or as
// a closable FilterTag. Both sides of both conditionals are exercised, plus the
// close callback. The preset tooltip is stubbed so we can assert which branch
// rendered without pulling in the popup machinery; the real FilterTag is used so
// the close click path is genuine.
import { fireEvent, render, screen } from "@testing-library/react";

jest.mock(
  "~/components/views/SamplesHeatmapView/components/SamplesHeatmapFilters/components/SamplesHeatmapPresetTooltip",
  () => {
    const ReactLib = require("react");
    return {
      __esModule: true,
      default: (props: $TSFixMe) =>
        ReactLib.createElement(
          "div",
          { "data-testid": "preset-tooltip" },
          props.component,
        ),
    };
  },
);

import { SamplesHeatmapCategoryFilterTags } from "~/components/views/SamplesHeatmapView/components/SamplesHeatmapFilters/components/SamplesHeatmapCategoryDropdown/components/SamplesHeatmapCategoryFilterTags/SamplesHeatmapCategoryFilterTags";

// Mirrors the real converter: categories become options, and each subcategory
// is emitted as "<Category> - <Sub>".
const converter = (categories: string[], subcategories: $TSFixMe) => {
  const out = (categories || []).map(c => ({ name: c }));
  Object.keys(subcategories || {}).forEach(cat => {
    subcategories[cat].forEach((sub: string) =>
      out.push({ name: `${cat} - ${sub}` }),
    );
  });
  return out;
};

function renderTags(overrides: $TSFixMe = {}) {
  const handleRemoveCategoryFromTags = jest.fn();
  const props = {
    selectedOptions: {
      categories: ["Bacteria"],
      subcategories: {},
      presets: [],
      ...(overrides.selectedOptions || {}),
    },
    disabled: false,
    handleRemoveCategoryFromTags,
    convertSelectedOptionsToSdsFormattedOptions: converter,
    ...overrides,
  };
  const utils = render(
    <SamplesHeatmapCategoryFilterTags {...(props as $TSFixMe)} />,
  );
  return { handleRemoveCategoryFromTags, ...utils };
}

const tagTexts = () =>
  screen.queryAllByTestId("filter-tag").map(n => n.textContent);

describe("SamplesHeatmapCategoryFilterTags", () => {
  it("renders one closable tag per selected category", () => {
    renderTags({
      selectedOptions: {
        categories: ["Bacteria", "Eukaryota"],
        subcategories: {},
        presets: [],
      },
    });
    expect(tagTexts()).toEqual(["Bacteria", "Eukaryota"]);
    expect(screen.queryByTestId("preset-tooltip")).toBeNull();
  });

  it("renders nothing when no categories are selected", () => {
    renderTags({
      selectedOptions: { categories: [], subcategories: {}, presets: [] },
    });
    expect(tagTexts()).toEqual([]);
  });

  it("shortens 'Viruses - Phage' to 'Phage' and pushes it to the end", () => {
    renderTags({
      selectedOptions: {
        categories: ["Viruses - Non-Phage", "Bacteria"],
        subcategories: { Viruses: ["Phage"] },
        presets: [],
      },
    });
    // "Viruses - Phage" came from the subcategory and is renamed + moved last.
    expect(tagTexts()).toEqual(["Viruses - Non-Phage", "Bacteria", "Phage"]);
  });

  it("leaves ordering untouched when no phage tag is present", () => {
    renderTags({
      selectedOptions: {
        categories: ["Viruses"],
        subcategories: { Bacteria: ["Something"] },
        presets: [],
      },
    });
    expect(tagTexts()).toEqual(["Viruses", "Bacteria - Something"]);
  });

  it("calls handleRemoveCategoryFromTags with the displayed tag name", () => {
    const { handleRemoveCategoryFromTags } = renderTags({
      selectedOptions: {
        categories: ["Bacteria"],
        subcategories: { Viruses: ["Phage"] },
        presets: [],
      },
    });
    const closeIcons = document.querySelectorAll("svg");
    // One close icon per tag; the second belongs to the renamed "Phage" tag.
    fireEvent.click(closeIcons[1]);
    expect(handleRemoveCategoryFromTags).toHaveBeenCalledWith("Phage");
  });

  it("swallows the close click when the tags are disabled", () => {
    const { handleRemoveCategoryFromTags } = renderTags({ disabled: true });
    fireEvent.click(document.querySelectorAll("svg")[0]);
    expect(handleRemoveCategoryFromTags).not.toHaveBeenCalled();
  });

  it("renders preset tooltips instead of closable tags when categories are preset", () => {
    const { handleRemoveCategoryFromTags } = renderTags({
      selectedOptions: {
        categories: ["Bacteria", "Eukaryota"],
        subcategories: {},
        presets: ["categories"],
      },
    });
    expect(screen.getAllByTestId("preset-tooltip")).toHaveLength(2);
    expect(tagTexts()).toEqual(["Bacteria", "Eukaryota"]);
    // Preset tags carry no close affordance at all.
    expect(document.querySelectorAll("svg")).toHaveLength(0);
    expect(handleRemoveCategoryFromTags).not.toHaveBeenCalled();
  });

  it("uses the closable branch when the presets list covers other filters", () => {
    renderTags({
      selectedOptions: {
        categories: ["Bacteria"],
        subcategories: {},
        presets: ["thresholdFilters"],
      },
    });
    expect(screen.queryByTestId("preset-tooltip")).toBeNull();
    expect(document.querySelectorAll("svg").length).toBeGreaterThan(0);
  });
});
