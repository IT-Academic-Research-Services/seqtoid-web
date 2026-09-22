// Coverage: app/assets/src/components/views/LandingPage/components/HeroEmailForm/HeroEmailForm.tsx
// SMP-1901: the landing page no longer collects an email. HeroEmailForm is now a single
// "Register Now" button that fires the analytics event and navigates (full page load) to the
// pre-account export-control signup form (/export_control_signup). We assert the render, the
// analytics event, and the navigation target.
import { fireEvent, render, screen } from "@testing-library/react";

const mockTrackEvent = jest.fn();

jest.mock("~/api/analytics", () => ({
  ANALYTICS_EVENT_NAMES: {
    LANDING_PAGE_REGISTER_NOW_BUTTON_CLICKED: "register-now-clicked",
  },
  useTrackEvent: () => mockTrackEvent,
}));

import { HeroEmailForm } from "~/components/views/LandingPage/components/HeroEmailForm/HeroEmailForm";

const mockAssign = jest.fn();

beforeAll(() => {
  // jsdom's location.assign is a non-implemented no-op; swap the whole location object so we can
  // assert the navigation target.
  const loc = { ...window.location, assign: mockAssign };
  Object.defineProperty(window, "location", {
    value: loc,
    writable: true,
    configurable: true,
  });
});

beforeEach(() => {
  mockTrackEvent.mockReset();
  mockAssign.mockReset();
});

describe("HeroEmailForm", () => {
  it("renders a single Register Now button and no email input", () => {
    render(<HeroEmailForm />);
    expect(
      screen.getByRole("button", { name: "Register for a SeqtoID account" }),
    ).toBeTruthy();
    expect(screen.getByText("Register Now")).toBeTruthy();
    expect(screen.queryByPlaceholderText("Your email address")).toBeNull();
  });

  it("tracks the click and navigates to the signup form", () => {
    render(<HeroEmailForm />);
    fireEvent.click(screen.getByRole("button"));
    expect(mockTrackEvent).toHaveBeenCalledWith("register-now-clicked", {});
    expect(mockAssign).toHaveBeenCalledWith("/export_control_signup");
  });
});
