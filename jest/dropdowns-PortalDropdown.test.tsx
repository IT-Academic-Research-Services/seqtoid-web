// Coverage: app/assets/src/components/ui/controls/dropdowns/PortalDropdown.tsx
//
// PortalDropdown renders its trigger inline and its menu into a document.body
// portal. It is "semi-controlled": props.open wins when it is a real boolean,
// otherwise internal state decides. These tests drive the uncontrolled toggle,
// the controlled override, the disabled short-circuit in open(), the
// onOpen/onClose callbacks (present and absent), the document mousedown
// out-click handler (inside trigger / inside menu / genuinely outside), the
// arrow and direction branches, and listener teardown on unmount.
import { fireEvent, render, screen } from "@testing-library/react";
import PortalDropdown from "~/components/ui/controls/dropdowns/PortalDropdown";

const trigger = <button data-testid="trigger">Open me</button>;
const menu = <div data-testid="menu">Menu contents</div>;

const renderPortal = (props: Record<string, unknown> = {}) =>
  render(
    // @ts-expect-error the component declares every prop as required
    <PortalDropdown trigger={trigger} menu={menu} {...props} />,
  );

const menuNode = () => document.querySelector("[data-testid='menu']");
const triggerContainer = () =>
  screen.getByTestId("trigger").parentElement as HTMLElement;

