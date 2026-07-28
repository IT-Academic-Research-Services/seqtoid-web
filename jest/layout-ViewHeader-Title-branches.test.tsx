// Coverage: app/assets/src/components/layout/ViewHeader/Title.tsx
//
// Two independent decisions drive this class:
//   * nameOverflows -- measured in checkNameOverflows from two refs, guarded by
//     `_nameContainer && _name && width > width`, then written to state only
//     when it actually changed (the "prevents infinite loop" if).
//   * multipleOptions -- `options && options.length > 1`, which swaps the bare
//     <h1> for a BareDropdown and filters the currently-selected option out.
//
// jsdom reports every getBoundingClientRect as 0x0, so the overflow arm is
// unreachable without stubbing the measurement; that stub is installed per-test
// and keyed on tag name so the inner <span> can be made wider than its <h1>.
import { fireEvent, render, screen } from "@testing-library/react";

// The overflow arm wraps the heading in a semantic-ui Popup, which renders only
// its trigger until a real hover/portal cycle. Swap just that one export for a
// marker so the wrap is directly observable; BareDropdown still gets the real
// semantic-ui implementation.
jest.mock("semantic-ui-react", () => ({
  ...jest.requireActual("semantic-ui-react"),
  Popup: ({
    trigger,
    content,
  }: {
    trigger: React.ReactNode;
    content: React.ReactNode;
  }) => (
    <span data-testid="name-popup" data-content={String(content)}>
      {trigger}
    </span>
  ),
}));

import Title from "~/components/layout/ViewHeader/Title";

const realGetBoundingClientRect =
  window.Element.prototype.getBoundingClientRect;

const stubWidths = ({
  name,
  container,
}: {
  name: number;
  container: number;
}) => {
  window.Element.prototype.getBoundingClientRect = function () {
    const width = this.tagName === "SPAN" ? name : container;
    return {
      width,
      height: 0,
      top: 0,
      left: 0,
      bottom: 0,
      right: 0,
      x: 0,
      y: 0,
    } as DOMRect;
  };
};

afterEach(() => {
  window.Element.prototype.getBoundingClientRect = realGetBoundingClientRect;
});

describe("Title branches", () => {
  describe("option count", () => {
    it("renders a plain heading when no options are supplied", () => {
      const { container } = render(<Title label="Sample A" />);

      const heading = container.querySelector("h1");
      expect(heading?.textContent).toBe("Sample A");
      expect(screen.queryByTestId("view-header-dropdown")).toBeNull();
    });

    it("renders a plain heading when there is only one option", () => {
      const { container } = render(
        <Title
          label="Sample A"
          id={1}
          options={[{ label: "Sample A", id: 1, onClick: jest.fn() }]}
        />,
      );

      expect(container.querySelector("h1")?.textContent).toBe("Sample A");
      expect(screen.queryByTestId("view-header-dropdown")).toBeNull();
    });

    it("switches to a dropdown once there is more than one option", () => {
      render(
        <Title
          label="Sample A"
          id={1}
          options={[
            { label: "Sample A", id: 1, onClick: jest.fn() },
            { label: "Sample B", id: 2, onClick: jest.fn() },
          ]}
        />,
      );

      expect(screen.getByTestId("view-header-dropdown")).not.toBeNull();
    });

    it("omits the currently-selected option from the dropdown and fires the rest", () => {
      const onClickA = jest.fn();
      const onClickB = jest.fn();
      render(
        <Title
          label="Sample A"
          // String(id) comparison: a numeric option id must still match a
          // string prop id.
          id="1"
          options={[
            { label: "Sample A", id: 1, onClick: onClickA },
            { label: "Sample B", id: 2, onClick: onClickB },
          ]}
        />,
      );

      fireEvent.click(screen.getByText("Sample A"));

      // Only the non-selected option is offered.
      expect(screen.queryAllByText("Sample B")).toHaveLength(1);
      // "Sample A" appears once, as the trigger heading -- not as an item.
      expect(screen.queryAllByText("Sample A")).toHaveLength(1);

      fireEvent.click(screen.getByText("Sample B"));
      expect(onClickB).toHaveBeenCalledTimes(1);
      expect(onClickA).not.toHaveBeenCalled();
    });
  });

  describe("name overflow", () => {
    it("leaves the heading unwrapped when the name fits its container", () => {
      stubWidths({ name: 50, container: 100 });
      const { container } = render(<Title label="Short" />);

      // No Popup wrapper: the h1 is still the root node.
      expect(container.firstElementChild?.tagName).toBe("H1");
      expect(screen.queryByTestId("name-popup")).toBeNull();
    });

    it("wraps the heading in a hover popup when the name is too wide", () => {
      stubWidths({ name: 400, container: 100 });
      const { container } = render(
        <Title label="A very long sample name indeed" />,
      );

      const popup = screen.getByTestId("name-popup");
      // The popup repeats the full label as its hover content.
      expect(popup.getAttribute("data-content")).toBe(
        "A very long sample name indeed",
      );
      // ...and the heading is now nested inside it rather than at the root.
      expect(container.firstElementChild?.tagName).toBe("SPAN");
      expect(popup.querySelector("h1")?.textContent).toBe(
        "A very long sample name indeed",
      );
    });

    it("does not re-measure into a new state when nothing changed on update", () => {
      stubWidths({ name: 400, container: 100 });
      const setStateSpy = jest.spyOn(Title.prototype, "setState");
      const { rerender, container } = render(<Title label="Long name" />);

      // Mount set the flag once.
      expect(setStateSpy).toHaveBeenCalledTimes(1);

      rerender(<Title label="Long name" />);

      // componentDidUpdate re-measures, sees the same value and bails out.
      expect(setStateSpy).toHaveBeenCalledTimes(1);
      expect(container.querySelector("h1")).not.toBeNull();
      setStateSpy.mockRestore();
    });

    it("treats a missing measurement as no overflow", () => {
      // Width comparison never runs because getBoundingClientRect reports 0 for
      // both nodes -- the guard falls through to `false`.
      const setStateSpy = jest.spyOn(Title.prototype, "setState");
      const { container } = render(<Title label="Sample A" />);

      expect(setStateSpy).not.toHaveBeenCalled();
      expect(container.firstElementChild?.tagName).toBe("H1");
      setStateSpy.mockRestore();
    });
  });
});
