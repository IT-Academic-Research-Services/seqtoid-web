// Coverage for LiveSearchBox, the semantic-ui-backed debounced search input.
// The behaviour worth pinning down is the debounce (min chars, timer reset,
// stale-response guard), the Enter/inputMode submit path, and the blur reset to
// the last searched term.
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import LiveSearchBox from "~/components/ui/controls/LiveSearchBox";

// Keeps prettier's organize-imports from dropping the React import that the
// classic JSX runtime needs in scope.
const _React: typeof React = React;

const PLACEHOLDER = "Search here";

const categories = (categoryName: string, title: string) => ({
  [categoryName]: { name: categoryName, results: [{ title }] },
});

const type = (input: HTMLElement, value: string) =>
  fireEvent.change(input, { target: { value } });

const getInput = () => screen.getByPlaceholderText(PLACEHOLDER);

/** Runs the debounce timer and lets the awaited search promise settle. */
const flushSearch = async (ms = 1000) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe("LiveSearchBox rendering", () => {
  it("renders the default placeholder and the initial value", () => {
    render(<LiveSearchBox initialValue="seed" />);
    const input = screen.getByPlaceholderText("Search") as HTMLInputElement;
    expect(input.value).toBe("seed");
  });

  it("renders an empty input when there is no initial value", () => {
    render(<LiveSearchBox placeholder={PLACEHOLDER} />);
    expect((getInput() as HTMLInputElement).value).toBe("");
  });

  it("re-syncs the input when the controlled value prop changes", () => {
    const { rerender } = render(
      <LiveSearchBox placeholder={PLACEHOLDER} value="one" />,
    );
    expect((getInput() as HTMLInputElement).value).toBe("one");
    rerender(<LiveSearchBox placeholder={PLACEHOLDER} value="two" />);
    expect((getInput() as HTMLInputElement).value).toBe("two");
  });
});