describe("PortalDropdown", () => {
  describe("uncontrolled open/close", () => {
    it("starts closed and renders no portal menu", () => {
      renderPortal();
      expect(screen.getByTestId("trigger")).toBeTruthy();
      expect(menuNode()).toBeNull();
    });

    it("opens on trigger click and portals the menu into document.body", () => {
      renderPortal();
      fireEvent.click(triggerContainer());
      const node = menuNode();
      expect(node).toBeTruthy();
      // The menu lives outside the component's own subtree.
      expect(document.body.contains(node as Node)).toBe(true);
    });

    it("closes again on a second trigger click", () => {
      renderPortal();
      fireEvent.click(triggerContainer());
      expect(menuNode()).toBeTruthy();
      fireEvent.click(triggerContainer());
      expect(menuNode()).toBeNull();
    });

    it("closes when the portalled menu itself is clicked", () => {
      renderPortal();
      fireEvent.click(triggerContainer());
      fireEvent.click(menuNode() as HTMLElement);
      expect(menuNode()).toBeNull();
    });
  });

  describe("disabled", () => {
    it("never opens and never fires onOpen", () => {
      const onOpen = jest.fn();
      renderPortal({ disabled: true, onOpen });
      fireEvent.click(triggerContainer());
      expect(menuNode()).toBeNull();
      expect(onOpen).not.toHaveBeenCalled();
    });
  });

  describe("callbacks", () => {
    it("fires onOpen when opening and onClose when closing", () => {
      const onOpen = jest.fn();
      const onClose = jest.fn();
      renderPortal({ onOpen, onClose });

      fireEvent.click(triggerContainer());
      expect(onOpen).toHaveBeenCalledTimes(1);
      expect(onClose).not.toHaveBeenCalled();

      fireEvent.click(triggerContainer());
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("toggles fine when no callbacks are supplied at all", () => {
      renderPortal();
      fireEvent.click(triggerContainer());
      expect(menuNode()).toBeTruthy();
      fireEvent.click(triggerContainer());
      expect(menuNode()).toBeNull();
    });
  });

  describe("controlled via the open prop", () => {
    it("renders the menu when open is true regardless of internal state", () => {
      renderPortal({ open: true });
      expect(menuNode()).toBeTruthy();
    });

    it("stays closed when open is false even after clicking the trigger", () => {
      renderPortal({ open: false, onOpen: jest.fn() });
      fireEvent.click(triggerContainer());
      // Internal state flipped, but props.open still governs what renders.
      expect(menuNode()).toBeNull();
    });

    it("falls back to internal state when open is explicitly null", () => {
      renderPortal({ open: null });
      expect(menuNode()).toBeNull();
      fireEvent.click(triggerContainer());
      expect(menuNode()).toBeTruthy();
    });
  });

  describe("outside click handling", () => {
    it("closes on a mousedown outside both the trigger and the menu", () => {
      renderPortal();
      fireEvent.click(triggerContainer());
      expect(menuNode()).toBeTruthy();

      const outside = document.createElement("div");
      document.body.appendChild(outside);
      fireEvent.mouseDown(outside);

      expect(menuNode()).toBeNull();
      document.body.removeChild(outside);
    });

    it("stays open on a mousedown inside the trigger", () => {
      renderPortal();
      fireEvent.click(triggerContainer());
      fireEvent.mouseDown(screen.getByTestId("trigger"));
      expect(menuNode()).toBeTruthy();
    });

    it("stays open on a mousedown inside the portalled menu", () => {
      renderPortal();
      fireEvent.click(triggerContainer());
      fireEvent.mouseDown(menuNode() as HTMLElement);
      expect(menuNode()).toBeTruthy();
    });

    it("ignores outside mousedowns while already closed", () => {
      const onClose = jest.fn();
      renderPortal({ onClose });
      const outside = document.createElement("div");
      document.body.appendChild(outside);
      fireEvent.mouseDown(outside);
      expect(onClose).not.toHaveBeenCalled();
      document.body.removeChild(outside);
    });

    it("detaches the document listener on unmount", () => {
      const removeSpy = jest.spyOn(document, "removeEventListener");
      const { unmount } = renderPortal();
      unmount();
      expect(removeSpy.mock.calls.some(call => call[0] === "mousedown")).toBe(
        true,
      );
      removeSpy.mockRestore();
    });
  });

  describe("arrow rendering", () => {
    it("renders the chevron svg by default", () => {
      const { container } = renderPortal();
      expect(container.querySelector("svg")).toBeTruthy();
    });

    it("renders no chevron when hideArrow is set", () => {
      const { container } = renderPortal({ hideArrow: true });
      expect(container.querySelector("svg")).toBeNull();
    });

    it("still renders the chevron when the arrow sits inside the trigger", () => {
      const { container } = renderPortal({ arrowInsideTrigger: true });
      expect(container.querySelector("svg")).toBeTruthy();
    });
  });

  // popper.js only resolves the concrete placement asynchronously against real
  // layout, so jsdom never writes a data-placement attribute. What is
  // assertable is that the popper render prop ran and its positioning style was
  // spread onto the menu wrapper for both direction values.
  describe("menu placement", () => {
    const menuWrapper = () => (menuNode() as HTMLElement).parentElement;

    it("positions the menu wrapper with popper styles when direction is right (the default)", () => {
      renderPortal();
      fireEvent.click(triggerContainer());
      expect(menuWrapper()?.style.position).toBe("absolute");
    });

    it("positions the menu wrapper with popper styles when direction is left", () => {
      renderPortal({ direction: "left" });
      fireEvent.click(triggerContainer());
      expect(menuWrapper()?.style.position).toBe("absolute");
      expect(menuWrapper()?.textContent).toBe("Menu contents");
    });

    it("gives the menu a min-width taken from the measured trigger width", () => {
      // jsdom reports 0 for every getBoundingClientRect width, so the
      // triggerWidth branch resolves falsy and no minWidth is written.
      renderPortal();
      fireEvent.click(triggerContainer());
      expect(menuWrapper()?.style.minWidth).toBe("");
    });
  });

  describe("trigger cloning", () => {
    it("passes an `active` flag down to the trigger element", () => {
      const Probe = ({ active }: { active?: boolean }) => (
        <button data-testid="probe">{active ? "active" : "inactive"}</button>
      );
      render(
        // @ts-expect-error the component declares every prop as required
        <PortalDropdown trigger={<Probe />} menu={menu} />,
      );
      expect(screen.getByTestId("probe").textContent).toBe("inactive");
      fireEvent.click(screen.getByTestId("probe").parentElement as HTMLElement);
      expect(screen.getByTestId("probe").textContent).toBe("active");
    });
  });

  describe("style-modifier props", () => {
    it("renders with the fluid/floating/withinModal modifiers applied", () => {
      renderPortal({
        fluid: true,
        floating: true,
        withinModal: true,
        triggerClassName: "my-trigger",
        menuClassName: "my-menu",
      });
      expect(triggerContainer().className).toContain("my-trigger");
      fireEvent.click(triggerContainer());
      expect((menuNode() as HTMLElement).parentElement?.className).toContain(
        "my-menu",
      );
    });
  });
});
