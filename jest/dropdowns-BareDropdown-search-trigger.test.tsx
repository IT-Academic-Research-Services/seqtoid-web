// Coverage: app/assets/src/components/ui/controls/dropdowns/BareDropdown.tsx
//
// Complements jest/dropdowns-BareDropdown.test.tsx by driving the search-mode
// trigger wrapper (the cloneElement onClick that manually closes semantic-ui's
// dropdown and forwards the trigger's own onClick), the search branch of
// handleMenuClick, the section-filtering exclusions for headers/dividers/the
// "None" key/unsearchable items, and the arrow-style prop branches.
import { fireEvent, render, screen } from "@testing-library/react";
import BareDropdown from "~/components/ui/controls/dropdowns/BareDropdown";

const OPTIONS = [
  { value: "a", text: "Alpha" },
  { value: "b", text: "Beta gamma" },
];

const menuItemTexts = () => {
  const menu = document.querySelector("[data-testid='dropdown-menu']");
  return Array.from(menu ? menu.children : []).map(n => n.textContent);
};

const typeInFilter = (value: string) =>
  fireEvent.change(screen.getByPlaceholderText("Search"), {
    target: { value },
  });

const isOpen = () => Boolean(document.querySelector(".dropdown.active"));

describe("BareDropdown search-mode trigger", () => {
  it("forwards the trigger's own onClick when search wraps it", () => {
    const triggerClick = jest.fn();
    render(
      <BareDropdown
        trigger={<button onClick={triggerClick}>Open</button>}
        search
        options={OPTIONS}
        onChange={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Open"));
    expect(triggerClick).toHaveBeenCalledTimes(1);
  });

  it("tolerates a trigger with no onClick of its own", () => {
    render(
      <BareDropdown
        trigger={<button>Open</button>}
        search
        options={OPTIONS}
        onChange={jest.fn()}
      />,
    );
    // No throw, and the search box is reachable.
    fireEvent.click(screen.getByText("Open"));
    expect(screen.getByTestId("filter-search-bar")).toBeTruthy();
  });

  it("manually closes the already-open dropdown when the trigger is clicked again", () => {
    render(
      <BareDropdown
        trigger={<button>Open</button>}
        search
        options={OPTIONS}
        onChange={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Open"));
    expect(isOpen()).toBe(true);
    fireEvent.click(screen.getByText("Open"));
    expect(isOpen()).toBe(false);
  });

  it("closes the dropdown when a searchable menu item is clicked", () => {
    const onChange = jest.fn();
    render(
      <BareDropdown
        trigger={<button>Open</button>}
        search
        options={OPTIONS}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText("Open"));
    expect(isOpen()).toBe(true);

    fireEvent.click(screen.getByTestId("alpha"));
    expect(onChange).toHaveBeenCalledWith("a");
    // search + closeOnClick default => handleMenuClick closes it by hand.
    expect(isOpen()).toBe(false);
  });

  it("does not close a searchable dropdown when clicking the search box itself", () => {
    render(
      <BareDropdown
        trigger={<button>Open</button>}
        search
        options={OPTIONS}
        onChange={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Open"));
    fireEvent.click(screen.getByTestId("filter-search-bar"));
    expect(isOpen()).toBe(true);
  });
});

describe("BareDropdown section filtering exclusions", () => {
  const items = [
    <BareDropdown.Header key="hdr" content="Section header" />,
    <BareDropdown.Item key="0">None</BareDropdown.Item>,
    <BareDropdown.Item key="u" flag="unsearchable">
      Always here
    </BareDropdown.Item>,
    <BareDropdown.Item key="a">Alpha</BareDropdown.Item>,
    <BareDropdown.Item key="b">Beta gamma</BareDropdown.Item>,
    <BareDropdown.Divider key="div" />,
  ];

  const renderSectioned = () =>
    render(
      <BareDropdown
        trigger={<button>Open</button>}
        search
        items={items}
        itemSearchStrings={["Alpha", "Beta gamma"]}
        sections={{ Greek: new Set(["Alpha", "Beta gamma"]) }}
      />,
    );

  it("renders every item verbatim before a filter is typed", () => {
    renderSectioned();
    expect(menuItemTexts()).toEqual([
      "Section header",
      "None",
      "Always here",
      "Alpha",
      "Beta gamma",
      "",
    ]);
  });

  it("zips only the searchable items against itemSearchStrings", () => {
    renderSectioned();
    typeInFilter("alpha");
    // Headers, dividers, the "None" (key 0) row and unsearchable items are
    // excluded from the zip, so "Alpha" lines up with its own search string.
    const texts = menuItemTexts();
    expect(texts).toContain("Greek");
    expect(texts).toContain("Alpha");
    expect(texts).not.toContain("Beta gamma");
    expect(texts).not.toContain("Always here");
  });

  it("reports an empty section when nothing in it matches", () => {
    renderSectioned();
    typeInFilter("zzzz");
    expect(menuItemTexts()).toContain(
      "There are no results matching your search.",
    );
  });
});

describe("BareDropdown arrow style props", () => {
  it("renders the chevron when the arrow is placed inside the trigger", () => {
    const { container } = render(
      <BareDropdown
        trigger={<button>Open</button>}
        options={OPTIONS}
        onChange={jest.fn()}
        arrowInsideTrigger
      />,
    );
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("renders the chevron with the small-arrow modifier", () => {
    const { container } = render(
      <BareDropdown
        trigger={<button>Open</button>}
        options={OPTIONS}
        onChange={jest.fn()}
        smallArrow
      />,
    );
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("keeps the chevron out of children-mode when hideArrow is set", () => {
    const { container } = render(
      <BareDropdown trigger={<button>Open</button>} hideArrow>
        <div data-testid="child">child</div>
      </BareDropdown>,
    );
    expect(screen.getByTestId("child")).toBeTruthy();
    expect(container.querySelector("svg")).toBeNull();
  });
});

describe("BareDropdown portal passthrough", () => {
  it("forwards onOpen/onClose to the portal dropdown", () => {
    const onOpen = jest.fn();
    const onClose = jest.fn();
    render(
      <BareDropdown
        trigger={<button>Open</button>}
        options={OPTIONS}
        onChange={jest.fn()}
        usePortal
        onOpen={onOpen}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByText("Open"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(menuItemTexts()).toEqual(["Alpha", "Beta gamma"]);

    fireEvent.click(screen.getByText("Open"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders the search box inside a portal menu with autocomplete disabled", () => {
    render(
      <BareDropdown
        trigger={<button>Open</button>}
        options={OPTIONS}
        onChange={jest.fn()}
        usePortal
        search
        menuLabel="Pick one"
        disableAutocomplete
      />,
    );
    fireEvent.click(screen.getByText("Open"));
    const searchInput = screen.getByPlaceholderText(
      "Search",
    ) as HTMLInputElement;
    // Input's disableAutocomplete sets a non-standard token so browsers stop
    // matching the field against saved values.
    expect(searchInput.getAttribute("autocomplete")).toBe("idseq-ui");
    expect(screen.getByText("Pick one")).toBeTruthy();
  });
});
