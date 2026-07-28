// Coverage: app/assets/src/components/views/DiscoveryView/components/DiscoveryHeader/DiscoveryHeader.tsx
//
// DiscoveryHeader lays out the filter button, live-search box and tabs, and
// normalizes the raw search-suggestion payload before handing it to the parent
// (handleSearchResultSelected has a per-category switch: taxon / sample /
// default, plus a locationV2 casing exception). The SDS Tabs/ButtonIcon,
// BasicPopup, FilterButtonWithCounter and LiveSearchBox are stubbed so the
// assertions land on that normalization logic and the disableSidebars branches.
import { fireEvent, render, screen } from "@testing-library/react";

let capturedSearchProps: $TSFixMe = null;
let capturedFilterProps: $TSFixMe = null;

jest.mock("~ui/controls/LiveSearchBox", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => {
    capturedSearchProps = props;
    const ReactLib = require("react");
    return ReactLib.createElement("div", {
      "data-testid": "live-search",
      "data-placeholder": props.placeholder,
      "data-value": props.value,
      "data-projectid": props.projectId,
    });
  },
}));

jest.mock("~/components/ui/controls/buttons/FilterButtonWithCounter", () => ({
  __esModule: true,
  FilterButtonWithCounter: (props: $TSFixMe) => {
    capturedFilterProps = props;
    const ReactLib = require("react");
    return ReactLib.createElement("button", {
      "data-testid": "filter-button",
      "data-disabled": String(props.isDisabled),
      "data-counter": String(props.filterCounter),
      onClick: props.onFilterToggle,
    });
  },
}));

jest.mock("~/components/common/BasicPopup", () => ({
  __esModule: true,
  default: ({ trigger }: $TSFixMe) => {
    const ReactLib = require("react");
    return ReactLib.createElement(
      "div",
      { "data-testid": "basic-popup" },
      trigger,
    );
  },
}));

jest.mock("@czi-sds/components", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    ButtonIcon: (props: $TSFixMe) =>
      ReactLib.createElement("button", {
        "data-testid": "info-icon",
        "data-on": String(props.on),
        disabled: props.disabled,
      }),
    Tabs: ({ value, onChange, children }: $TSFixMe) =>
      ReactLib.createElement(
        "div",
        { "data-testid": "tabs", "data-value": String(value) },
        ReactLib.createElement("button", {
          "data-testid": "tab-change",
          onClick: () => onChange(null, 1),
        }),
        children,
      ),
  };
});

import { WorkflowType } from "~/components/utils/workflows";
import { DiscoveryHeader } from "~/components/views/DiscoveryView/components/DiscoveryHeader/DiscoveryHeader";

const tabs = [
  { value: "samples", label: <span key="s">Samples</span> },
  { value: "projects", label: <span key="p">Projects</span> },
];

const renderHeader = (props: $TSFixMe = {}) =>
  render(
    <DiscoveryHeader
      domain="my_data"
      currentTab="samples"
      tabs={tabs}
      workflow={WorkflowType.SHORT_READ_MNGS}
      projectId="proj-9"
      {...props}
    />,
  );

beforeEach(() => {
  capturedSearchProps = null;
  capturedFilterProps = null;
});

describe("DiscoveryHeader layout", () => {
  it("renders the search box with a start-cased placeholder for non-snapshot domains", () => {
    renderHeader({ domain: "all_data", searchValue: "hello" });
    const box = screen.getByTestId("live-search");
    expect(box.getAttribute("data-placeholder")).toBe("Search All Data...");
    expect(box.getAttribute("data-value")).toBe("hello");
    expect(box.getAttribute("data-projectid")).toBe("proj-9");
  });

  it("hides the search box on snapshot views", () => {
    renderHeader({ domain: "snapshot" });
    expect(screen.queryByTestId("live-search")).toBeNull();
  });

  it("passes the filter counter and toggle to the filter button", () => {
    const onFilterToggle = jest.fn();
    renderHeader({ filterCount: 4, onFilterToggle });
    expect(
      screen.getByTestId("filter-button").getAttribute("data-counter"),
    ).toBe("4");
    fireEvent.click(screen.getByTestId("filter-button"));
    expect(onFilterToggle).toHaveBeenCalled();
  });

  it("reflects the current tab index in the tabs value", () => {
    renderHeader({ currentTab: "projects" });
    expect(screen.getByTestId("tabs").getAttribute("data-value")).toBe("1");
  });

  it("fires onTabChange with the selected tab index", () => {
    const onTabChange = jest.fn();
    renderHeader({ onTabChange });
    fireEvent.click(screen.getByTestId("tab-change"));
    expect(onTabChange).toHaveBeenCalledWith(1);
  });
});

