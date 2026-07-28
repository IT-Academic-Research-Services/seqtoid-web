// CZID-586 (#586) frontend coverage:
// app/assets/src/components/common/SupportPortal/openSupportPortal.ts
//
// A dependency-free window-event bus used to open the in-app support portal
// from anywhere (error boundaries, failed-mutation toasts). The interesting
// branches are the optional `context` argument (`context ?? {}`) and the
// optional CustomEvent `detail` (`detail ?? {}`) -- both are exercised here,
// along with the returned unsubscribe function.
import {
  onOpenSupportPortal,
  openSupportPortal,
  SUPPORT_PORTAL_OPEN_EVENT,
} from "~/components/common/SupportPortal/openSupportPortal";

describe("SUPPORT_PORTAL_OPEN_EVENT", () => {
  it("is a stable, namespaced event name", () => {
    expect(SUPPORT_PORTAL_OPEN_EVENT).toBe("csid:open-support-portal");
  });
});

describe("openSupportPortal / onOpenSupportPortal", () => {
  it("delivers the supplied note to a subscriber", () => {
    const handler = jest.fn();
    const unsubscribe = onOpenSupportPortal(handler);

    openSupportPortal({ note: "Upload failed" });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ note: "Upload failed" });
    unsubscribe();
  });

  it("delivers an empty detail object when called with no context", () => {
    const handler = jest.fn();
    const unsubscribe = onOpenSupportPortal(handler);

    openSupportPortal();

    expect(handler).toHaveBeenCalledWith({});
    unsubscribe();
  });

  it("normalises a raw Event with no detail to an empty object", () => {
    const handler = jest.fn();
    const unsubscribe = onOpenSupportPortal(handler);

    // Anything on the page can dispatch the bare event; the subscriber must
    // still receive an object rather than null/undefined.
    window.dispatchEvent(new Event(SUPPORT_PORTAL_OPEN_EVENT));

    expect(handler).toHaveBeenCalledWith({});
    unsubscribe();
  });

  it("stops delivering after the returned unsubscribe is called", () => {
    const handler = jest.fn();
    const unsubscribe = onOpenSupportPortal(handler);

    openSupportPortal({ note: "first" });
    expect(handler).toHaveBeenCalledTimes(1);

    unsubscribe();
    openSupportPortal({ note: "second" });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenLastCalledWith({ note: "first" });
  });

  it("fans out to every active subscriber", () => {
    const first = jest.fn();
    const second = jest.fn();
    const unsubFirst = onOpenSupportPortal(first);
    const unsubSecond = onOpenSupportPortal(second);

    openSupportPortal({ note: "broadcast" });

    expect(first).toHaveBeenCalledWith({ note: "broadcast" });
    expect(second).toHaveBeenCalledWith({ note: "broadcast" });
    unsubFirst();
    unsubSecond();
  });

  it("is a no-op (does not notify) once every subscriber has detached", () => {
    const handler = jest.fn();
    onOpenSupportPortal(handler)();

    openSupportPortal({ note: "nobody listening" });

    expect(handler).not.toHaveBeenCalled();
  });
});
