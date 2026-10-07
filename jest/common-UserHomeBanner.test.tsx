// Coverage: app/assets/src/components/common/UserHomeBanner/UserHomeBanner.tsx
//
// The operator-editable logged-in home banner. It is driven entirely by AppConfig values delivered
// through UserContext.appConfig. The behaviour under test:
//   * renders nothing when disabled, or when the text is empty even if enabled (never a blank banner);
//   * renders the text via the SDS Callout when enabled + non-empty, mapping severity -> Callout intent;
//   * is dismissible, persisting the dismissal in localStorage under a key that embeds a HASH of the
//     text, so re-wording the banner makes it reappear for everyone who dismissed the old copy;
//   * wraps every localStorage access in try/catch so a throwing store never breaks the page;
//   * renders the text as PLAIN TEXT -- a <script>/<img onerror> payload is escaped, never executed.
//
// Only core Jest matchers are available (no jest-dom in this repo).
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { UserContext } from "~/components/common/UserContext";
import UserHomeBanner from "~/components/common/UserHomeBanner";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Classic-runtime JSX needs React in scope; the anchor keeps the import from being pruned.
const _React: typeof React = React;

const renderBanner = (appConfig: any) =>
  render(
    <UserContext.Provider value={{ appConfig } as any}>
      <UserHomeBanner />
    </UserContext.Provider>,
  );

beforeEach(() => {
  localStorage.clear();
});

describe("UserHomeBanner", () => {
  it("renders nothing when disabled", () => {
    renderBanner({ userHomeBannerEnabled: false, userHomeBannerText: "Hello" });
    expect(screen.queryByTestId("user-home-banner")).toBeNull();
  });

  it("renders nothing when enabled but the text is empty", () => {
    renderBanner({ userHomeBannerEnabled: true, userHomeBannerText: "" });
    expect(screen.queryByTestId("user-home-banner")).toBeNull();
  });

  it("renders nothing when enabled but the text is only whitespace", () => {
    renderBanner({ userHomeBannerEnabled: true, userHomeBannerText: "   " });
    expect(screen.queryByTestId("user-home-banner")).toBeNull();
  });

  it("renders the text when enabled and non-empty", () => {
    renderBanner({
      userHomeBannerEnabled: true,
      userHomeBannerText: "Scheduled maintenance tonight",
      userHomeBannerSeverity: "info",
    });
    expect(screen.getByTestId("user-home-banner")).toBeTruthy();
    expect(screen.getByText("Scheduled maintenance tonight")).toBeTruthy();
  });

  it("maps severity to the SDS Callout intent", () => {
    const { container, unmount } = renderBanner({
      userHomeBannerEnabled: true,
      userHomeBannerText: "Heads up",
      userHomeBannerSeverity: "warning",
    });
    expect(container.querySelector(".MuiAlert-standardWarning")).toBeTruthy();
    unmount();

    const { container: infoContainer } = renderBanner({
      userHomeBannerEnabled: true,
      userHomeBannerText: "Heads up",
      userHomeBannerSeverity: "info",
    });
    expect(infoContainer.querySelector(".MuiAlert-standardInfo")).toBeTruthy();
  });

  it("is dismissible and persists the dismissal in localStorage under a text-hashed key", () => {
    renderBanner({
      userHomeBannerEnabled: true,
      userHomeBannerText: "Scheduled maintenance tonight",
      userHomeBannerSeverity: "info",
    });

    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));

    expect(screen.queryByTestId("user-home-banner")).toBeNull();
    const keys = Object.keys(localStorage).filter(k =>
      k.startsWith("userHomeBannerDismissed-"),
    );
    expect(keys).toHaveLength(1);
    expect(localStorage.getItem(keys[0])).toBe("true");
  });

  it("stays dismissed on a re-render when the dismissal is already stored for that text", () => {
    const appConfig = {
      userHomeBannerEnabled: true,
      userHomeBannerText: "Scheduled maintenance tonight",
      userHomeBannerSeverity: "info",
    };
    // First mount + dismiss records the key...
    const { unmount } = renderBanner(appConfig);
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    unmount();

    // ...a fresh mount with the SAME text must honor it and render nothing.
    renderBanner(appConfig);
    expect(screen.queryByTestId("user-home-banner")).toBeNull();
  });

  it("reappears after the text is edited (dismissal is keyed by a hash of the text)", () => {
    // Dismiss the original wording.
    const { unmount } = renderBanner({
      userHomeBannerEnabled: true,
      userHomeBannerText: "Old wording",
      userHomeBannerSeverity: "info",
    });
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    unmount();

    // New wording => new key => the banner is shown again even though the old one was dismissed.
    renderBanner({
      userHomeBannerEnabled: true,
      userHomeBannerText: "New wording",
      userHomeBannerSeverity: "info",
    });
    expect(screen.getByTestId("user-home-banner")).toBeTruthy();
    expect(screen.getByText("New wording")).toBeTruthy();
  });

  it("does not crash when localStorage throws (wrapped in try/catch)", () => {
    const getItem = jest
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("localStorage unavailable");
      });
    const setItem = jest
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("localStorage unavailable");
      });

    expect(() => {
      renderBanner({
        userHomeBannerEnabled: true,
        userHomeBannerText: "Still renders",
        userHomeBannerSeverity: "info",
      });
      // Dismissing writes to the (throwing) store; must not propagate.
      fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    }).not.toThrow();

    getItem.mockRestore();
    setItem.mockRestore();
  });

  // STEP 4 security assertion: a value containing markup must be rendered as PLAIN TEXT, never as HTML.
  it("renders a <script>/<img onerror> payload as escaped plain text, not as HTML", () => {
    const payload = '<script>alert(1)</script><img src=x onerror="alert(2)">';
    const { container } = renderBanner({
      userHomeBannerEnabled: true,
      userHomeBannerText: payload,
      userHomeBannerSeverity: "info",
    });

    const banner = screen.getByTestId("user-home-banner");
    // The literal characters are present as text...
    expect(banner.textContent).toContain(payload);
    // ...but no real <script> or <img> element was injected into the DOM.
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });
});
