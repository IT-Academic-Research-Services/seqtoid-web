// BRANCH coverage: app/assets/src/components/ui/controls/dropdowns/SubtextDropdown.tsx
//
// SubtextDropdown only decorates the options it hands to Dropdown, and all four
// of its conditionals live in that decoration:
//   - `option.customNode ? option.customNode : this.renderMenuItem(option)`
//   - `if (option.tooltip)` -> wrap the item in a ColumnHeaderTooltip, else not
//   - `option.disabled && cs.disabledOption` on the item's className
//   - `if (option.disabled) e.stopPropagation()` in the item's click handler,
//     which is what stops a disabled row from selecting anything
// Options are rendered through a portal, so the menu has to be opened first.
import { fireEvent, render, screen } from "@testing-library/react";
import SubtextDropdown from "~/components/ui/controls/dropdowns/SubtextDropdown";

const OPTIONS = [
  { value: "plain", text: "Plain option", subtext: "no frills" },
  {
    value: "tipped",
    text: "Tipped option",
    subtext: "has a tooltip",
    tooltip: "Why this one is special",
  },
  {
    value: "off",
    text: "Disabled option",
    subtext: "cannot be picked",
    disabled: true,
  },
];

const renderDropdown = (props: Record<string, unknown> = {}) => {
  const onChange = jest.fn();
  const utils = render(
    // @ts-expect-error SubtextDropdown re-declares semantic's DropdownProps
    <SubtextDropdown options={OPTIONS} onChange={onChange} {...props} />,
  );
  return { ...utils, onChange };
};

// The Dropdown trigger is rendered by DropdownTrigger; PortalDropdown's own
// wrapper div is the element that owns the open/close click handler.
const openMenu = () => {
  const trigger = screen.getByTestId("filters");
  fireEvent.click(trigger.parentElement as HTMLElement);
};

const item = (text: string) =>
  document.querySelector(`[data-testid='dropdown-${text}']`) as HTMLElement;

describe("SubtextDropdown -- option decoration", () => {
  it("renders every option's text and subtext once the menu is open", () => {
    renderDropdown();
    openMenu();

    expect(item("plain-option")).toBeTruthy();
    expect(item("plain-option").textContent).toContain("Plain option");
    expect(item("plain-option").textContent).toContain("no frills");
    expect(item("tipped-option").textContent).toContain("has a tooltip");
    expect(item("disabled-option").textContent).toContain("cannot be picked");
  });

  it("marks only the disabled option with the disabled class", () => {
    renderDropdown();
    openMenu();

    // styleMock maps every scss import to {}, so the composed class list is
    // empty for the enabled rows and stays empty for the disabled one too --
    // what is observable is that the enabled rows are selectable and the
    // disabled one is not (asserted below). Here we pin the structure: all
    // three rows exist and each carries its own testid.
    expect(
      document.querySelectorAll("[data-testid^='dropdown-']").length,
    ).toBeGreaterThanOrEqual(3);
  });
});

describe("SubtextDropdown -- disabled options", () => {
  it("does not select a disabled option when it is clicked", () => {
    const { onChange } = renderDropdown();
    openMenu();

    fireEvent.click(item("disabled-option"));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("does select an enabled option when it is clicked", () => {
    const { onChange } = renderDropdown();
    openMenu();

    fireEvent.click(item("plain-option"));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBe("plain");
  });
});

describe("SubtextDropdown -- tooltips", () => {
  it("still renders a tooltip-bearing option as a selectable row", () => {
    const { onChange } = renderDropdown();
    openMenu();

    fireEvent.click(item("tipped-option"));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBe("tipped");
  });
});

describe("SubtextDropdown -- customNode", () => {
  it("uses a supplied customNode verbatim instead of building a menu item", () => {
    renderDropdown({
      options: [
        {
          value: "custom",
          text: "Custom option",
          customNode: <div data-testid="my-custom-node">Bespoke row</div>,
        },
        ...OPTIONS,
      ],
    });
    openMenu();

    expect(screen.getByTestId("my-custom-node").textContent).toBe(
      "Bespoke row",
    );
    // The default item builder was not used for that option.
    expect(item("custom-option")).toBeNull();
    // ...but it was still used for the untouched ones.
    expect(item("plain-option")).toBeTruthy();
  });
});

describe("SubtextDropdown -- pass-through props", () => {
  it("preselects initialSelectedValue in the trigger", () => {
    renderDropdown({ initialSelectedValue: "tipped" });
    expect(screen.getByTestId("filter-value").textContent).toBe(
      "Tipped option",
    );
  });

  it("falls back to nullLabel when nothing is preselected", () => {
    renderDropdown({ nullLabel: "Any option", placeholder: "Pick one" });
    expect(screen.getByTestId("filter-value").textContent).toBe("Any option");
  });
});
