// Branch coverage: app/assets/src/components/common/SupportPortal/collectDiagnostics.ts
//
// Companion to common-SupportPortal-collectDiagnostics.test.ts. The fallback
// arms pinned here are the ones a normal browser render never reaches: an empty
// route string, a window with no `screen`, and an Intl implementation that
// reports no time zone.
import {
  collectDiagnostics,
  deriveProject,
} from "~/components/common/SupportPortal/collectDiagnostics";

const userContext = () =>
  ({
    admin: false,
    userId: 42,
    userName: "Test User",
    userEmail: "test@example.com",
  } as $TSFixMe);

describe("deriveProject with no route at all", () => {
  it("falls back to the not-in-a-project label for an empty route", () => {
    window.history.pushState({}, "", "/samples/1");
    expect(deriveProject("")).toBe("Not in a project");
  });

  it("still parses a project id out of a real route", () => {
    window.history.pushState({}, "", "/samples/1");
    expect(deriveProject("/projects/77/samples")).toBe("Project 77");
  });
});

describe("collectDiagnostics fallbacks", () => {
  it("reports an unknown screen size when window.screen is missing", () => {
    const original = Object.getOwnPropertyDescriptor(window, "screen");
    Object.defineProperty(window, "screen", {
      value: undefined,
      configurable: true,
    });
    try {
      const diagnostics = collectDiagnostics(userContext());
      expect(diagnostics.screen).toBe("unknown");
      // The viewport still comes from the window itself.
      expect(diagnostics.viewport).toBe(
        `${window.innerWidth}x${window.innerHeight}`,
      );
    } finally {
      if (original) {
        Object.defineProperty(window, "screen", original);
      }
    }
  });

  it("reports an unknown time zone when Intl resolves an empty one", () => {
    const spy = jest.spyOn(Intl, "DateTimeFormat").mockImplementation(
      () =>
        ({
          resolvedOptions: () => ({ timeZone: "" }),
        } as $TSFixMe),
    );
    try {
      expect(collectDiagnostics(userContext()).timezone).toBe("unknown");
    } finally {
      spy.mockRestore();
    }
  });

  it("reports the resolved time zone when Intl provides one", () => {
    const spy = jest.spyOn(Intl, "DateTimeFormat").mockImplementation(
      () =>
        ({
          resolvedOptions: () => ({ timeZone: "America/Los_Angeles" }),
        } as $TSFixMe),
    );
    try {
      expect(collectDiagnostics(userContext()).timezone).toBe(
        "America/Los_Angeles",
      );
    } finally {
      spy.mockRestore();
    }
  });
});
