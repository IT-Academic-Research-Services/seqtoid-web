import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import LiveSearchPopBox, {
  SearchResults,
} from "../app/assets/src/components/ui/controls/LiveSearchPopBox";

// Regression test for the geosearch stale-closure bug: the debounced search read the
// `inputValue` state captured by its closure, which lagged one keystroke behind — so
// typing "france" searched "franc" and the plain-text fallback showed "franc". The fix
// passes the typed value through the debounce and guards results by the latest query.
describe("LiveSearchPopBox", () => {
  const PLACEHOLDER = "Search here";

  // Mimics GeoSearchInputBox: no server matches, so the only result is a plain-text
  // fallback built from the query the user typed.
  const plainTextSearch = jest.fn(
    async (query: string): Promise<SearchResults> => ({
      "No Results (Use Plain Text)": {
        name: "No Results (Use Plain Text)",
        results: [{ title: query, name: query }],
      },
    }),
  );

  beforeEach(() => {
    jest.useFakeTimers();
    plainTextSearch.mockClear();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  const type = (input: HTMLElement, value: string) =>
    fireEvent.change(input, { target: { value } });

  it("searches the value the user actually typed, not the previous keystroke", async () => {
    // NOTE: use React.createElement instead of JSX so the `React` import is genuinely
    // referenced — the repo's prettier organize-imports (automatic JSX runtime) would
    // otherwise strip it, but Jest's classic-runtime transform needs React in scope.
    render(
      React.createElement(LiveSearchPopBox, {
        placeholder: PLACEHOLDER,
        onSearchTriggered: plainTextSearch,
        onResultSelect: jest.fn(),
        inputMode: true,
      }),
    );
    const input = screen.getByPlaceholderText(PLACEHOLDER);

    await act(async () => {
      type(input, "franc");
      type(input, "france");
      jest.advanceTimersByTime(300); // past the 200ms debounce
      await Promise.resolve(); // flush the async onSearchTriggered
    });

    // The bug fired the search with the stale "franc"; the fix searches "france".
    // Since GeoSearchInputBox builds the plain-text fallback from this exact query
    // ({ title: query }), searching "france" is what makes the fallback show "france".
    expect(plainTextSearch).toHaveBeenCalled();
    expect(plainTextSearch).toHaveBeenLastCalledWith("france");
    expect(plainTextSearch).not.toHaveBeenLastCalledWith("franc");
  });

  it("renders correctly with default props", () => {
    const { container } = render(
      React.createElement(LiveSearchPopBox, {
        value: "initial value",
        onSearchTriggered: jest.fn(),
      }),
    );
    expect(container).toBeTruthy();
  });

  it("triggers onResultSelect with correct SearchResult format on keypress of Enter when inputMode is true", () => {
    const onResultSelectMock = jest.fn();
    render(
      React.createElement(LiveSearchPopBox, {
        value: "test-query",
        inputMode: true,
        onResultSelect: onResultSelectMock,
        onSearchTriggered: jest.fn(),
      }),
    );

    const input = screen.getByPlaceholderText("Search");
    fireEvent.keyPress(input, { key: "Enter", code: "Enter", charCode: 13 });

    expect(onResultSelectMock).toHaveBeenCalledWith({
      currentEvent: expect.any(Object),
      result: {
        title: "test-query",
        name: "test-query",
      },
    });
  });

  it("triggers onResultSelect with correct SearchResult format on blur when value is untouched (does not trigger)", () => {
    const onResultSelectMock = jest.fn();
    render(
      React.createElement(LiveSearchPopBox, {
        value: "initial",
        onResultSelect: onResultSelectMock,
        onSearchTriggered: jest.fn(),
      }),
    );

    const input = screen.getByPlaceholderText("Search");
    fireEvent.blur(input);

    expect(onResultSelectMock).not.toHaveBeenCalled();
  });

  it("trims the value and triggers onResultSelect with correct SearchResult format on keypress of Enter when inputMode is true", () => {
    const onResultSelectMock = jest.fn();
    render(
      React.createElement(LiveSearchPopBox, {
        value: "  test-query  ",
        inputMode: true,
        onResultSelect: onResultSelectMock,
        onSearchTriggered: jest.fn(),
      }),
    );

    const input = screen.getByPlaceholderText("Search");
    fireEvent.keyPress(input, { key: "Enter", code: "Enter", charCode: 13 });

    expect(onResultSelectMock).toHaveBeenCalledWith({
      currentEvent: expect.any(Object),
      result: {
        title: "test-query",
        name: "test-query",
      },
    });
  });

  it("trims the value and triggers onResultSelect on blur when value has changed and no suggestion was picked", () => {
    const onResultSelectMock = jest.fn();
    render(
      React.createElement(LiveSearchPopBox, {
        value: "original",
        onResultSelect: onResultSelectMock,
        onSearchTriggered: jest.fn(),
      }),
    );

    const input = screen.getByPlaceholderText("Search");
    fireEvent.change(input, { target: { value: "  new-value  " } });
    fireEvent.blur(input);

    expect(onResultSelectMock).toHaveBeenCalledWith({
      result: {
        title: "new-value",
        name: "new-value",
      },
    });
  });

  it("does not trigger onResultSelect on blur if a suggestion has already been selected", async () => {
    const onResultSelectMock = jest.fn();
    const onSearchTriggeredMock = jest.fn().mockResolvedValue({
      testCat: {
        name: "Category",
        results: [{ title: "San Francisco", name: "SF" }],
      },
    });

    render(
      React.createElement(LiveSearchPopBox, {
        value: "",
        onResultSelect: onResultSelectMock,
        onSearchTriggered: onSearchTriggeredMock,
      }),
    );

    const input = screen.getByPlaceholderText("Search");

    await act(async () => {
      fireEvent.change(input, { target: { value: "San" } });
      jest.advanceTimersByTime(300);
      await Promise.resolve();
    });

    const suggestion = screen.getByText("San Francisco");
    expect(suggestion).toBeTruthy();

    fireEvent.mouseDown(suggestion);

    expect(onResultSelectMock).toHaveBeenCalledWith({
      currentEvent: expect.any(Object),
      result: { title: "San Francisco", name: "SF" },
    });

    onResultSelectMock.mockClear();

    fireEvent.blur(input);

    expect(onResultSelectMock).not.toHaveBeenCalled();
  });

  it("handles plain text option correctly", async () => {
    const onResultSelectMock = jest.fn();
    render(
      React.createElement(LiveSearchPopBox, {
        placeholder: PLACEHOLDER,
        onSearchTriggered: plainTextSearch,
        onResultSelect: onResultSelectMock,
        inputMode: true,
      }),
    );
    const input = screen.getByPlaceholderText(PLACEHOLDER);

    await act(async () => {
      type(input, "Atlantis");
      jest.advanceTimersByTime(300);
      await Promise.resolve();
    });

    const plainTextOption = screen.getByText("Atlantis");
    fireEvent.mouseDown(plainTextOption);

    expect(onResultSelectMock).toHaveBeenCalledWith({
      currentEvent: expect.any(Object),
      result: {
        name: "Atlantis",
        title: "Atlantis",
      },
    });
  });
});
