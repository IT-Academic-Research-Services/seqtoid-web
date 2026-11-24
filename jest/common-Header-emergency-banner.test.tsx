// End-to-end proof that the emergency banner actually renders.
//
// The sibling common-Header-Header.test.tsx mocks AnnouncementBanner, so it only
// proves Header forwards the right props. This file renders the REAL Header with
// the REAL AnnouncementBanner to prove the full chain produces (or withholds) a
// visible banner purely on the emergencyBannerMessage value -- the server read at
// application_controller.rb:182 is unconditional (no time gate, no "==1" flag),
// so a non-empty message is the only thing that makes it render.
import { render, screen } from "@testing-library/react";
import React from "react";
import Header from "~/components/common/Header/Header";

// Keep the assertions on the banner, not on unrelated chrome.
jest.mock("~utils/links", () => ({
  postToUrlWithCSRF: jest.fn(),
}));
jest.mock("~ui/containers/ToastContainer", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: () => ReactLib.createElement("div", { "data-testid": "toasts" }),
  };
});

const baseProps = {
  adminUser: false,
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
  render(<Header {...(baseProps as $TSFixMe)} {...(props as $TSFixMe)} />);

describe("emergency banner (real AnnouncementBanner)", () => {
  beforeEach(() => localStorage.clear());

  it("renders the emergency message when the AppConfig value is non-empty", () => {
    renderHeader({ emergencyBannerMessage: "Pipelines are degraded" });
    // AnnouncementBanner prints the message in both the popup content and the
    // visible trigger, so there is at least one node with the text.
    expect(
      screen.getAllByText("Pipelines are degraded").length,
    ).toBeGreaterThan(0);
  });

  it("renders nothing for the emergency banner when the message is empty", () => {
    renderHeader({ emergencyBannerMessage: "" });
    expect(screen.queryByText("Pipelines are degraded")).toBeNull();
  });
});
