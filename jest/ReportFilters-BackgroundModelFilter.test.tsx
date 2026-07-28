// Coverage: app/assets/src/components/views/SampleView/components/MngsReport/components/ReportFilters/components/BackgroundModelFilter.tsx
//
// BackgroundModelFilter maps raw background models into dropdown options and
// picks one of two dropdowns to render. Its logic: formatBackgroundOptions
// (name/text fallback, mass-normalized subtext, disabled + tooltip when
// mass-normalized backgrounds aren't enabled), an empty-list fallback that
// disables the control, and the categorizeBackgrounds switch between a
// SectionsDropdown (with an id->name map) and a flat SubtextDropdown. Both
// dropdowns are stubbed so the options/props they receive can be asserted.
import { render } from "@testing-library/react";

let mockSubtextProps: $TSFixMe = null;
jest.mock("~ui/controls/dropdowns/SubtextDropdown", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => {
    mockSubtextProps = props;
    return <div data-testid="subtext-dropdown" />;
  },
  Option: {},
}));

let mockSectionsProps: $TSFixMe = null;
jest.mock("~ui/controls/dropdowns/SectionsDropdown", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => {
    mockSectionsProps = props;
    return <div data-testid="sections-dropdown" />;
  },
}));

import BackgroundModelFilter from "~/components/views/SampleView/components/MngsReport/components/ReportFilters/components/BackgroundModelFilter";

const bg = (over: $TSFixMe = {}) => ({
  id: 1,
  name: "Standard BG",
  mass_normalized: false,
  ...over,
});

const renderFilter = (props: $TSFixMe = {}) =>
  render(
    <BackgroundModelFilter onChange={jest.fn()} {...(props as $TSFixMe)} />,
  );

beforeEach(() => {
  mockSubtextProps = null;
  mockSectionsProps = null;
});

describe("BackgroundModelFilter (flat SubtextDropdown)", () => {
  it("formats options with name, standard subtext and id value", () => {
    renderFilter({ allBackgrounds: [bg({ id: 10, name: "My BG" })] });
    expect(mockSubtextProps.options).toEqual([
      expect.objectContaining({
        text: "My BG",
        subtext: "Standard",
        value: 10,
        disabled: false,
        tooltip: null,
      }),
    ]);
    expect(mockSubtextProps.disabled).toBe(false);
  });

  it("falls back to text and value keys when name and id are absent", () => {
    renderFilter({
      allBackgrounds: [
        { mass_normalized: false, text: "By text", value: 99 } as $TSFixMe,
      ],
    });
    expect(mockSubtextProps.options[0].text).toBe("By text");
    expect(mockSubtextProps.options[0].value).toBe(99);
  });

  it("marks mass-normalized options disabled with a tooltip when the feature is off", () => {
    renderFilter({
      allBackgrounds: [bg({ mass_normalized: true })],
      enableMassNormalizedBackgrounds: false,
    });
    expect(mockSubtextProps.options[0].disabled).toBe(true);
    expect(mockSubtextProps.options[0].subtext).toBe(
      "Normalized by input mass",
    );
    expect(mockSubtextProps.options[0].tooltip).toContain("ERCC samples");
  });

  it("keeps mass-normalized options enabled when the feature is on", () => {
    renderFilter({
      allBackgrounds: [bg({ mass_normalized: true })],
      enableMassNormalizedBackgrounds: true,
    });
    expect(mockSubtextProps.options[0].disabled).toBe(false);
    expect(mockSubtextProps.options[0].tooltip).toBeNull();
  });

  it("shows a placeholder option and disables the control when there are no backgrounds", () => {
    renderFilter({ allBackgrounds: [] });
    expect(mockSubtextProps.options).toEqual([
      { text: "No background models to display", value: -1 },
    ]);
    expect(mockSubtextProps.disabled).toBe(true);
  });

  it("also disables when allBackgrounds is null/undefined", () => {
    renderFilter({ allBackgrounds: null });
    expect(mockSubtextProps.disabled).toBe(true);
  });
});

describe("BackgroundModelFilter (categorized SectionsDropdown)", () => {
  it("renders sections and builds an id->name map when categorizeBackgrounds is set", () => {
    renderFilter({
      categorizeBackgrounds: true,
      allBackgrounds: [bg({ id: 1, name: "Owned" })],
      ownedBackgrounds: [{ id: 1, name: "Owned", mass_normalized: false }],
      otherBackgrounds: [{ id: 2, name: "Other", mass_normalized: false }],
    });
    expect(mockSectionsProps).not.toBeNull();
    expect(mockSubtextProps).toBeNull();
    expect(mockSectionsProps.itemIdToName[1]).toBe("Owned");
    expect(mockSectionsProps.itemIdToName[2]).toBe("Other");
    expect(mockSectionsProps.categories.MY_BACKGROUNDS.options[0].text).toBe(
      "Owned",
    );
    expect(mockSectionsProps.categories.OTHER_BACKGROUNDS.options[0].text).toBe(
      "Other",
    );
  });

  it("disables the sections dropdown when there are no backgrounds to display", () => {
    renderFilter({
      categorizeBackgrounds: true,
      allBackgrounds: [],
      ownedBackgrounds: [],
      otherBackgrounds: [],
    });
    expect(mockSectionsProps.disabled).toBe(true);
  });
});
