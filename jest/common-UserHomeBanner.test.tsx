// Coverage: app/assets/src/components/common/UserHomeBanner/UserHomeBanner.tsx
//
// The operator-editable logged-in home banner. It is driven entirely by AppConfig values delivered
// through UserContext.appConfig. The behaviour under test:
//   * renders nothing when disabled, or when the text is empty even if enabled (never a blank banner);
//   * renders the text via the SDS Callout when enabled + non-empty, mapping severity -> Callout intent;
//   * is NOT dismissible -- there is no close button and it does not disappear;
//   * renders the text as PLAIN TEXT -- a <script>/<img onerror> payload is escaped, never executed.
//
// Only core Jest matchers are available (no jest-dom in this repo).
import { render, screen } from "@testing-library/react";
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
      userHomeBannerText: "Data Transfer Notice: Transfers may take up to 7 business days",
      userHomeBannerSeverity: "info",
    });
    expect(screen.getByTestId("user-home-banner")).toBeTruthy();
    expect(
      screen.getByText("Data Transfer Notice: Transfers may take up to 7 business days"),
    ).toBeTruthy();
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

  it("is NOT dismissible -- it renders no close button", () => {
    renderBanner({
      userHomeBannerEnabled: true,
      userHomeBannerText: "Data Transfer Notice: Transfers may take up to 7 business days",
      userHomeBannerSeverity: "info",
    });
    // The SDS Callout only renders a dismiss ButtonIcon when given an onClose; we pass none.
    expect(screen.queryByRole("button", { name: /dismiss/i })).toBeNull();
  });

  // Security assertion: a value containing markup must be rendered as PLAIN TEXT, never as HTML.
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
