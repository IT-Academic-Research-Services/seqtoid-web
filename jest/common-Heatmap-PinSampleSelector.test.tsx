// Coverage: app/assets/src/components/common/Heatmap/PinSampleSelector.tsx
//
// The component wraps an SDS DropdownMenu and owns three small handlers:
// handleApply / handleCancel (each of which must also close the menu) and
// handleClose, which deliberately swallows the "blur" and "toggleInput"
// reasons so the menu stays open while the user is searching. The SDS
// DropdownMenu/Button are stubbed so those handlers can be driven directly
// and the props handed to the menu can be inspected.
import { fireEvent, render, screen } from "@testing-library/react";

let lastMenuProps: $TSFixMe = null;
jest.mock("@czi-sds/components", () => {
  const ReactLib = require("react");
  return {
    DropdownMenu: (props: $TSFixMe) => {
      lastMenuProps = props;
      return ReactLib.createElement(
        "div",
        {
          "data-testid": "dropdown-menu",
          "data-open": String(props.open),
          "data-title": props.title,
          "data-options": JSON.stringify(props.options),
          "data-value": JSON.stringify(props.value),
        },
        props.children,
      );
    },
    Button: ({ children, onClick }: $TSFixMe) =>
      ReactLib.createElement("button", { onClick }, children),
  };
});

import PinSampleSelector from "~/components/common/Heatmap/PinSampleSelector";

const OPTIONS = [
  { id: 1, name: "Sample One", pinned: false },
  { id: 2, name: "Sample Two", pinned: true },
];

function renderSelector(overrides: $TSFixMe = {}) {
  const handlers = {
    onApply: jest.fn(),
    onCancel: jest.fn(),
    onClose: jest.fn(),
    onSelectionChange: jest.fn(),
  };
  const props = {
    ...handlers,
    options: OPTIONS,
    selectedSamples: [2],
    selectSampleTrigger: document.createElement("div"),
    ...overrides,
  };
  render(<PinSampleSelector {...props} />);
  return handlers;
}

describe("PinSampleSelector", () => {
  beforeEach(() => {
    lastMenuProps = null;
  });

  it("renders an open menu seeded with the options and current selection", () => {
    renderSelector();

    const menu = screen.getByTestId("dropdown-menu");
    expect(menu.getAttribute("data-open")).toBe("true");
    expect(menu.getAttribute("data-title")).toBe("Select Samples to Pin");
    expect(JSON.parse(menu.getAttribute("data-options") as string)).toEqual(
      OPTIONS,
    );
    expect(JSON.parse(menu.getAttribute("data-value") as string)).toEqual([2]);
    expect(screen.getByText("Apply")).toBeTruthy();
    expect(screen.getByText("Cancel")).toBeTruthy();
  });

  it("applies and closes when Apply is clicked", () => {
    const { onApply, onCancel, onClose } = renderSelector();

    fireEvent.click(screen.getByText("Apply"));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancels and closes when Cancel is clicked", () => {
    const { onApply, onCancel, onClose } = renderSelector();

    fireEvent.click(screen.getByText("Cancel"));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("ignores blur and toggleInput close reasons", () => {
    const { onClose } = renderSelector();

    lastMenuProps.onClose({}, "blur");
    expect(onClose).not.toHaveBeenCalled();

    lastMenuProps.onClose({}, "toggleInput");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes for any other close reason", () => {
    const { onClose } = renderSelector();

    lastMenuProps.onClose({}, "escapeKeyDown");
    expect(onClose).toHaveBeenCalledTimes(1);

    lastMenuProps.onClose({}, "backdropClick");
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("passes selection changes straight through to onSelectionChange", () => {
    const { onSelectionChange } = renderSelector();

    expect(lastMenuProps.onChange).toBe(onSelectionChange);
    expect(lastMenuProps.multiple).toBe(true);
    expect(lastMenuProps.disableCloseOnSelect).toBe(true);
  });

  it("matches options against selected ids by id", () => {
    renderSelector();

    expect(lastMenuProps.isOptionEqualToValue(OPTIONS[1], 2)).toBe(true);
    expect(lastMenuProps.isOptionEqualToValue(OPTIONS[0], 2)).toBe(false);
  });

  it("renders an empty menu when there are no options or selections", () => {
    renderSelector({ options: [], selectedSamples: [] });

    const menu = screen.getByTestId("dropdown-menu");
    expect(JSON.parse(menu.getAttribute("data-options") as string)).toEqual([]);
    expect(JSON.parse(menu.getAttribute("data-value") as string)).toEqual([]);
  });
});
