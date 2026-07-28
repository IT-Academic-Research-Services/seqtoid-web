// Branch coverage for the arms of
// app/assets/src/components/common/SupportPortal/collectDiagnostics.ts
// that the main collectDiagnostics suite leaves untaken: the `(route || "")`
// fallback in deriveProject, the `window.screen` guard in collectDiagnostics,
// and the `|| "unknown"` fallback when Intl reports no timeZone.
//
// NOTE: the three `typeof window !== "undefined"` else-arms in this module are
// unreachable under the jsdom test environment (window is always defined) and
// are deliberately not chased here.
import {
  collectDiagnostics,
  deriveProject,
  recordClientError,
} from "~/components/common/SupportPortal/collectDiagnostics";

const originalScreen = window.screen;
const originalDateTimeFormat = Intl.DateTimeFormat;

const userContext = {
  userId: 7,
  userEmail: "scientist@example.org",
  admin: false,
} as $TSFixMe;

afterEach(() => {
  Object.defineProperty(window, "screen", {
    configurable: true,
    writable: true,
    value: originalScreen,
  });
  Intl.DateTimeFormat = originalDateTimeFormat;
  window.history.replaceState({}, "", "/");
});

describe("deriveProject route fallback", () => {
  it("falls back to 'Not in a project' when the route itself is nullish", () => {
    window.history.replaceState({}, "", "/my_data");

    // No projectName/projectId in the query string, and `route` is nullish, so
    // the `(route || "")` right-hand arm supplies the empty string to match().
    expect(deriveProject(undefined as $TSFixMe)).toBe("Not in a project");
    expect(deriveProject(null as $TSFixMe)).toBe("Not in a project");
  });

  it("still parses a project id out of a supplied route", () => {
    window.history.replaceState({}, "", "/my_data");

    expect(deriveProject("/projects/482/samples")).toBe("Project 482");
  });
});

describe("collectDiagnostics environment fallbacks", () => {
  it("reports an unknown screen size when window.screen is missing", () => {
    Object.defineProperty(window, "screen", {
      configurable: true,
      writable: true,
      value: undefined,
    });

    const diagnostics = collectDiagnostics(userContext);

    expect(diagnostics.screen).toBe("unknown");
    // The viewport guard is independent and still resolves.
    expect(diagnostics.viewport).toBe(
      `${window.innerWidth}x${window.innerHeight}`,
    );
  });

  it("reports a real screen size when window.screen is present", () => {
    const diagnostics = collectDiagnostics(userContext);

    expect(diagnostics.screen).toBe(
      `${window.screen.width}x${window.screen.height}`,
    );
  });

  it("falls back to an unknown timezone when Intl resolves an empty timeZone", () => {
    Intl.DateTimeFormat = (() => ({
      resolvedOptions: () => ({ timeZone: "" }),
    })) as $TSFixMe;

    expect(collectDiagnostics(userContext).timezone).toBe("unknown");
  });

  it("uses the resolved timezone when Intl provides one", () => {
    Intl.DateTimeFormat = (() => ({
      resolvedOptions: () => ({ timeZone: "America/Los_Angeles" }),
    })) as $TSFixMe;

    expect(collectDiagnostics(userContext).timezone).toBe(
      "America/Los_Angeles",
    );
  });

  it("records the user role and the most recent client error", () => {
    recordClientError("TypeError: boom @ app.js:1:2");

    const asUser = collectDiagnostics(userContext);
    expect(asUser.userRole).toBe("user");
    expect(asUser.userId).toBe("7");
    expect(asUser.recentError).toBe("TypeError: boom @ app.js:1:2");

    const asAdmin = collectDiagnostics({
      ...userContext,
      admin: true,
      userId: null,
      userEmail: null,
    } as $TSFixMe);
    expect(asAdmin.userRole).toBe("admin");
    expect(asAdmin.userId).toBe("unknown");
    expect(asAdmin.userEmail).toBe("unknown");
  });
});
