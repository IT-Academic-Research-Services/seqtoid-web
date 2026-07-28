// Coverage: app/assets/src/components/common/Header/Header.tsx
//
// Header has three mutually exclusive top-level shapes -- the blank logo-only
// bar, the log-out-only bar, and the full application header -- plus nested
// branches inside the full header for disableNavigation, userSignedIn (user
// menu vs terms menu, background-refresh iframe) and the two announcement
// banners. Every one of those arms is driven here. The child menus and the
// toast container are stubbed so the assertions land on Header's own wiring,
// and postToUrlWithCSRF is mocked so the log-out handlers can be observed.
import { fireEvent, render, screen } from "@testing-library/react";

const mockPostToUrlWithCSRF = jest.fn();

jest.mock("~utils/links", () => ({
  postToUrlWithCSRF: (...args: unknown[]) => mockPostToUrlWithCSRF(...args),
}));

const mockBannerRenders: Record<string, $TSFixMe>[] = [];

jest.mock("~/components/common/AnnouncementBanner", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: (props: Record<string, $TSFixMe>) => {
      mockBannerRenders.push(props);
      return ReactLib.createElement("div", {
        "data-testid": `banner-${props.id}-${String(props.visible)}`,
      });
    },
  };
});

jest.mock("~ui/containers/ToastContainer", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: () => ReactLib.createElement("div", { "data-testid": "toasts" }),
  };
});

import Header from "~/components/common/Header/Header";

const baseProps = {
  adminUser: false,
  announcementBannerEnabled: false,
  emergencyBannerMessage: "",
  disableNavigation: false,
  showBlank: false,
  showLogOut: false,
  userSignedIn: true,
  email: "user@example.com",
  signOutEndpoint: "/auth0/logout",
  userName: "Test User",
};

const renderHeader = (props: Record<string, unknown> = {}) =>
  render(<Header {...baseProps} {...(props as $TSFixMe)} />);

describe("Header showBlank / showLogOut short-circuits", () => {
  beforeEach(() => jest.clearAllMocks());

  it("renders only the logo when showBlank is set", () => {
    renderHeader({ showBlank: true });
    expect(screen.queryByText("Log Out")).toBeNull();
    expect(screen.queryByTestId("toasts")).toBeNull();
    expect(screen.queryByTestId("top-menu")).toBeNull();
    expect(screen.getByAltText("SeqtoID logo")).toBeTruthy();
    // The blank header's logo is not wrapped in a home link.
    expect(document.querySelector('a[href="/"]')).toBeNull();
  });

  it("prefers the blank header over the log-out header when both flags are set", () => {
    renderHeader({ showBlank: true, showLogOut: true });
    expect(screen.queryByText("Log Out")).toBeNull();
  });

  it("renders a clickable Log Out control when showLogOut is set", () => {
    renderHeader({ showLogOut: true });
    const logOut = screen.getByText("Log Out");
    expect(logOut.getAttribute("role")).toBe("button");
    expect(screen.queryByTestId("toasts")).toBeNull();

    fireEvent.click(logOut);
    expect(mockPostToUrlWithCSRF).toHaveBeenCalledWith("/auth0/logout");
  });

  it("also signs out from the keyboard handler on the Log Out control", () => {
    renderHeader({ showLogOut: true, signOutEndpoint: "/custom/logout" });
    fireEvent.keyDown(screen.getByText("Log Out"), { key: "Enter" });
    expect(mockPostToUrlWithCSRF).toHaveBeenCalledWith("/custom/logout");
  });

  it("clears sessionStorage before posting the sign-out", () => {
    sessionStorage.setItem("stale", "value");
    renderHeader({ showLogOut: true });
    fireEvent.click(screen.getByText("Log Out"));
    expect(sessionStorage.getItem("stale")).toBeNull();
  });
});

describe("Header announcement banners", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBannerRenders.length = 0;
  });

  it("hides the emergency banner when the message is an empty string", () => {
    renderHeader({ emergencyBannerMessage: "" });
    expect(screen.getByTestId("banner-emergency-false")).toBeTruthy();
  });

  it("shows the emergency banner and forwards the message when one is set", () => {
    renderHeader({ emergencyBannerMessage: "Pipelines are degraded" });
    expect(screen.getByTestId("banner-emergency-true")).toBeTruthy();
    const emergency = mockBannerRenders.find(p => p.id === "emergency");
    expect(emergency?.message).toBe("Pipelines are degraded");
  });

  it("passes announcementBannerEnabled straight through to the transfer banner", () => {
    const hidden = renderHeader({ announcementBannerEnabled: false });
    expect(screen.getByTestId("banner-czid-transfer-false")).toBeTruthy();
    hidden.unmount();
    mockBannerRenders.length = 0;

    renderHeader({ announcementBannerEnabled: true });
    expect(screen.getByTestId("banner-czid-transfer-true")).toBeTruthy();
  });

  it("renders no banners at all in the blank or log-out headers", () => {
    renderHeader({ showBlank: true, emergencyBannerMessage: "Down" });
    expect(mockBannerRenders).toHaveLength(0);
    expect(screen.queryByTestId("banner-emergency-true")).toBeNull();
  });
});

describe("Header full application header", () => {
  beforeEach(() => jest.clearAllMocks());

  it("renders the home-link logo and the toast container", () => {
    const { container } = renderHeader();
    const homeLink = container.querySelector('a[href="/"]');
    expect(homeLink).toBeTruthy();
    expect(homeLink?.querySelector("img")).toBeTruthy();
    expect(screen.getByTestId("toasts")).toBeTruthy();
  });

  it("renders the main menu and the user menu for a signed-in user", () => {
    renderHeader({ userSignedIn: true });
    expect(screen.getByTestId("top-menu")).toBeTruthy();
    // The signed-in dropdown is labelled with the user's name.
    expect(screen.getByText("Test User")).toBeTruthy();
  });

  it("renders the logged-out main menu and terms menu for an anonymous user", () => {
    renderHeader({ userSignedIn: false });
    expect(screen.queryByTestId("top-menu")).toBeNull();
    expect(screen.getByTestId("menu-item-help-center")).toBeTruthy();
    expect(screen.queryByText("Test User")).toBeNull();
  });

  it("renders the background-refresh iframe only when signed in", () => {
    const signedIn = renderHeader({ userSignedIn: true });
    expect(
      signedIn.container.querySelector('iframe[title="background_refresh"]'),
    ).toBeTruthy();
    signedIn.unmount();

    const anonymous = renderHeader({ userSignedIn: false });
    expect(
      anonymous.container.querySelector('iframe[title="background_refresh"]'),
    ).toBeNull();
  });

  it("hides both menus when navigation is disabled", () => {
    renderHeader({ disableNavigation: true, userSignedIn: true });
    expect(screen.queryByTestId("top-menu")).toBeNull();
    expect(screen.queryByText("Test User")).toBeNull();
    // The logo and toast container survive.
    expect(screen.getByTestId("toasts")).toBeTruthy();
  });

  it("hides the terms menu too when navigation is disabled and signed out", () => {
    renderHeader({ disableNavigation: true, userSignedIn: false });
    expect(screen.queryByTestId("menu-item-help-center")).toBeNull();
  });
});