describe("LiveSearchBox debounced search", () => {
  it("triggers the search with the typed value and the project id", async () => {
    const onSearchTriggered = jest
      .fn()
      .mockResolvedValue(categories("Cat", "hit"));
    render(
      <LiveSearchBox
        placeholder={PLACEHOLDER}
        projectId="proj-1"
        onSearchTriggered={onSearchTriggered}
      />,
    );
    type(getInput(), "abc");
    expect(onSearchTriggered).not.toHaveBeenCalled();

    await flushSearch();
    expect(onSearchTriggered).toHaveBeenCalledTimes(1);
    expect(onSearchTriggered).toHaveBeenCalledWith("abc", "proj-1");
  });

  it("does not search below the minimum character count", async () => {
    const onSearchTriggered = jest.fn().mockResolvedValue({});
    render(
      <LiveSearchBox
        placeholder={PLACEHOLDER}
        minChars={3}
        onSearchTriggered={onSearchTriggered}
      />,
    );
    type(getInput(), "ab");
    await flushSearch();
    expect(onSearchTriggered).not.toHaveBeenCalled();

    type(getInput(), "abc");
    await flushSearch();
    expect(onSearchTriggered).toHaveBeenCalledTimes(1);
  });

  it("notifies onSearchChange on every keystroke", () => {
    const onSearchChange = jest.fn();
    render(
      <LiveSearchBox
        placeholder={PLACEHOLDER}
        onSearchChange={onSearchChange}
        onSearchTriggered={jest.fn().mockResolvedValue({})}
      />,
    );
    type(getInput(), "a");
    type(getInput(), "ab");
    expect(onSearchChange).toHaveBeenCalledTimes(2);
    expect(onSearchChange).toHaveBeenLastCalledWith("ab");
  });

  it("resets the debounce timer so only the last keystroke searches", async () => {
    const onSearchTriggered = jest.fn().mockResolvedValue({});
    render(
      <LiveSearchBox
        placeholder={PLACEHOLDER}
        onSearchTriggered={onSearchTriggered}
      />,
    );
    type(getInput(), "ab");
    act(() => {
      jest.advanceTimersByTime(500);
    });
    type(getInput(), "abcd");
    await flushSearch();

    expect(onSearchTriggered).toHaveBeenCalledTimes(1);
    // No projectId prop was supplied, so it is forwarded as undefined.
    expect(onSearchTriggered).toHaveBeenCalledWith("abcd", undefined);
  });

  it("skips the search entirely when the value has been cleared", async () => {
    const onSearchTriggered = jest.fn().mockResolvedValue({});
    render(
      <LiveSearchBox
        placeholder={PLACEHOLDER}
        inputMode
        onSearchTriggered={onSearchTriggered}
        onResultSelect={jest.fn()}
      />,
    );
    type(getInput(), "abc");
    // Enter submits and resets the box, so the pending timer finds no value.
    fireEvent.keyDown(getInput(), { key: "Enter" });
    await flushSearch();
    expect(onSearchTriggered).not.toHaveBeenCalled();
  });

  it("discards a stale in-flight response in favour of the newest query", async () => {
    let resolveFirst: (v: unknown) => void = () => undefined;
    const onSearchTriggered = jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(categories("Fresh", "fresh-item"));

    render(
      <LiveSearchBox
        placeholder={PLACEHOLDER}
        onSearchTriggered={onSearchTriggered}
      />,
    );
    type(getInput(), "ab");
    await flushSearch();
    expect(onSearchTriggered).toHaveBeenCalledTimes(1);

    // A newer keystroke starts a newer timer while the first request is still open.
    type(getInput(), "abcd");
    await flushSearch();
    expect(onSearchTriggered).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("fresh-item")).toBeTruthy();

    // The stale response lands last and must be ignored.
    await act(async () => {
      resolveFirst(categories("Stale", "stale-item"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByText("stale-item")).toBeNull();
    expect(screen.getByText("fresh-item")).toBeTruthy();
  });
});

describe("LiveSearchBox selection", () => {
  it("submits the typed text on Enter in input mode and clears the box", () => {
    const onResultSelect = jest.fn();
    const onEnter = jest.fn();
    render(
      <LiveSearchBox
        placeholder={PLACEHOLDER}
        inputMode
        onResultSelect={onResultSelect}
        onEnter={onEnter}
        onSearchTriggered={jest.fn().mockResolvedValue({})}
      />,
    );
    type(getInput(), "typed text");
    fireEvent.keyDown(getInput(), { key: "Enter" });

    expect(onResultSelect).toHaveBeenCalledTimes(1);
    expect(onResultSelect.mock.calls[0][0].result).toBe("typed text");
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(onEnter.mock.calls[0][0].value).toBe("typed text");
    expect((getInput() as HTMLInputElement).value).toBe("");
  });

  it("does not submit typed text on Enter outside input mode", () => {
    const onResultSelect = jest.fn();
    const onEnter = jest.fn();
    render(
      <LiveSearchBox
        placeholder={PLACEHOLDER}
        onResultSelect={onResultSelect}
        onEnter={onEnter}
        onSearchTriggered={jest.fn().mockResolvedValue({})}
      />,
    );
    type(getInput(), "typed text");
    fireEvent.keyDown(getInput(), { key: "Enter" });

    expect(onResultSelect).not.toHaveBeenCalled();
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect((getInput() as HTMLInputElement).value).toBe("typed text");
  });

  it("ignores non-Enter keys", () => {
    const onEnter = jest.fn();
    render(
      <LiveSearchBox
        placeholder={PLACEHOLDER}
        onEnter={onEnter}
        onSearchTriggered={jest.fn().mockResolvedValue({})}
      />,
    );
    type(getInput(), "abc");
    fireEvent.keyDown(getInput(), { key: "a" });
    expect(onEnter).not.toHaveBeenCalled();
  });

  it("handles Enter with no onEnter handler wired up", () => {
    render(
      <LiveSearchBox
        placeholder={PLACEHOLDER}
        onSearchTriggered={jest.fn().mockResolvedValue({})}
      />,
    );
    type(getInput(), "abc");
    fireEvent.keyDown(getInput(), { key: "Enter" });
    // Without inputMode/onEnter the value simply stays put.
    expect((getInput() as HTMLInputElement).value).toBe("abc");
  });

  it("restores the last searched term on blur", () => {
    render(
      <LiveSearchBox
        placeholder={PLACEHOLDER}
        onSearchTriggered={jest.fn().mockResolvedValue({})}
      />,
    );
    type(getInput(), "committed");
    fireEvent.keyDown(getInput(), { key: "Enter" });
    type(getInput(), "half-typed");
    expect((getInput() as HTMLInputElement).value).toBe("half-typed");

    fireEvent.blur(getInput());
    expect((getInput() as HTMLInputElement).value).toBe("committed");
  });

  it("calls onResultSelect when a suggestion is clicked", async () => {
    const onResultSelect = jest.fn();
    render(
      <LiveSearchBox
        placeholder={PLACEHOLDER}
        onResultSelect={onResultSelect}
        onSearchTriggered={jest
          .fn()
          .mockResolvedValue(categories("Locations", "Paris"))}
      />,
    );
    type(getInput(), "par");
    await flushSearch();

    const item = await screen.findByText("Paris");
    fireEvent.click(item);
    expect(onResultSelect).toHaveBeenCalledTimes(1);
    expect(onResultSelect.mock.calls[0][0].result).toMatchObject({
      title: "Paris",
    });
    // Selecting a result resets the box.
    expect((getInput() as HTMLInputElement).value).toBe("");
  });

  it("survives a suggestion click with no onResultSelect handler", async () => {
    render(
      <LiveSearchBox
        placeholder={PLACEHOLDER}
        onSearchTriggered={jest
          .fn()
          .mockResolvedValue(categories("Locations", "Berlin"))}
      />,
    );
    type(getInput(), "ber");
    await flushSearch();
    fireEvent.click(await screen.findByText("Berlin"));
    expect((getInput() as HTMLInputElement).value).toBe("");
  });
});
