import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import BareDropdown from "~/components/ui/controls/dropdowns/BareDropdown";

// Keeps prettier's organize-imports plugin from dropping the React import that
// Jest's classic JSX runtime needs in scope (see jest/uiControls.test.tsx).
const _React: typeof React = React;

const trigger = <button>Open</button>;

const OPTIONS = [
  { value: "a", text: "Alpha" },
  { value: "b", text: "Beta gamma" },
  { value: "g", text: "Gamma ray" },
];

// The scss modules are stubbed to {} in jest, so class names from `cs` are not
// assertable. Options rendered the default way carry
// data-testid={kebabCase(option.text)}, which is what these tests key off.
const menuItemTexts = () => {
  const menu = document.querySelector("[data-testid='dropdown-menu']");
  return Array.from(menu ? menu.children : []).map(n => n.textContent);
};

const typeInFilter = (value: string) =>
  fireEvent.change(screen.getByPlaceholderText("Search"), {
    target: { value },
  });

describe("BareDropdown", () => {
  describe("children mode (no options and no items)", () => {
    it("renders arbitrary children inside the menu", () => {
      render(
        <BareDropdown trigger={trigger}>
          <div data-testid="custom-content">anything at all</div>
        </BareDropdown>,
      );
      expect(screen.getByText("Open")).toBeTruthy();
      expect(screen.getByTestId("custom-content").textContent).toBe(
        "anything at all",
      );
      // The options/items menu is not built in this mode.
      expect(
        document.querySelector("[data-testid='dropdown-menu']"),
      ).toBeNull();
    });
  });

  it("throws when both options and items are provided", () => {
    // React logs the thrown render error; silence it for this assertion.
    const spy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    expect(() =>
      render(
        <BareDropdown
          trigger={trigger}
          options={OPTIONS}
          items={[<BareDropdown.Item key="x">X</BareDropdown.Item>]}
        />,
      ),
    ).toThrow("Only one of options or items should be provided");
    spy.mockRestore();
  });

  describe("options mode", () => {
    it("renders one item per option, in order, with kebab-cased test ids", () => {
      render(
        <BareDropdown
          trigger={trigger}
          options={OPTIONS}
          onChange={jest.fn()}
        />,
      );
      expect(menuItemTexts()).toEqual(["Alpha", "Beta gamma", "Gamma ray"]);
      expect(screen.getByTestId("alpha")).toBeTruthy();
      expect(screen.getByTestId("beta-gamma")).toBeTruthy();
    });

    it("calls onChange with the option value when an option is clicked", () => {
      const onChange = jest.fn();
      render(
        <BareDropdown
          trigger={trigger}
          options={OPTIONS}
          onChange={onChange}
        />,
      );
      fireEvent.click(screen.getByTestId("gamma-ray"));
      expect(onChange).toHaveBeenCalledWith("g");
    });

    it("marks the option matching `value` as active", () => {
      render(
        <BareDropdown
          trigger={trigger}
          options={OPTIONS}
          value="b"
          onChange={jest.fn()}
        />,
      );
      expect(screen.getByTestId("beta-gamma").className).toContain("active");
      expect(screen.getByTestId("alpha").className).not.toContain("active");
    });

    it("renders a disabled option as disabled", () => {
      render(
        <BareDropdown
          trigger={trigger}
          options={[{ value: "a", text: "Alpha", disabled: true }]}
          onChange={jest.fn()}
        />,
      );
      expect(screen.getByTestId("alpha").className).toContain("disabled");
    });

    it("renders a customNode option instead of the default item and still fires onChange", () => {
      const onChange = jest.fn();
      render(
        <BareDropdown
          trigger={trigger}
          options={[
            {
              value: "c",
              text: "Custom",
              customNode: <span data-testid="custom-node">Custom node</span>,
            },
          ]}
          onChange={onChange}
        />,
      );
      // No default BaseDropdown.Item test id is emitted for customNode options.
      expect(screen.queryByTestId("custom")).toBeNull();
      fireEvent.click(screen.getByTestId("custom-node"));
      expect(onChange).toHaveBeenCalledWith("c");
    });
  });

  describe("search filtering over options", () => {
    const renderSearchable = (extra = {}) =>
      render(
        <BareDropdown
          trigger={trigger}
          search
          options={OPTIONS}
          onChange={jest.fn()}
          {...extra}
        />,
      );

    it("shows every option before anything is typed", () => {
      renderSearchable();
      expect(screen.getByTestId("filter-search-bar")).toBeTruthy();
      expect(menuItemTexts()).toEqual(["Alpha", "Beta gamma", "Gamma ray"]);
    });

    it("filters case-insensitively on the option text", () => {
      renderSearchable();
      typeInFilter("ALP");
      expect(menuItemTexts()).toEqual(["Alpha"]);
    });

    it("sorts prefix matches ahead of mid-string matches", () => {
      renderSearchable();
      typeInFilter("gamma");
      // "Gamma ray" starts with the query, "Beta gamma" only contains it.
      expect(menuItemTexts()).toEqual(["Gamma ray", "Beta gamma"]);
    });

    it("notifies onFilterChange with each filter string", () => {
      const onFilterChange = jest.fn();
      renderSearchable({ onFilterChange });
      typeInFilter("be");
      expect(onFilterChange).toHaveBeenCalledWith("be");
    });

    it("shows the no-results message only when enabled and not loading", () => {
      const { rerender } = renderSearchable({ showNoResultsMessage: true });
      typeInFilter("zzz");
      expect(menuItemTexts()).toEqual([]);
      expect(screen.getByText("No results found.")).toBeTruthy();

      rerender(
        <BareDropdown
          trigger={trigger}
          search
          options={OPTIONS}
          onChange={jest.fn()}
          showNoResultsMessage
          isLoadingSearchOptions
        />,
      );
      expect(screen.queryByText("No results found.")).toBeNull();
    });

    it("hides the no-results message when showNoResultsMessage is not set", () => {
      renderSearchable();
      typeInFilter("zzz");
      expect(screen.queryByText("No results found.")).toBeNull();
    });

    it("shows a Searching indicator while search options are loading", () => {
      const { rerender } = renderSearchable({ isLoadingSearchOptions: false });
      expect(screen.queryByText("Searching...")).toBeNull();

      rerender(
        <BareDropdown
          trigger={trigger}
          search
          options={OPTIONS}
          onChange={jest.fn()}
          isLoadingSearchOptions
        />,
      );
      // The indicator shows even when there are stale options still displayed.
      expect(screen.getByText("Searching...")).toBeTruthy();
      expect(menuItemTexts()).toEqual(["Alpha", "Beta gamma", "Gamma ray"]);
    });

    it("renders the menu label when provided", () => {
      renderSearchable({ menuLabel: "Pick one" });
      expect(screen.getByText("Pick one")).toBeTruthy();
    });

    it("renders an options header above the item list", () => {
      renderSearchable({
        optionsHeader: <span data-testid="options-header">Header</span>,
      });
      expect(screen.getByTestId("options-header")).toBeTruthy();
    });
  });

  describe("items mode", () => {
    const items = [
      <BareDropdown.Item key="a">Alpha</BareDropdown.Item>,
      <BareDropdown.Item key="b">Beta gamma</BareDropdown.Item>,
      <BareDropdown.Item key="g">Gamma ray</BareDropdown.Item>,
    ];
    const itemSearchStrings = ["Alpha", "Beta gamma", "Gamma ray"];

    it("renders the pre-rendered items untouched when no filter is typed", () => {
      render(<BareDropdown trigger={trigger} search items={items} />);
      expect(menuItemTexts()).toEqual(["Alpha", "Beta gamma", "Gamma ray"]);
    });

    it("filters items using the parallel itemSearchStrings array", () => {
      render(
        <BareDropdown
          trigger={trigger}
          search
          items={items}
          itemSearchStrings={itemSearchStrings}
        />,
      );
      typeInFilter("gamma");
      expect(menuItemTexts()).toEqual(["Gamma ray", "Beta gamma"]);
    });

    it("drops every item when nothing matches the search strings", () => {
      render(
        <BareDropdown
          trigger={trigger}
          search
          items={items}
          itemSearchStrings={itemSearchStrings}
        />,
      );
      typeInFilter("nothing-matches");
      expect(menuItemTexts()).toEqual([]);
    });

    it("regroups search results under their sections and reports empty sections", () => {
      render(
        <BareDropdown
          trigger={trigger}
          search
          items={items}
          itemSearchStrings={itemSearchStrings}
          sections={{
            Greek: new Set(["Alpha", "Beta gamma"]),
            Rays: new Set(["Gamma ray"]),
          }}
        />,
      );
      typeInFilter("alpha");
      const texts = menuItemTexts();
      expect(texts).toContain("Greek");
      expect(texts).toContain("Alpha");
      expect(texts).toContain("Rays");
      // The section with no match gets an explicit empty-state row.
      expect(texts).toContain("There are no results matching your search.");
    });
  });

  describe("menu click behaviour", () => {
    it("closes the dropdown on item click when closeOnClick is left at its default", () => {
      render(
        <BareDropdown
          trigger={trigger}
          options={OPTIONS}
          onChange={jest.fn()}
        />,
      );
      fireEvent.click(screen.getByText("Open"));
      expect(document.querySelector(".dropdown.active")).toBeTruthy();
      fireEvent.click(screen.getByTestId("alpha"));
      expect(document.querySelector(".dropdown.active")).toBeNull();
    });

    it("keeps the dropdown open on item click when closeOnClick is false", () => {
      render(
        <BareDropdown
          trigger={trigger}
          options={OPTIONS}
          onChange={jest.fn()}
          closeOnClick={false}
        />,
      );
      fireEvent.click(screen.getByText("Open"));
      expect(document.querySelector(".dropdown.active")).toBeTruthy();
      fireEvent.click(screen.getByTestId("alpha"));
      // stopPropagation in handleMenuClick keeps semantic-ui from closing it.
      expect(document.querySelector(".dropdown.active")).toBeTruthy();
    });
  });

  describe("arrow rendering", () => {
    it("renders the chevron icon by default", () => {
      const { container } = render(
        <BareDropdown
          trigger={trigger}
          options={OPTIONS}
          onChange={jest.fn()}
        />,
      );
      expect(container.querySelector("svg")).toBeTruthy();
    });

    it("renders no chevron when hideArrow is set", () => {
      const { container } = render(
        <BareDropdown
          trigger={trigger}
          options={OPTIONS}
          onChange={jest.fn()}
          hideArrow
        />,
      );
      expect(container.querySelector("svg")).toBeNull();
    });
  });

  describe("portal mode", () => {
    it("renders the menu into a document-body portal only once opened", () => {
      render(
        <BareDropdown
          trigger={trigger}
          options={OPTIONS}
          onChange={jest.fn()}
          usePortal
        />,
      );
      expect(screen.getByText("Open")).toBeTruthy();
      expect(
        document.querySelector("[data-testid='dropdown-menu']"),
      ).toBeNull();

      fireEvent.click(screen.getByText("Open"));
      expect(
        document.querySelector("[data-testid='dropdown-menu']"),
      ).toBeTruthy();
      expect(menuItemTexts()).toEqual(["Alpha", "Beta gamma", "Gamma ray"]);
    });

    it("does not open a disabled portal dropdown", () => {
      render(
        <BareDropdown
          trigger={trigger}
          options={OPTIONS}
          onChange={jest.fn()}
          usePortal
          disabled
        />,
      );
      fireEvent.click(screen.getByText("Open"));
      expect(
        document.querySelector("[data-testid='dropdown-menu']"),
      ).toBeNull();
    });
  });
});
