// CZID-586 (#586) frontend coverage: LandingHeader is the marketing/landing top
// nav, including a mobile hamburger toggle and conditional announcement banners.
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { LandingHeader } from "~/components/common/LandingHeader/LandingHeader";

describe("LandingHeader", () => {
  beforeEach(() => localStorage.clear());

  it("renders the top nav with sign-in and resources links", () => {
    render(React.createElement(LandingHeader, {}));
    expect(screen.getByTestId("home-top-nav-bar")).toBeTruthy();
    expect(screen.getByTestId("home-top-nav-login").getAttribute("href")).toBe(
      "/auth0/login",
    );
    // REBRAND-02: impact nav commented out pending impact-page re-enable. Uncomment this
    // assertion when the {/* Case Studies */} block in LandingHeader.tsx is restored.
    // expect(screen.getByTestId("home-top-nav-impact")).toBeTruthy();
    expect(screen.getByTestId("home-top-nav-resources")).toBeTruthy();
  });

  it("toggles the mobile nav open when the hamburger is clicked", () => {
    render(React.createElement(LandingHeader, {}));
    const mobileLogin = screen.getByTestId("home-mobile-menu-login");
    // Collapsed initially: the mobile nav container width is 0.
    const mobileNav = mobileLogin.closest("div[style]") as HTMLElement;
    fireEvent.click(screen.getByTestId("home-mobile-hamburger"));
    // After toggling, the mobile links become visible (opacity 1).
    expect(mobileLogin.style.opacity).toBe("1");
    expect(mobileNav).toBeTruthy();
  });

  it("shows the emergency banner when a message is provided", () => {
    render(
      React.createElement(LandingHeader, {
        emergencyBannerMessage: "Service disruption in progress",
      }),
    );
    expect(
      screen.getAllByText("Service disruption in progress").length,
    ).toBeGreaterThan(0);
  });
});
