// Coverage:
//   app/assets/src/components/views/PageNotFound/PageNotFound.tsx
//   app/assets/src/components/views/PageNotFound/components/LandingHeaderV1/LandingHeaderV1.tsx
//
// PageNotFound has one `showLandingHeader &&` short circuit; LandingHeaderV1 has
// the `browserInfo.supported ? <SignIn/> : <unsupported message>` ternary and a
// sign-in handler that navigates. Both sides of both are driven here.
import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("~/components/common/InfoBanner", () => ({
  InfoBanner: ({ title, message }: { title: string; message: string }) => (
    <div data-testid="info-banner">
      <span data-testid="info-banner-title">{title}</span>
      <span data-testid="info-banner-message">{message}</span>
    </div>
  ),
}));

import { LandingHeaderV1 } from "~/components/views/PageNotFound/components/LandingHeaderV1/LandingHeaderV1";
import { PageNotFound } from "~/components/views/PageNotFound/PageNotFound";

describe("PageNotFound", () => {
  it("renders only the banner when showLandingHeader is not set", () => {
    render(<PageNotFound />);

    // The `showLandingHeader &&` guard short-circuits, so no header logo.
    expect(screen.queryByTestId("logo")).toBeNull();
    expect(screen.getByTestId("info-banner-title").textContent).toBe(
      "Oh no! This page isn't available.",
    );
  });

  it("renders the landing header above the banner when asked to", () => {
    render(
      <PageNotFound
        showLandingHeader
        browserInfo={{ supported: true, browser: "Chrome" }}
      />,
    );

    expect(screen.getByTestId("logo")).toBeTruthy();
    expect(screen.getByTestId("info-banner")).toBeTruthy();
  });

  it("passes browserInfo through to the header, so an unsupported browser is called out", () => {
    render(
      <PageNotFound
        showLandingHeader
        browserInfo={{ supported: false, browser: "Netscape" }}
      />,
    );

    expect(screen.queryByTestId("home-top-nav-login")).toBeNull();
    expect(
      screen.getByText(/Netscape is not currently supported/),
    ).toBeTruthy();
  });
});

describe("LandingHeaderV1", () => {
  const originalLocation = window.location;

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  const stubLocation = () => {
    const location = { href: "" } as $TSFixMe;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: location,
    });
    return location;
  };

  it("shows the sign-in button for a supported browser", () => {
    render(
      <LandingHeaderV1 browserInfo={{ supported: true, browser: "Chrome" }} />,
    );

    expect(screen.getByTestId("home-top-nav-login")).toBeTruthy();
    expect(screen.queryByText(/is not currently supported/)).toBeNull();
  });

  it("shows the unsupported-browser message instead for an unsupported browser", () => {
    render(
      <LandingHeaderV1 browserInfo={{ supported: false, browser: "IE 11" }} />,
    );

    expect(screen.queryByTestId("home-top-nav-login")).toBeNull();
    expect(screen.getByText(/IE 11 is not currently supported/)).toBeTruthy();
  });

  it("navigates to the Auth0 login when the sign-in button is clicked", () => {
    const location = stubLocation();
    render(
      <LandingHeaderV1 browserInfo={{ supported: true, browser: "Chrome" }} />,
    );

    fireEvent.click(screen.getByText("Sign In"));

    expect(location.href).toBe("/auth0/login");
  });

  it("always renders the four external nav links", () => {
    render(
      <LandingHeaderV1 browserInfo={{ supported: true, browser: "Chrome" }} />,
    );

    ["Help Center", "Video Tour", "Hiring", "GitHub"].forEach(label => {
      expect(screen.getByText(label)).toBeTruthy();
    });
    expect(screen.getByText("GitHub").getAttribute("href")).toBe(
      "https://github.com/IT-Academic-Research-Services/seqtoid-workflows",
    );
  });
});
