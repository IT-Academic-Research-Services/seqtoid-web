// Branch coverage: app/assets/src/components/ui/controls/LiveSearchPopBox.tsx
//
// controls-LiveSearchPopBox-branches.test.tsx walks the happy paths (search,
// Enter commit, blur commit, suggestion select). This file picks up the arms
// that spec never reaches:
//
//   * the `placeholder = "Search"` default parameter (no placeholder passed),
//   * the else side of `key === "Enter" && inputMode`,
//   * the `result.name` and `""` fallbacks of the selected-result display,
//   * the stale-response guard in triggerSearch (`query !== latestQueryRef`),
//   * focus without shouldSearchOnFocus,
//   * blur after an explicit selection (the `!selectedRef.current` guard).
import { act, fireEvent, render, screen } from "@testing-library/react";
import LiveSearchPopBox, {
  SearchResults,
} from "~/components/ui/controls/LiveSearchPopBox";

const PLACEHOLDER = "Search here";

const oneResult = (result: Record<string, unknown>): SearchResults =>
  ({
    Places: { name: "Places", results: [result] },
  } as unknown as SearchResults);

const type = (input: HTMLElement, value: string) =>
  fireEvent.change(input, { target: { value } });

async function flushDebounce() {
  await act(async () => {
    jest.advanceTimersByTime(300);
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe("LiveSearchPopBox default placeholder", () => {
  it('falls back to "Search" when no placeholder is given', () => {
    render(<LiveSearchPopBox onSearchTriggered={jest.fn()} />);
    const input = screen.getByPlaceholderText("Search");
    expect(input.tagName).toBe("INPUT");
    expect(input.getAttribute("placeholder")).toBe("Search");
  });
});

describe("LiveSearchPopBox key handling", () => {
  const setup = (props: Record<string, unknown> = {}) => {
    const onResultSelect = jest.fn();
    render(
      <LiveSearchPopBox
        placeholder={PLACEHOLDER}
        onSearchTriggered={jest.fn()}
        onResultSelect={onResultSelect}
        {...props}
      />,
    );
    return { onResultSelect, input: screen.getByPlaceholderText(PLACEHOLDER) };
  };

  it("ignores keys other than Enter while in inputMode", () => {
    const { onResultSelect, input } = setup({ inputMode: true });
    type(input, "berlin");
    fireEvent.keyPress(input, { key: "a", charCode: 97 });
    expect(onResultSelect).not.toHaveBeenCalled();
  });

  it("ignores Enter when inputMode is off", () => {
    const { onResultSelect, input } = setup();
    type(input, "berlin");
    fireEvent.keyPress(input, { key: "Enter", charCode: 13 });
    expect(onResultSelect).not.toHaveBeenCalled();
  });
});

describe("LiveSearchPopBox selected-result display fallbacks", () => {
  // Renders the dropdown for a single suggestion and clicks it. The suggestion
  // is located by its description so results with no title are still clickable.
  const selectSuggestion = async (result: Record<string, unknown>) => {
    const onResultSelect = jest.fn();
    const onSearchTriggered = jest.fn(async () => oneResult(result));
    render(
      <LiveSearchPopBox
        placeholder={PLACEHOLDER}
        onSearchTriggered={onSearchTriggered}
        onResultSelect={onResultSelect}
      />,
    );
    const input = screen.getByPlaceholderText(PLACEHOLDER) as HTMLInputElement;
    type(input, "query");
    await flushDebounce();

    fireEvent.mouseDown(await screen.findByText(result.description as string));
    return { onResultSelect, input };
  };

  it("falls back to result.name when the suggestion has no title", async () => {
    const { onResultSelect, input } = await selectSuggestion({
      name: "solo-name",
      description: "name only",
    });

    expect(onResultSelect).toHaveBeenCalledTimes(1);
    expect(input.value).toBe("solo-name");
  });

  it("falls back to an empty string when the suggestion has neither", async () => {
    const { onResultSelect, input } = await selectSuggestion({
      description: "nothing to display",
    });

    expect(onResultSelect).toHaveBeenCalledTimes(1);
    expect(input.value).toBe("");
  });
});

describe("LiveSearchPopBox out-of-order responses", () => {
  it("drops a response whose query is no longer the latest one", async () => {
    let releaseStale: (results: SearchResults) => void = () => undefined;
    const onSearchTriggered = jest.fn((query: string) => {
      if (query === "par") {
        return new Promise<SearchResults>(resolve => {
          releaseStale = resolve;
        });
      }
      return Promise.resolve(
        oneResult({ title: "FRESH City", name: "fresh", description: "fresh" }),
      );
    });

    render(
      <LiveSearchPopBox
        placeholder={PLACEHOLDER}
        onSearchTriggered={onSearchTriggered}
      />,
    );
    const input = screen.getByPlaceholderText(PLACEHOLDER);

    // First search goes out and hangs.
    type(input, "par");
    await flushDebounce();
    expect(onSearchTriggered).toHaveBeenCalledWith("par");

    // The user keeps typing, so "par" is no longer the latest query.
    type(input, "paris");

    // The stale response lands late and must be discarded.
    await act(async () => {
      releaseStale(
        oneResult({ title: "STALE City", name: "stale", description: "stale" }),
      );
      await Promise.resolve();
    });
    expect(screen.queryByText("STALE City")).toBeNull();

    // The in-flight current query still applies normally.
    await flushDebounce();
    expect(onSearchTriggered).toHaveBeenLastCalledWith("paris");
    expect(await screen.findByText("FRESH City")).not.toBeNull();
  });
});

describe("LiveSearchPopBox focus and blur guards", () => {
  it("does not search on focus unless shouldSearchOnFocus is set", async () => {
    const onSearchTriggered = jest.fn(async () => oneResult({ title: "x" }));
    render(
      <LiveSearchPopBox
        placeholder={PLACEHOLDER}
        onSearchTriggered={onSearchTriggered}
        value="madrid"
      />,
    );
    const input = screen.getByPlaceholderText(PLACEHOLDER);

    fireEvent.focus(input);
    await flushDebounce();

    expect(onSearchTriggered).not.toHaveBeenCalled();
  });

  it("does not re-commit plain text on blur after a suggestion was picked", async () => {
    const onResultSelect = jest.fn();
    const onSearchTriggered = jest.fn(async () =>
      oneResult({ title: "Rome City", name: "rome", description: "a place" }),
    );
    render(
      <LiveSearchPopBox
        placeholder={PLACEHOLDER}
        onSearchTriggered={onSearchTriggered}
        onResultSelect={onResultSelect}
      />,
    );
    const input = screen.getByPlaceholderText(PLACEHOLDER);

    type(input, "rome");
    await flushDebounce();
    fireEvent.mouseDown(await screen.findByText("Rome City"));
    expect(onResultSelect).toHaveBeenCalledTimes(1);

    // Blurring must not fire a second, plain-text selection.
    fireEvent.blur(input);
    expect(onResultSelect).toHaveBeenCalledTimes(1);
  });

  it("does not throw on blur when no onResultSelect is supplied", () => {
    render(
      <LiveSearchPopBox
        placeholder={PLACEHOLDER}
        onSearchTriggered={jest.fn()}
      />,
    );
    const input = screen.getByPlaceholderText(PLACEHOLDER);
    type(input, "tokyo");

    expect(() => fireEvent.blur(input)).not.toThrow();
  });
});
