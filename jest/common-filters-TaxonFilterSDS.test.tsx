// Coverage: app/assets/src/components/common/filters/TaxonFilterSDS.tsx
//
// TaxonFilterSDS is the multi-select taxon autocomplete. Its logic lives in the
// search handling: derive the trigger label from the selection count, ignore
// non-typing input events, show a loading state immediately, debounce the
// elasticsearch call, skip queries shorter than two characters, and
// map/filter the raw taxon hits into dropdown options (dropping non-positive
// taxids). The SDS Dropdown is stubbed so its DropdownMenuProps callbacks can be
// driven directly and the option list it receives can be asserted on. Real
// timers are used deliberately: lodash binds setTimeout/Date.now at import time,
// so jest's fake timers never reach the debounced handler.
import { act, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { getSearchSuggestions } from "~/api";
import TaxonFilterSDS from "~/components/common/filters/TaxonFilterSDS";

const _React: typeof React = React;

jest.mock("~/api", () => ({ getSearchSuggestions: jest.fn() }));

let mockDropdownProps: $TSFixMe = null;

jest.mock("@czi-sds/components", () => ({
  __esModule: true,
  LoadingIndicator: () => <span data-testid="loading-indicator" />,
  DropdownPopper: (props: $TSFixMe) => <div {...props} />,
  Dropdown: (props: $TSFixMe) => {
    mockDropdownProps = props;
    return (
      <div
        data-testid="taxon-filter-sds"
        data-label={props.label}
        data-loading={String(props.DropdownMenuProps.loading)}
        data-no-options={props.DropdownMenuProps.noOptionsText}
      >
        {(props.options || []).map((option: $TSFixMe, i: number) => (
          <span key={i} data-testid={`taxon-option-${i}`}>
            {option.name}
          </span>
        ))}
      </div>
    );
  },
}));

const mockedSearch = getSearchSuggestions as unknown as jest.Mock;

const PAST_DEBOUNCE_MS = 750;

const optionNames = () =>
  screen
    .queryAllByTestId(/^taxon-option-/)
    .map(node => node.textContent as string);

const filterNode = () => screen.getByTestId("taxon-filter-sds");

const typeQuery = (value: string) =>
  act(() => {
    mockDropdownProps.DropdownMenuProps.onInputChange(
      { type: "change" },
      value,
    );
  });

const waitPastDebounce = () =>
  act(async () => {
    await new Promise(resolve => setTimeout(resolve, PAST_DEBOUNCE_MS));
  });

const RESULTS = {
  Taxon: {
    results: [
      { taxid: 5, title: "Zeta virus", level: "genus" },
      { taxid: 3, title: "Alpha virus", level: "species" },
      { taxid: -1, title: "Bad taxon", level: "genus" },
    ],
  },
};

describe("TaxonFilterSDS", () => {
  beforeEach(() => {
    mockDropdownProps = null;
    mockedSearch.mockReset();
    mockedSearch.mockResolvedValue(RESULTS);
  });

  it("shows the 'Choose Taxon' label when nothing is selected", () => {
    render(
      <TaxonFilterSDS
        domain="my_data"
        selectedTaxa={[]}
        handleChange={jest.fn()}
      />,
    );
    expect(filterNode().getAttribute("data-label")).toBe("Choose Taxon");
  });

  it("counts the selection in the label when taxa are selected", () => {
    render(
      <TaxonFilterSDS
        domain="my_data"
        selectedTaxa={[
          { id: 1, name: "A", level: "genus" },
          { id: 2, name: "B", level: "genus" },
        ]}
        handleChange={jest.fn()}
      />,
    );
    expect(filterNode().getAttribute("data-label")).toBe("2 Taxa Selected");
  });

  it("ignores input events that are not the user typing", async () => {
    render(
      <TaxonFilterSDS
        domain="my_data"
        selectedTaxa={[]}
        handleChange={jest.fn()}
      />,
    );

    act(() => {
      mockDropdownProps.DropdownMenuProps.onInputChange(
        { type: "click" },
        "abc",
      );
    });
    await waitPastDebounce();

    expect(mockedSearch).not.toHaveBeenCalled();
    expect(filterNode().getAttribute("data-loading")).toBe("false");
  });

  it("does not search for queries shorter than two characters", async () => {
    render(
      <TaxonFilterSDS
        domain="my_data"
        selectedTaxa={[{ id: 9, name: "Kept", level: "genus" }]}
        handleChange={jest.fn()}
      />,
    );

    typeQuery("a");

    // Immediately: no spinner, no "no results" text.
    expect(filterNode().getAttribute("data-loading")).toBe("false");
    expect(filterNode().getAttribute("data-no-options")).toBe("");

    await waitPastDebounce();

    // The debounced handler still runs, but skips the query for short input,
    // leaving the already-selected taxon in the option list.
    expect(mockedSearch).not.toHaveBeenCalled();
    expect(optionNames()).toEqual(["Kept"]);
  });

  it("shows the loading state immediately and defers the query", () => {
    render(
      <TaxonFilterSDS
        domain="my_data"
        selectedTaxa={[]}
        handleChange={jest.fn()}
      />,
    );

    typeQuery("cor");

    expect(filterNode().getAttribute("data-loading")).toBe("true");
    expect(mockedSearch).not.toHaveBeenCalled();
  });

  it("queries taxa, drops non-positive taxids and maps to options", async () => {
    render(
      <TaxonFilterSDS
        domain="my_data"
        selectedTaxa={[]}
        handleChange={jest.fn()}
      />,
    );

    typeQuery("virus");
    await waitFor(() => expect(mockedSearch).toHaveBeenCalled(), {
      timeout: 3000,
    });

    expect(mockedSearch).toHaveBeenCalledWith({
      query: "virus",
      categories: ["taxon"],
      domain: "my_data",
    });
    await waitFor(() =>
      expect(new Set(optionNames())).toEqual(
        new Set(["Zeta virus", "Alpha virus"]),
      ),
    );
    // "Bad taxon" (taxid -1) is filtered out.
    expect(optionNames()).not.toContain("Bad taxon");
    expect(filterNode().getAttribute("data-loading")).toBe("false");
    expect(filterNode().getAttribute("data-no-options")).toBe("No results");
  });

  it("treats missing elasticsearch results as an empty option list", async () => {
    mockedSearch.mockResolvedValue({});
    render(
      <TaxonFilterSDS
        domain="my_data"
        selectedTaxa={[]}
        handleChange={jest.fn()}
      />,
    );

    typeQuery("virus");
    await waitFor(() => expect(mockedSearch).toHaveBeenCalled(), {
      timeout: 3000,
    });
    await waitPastDebounce();

    expect(optionNames()).toEqual([]);
  });

  it("restores the current selection when the dropdown closes", () => {
    const selected = [{ id: 4, name: "Restored", level: "genus" }];
    render(
      <TaxonFilterSDS
        domain="my_data"
        selectedTaxa={selected}
        handleChange={jest.fn()}
      />,
    );

    act(() => {
      mockDropdownProps.onClose();
    });

    expect(optionNames()).toEqual(["Restored"]);
  });

  it("passes handleChange straight through to the Dropdown onChange", () => {
    const handleChange = jest.fn();
    render(
      <TaxonFilterSDS
        domain="my_data"
        selectedTaxa={[]}
        handleChange={handleChange}
      />,
    );
    expect(mockDropdownProps.onChange).toBe(handleChange);
  });
});
