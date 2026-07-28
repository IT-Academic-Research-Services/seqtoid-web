import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import SearchBox from "~/components/ui/controls/SearchBox";

// Keeps prettier's organize-imports plugin from dropping the React import that
// Jest's classic JSX runtime needs in scope (see jest/uiControls.test.tsx).
const _React: typeof React = React;

const mockGet = jest.fn();
jest.mock("~/api/core", () => ({
  get: (...args: unknown[]) => mockGet(...args),
}));

const PLACEHOLDER = "Search taxa";

const clientSource = [
  { title: "Klebsiella pneumoniae", id: 573 },
  { title: "Escherichia coli", id: 562 },
  { title: "Klebsiella oxytoca", id: 571 },
];

const type = (input: HTMLElement, value: string) =>
  fireEvent.change(input, { target: { value } });

const getInput = () => screen.getByPlaceholderText(PLACEHOLDER);

// semantic-ui's <Search> renders each result title in a .title node.
const resultTitles = (container: HTMLElement) =>
  Array.from(container.querySelectorAll(".results .title")).map(
    node => node.textContent,
  );

describe("SearchBox", () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  describe("client-side search", () => {
    it("renders the initial value in the input", () => {
      render(
        <SearchBox
          placeholder={PLACEHOLDER}
          initialValue="Klebsiella"
          clientSearchSource={clientSource}
          onResultSelect={jest.fn()}
        />,
      );
      expect((getInput() as HTMLInputElement).value).toBe("Klebsiella");
    });

    it("renders an empty string (not null) when no initial value is given", () => {
      render(
        <SearchBox
          placeholder={PLACEHOLDER}
          clientSearchSource={clientSource}
          onResultSelect={jest.fn()}
        />,
      );
      expect((getInput() as HTMLInputElement).value).toBe("");
    });

    it("filters the client source case-insensitively", () => {
      const { container } = render(
        <SearchBox
          placeholder={PLACEHOLDER}
          clientSearchSource={clientSource}
          onResultSelect={jest.fn()}
        />,
      );
      type(getInput(), "klebsi");
      expect(resultTitles(container)).toEqual([
        "Klebsiella pneumoniae",
        "Klebsiella oxytoca",
      ]);
    });

    it("does not search until the minimum character count is reached", () => {
      const { container } = render(
        <SearchBox
          placeholder={PLACEHOLDER}
          clientSearchSource={clientSource}
          onResultSelect={jest.fn()}
        />,
      );
      // 1 char is below minChars (2): value updates, but no results render.
      type(getInput(), "k");
      expect((getInput() as HTMLInputElement).value).toBe("k");
      expect(resultTitles(container)).toEqual([]);
    });

    it("clears results when the query is emptied", () => {
      const { container } = render(
        <SearchBox
          placeholder={PLACEHOLDER}
          clientSearchSource={clientSource}
          onResultSelect={jest.fn()}
        />,
      );
      type(getInput(), "coli");
      expect(resultTitles(container)).toEqual(["Escherichia coli"]);
      type(getInput(), "");
      expect(resultTitles(container)).toEqual([]);
      expect((getInput() as HTMLInputElement).value).toBe("");
    });

    it("escapes regex metacharacters in the query rather than treating them as a pattern", () => {
      const { container } = render(
        <SearchBox
          placeholder={PLACEHOLDER}
          clientSearchSource={[{ title: "E. coli (K12)" }, { title: "Excoli" }]}
          onResultSelect={jest.fn()}
        />,
      );
      // "E." would match "Ex" if the dot were left as a regex wildcard.
      type(getInput(), "E.");
      expect(resultTitles(container)).toEqual(["E. coli (K12)"]);
    });
  });

  describe("result selection", () => {
    it("keeps the selected title in the input and forwards the result", () => {
      const onResultSelect = jest.fn();
      const { container } = render(
        <SearchBox
          placeholder={PLACEHOLDER}
          clientSearchSource={clientSource}
          onResultSelect={onResultSelect}
        />,
      );
      type(getInput(), "coli");
      fireEvent.click(container.querySelector(".results .result"));

      expect(onResultSelect).toHaveBeenCalledTimes(1);
      expect(onResultSelect.mock.calls[0][1].result.title).toBe(
        "Escherichia coli",
      );
      expect((getInput() as HTMLInputElement).value).toBe("Escherichia coli");
    });

    it("clears the input on select when clearOnSelect is set", () => {
      const { container } = render(
        <SearchBox
          placeholder={PLACEHOLDER}
          clientSearchSource={clientSource}
          clearOnSelect
          onResultSelect={jest.fn()}
        />,
      );
      type(getInput(), "coli");
      fireEvent.click(container.querySelector(".results .result"));
      expect((getInput() as HTMLInputElement).value).toBe("");
    });
  });

  describe("Enter key handling", () => {
    it("calls onEnter and closes the dropdown while keeping the typed text", () => {
      const onEnter = jest.fn();
      const { container } = render(
        <SearchBox
          placeholder={PLACEHOLDER}
          clientSearchSource={clientSource}
          onResultSelect={jest.fn()}
          onEnter={onEnter}
        />,
      );
      type(getInput(), "coli");
      fireEvent.keyDown(getInput(), { key: "Enter" });

      expect(onEnter).toHaveBeenCalledTimes(1);
      // resetComponent() drops the results but preserves the entered text.
      expect(resultTitles(container)).toEqual([]);
      expect((getInput() as HTMLInputElement).value).toBe("coli");
    });

    it("ignores non-Enter keys", () => {
      const onEnter = jest.fn();
      render(
        <SearchBox
          placeholder={PLACEHOLDER}
          clientSearchSource={clientSource}
          onResultSelect={jest.fn()}
          onEnter={onEnter}
        />,
      );
      type(getInput(), "coli");
      fireEvent.keyDown(getInput(), { key: "a" });
      expect(onEnter).not.toHaveBeenCalled();
    });

    it("does nothing on Enter when no onEnter handler is provided", () => {
      const { container } = render(
        <SearchBox
          placeholder={PLACEHOLDER}
          clientSearchSource={clientSource}
          onResultSelect={jest.fn()}
        />,
      );
      type(getInput(), "coli");
      fireEvent.keyDown(getInput(), { key: "Enter" });
      // Without onEnter the component must NOT reset -- results stay open.
      expect(resultTitles(container)).toEqual(["Escherichia coli"]);
    });
  });

  describe("server-side search", () => {
    // Real timers on purpose: the debounce comes from lodash, which compares
    // Date.now() timestamps. Jest 26's default (legacy) fake timers do not mock
    // Date.now, so an advanceTimersByTime() only makes lodash reschedule and the
    // request never fires.
    const flush = async () => {
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 260)); // > 200ms debounce
      });
    };

    it("debounces the request and renders the server results", async () => {
      mockGet.mockResolvedValue([{ title: "Salmonella", level: "genus" }]);
      const { container } = render(
        <SearchBox
          placeholder={PLACEHOLDER}
          serverSearchAction="search_suggestions"
          onResultSelect={jest.fn()}
        />,
      );

      type(getInput(), "salm");
      type(getInput(), "salmo");
      expect(mockGet).not.toHaveBeenCalled(); // still inside the debounce window

      await flush();

      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(mockGet).toHaveBeenCalledWith("/search_suggestions?query=salmo");
      expect(resultTitles(container)).toEqual(["Salmonella"]);
    });

    it("appends serverSearchActionArgs to the query string", async () => {
      mockGet.mockResolvedValue([]);
      render(
        <SearchBox
          placeholder={PLACEHOLDER}
          serverSearchAction="search_suggestions"
          serverSearchActionArgs={{ projectId: 4 }}
          onResultSelect={jest.fn()}
        />,
      );

      type(getInput(), "salmo");
      await flush();

      expect(mockGet).toHaveBeenCalledWith(
        "/search_suggestions?query=salmo&projectId=4",
      );
    });

    it("suffixes each result title with its level when levelLabel is set", async () => {
      mockGet.mockResolvedValue([
        { title: "Salmonella", level: "genus" },
        { title: "Salmonella enterica", level: "species" },
      ]);
      const { container } = render(
        <SearchBox
          placeholder={PLACEHOLDER}
          serverSearchAction="search_suggestions"
          levelLabel
          onResultSelect={jest.fn()}
        />,
      );

      type(getInput(), "salmo");
      await flush();

      expect(resultTitles(container)).toEqual([
        "Salmonella (genus)",
        "Salmonella enterica (species)",
      ]);
    });

    it("never calls the server for a query shorter than the minimum", async () => {
      mockGet.mockResolvedValue([]);
      render(
        <SearchBox
          placeholder={PLACEHOLDER}
          serverSearchAction="search_suggestions"
          onResultSelect={jest.fn()}
        />,
      );

      type(getInput(), "s");
      await flush();

      expect(mockGet).not.toHaveBeenCalled();
    });
  });
});
