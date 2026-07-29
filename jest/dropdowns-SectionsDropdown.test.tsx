// Coverage for
// app/assets/src/components/ui/controls/dropdowns/SectionsDropdown.tsx
//
// SectionsDropdown turns a { category: { displayName, options[] } } map into a
// sectioned BareDropdown: a header + item + divider per category (last divider
// popped), an optional leading "None" option, tooltip-wrapped items, and an
// "empty section" placeholder when a category has no options. The trigger text
// comes from itemIdToName / nullLabel. BareDropdown and its sub-components are
// stubbed with minimal harnesses that render the computed `items`/`trigger` so
// the item-building, onChange-guarding and trigger branches all run for real.
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import SectionsDropdown from "~/components/ui/controls/dropdowns/SectionsDropdown";

let lastBareDropdownProps: $TSFixMe = null;

jest.mock("~ui/controls/dropdowns/BareDropdown", () => {
  const ReactLib = require("react");
  const BareDropdown = (props: $TSFixMe) => {
    lastBareDropdownProps = props;
    return ReactLib.createElement(
      "div",
      { "data-testid": "bare-dropdown", "data-search": String(!!props.search) },
      ReactLib.createElement(
        "div",
        { "data-testid": "trigger" },
        props.trigger,
      ),
      ReactLib.createElement("div", { "data-testid": "items" }, props.items),
    );
  };
  BareDropdown.Item = (props: $TSFixMe) =>
    ReactLib.createElement(
      "button",
      { className: props.className, onClick: props.onClick },
      props.children,
    );
  BareDropdown.Header = (props: $TSFixMe) =>
    ReactLib.createElement(
      "div",
      { "data-testid": "section-header" },
      props.content,
    );
  BareDropdown.Divider = () =>
    ReactLib.createElement("hr", { "data-testid": "divider" });
  return { __esModule: true, default: BareDropdown };
});

jest.mock("~/components/ui/controls/dropdowns/common/DropdownTrigger", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: (props: $TSFixMe) =>
      ReactLib.createElement(
        "div",
        { "data-testid": "dropdown-trigger" },
        `${props.label}${props.value ?? ""}`,
      ),
  };
});

jest.mock("~ui/containers/ColumnHeaderTooltip", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: (props: $TSFixMe) =>
      ReactLib.createElement(
        "div",
        { "data-testid": "tooltip", "data-content": props.content },
        props.trigger,
      ),
  };
});

const _React: typeof React = React;

const categories = {
  cat1: {
    displayName: "Category One",
    options: [
      { text: "Alpha", value: "a", subtext: "first" },
      { text: "Beta", value: "b", disabled: true },
      { text: "Gamma", value: "g", tooltip: "a helpful tip" },
    ],
  },
  empty: {
    displayName: "Empty Category",
    emptySectionMessage: "Nothing here",
    options: [],
  },
};

describe("SectionsDropdown", () => {
  beforeEach(() => {
    lastBareDropdownProps = null;
  });

  it("renders a header per category and calls onChange when an enabled option is clicked", () => {
    const onChange = jest.fn();
    render(
      <SectionsDropdown
        categories={categories as $TSFixMe}
        onChange={onChange}
      />,
    );

    expect(screen.getByText("Category One")).toBeTruthy();
    expect(screen.getByText("Empty Category")).toBeTruthy();

    fireEvent.click(screen.getByText("Alpha"));
    expect(onChange).toHaveBeenCalledWith("a");
  });

  it("does not call onChange when a disabled option is clicked", () => {
    const onChange = jest.fn();
    render(
      <SectionsDropdown
        categories={categories as $TSFixMe}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText("Beta"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("wraps options that declare a tooltip in a ColumnHeaderTooltip", () => {
    render(
      <SectionsDropdown
        categories={categories as $TSFixMe}
        onChange={jest.fn()}
      />,
    );
    const tooltip = screen.getByTestId("tooltip");
    expect(tooltip.getAttribute("data-content")).toBe("a helpful tip");
    expect(tooltip.textContent).toContain("Gamma");
  });

  it("renders the empty-section placeholder for a category with no options", () => {
    render(
      <SectionsDropdown
        categories={categories as $TSFixMe}
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByText("Nothing here")).toBeTruthy();
  });

  it("prepends a None option and records it in itemIdToName when requested", () => {
    const itemIdToName: Record<string, string> = {};
    render(
      <SectionsDropdown
        categories={categories as $TSFixMe}
        onChange={jest.fn()}
        shouldIncludeNoneOption
        itemIdToName={itemIdToName}
      />,
    );
    expect(screen.getByText("None")).toBeTruthy();
    // addNoneOption mutates the passed itemIdToName map.
    expect(Object.values(itemIdToName)).toContain("None");
  });

  it("shows the mapped name in the trigger when a value is selected", () => {
    render(
      <SectionsDropdown
        categories={categories as $TSFixMe}
        onChange={jest.fn()}
        selectedValue="a"
        itemIdToName={{ a: "Alpha Name" }}
        label="Metric"
      />,
    );
    expect(screen.getByTestId("dropdown-trigger").textContent).toContain(
      "Alpha Name",
    );
    expect(screen.getByTestId("dropdown-trigger").textContent).toContain(
      "Metric:",
    );
  });

  it("falls back to nullLabel in the trigger when nothing is selected", () => {
    render(
      <SectionsDropdown
        categories={categories as $TSFixMe}
        onChange={jest.fn()}
        nullLabel="Pick one"
      />,
    );
    expect(screen.getByTestId("dropdown-trigger").textContent).toContain(
      "Pick one",
    );
  });

  it("builds search strings and forwards the search flag when search is enabled", () => {
    render(
      <SectionsDropdown
        categories={categories as $TSFixMe}
        onChange={jest.fn()}
        search
      />,
    );
    expect(
      screen.getByTestId("bare-dropdown").getAttribute("data-search"),
    ).toBe("true");
    expect(lastBareDropdownProps.itemSearchStrings).toEqual(
      expect.arrayContaining(["Alpha", "Beta", "Gamma"]),
    );
  });
});
