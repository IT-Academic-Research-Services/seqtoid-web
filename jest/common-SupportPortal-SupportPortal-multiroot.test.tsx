// Regression coverage for the profile-setup "Report a problem" crash (2026-10). A page mounts one
// React root per react_component call and each root has its own SupportPortal, all listening to the
// same window event. On the profile-setup page the Header root is mounted WITHOUT a user context:
// when the page's error screen called openSupportPortal(), that context-less portal opened and
// crashed building its report ("cannot read 'userName' of undefined"), and nothing was submitted.
import { act, render, screen } from "@testing-library/react";
import React from "react";
import SupportPortal from "~/components/common/SupportPortal/SupportPortal";
import {
  collectDiagnostics,
  collectQuickReport,
  deriveAccountName,
} from "~/components/common/SupportPortal/collectDiagnostics";
import { openSupportPortal } from "~/components/common/SupportPortal/openSupportPortal";
import { UserContext } from "~/components/common/UserContext";

jest.mock("~/api/support", () => ({ createSupportRequest: jest.fn() }));
jest.mock("~/components/utils/logUtil", () => ({ logError: jest.fn() }));

const _React: typeof React = React;

const signedInContext = {
  admin: false,
  firstSignIn: false,
  allowedFeatures: [],
  appConfig: {},
  userSignedIn: true,
  userId: 7,
  userName: "Ada Lovelace",
  userEmail: "ada@example.com",
  profileCompleted: false,
};

const withContext = (context: any) => (
  <UserContext.Provider value={context}>
    <SupportPortal />
  </UserContext.Provider>
);

describe("SupportPortal across several React roots", () => {
  it("ignores an open request when mounted without a user context, without throwing", () => {
    render(withContext(undefined));
    expect(() =>
      act(() => {
        openSupportPortal({ note: "Error in the app" });
      }),
    ).not.toThrow();
    expect(screen.queryByTestId("support-portal-panel")).toBeNull();
  });

  it("is answered by the signed-in portal when a context-less root is mounted first", () => {
    // Profile-setup page: the Header root (no context) mounts before the page root.
    render(withContext(undefined));
    render(withContext(signedInContext));
    act(() => {
      openSupportPortal({ note: "Error in the app" });
    });
    expect(screen.getAllByTestId("support-portal-panel")).toHaveLength(1);
  });

  it("opens only one panel when two signed-in roots hear the same request", () => {
    render(withContext(signedInContext));
    render(withContext(signedInContext));
    act(() => {
      openSupportPortal({ note: "Report failed to render" });
    });
    expect(screen.getAllByTestId("support-portal-panel")).toHaveLength(1);
  });
});

describe("report collectors without a user context", () => {
  it("never throw and fall back to placeholders", () => {
    expect(deriveAccountName(undefined)).toBe("Unknown account");
    expect(() => collectQuickReport(undefined)).not.toThrow();
    const diagnostics = collectDiagnostics(undefined);
    expect(diagnostics.userId).toBe("unknown");
    expect(diagnostics.userEmail).toBe("unknown");
    expect(diagnostics.userRole).toBe("user");
  });
});