describe("DiscoveryHeader disableSidebars", () => {
  it("disables the sidebars on the visualizations tab", () => {
    renderHeader({ currentTab: "visualizations" });
    expect(
      screen.getByTestId("filter-button").getAttribute("data-disabled"),
    ).toBe("true");
    expect(
      (screen.getByTestId("info-icon") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("disables the sidebars for a benchmark workflow on the samples tab", () => {
    renderHeader({ currentTab: "samples", workflow: WorkflowType.BENCHMARK });
    expect(
      screen.getByTestId("filter-button").getAttribute("data-disabled"),
    ).toBe("true");
  });

  it("leaves the sidebars enabled for a normal samples tab", () => {
    renderHeader({ currentTab: "samples" });
    expect(
      screen.getByTestId("filter-button").getAttribute("data-disabled"),
    ).toBe("false");
  });

  it("does not fire onStatsToggle while disabled", () => {
    const onStatsToggle = jest.fn();
    renderHeader({ currentTab: "visualizations", onStatsToggle });
    // The stats trigger div wraps the popup; clicking it is a no-op when disabled.
    fireEvent.click(screen.getByTestId("basic-popup").parentElement as Element);
    expect(onStatsToggle).not.toHaveBeenCalled();
  });

  it("fires onStatsToggle when enabled", () => {
    const onStatsToggle = jest.fn();
    renderHeader({ currentTab: "samples", onStatsToggle });
    fireEvent.click(screen.getByTestId("basic-popup").parentElement as Element);
    expect(onStatsToggle).toHaveBeenCalled();
  });
});

describe("DiscoveryHeader search result normalization", () => {
  const selectResult = (result: $TSFixMe) => {
    const onSearchResultSelected = jest.fn();
    renderHeader({ onSearchResultSelected });
    capturedSearchProps.onResultSelect({ currentEvent: "evt", result });
    return onSearchResultSelected;
  };

  it("maps a taxon result to a lowercased key, taxid value and sds taxon data", () => {
    const cb = selectResult({
      category: "Taxon",
      id: 5,
      taxid: 573,
      title: "Klebsiella",
      level: "species",
    });
    const [parsed, event] = cb.mock.calls[0];
    expect(parsed.key).toBe("taxon");
    expect(parsed.value).toBe(573);
    expect(parsed.text).toBe("Klebsiella");
    expect(parsed.sdsTaxonFilterData).toEqual({
      id: 573,
      level: "species",
      name: "Klebsiella",
    });
    expect(event).toBe("evt");
  });

  it("maps a sample result to its sample_id value with empty taxon data", () => {
    const cb = selectResult({
      category: "Sample",
      id: 8,
      sample_id: 99,
      title: "My Sample",
    });
    const [parsed] = cb.mock.calls[0];
    expect(parsed.key).toBe("sample");
    expect(parsed.value).toBe(99);
    expect(parsed.sdsTaxonFilterData).toEqual({});
  });

  it("falls back to the id for other categories (default branch)", () => {
    const cb = selectResult({
      category: "Project",
      id: 12,
      title: "A Project",
    });
    const [parsed] = cb.mock.calls[0];
    expect(parsed.key).toBe("project");
    expect(parsed.value).toBe(12);
  });

  it("preserves the locationV2 category casing (not lowercased)", () => {
    const cb = selectResult({
      category: "locationV2",
      id: 3,
      title: "California",
    });
    const [parsed] = cb.mock.calls[0];
    expect(parsed.key).toBe("locationV2");
    expect(parsed.value).toBe(3);
  });

  it("does nothing when no onSearchResultSelected handler is provided", () => {
    renderHeader();
    expect(() =>
      capturedSearchProps.onResultSelect({
        currentEvent: "e",
        result: { category: "Project", id: 1, title: "x" },
      }),
    ).not.toThrow();
  });

  it("forwards the entered search text to onSearchEnterPressed", () => {
    const onSearchEnterPressed = jest.fn();
    renderHeader({ onSearchEnterPressed });
    capturedSearchProps.onEnter({ value: "malaria" });
    expect(onSearchEnterPressed).toHaveBeenCalledWith("malaria");
  });

  it("does not throw when Enter is pressed without a handler", () => {
    renderHeader();
    expect(() => capturedSearchProps.onEnter({ value: "x" })).not.toThrow();
  });
});
