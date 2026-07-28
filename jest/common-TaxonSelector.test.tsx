// Coverage: app/assets/src/components/common/TaxonSelector.tsx
//
// TaxonSelector is a class component wrapping SearchBoxList inside a
// ContextPlaceholder popover. Its own logic is the debounced
// loadOptionsForQuery: it fetches suggestions, discards stale responses,
// maps the API shape into option objects, and falls back to availableTaxa
// when the query is empty. The API call, ContextPlaceholder and SearchBoxList
// are stubbed so the tests drive that logic directly and read the resulting
// options off the stubbed list.
import { act, render, screen } from "@testing-library/react";

const mockGetTaxaWithReadsSuggestions = jest.fn();

jest.mock("~/api", () => ({
  __esModule: true,
  getTaxaWithReadsSuggestions: (...args: $TSFixMe[]) =>
    mockGetTaxaWithReadsSuggestions(...args),
}));

// ContextPlaceholder just renders its children (and exposes onClose for a test).
jest.mock("~ui/containers", () => ({
  __esModule: true,
  ContextPlaceholder: (props: $TSFixMe) =>
    require("react").createElement(
      "div",
      { "data-testid": "context-placeholder", onClick: props.onClose },
      props.children,
    ),
}));

// SearchBoxList renders the option labels and exposes onFilterChange/onChange.
jest.mock("~ui/controls", () => ({
  __esModule: true,
  SearchBoxList: (props: $TSFixMe) => {
    const r = require("react");
    return r.createElement(
      "div",
      { "data-testid": "search-box-list" },
      r.createElement(
        "span",
        { "data-testid": "opt-count" },
        String(props.options.length),
      ),
      props.options.map((o: $TSFixMe) =>
        r.createElement(
          "span",
          { key: o.value, "data-testid": "opt" },
          o.label,
        ),
      ),
      r.createElement("button", {
        "data-testid": "filter-btn",
        onClick: () => props.onFilterChange("flu"),
      }),
      r.createElement("button", {
        "data-testid": "filter-empty-btn",
        onClick: () => props.onFilterChange(""),
      }),
    );
  },
}));

import TaxonSelector from "~/components/common/TaxonSelector";

const availableTaxa = [
  { count: 3, label: "Available A", value: 100 },
  { count: 1, label: "Available B", value: 101 },
];

const renderSelector = (props: $TSFixMe = {}) => {
  return render(
    <TaxonSelector
      addTaxonTrigger={document.createElement("div") as $TSFixMe}
      availableTaxa={availableTaxa as $TSFixMe}
      sampleIds={[1, 2]}
      selectedTaxa={new Set<number>()}
      onTaxonSelectionChange={jest.fn()}
      onTaxonSelectionClose={jest.fn()}
      taxLevel="species"
      {...props}
    />,
  );
};

beforeEach(() => {
  mockGetTaxaWithReadsSuggestions.mockReset();
});

// TaxonSelector debounces via lodash (which reads Date.now), a combination that
// is fragile under Jest fake timers. Use real timers and wait past the 200ms
// AUTOCOMPLETE_DEBOUNCE_DELAY instead.
const flushDebounce = async () => {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 300));
  });
};

describe("TaxonSelector", () => {
  it("renders the available taxa as the initial options", () => {
    renderSelector();
    expect(screen.getByTestId("opt-count").textContent).toBe("2");
    const labels = screen.getAllByTestId("opt").map(n => n.textContent);
    expect(labels).toEqual(["Available A", "Available B"]);
  });

  it("loads and maps suggestions for a non-empty query", async () => {
    mockGetTaxaWithReadsSuggestions.mockResolvedValue([
      { taxid: 5, title: "Influenza A", sample_count: 9 },
      { taxid: 6, title: "Influenza B", sample_count: 4 },
    ]);
    renderSelector();

    act(() => {
      screen.getByTestId("filter-btn").click();
    });
    await flushDebounce();

    expect(mockGetTaxaWithReadsSuggestions).toHaveBeenCalledWith(
      "flu",
      [1, 2],
      "species",
    );
    const labels = screen.getAllByTestId("opt").map(n => n.textContent);
    expect(labels).toEqual(["Influenza A", "Influenza B"]);
  });

  it("falls back to availableTaxa when the query is empty", async () => {
    mockGetTaxaWithReadsSuggestions.mockResolvedValue([
      { taxid: 7, title: "Should be ignored", sample_count: 1 },
    ]);
    renderSelector();

    act(() => {
      screen.getByTestId("filter-empty-btn").click();
    });
    await flushDebounce();

    // Even though the API returned a row, an empty query resets to availableTaxa.
    const labels = screen.getAllByTestId("opt").map(n => n.textContent);
    expect(labels).toEqual(["Available A", "Available B"]);
  });

  it("invokes onTaxonSelectionClose when the placeholder closes", () => {
    const onTaxonSelectionClose = jest.fn();
    renderSelector({ onTaxonSelectionClose });
    act(() => {
      screen.getByTestId("context-placeholder").click();
    });
    expect(onTaxonSelectionClose).toHaveBeenCalled();
  });
});
