/**
 * @jest-environment node
 */
// Branch coverage: app/assets/src/components/common/SupportPortal/collectDiagnostics.ts
//
// The module guards several reads with `typeof window !== "undefined"`, which
// is always true under the default jsdom environment. This file runs in the
// node environment so the server-side arm of each guard is taken -- the shape
// the module takes if it is ever pulled into an SSR or script context.
import {
  collectDiagnostics,
  collectQuickReport,
} from "~/components/common/SupportPortal/collectDiagnostics";

const userContext = () =>
  ({
    admin: false,
    userId: 42,
    userName: "Test User",
    userEmail: "test@example.com",
  } as $TSFixMe);

describe("collectQuickReport without a window", () => {
  it("derives its report from an empty route", () => {
    expect(typeof window).toBe("undefined");
    const report = collectQuickReport(userContext());

    // An empty route is treated as the root, and matches no project pattern.
    expect(report.task).toBe("Home");
    expect(report.project).toBe("Not in a project");
    expect(report.accountName).toBe("Test User");
  });
});

describe("collectDiagnostics without a window", () => {
  it("falls back to unknown viewport and screen before it needs the window", () => {
    // The size guards degrade gracefully, but the payload itself reads window
    // globals unconditionally, so the full collection is browser-only.
    expect(() => collectDiagnostics(userContext())).toThrow(ReferenceError);
  });
});
