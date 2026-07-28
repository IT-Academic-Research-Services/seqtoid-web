// Additional branch coverage for
// app/assets/src/components/ui/controls/LiveSearchPopBox.tsx
//
// The existing LiveSearchPopBox spec pins the stale-closure regression; this one
// walks the remaining branches: the below-minChars reset, the inputMode Enter
// commit (and its empty-string guard), focus-triggered search, the blur
// plain-text commit vs. the "already selected" guard, selecting a suggestion
// object vs. a plain string, and the value-prop reset effect. Only the SCSS is
// auto-mocked; the real Input and BareDropdown render so the open/close and
// item-building branches run.
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import LiveSearchPopBox, {
  SearchResults,
} from "~/components/ui/controls/LiveSearchPopBox";

// Keep prettier's organize-imports from dropping the React import the classic
// JSX runtime needs in scope.
const _React: typeof React = React;

const PLACEHOLDER = "Search here";

// Returns one category with a single result whose title/description are derived
// from the query, so we can both assert the search argument and render an item.
const search = jest.fn(
  async (query: string): Promise<SearchResults> => ({
    Places: {
      name: "Places",
      results: [
        { title: `${query} City`, name: query, description: "a place" },
      ],
    },
  }),
);

beforeEach(() => {
  jest.useFakeTimers();
  search.mockClear();
});
afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

const type = (input: HTMLElement, value: string) =>
  fireEvent.change(input, { target: { value } });

async function flushDebounce() {
  await act(async () => {
    jest.advanceTimersByTime(300);
    await Promise.resolve();
  });
}

function renderBox(props: Record<string, unknown> = {}) {
  const onResultSelect = jest.fn();
  render(
    React.createElement(LiveSearchPopBox, {
      placeholder: PLACEHOLDER,
      onSearchTriggered: search,
      onResultSelect,
      ...props,
    }),
  );
  return { onResultSelect, input: screen.getByPlaceholderText(PLACEHOLDER) };
}

describe("LiveSearchPopBox branches", () => {
  it("does not fire a search and clears results when below minChars", async () => {
    const { input } = renderBox({ minChars: 3 });
    type(input, "ab"); // only 2 chars, below the 3 minimum
    await flushDebounce();
    expect(search).not.toHaveBeenCalled();
  });

  it("triggers a search once enough characters are typed", async () => {
    const { input } = renderBox();
    type(input, "paris");
    await flushDebounce();
    expect(search).toHaveBeenLastCalledWith("paris");
  });

  it("commits the typed text on Enter in inputMode, and ignores whitespace-only input", () => {
    const { onResultSelect, input } = renderBox({ inputMode: true });

    // Whitespace-only -> trimmed is empty -> no commit.
    type(input, "   ");
    fireEvent.keyPress(input, { key: "Enter", charCode: 13 });
    expect(onResultSelect).not.toHaveBeenCalled();

    // Real text -> commit trimmed value.
    type(input, "  berlin  ");
    fireEvent.keyPress(input, { key: "Enter", charCode: 13 });
    expect(onResultSelect).toHaveBeenCalledWith({
      result: "berlin",
      currentEvent: {},
    });
  });

  it("commits typed plain text on blur when nothing was explicitly selected", () => {
    const { onResultSelect, input } = renderBox();
    type(input, "tokyo");
    fireEvent.blur(input);
    expect(onResultSelect).toHaveBeenCalledWith({ result: "tokyo" });
  });

  it("does not re-commit on blur when the typed value already matches the value prop", () => {
    const { onResultSelect, input } = renderBox({ value: "cairo" });
    // inputValue is seeded from value ("cairo"); blur without a new keystroke
    // must not re-submit it.
    fireEvent.blur(input);
    expect(onResultSelect).not.toHaveBeenCalled();
  });

  it("selects a suggestion object, filling the input with its title and closing the dropdown", async () => {
    const { onResultSelect, input } = renderBox({ shouldSearchOnFocus: true });
    type(input, "rome");
    await flushDebounce();

    // The dropdown should now hold the built item; clicking it selects the object.
    const item = await screen.findByText("rome City");
    fireEvent.mouseDown(item);

    expect(onResultSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({ title: "rome City", name: "rome" }),
      }),
    );
    // After selection the input reflects the chosen title.
    expect((input as HTMLInputElement).value).toBe("rome City");
  });

  it("re-runs the search on focus when shouldSearchOnFocus and enough chars are present", async () => {
    const { input } = renderBox({ shouldSearchOnFocus: true, value: "madrid" });
    search.mockClear();
    fireEvent.focus(input);
    await flushDebounce();
    expect(search).toHaveBeenCalledWith("madrid");
  });

  it("resets the input when the value prop changes", () => {
    const { rerender } = (() => {
      const r = render(
        React.createElement(LiveSearchPopBox, {
          placeholder: PLACEHOLDER,
          onSearchTriggered: search,
          value: "first",
        }),
      );
      return r;
    })();

    expect(
      (screen.getByPlaceholderText(PLACEHOLDER) as HTMLInputElement).value,
    ).toBe("first");

    rerender(
      React.createElement(LiveSearchPopBox, {
        placeholder: PLACEHOLDER,
        onSearchTriggered: search,
        value: "second",
      }),
    );
    expect(
      (screen.getByPlaceholderText(PLACEHOLDER) as HTMLInputElement).value,
    ).toBe("second");
  });
});
