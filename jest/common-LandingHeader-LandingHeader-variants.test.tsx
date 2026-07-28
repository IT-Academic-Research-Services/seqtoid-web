// Coverage: app/assets/src/components/common/LandingHeader/LandingHeader.tsx
//
// The existing LandingHeader spec covers the default marketing nav. This one
// drives the REBRAND variant flags that the default render never reaches:
// `legalNav` (Help Center + Legal dropdown instead of Resources + Sign in,
// with a different mobile link set) and `logoOnly` (logo, no nav at all),
// plus the czid-transfer announcement banner arm.
import { fireEvent, render, screen } from "@testing-library/react";
import { LandingHeader } from "~/components/common/LandingHeader/LandingHeader";

describe("LandingHeader variants", () => {
  beforeEach(() => localStorage.clear());

  describe("legalNav", () => {
    it("swaps the marketing links for the legal nav", () => {
      render(<LandingHeader legalNav={true} />);

      expect(screen.getByTestId("home-top-nav-help-center")).toBeTruthy();
      expect(screen.getByText("Legal")).toBeTruthy();
      // Marketing-only links are gone on this arm.
      expect(screen.queryByTestId("home-top-nav-resources")).toBeNull();
      expect(screen.queryByTestId("home-top-nav-login")).toBeNull();
    });

    it("renders terms and privacy links in the mobile menu", () => {
      render(<LandingHeader legalNav={true} />);

      expect(
        screen.getByTestId("home-mobile-menu-terms").getAttribute("href"),
      ).toBe("/terms");
      expect(
        screen.getByTestId("home-mobile-menu-privacy").getAttribute("href"),
      ).toBe("/privacy");
      expect(screen.getByTestId("home-mobile-menu-help-center")).toBeTruthy();
      expect(screen.queryByTestId("home-mobile-menu-login")).toBeNull();
      expect(screen.queryByTestId("home-mobile-menu-resources")).toBeNull();
    });

    it("reveals the legal mobile links when the hamburger is toggled", () => {
      render(<LandingHeader legalNav={true} />);

      const terms = screen.getByTestId("home-mobile-menu-terms");
      expect(terms.style.opacity).toBe("0");

      fireEvent.click(screen.getByTestId("home-mobile-hamburger"));
      expect(terms.style.opacity).toBe("1");
      expect(screen.getByTestId("home-mobile-menu-privacy").style.opacity).toBe(
        "1",
      );

      // Toggling again via the close control collapses it back.
      fireEvent.click(screen.getByTestId("home-mobile-close-hamburger"));
      expect(terms.style.opacity).toBe("0");
    });
  });

  describe("logoOnly", () => {
    it("renders the logo without any nav", () => {
      render(<LandingHeader logoOnly={true} />);

      expect(screen.getByTestId("home-top-nav-bar")).toBeTruthy();
      expect(screen.queryByTestId("home-top-nav-resources")).toBeNull();
      expect(screen.queryByTestId("home-top-nav-login")).toBeNull();
      expect(screen.queryByTestId("home-mobile-hamburger")).toBeNull();
      expect(screen.queryByTestId("home-top-nav-help-center")).toBeNull();
      // The homepage logo link survives.
      expect(
        screen
          .getByLabelText("Go to the SeqtoID homepage")
          .getAttribute("href"),
      ).toBe("/");
    });
  });

  it("shows the transfer announcement banner when enabled", () => {
    render(<LandingHeader announcementBannerEnabled={true} />);

    expect(screen.getAllByText(/MANAGE SeqtoID/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("HERE").length).toBeGreaterThan(0);
  });

  it("hides both banners when neither is configured", () => {
    render(<LandingHeader />);

    expect(screen.queryByText(/MANAGE SeqtoID/)).toBeNull();
    // Default nav is still the marketing one.
    expect(screen.getByTestId("home-top-nav-login")).toBeTruthy();
  });
});
