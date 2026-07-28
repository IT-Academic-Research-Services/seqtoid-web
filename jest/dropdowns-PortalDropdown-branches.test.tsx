// Coverage: app/assets/src/components/ui/controls/dropdowns/PortalDropdown.tsx
//
// jest/dropdowns-PortalDropdown.test.tsx covers the open/close/out-click
// surface against the real react-popper. What it cannot reach is the
// positioning logic inside the Popper render prop, because popper.js never
// produces a *changing* transform against jsdom's all-zero layout: the
// "popper moved, so hide the menu" hack at the top of that render prop stays
// dark, and so does the measured-trigger minWidth branch (every
// getBoundingClientRect width is 0, so triggerWidth is always falsy).
//
// This file swaps react-popper for a minimal double whose style object the test
// controls, which makes both of those branches drivable, and mocks
// getBoundingClientRect so the trigger has a real width to measure.
import { act, fireEvent, render, screen } from "@testing-library/react";
import PortalDropdown from "~/components/ui/controls/dropdowns/PortalDropdown";

// Mutated per-test; read lazily inside the Popper double's render, never at
// module-factory time.
let mockPopperStyle: Record<string, unknown>;

jest.mock("react-popper", () => ({
  Manager: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Reference: ({ children }: { children: $TSFixMeFunction }) =>
    children({ ref: () => undefined }),
  Popper: ({
    children,
    placement,
  }: {
    children: $TSFixMeFunction;
    placement: string;
  }) =>
    children({
      ref: () => undefined,
      style: mockPopperStyle,
      placement,
    }),
}));

const trigger = <button data-testid="trigger">Open me</button>;
const menu = <div data-testid="menu">Menu contents</div>;

const menuNode = () => document.querySelector("[data-testid='menu']");
const menuWrapper = () => (menuNode() as HTMLElement).parentElement;
const triggerContainer = () =>
  screen.getByTestId("trigger").parentElement as HTMLElement;

beforeEach(() => {
  mockPopperStyle = {
    position: "absolute",
    transform: "translate3d(0px,0px,0)",
  };
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("PortalDropdown positioning branches", () => {
  describe("minWidth taken from the measured trigger", () => {
    it("writes the trigger's measured width onto the portalled menu", () => {
      jest
        .spyOn(HTMLElement.prototype, "getBoundingClientRect")
        .mockReturnValue({ width: 250, height: 30 } as DOMRect);

      render(
        // @ts-expect-error the component declares every prop as required
        <PortalDropdown trigger={trigger} menu={menu} />,
      );
      fireEvent.click(triggerContainer());

      expect(menuWrapper()?.style.minWidth).toBe("250px");
      // The popper style is still spread in alongside the injected minWidth.
      expect(menuWrapper()?.style.position).toBe("absolute");
    });

    it("omits minWidth when the trigger node was never captured", () => {
      // Same 250px measurement as above, but with no trigger node to measure
      // the component must fall back to a null triggerWidth rather than call
      // getBoundingClientRect on nothing.
      jest
        .spyOn(HTMLElement.prototype, "getBoundingClientRect")
        .mockReturnValue({ width: 250, height: 30 } as DOMRect);

      const instance = { current: null as PortalDropdown | null };
      render(
        // @ts-expect-error the component declares every prop as required
        <PortalDropdown
          ref={(c: PortalDropdown) => (instance.current = c)}
          trigger={trigger}
          menu={menu}
        />,
      );

      const dropdown = instance.current as PortalDropdown;
      dropdown._triggerRef = null;
      act(() => {
        dropdown.open();
      });

      expect(menuNode()).toBeTruthy();
      expect(menuWrapper()?.style.minWidth).toBe("");
      expect(menuWrapper()?.style.position).toBe("absolute");
    });
  });

  describe("hiding the menu when the popper moves", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("closes the menu when the popper transform changes while open", () => {
      const onClose = jest.fn();
      const { rerender } = render(
        // @ts-expect-error the component declares every prop as required
        <PortalDropdown
          trigger={trigger}
          menu={menu}
          onClose={onClose}
          menuClassName="pass-one"
        />,
      );

      // First open records the current transform.
      fireEvent.click(triggerContainer());
      expect(menuNode()).toBeTruthy();

      // The trigger scrolled out of view, so popper hands back a different
      // transform on the next render.
      mockPopperStyle = {
        position: "absolute",
        transform: "translate3d(0px,-900px,0)",
      };
      rerender(
        // @ts-expect-error the component declares every prop as required
        <PortalDropdown
          trigger={trigger}
          menu={menu}
          onClose={onClose}
          menuClassName="pass-two"
        />,
      );

      // The close is deferred out of render via setTimeout.
      expect(menuNode()).toBeTruthy();
      act(() => {
        jest.runAllTimers();
      });

      expect(menuNode()).toBeNull();
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("keeps the menu open when the popper transform is unchanged", () => {
      const onClose = jest.fn();
      const { rerender } = render(
        // @ts-expect-error the component declares every prop as required
        <PortalDropdown
          trigger={trigger}
          menu={menu}
          onClose={onClose}
          menuClassName="pass-one"
        />,
      );

      fireEvent.click(triggerContainer());
      expect(menuNode()).toBeTruthy();

      rerender(
        // @ts-expect-error the component declares every prop as required
        <PortalDropdown
          trigger={trigger}
          menu={menu}
          onClose={onClose}
          menuClassName="pass-two"
        />,
      );
      act(() => {
        jest.runAllTimers();
      });

      expect(menuNode()).toBeTruthy();
      expect(onClose).not.toHaveBeenCalled();
    });

    it("re-arms the move detector after a reopen, so a later move still closes it", () => {
      const { rerender } = render(
        // @ts-expect-error the component declares every prop as required
        <PortalDropdown trigger={trigger} menu={menu} menuClassName="a" />,
      );

      fireEvent.click(triggerContainer());
      fireEvent.click(triggerContainer());
      expect(menuNode()).toBeNull();

      // Reopening starts from a cleared transform, so the very next render at
      // the same position must NOT close the menu...
      fireEvent.click(triggerContainer());
      rerender(
        // @ts-expect-error the component declares every prop as required
        <PortalDropdown trigger={trigger} menu={menu} menuClassName="b" />,
      );
      act(() => {
        jest.runAllTimers();
      });
      expect(menuNode()).toBeTruthy();

      // ...but a genuine move afterwards still does.
      mockPopperStyle = {
        position: "absolute",
        transform: "translate3d(0px,-42px,0)",
      };
      rerender(
        // @ts-expect-error the component declares every prop as required
        <PortalDropdown trigger={trigger} menu={menu} menuClassName="c" />,
      );
      act(() => {
        jest.runAllTimers();
      });
      expect(menuNode()).toBeNull();
    });
  });

  describe("placement handed to popper", () => {
    it("anchors bottom-start for the default right direction", () => {
      render(
        // @ts-expect-error the component declares every prop as required
        <PortalDropdown trigger={trigger} menu={menu} />,
      );
      fireEvent.click(triggerContainer());
      expect(menuWrapper()?.getAttribute("data-placement")).toBe(
        "bottom-start",
      );
    });

    it("anchors bottom-end when the direction is left", () => {
      render(
        // @ts-expect-error the component declares every prop as required
        <PortalDropdown trigger={trigger} menu={menu} direction="left" />,
      );
      fireEvent.click(triggerContainer());
      expect(menuWrapper()?.getAttribute("data-placement")).toBe("bottom-end");
    });
  });
});
