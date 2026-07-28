// Frontend coverage: UploadTaxonFilter is the viral-CG "select a taxon"
// autocomplete. Its logic is in the search handling: ignore non-typing input
// events, show a loading state immediately, debounce the elasticsearch call,
// skip queries shorter than two characters, and map/filter/sort the raw taxon
// hits into dropdown options. The "Unknown" option is always kept available.
//
// The SDS Dropdown is stubbed so its DropdownMenuProps callbacks can be driven
// directly and the option list it receives can be asserted on. Real timers are
// used deliberately: lodash binds setTimeout/Date.now at import time, so jest's
// fake timers never reach the debounced handler.
import { act, render, screen, waitFor } from "@testing-library/react";
import { getSearchSuggestions } from "~/api";
import { UploadTaxonFilter } from "~/components/views/SampleUploadFlow/components/WorkflowSelector/components/ViralConsensusGenomeSequencingPlatformOptions/components/UploadTaxonFilter/UploadTaxonFilter";

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
        data-testid="upload-taxon-filter"
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

// Slightly longer than the component's 600ms autocomplete debounce.
const PAST_DEBOUNCE_MS = 750;

const optionNames = () =>
  screen
    .queryAllByTestId(/^taxon-option-/)
    .map(node => node.textContent as string);

const filterNode = () => screen.getByTestId("upload-taxon-filter");

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
      { taxid: 5, title: "Zeta virus", description: "z desc", level: "genus" },
      { taxid: 3, title: "Alpha virus", description: "a desc", level: null },
      { taxid: -1, title: "Bad taxon", description: "ignored", level: "genus" },
      {
        taxid: 7,
        title: "Mid virus",
        description: undefined,
        level: "species",
      },
    ],
  },
};

describe("UploadTaxonFilter", () => {
  beforeEach(() => {
    mockDropdownProps = null;
    mockedSearch.mockReset();
    mockedSearch.mockResolvedValue(RESULTS);
  });

  it("shows the placeholder label and only the Unknown option with no selection", () => {
    render(
      <UploadTaxonFilter
        selectedTaxon={null as $TSFixMe}
        onChange={jest.fn()}
      />,
    );

    expect(filterNode().getAttribute("data-label")).toBe("Select Taxon Name");
    expect(optionNames()).toEqual(["Unknown"]);
  });

  it("labels itself with the selected taxon and keeps it alongside Unknown", () => {
    render(
      <UploadTaxonFilter
        selectedTaxon={{ id: 1, name: "Betacoronavirus" } as $TSFixMe}
        onChange={jest.fn()}
      />,
    );

    expect(filterNode().getAttribute("data-label")).toBe("Betacoronavirus");
    expect(optionNames()).toEqual(["Betacoronavirus", "Unknown"]);
  });

  it("ignores input events that are not the user typing", async () => {
    render(
      <UploadTaxonFilter
        selectedTaxon={null as $TSFixMe}
        onChange={jest.fn()}
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

  it("does not search for queries shorter than two characters and restores the selection", async () => {
    render(
      <UploadTaxonFilter
        selectedTaxon={{ id: 1, name: "Betacoronavirus" } as $TSFixMe}
        onChange={jest.fn()}
      />,
    );

    typeQuery("a");

    // Immediately: no spinner, no "no results" text, and the current selection
    // is put back so the dropdown is not left empty.
    expect(filterNode().getAttribute("data-loading")).toBe("false");
    expect(filterNode().getAttribute("data-no-options")).toBe("");
    expect(optionNames()).toEqual(["Betacoronavirus", "Unknown"]);

    await waitPastDebounce();

    // The debounced handler still runs, but skips the query for short input.
    expect(mockedSearch).not.toHaveBeenCalled();
    expect(filterNode().getAttribute("data-no-options")).toBe("");
    expect(optionNames()).toEqual(["Unknown"]);
  });

  it("shows the loading state immediately and defers the query", () => {
    render(
      <UploadTaxonFilter
        selectedTaxon={null as $TSFixMe}
        onChange={jest.fn()}
      />,
    );

    typeQuery("cor");

    expect(filterNode().getAttribute("data-loading")).toBe("true");
    // Debounced -- the API has not been hit yet.
    expect(mockedSearch).not.toHaveBeenCalled();
  });

  it("queries viral taxa, drops non-positive taxids and sorts by name", async () => {
    render(
      <UploadTaxonFilter
        selectedTaxon={null as $TSFixMe}
        onChange={jest.fn()}
      />,
    );

    typeQuery("virus");
    await waitFor(() => expect(mockedSearch).toHaveBeenCalled(), {
      timeout: 3000,
    });

    expect(mockedSearch).toHaveBeenCalledWith({
      query: "virus",
      categories: ["taxon"],
      superkingdom: "Viruses",
    });
    // "Bad taxon" (taxid -1) is filtered out; the rest are alphabetical, with
    // the always-available Unknown option appended.
    await waitFor(() =>
      expect(optionNames()).toEqual([
        "Alpha virus",
        "Mid virus (species)",
        "Zeta virus (genus)",
        "Unknown",
      ]),
    );
    expect(filterNode().getAttribute("data-loading")).toBe("false");
    expect(filterNode().getAttribute("data-no-options")).toBe("No results");
  });

  it("falls back to 'unknown' details when a hit has no description", async () => {
    render(
      <UploadTaxonFilter
        selectedTaxon={null as $TSFixMe}
        onChange={jest.fn()}
      />,
    );

    typeQuery("virus");
    await waitFor(
      () =>
        expect(
          mockDropdownProps.options.find((o: $TSFixMe) => o.id === 7),
        ).toBeTruthy(),
      { timeout: 3000 },
    );

    expect(
      mockDropdownProps.options.find((o: $TSFixMe) => o.id === 7).details,
    ).toBe("unknown");
    expect(
      mockDropdownProps.options.find((o: $TSFixMe) => o.id === 3).details,
    ).toBe("a desc");
  });

  it("handles an empty elasticsearch response", async () => {
    mockedSearch.mockResolvedValue({});
    render(
      <UploadTaxonFilter
        selectedTaxon={null as $TSFixMe}
        onChange={jest.fn()}
      />,
    );

    typeQuery("virus");
    await waitFor(
      () =>
        expect(filterNode().getAttribute("data-no-options")).toBe("No results"),
      { timeout: 3000 },
    );

    expect(optionNames()).toEqual(["Unknown"]);
  });

  it("compares options by taxon id and forwards selection to onChange", () => {
    const onChange = jest.fn();
    render(
      <UploadTaxonFilter
        selectedTaxon={{ id: 1, name: "Betacoronavirus" } as $TSFixMe}
        onChange={onChange}
      />,
    );

    const isEqual = mockDropdownProps.DropdownMenuProps.isOptionEqualToValue;
    expect(isEqual({ id: 1, name: "a" }, { id: 1, name: "b" })).toBe(true);
    expect(isEqual({ id: 1, name: "a" }, { id: 2, name: "a" })).toBe(false);

    mockDropdownProps.onChange({ id: 2, name: "Other" });
    expect(onChange).toHaveBeenCalledWith({ id: 2, name: "Other" });
  });

  it("cancels the pending debounced search on unmount", async () => {
    const { unmount } = render(
      <UploadTaxonFilter
        selectedTaxon={null as $TSFixMe}
        onChange={jest.fn()}
      />,
    );

    typeQuery("virus");
    unmount();
    await waitPastDebounce();

    expect(mockedSearch).not.toHaveBeenCalled();
  });
});
