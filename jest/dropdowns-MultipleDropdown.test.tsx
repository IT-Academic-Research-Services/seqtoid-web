import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import MultipleDropdown from "~/components/ui/controls/dropdowns/MultipleDropdown";

// Keeps prettier's organize-imports plugin from dropping the React import that
// Jest's classic JSX runtime needs in scope (see jest/uiControls.test.tsx).
const _React: typeof React = React;

const OPTIONS = [
  { value: "a", text: "Alpha" },
  { value: "b", text: "Beta" },
  { value: "c", text: "Gamma" },
];

// BareDropdown puts the rendered items inside the inner scrolling menu; each
// row is a CheckboxItem whose text content is the option label.
const itemLabels = () => {
  const menu = document.querySelector("[data-testid='dropdown-menu']");
  return Array.from(menu ? menu.children : []).map(node => node.textContent);
};

const clickItem = (label: string) =>
  fireEvent.click(screen.getByTestId(`dropdown-${label.toLowerCase()}`));

// Each CheckboxItem renders a "checked" marker div whose class list gains the
// (stubbed-out) checked class; the scss mock makes classes unusable, so read
// checked-ness off the parallel option order instead by clicking and observing
// the onChange payload. For render-time assertions we use the counter label.
const counterText = () => screen.getByTestId("filter-value").textContent;

describe("MultipleDropdown", () => {
  it("renders one checkbox row per option", () => {
    render(
      <MultipleDropdown
        options={OPTIONS}
        onChange={jest.fn()}
        trigger={<button>Open</button>}
      />,
    );
    expect(itemLabels()).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("adds a clicked value to the selection and reports it", () => {
    const onChange = jest.fn();
    render(
      <MultipleDropdown
        options={OPTIONS}
        onChange={onChange}
        trigger={<button>Open</button>}
      />,
    );
    clickItem("Beta");
    expect(onChange).toHaveBeenCalledWith(["b"]);
  });

  it("accumulates multiple selections in click order", () => {
    const onChange = jest.fn();
    render(
      <MultipleDropdown
        options={OPTIONS}
        onChange={onChange}
        trigger={<button>Open</button>}
      />,
    );
    clickItem("Gamma");
    clickItem("Alpha");
    expect(onChange).toHaveBeenLastCalledWith(["c", "a"]);
  });

  it("removes an already-checked value when it is clicked again", () => {
    const onChange = jest.fn();
    render(
      <MultipleDropdown
        options={OPTIONS}
        value={["a", "b"]}
        onChange={onChange}
        trigger={<button>Open</button>}
      />,
    );
    clickItem("Alpha");
    expect(onChange).toHaveBeenCalledWith(["b"]);
  });

  it("does not blow up when no onChange handler is supplied", () => {
    render(
      <MultipleDropdown
        options={OPTIONS}
        onChange={undefined as $TSFixMe}
        trigger={<button>Open</button>}
      />,
    );
    clickItem("Alpha");
    // The row is still rendered afterwards, i.e. the click was handled.
    expect(itemLabels()).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  describe("derived state from props", () => {
    it("treats a null value prop as an empty selection (regression: #545)", () => {
      const onChange = jest.fn();
      render(
        <MultipleDropdown
          options={OPTIONS}
          value={null as $TSFixMe}
          onChange={onChange}
          checkedOnTop
          trigger={<button>Open</button>}
        />,
      );
      // handleOpen calls state.value.slice(); a null value used to crash here.
      fireEvent.click(screen.getByText("Open"));
      clickItem("Beta");
      expect(onChange).toHaveBeenCalledWith(["b"]);
    });

    it("re-syncs the selection when the value prop changes", () => {
      const onChange = jest.fn();
      const { rerender } = render(
        <MultipleDropdown
          options={OPTIONS}
          value={["a"]}
          label="Taxa"
          onChange={onChange}
        />,
      );
      expect(counterText()).toBe("1");

      rerender(
        <MultipleDropdown
          options={OPTIONS}
          value={["a", "b", "c"]}
          label="Taxa"
          onChange={onChange}
        />,
      );
      expect(counterText()).toBe("3");
    });
  });

  describe("trigger label", () => {
    it("appends a colon to the label and shows the count when something is selected", () => {
      render(
        <MultipleDropdown
          options={OPTIONS}
          value={["a", "b"]}
          label="Taxa"
          onChange={jest.fn()}
        />,
      );
      expect(screen.getByTestId("taxa-filter").textContent).toBe("Taxa:");
      expect(counterText()).toBe("2");
    });

    it("shows the bare label with no counter when nothing is selected", () => {
      render(
        <MultipleDropdown
          options={OPTIONS}
          label="Taxa"
          onChange={jest.fn()}
        />,
      );
      expect(screen.getByTestId("taxa-filter").textContent).toBe("Taxa");
      expect(counterText()).toBe("");
    });

    it("suppresses the colon and counter when hideCounter is set", () => {
      render(
        <MultipleDropdown
          options={OPTIONS}
          value={["a", "b"]}
          label="Taxa"
          hideCounter
          onChange={jest.fn()}
        />,
      );
      expect(screen.getByTestId("taxa-filter").textContent).toBe("Taxa");
      expect(counterText()).toBe("");
    });

    it("uses a custom trigger instead of the built-in one when provided", () => {
      render(
        <MultipleDropdown
          options={OPTIONS}
          label="Taxa"
          onChange={jest.fn()}
          trigger={<button>Custom trigger</button>}
        />,
      );
      expect(screen.getByText("Custom trigger")).toBeTruthy();
      expect(screen.queryByTestId("taxa-filter")).toBeNull();
    });
  });

  describe("checkedOnTop ordering", () => {
    it("floats the values that were checked when the menu opened to the top", () => {
      render(
        <MultipleDropdown
          options={OPTIONS}
          value={["c"]}
          checkedOnTop
          onChange={jest.fn()}
          trigger={<button>Open</button>}
        />,
      );
      fireEvent.click(screen.getByText("Open"));
      expect(itemLabels()).toEqual(["Gamma", "Alpha", "Beta"]);
    });

    it("does not reorder while the menu stays open, even as the selection changes", () => {
      const onChange = jest.fn();
      render(
        <MultipleDropdown
          options={OPTIONS}
          value={[]}
          checkedOnTop
          onChange={onChange}
          trigger={<button>Open</button>}
        />,
      );
      fireEvent.click(screen.getByText("Open"));
      expect(itemLabels()).toEqual(["Alpha", "Beta", "Gamma"]);
      clickItem("Gamma");
      // valueOnOpen is snapshotted at open time, so the order is stable.
      expect(itemLabels()).toEqual(["Alpha", "Beta", "Gamma"]);
    });

    it("ignores checked values that are not present in the option list", () => {
      render(
        <MultipleDropdown
          options={OPTIONS}
          value={["does-not-exist"]}
          checkedOnTop
          onChange={jest.fn()}
          trigger={<button>Open</button>}
        />,
      );
      fireEvent.click(screen.getByText("Open"));
      expect(itemLabels()).toEqual(["Alpha", "Beta", "Gamma"]);
    });

    it("keeps the plain option order when checkedOnTop is off", () => {
      render(
        <MultipleDropdown
          options={OPTIONS}
          value={["c"]}
          onChange={jest.fn()}
          trigger={<button>Open</button>}
        />,
      );
      expect(itemLabels()).toEqual(["Alpha", "Beta", "Gamma"]);
    });
  });
});
