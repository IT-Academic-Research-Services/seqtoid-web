// Coverage: app/assets/src/components/views/LandingPage/components/HeroEmailForm/HeroEmailForm.tsx
//
// SMP-1709 -- the landing-page "Register Now" form is the self-service signup entry point. It must
// only be offered where self-service signup is enabled (dev); in the gated envs (beta/staging/prod)
// it is replaced by a request-access CTA so visitors cannot self-register. The gate value arrives on
// UserContext.appConfig.selfServiceSignupEnabled (fail-closed: absent/undefined => disabled).
import React from "react";

const mockCommitMutation = jest.fn();
const mockHistoryPush = jest.fn();

jest.mock("react-relay", () => ({
  graphql: () => "HeroEmailFormMutation",
  useMutation: () => [mockCommitMutation, false],
}));

jest.mock("react-router-dom", () => ({
  useHistory: () => ({ push: mockHistoryPush }),
}));

jest.mock("~/api/analytics", () => ({
  useTrackEvent: () => jest.fn(),
  ANALYTICS_EVENT_NAMES: {
    LANDING_PAGE_REGISTER_NOW_BUTTON_CLICKED: "register_now_clicked",
  },
}));

jest.mock("~/api/user", () => ({
  EMAIL_TAKEN_ERROR: "Email has already been taken",
}));

jest.mock("~/components/ui/controls/ExternalLink", () => ({
  __esModule: true,
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

jest.mock("~/components/ui/icons/IconSubmitArrow", () => ({
  __esModule: true,
  default: () => <svg data-testid="submit-arrow" />,
}));

jest.mock("~/components/utils/documentationLinks", () => ({
  CONTACT_US_LINK: "helpcenter:/contact",
}));

import { render, screen } from "@testing-library/react";
import { UserContext } from "~/components/common/UserContext";
import { HeroEmailForm } from "~/components/views/LandingPage/components/HeroEmailForm/HeroEmailForm";

// Minimal UserContext value; only appConfig.selfServiceSignupEnabled matters here.
const renderWithSignup = (selfServiceSignupEnabled?: boolean) =>
  render(
    <UserContext.Provider
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      value={{ appConfig: { selfServiceSignupEnabled } } as any}
    >
      <HeroEmailForm />
    </UserContext.Provider>,
  );

beforeEach(() => {
  mockCommitMutation.mockClear();
  mockHistoryPush.mockClear();
});

describe("HeroEmailForm self-service signup gate (SMP-1709)", () => {
  it("renders the email + Register Now form when signup is enabled", () => {
    renderWithSignup(true);

    expect(screen.getByText("Register Now")).toBeTruthy();
    expect(screen.getByPlaceholderText("Your email address")).toBeTruthy();
    expect(screen.queryByText("Request Access")).toBeNull();
  });

  it("renders a Request Access CTA (not the signup form) when signup is disabled", () => {
    renderWithSignup(false);

    const cta = screen
      .getByText("Request Access")
      .closest("a") as HTMLAnchorElement;
    expect(cta).toBeTruthy();
    expect(cta.getAttribute("href")).toBe("helpcenter:/contact");
    // The account-creation form must not be reachable.
    expect(screen.queryByText("Register Now")).toBeNull();
    expect(screen.queryByPlaceholderText("Your email address")).toBeNull();
  });

  it("fails closed to Request Access when the flag is undefined", () => {
    renderWithSignup(undefined);

    expect(screen.getByText("Request Access")).toBeTruthy();
    expect(screen.queryByText("Register Now")).toBeNull();
  });
});
