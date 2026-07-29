// Coverage: app/assets/src/components/views/LandingPage/components/HeroEmailForm/HeroEmailForm.tsx
// The form validates the entered email, and on a valid submit fires a Relay
// createUser mutation. We drive every branch of registerAccount: the invalid
// path (alert, no mutation), the valid path plus onCompleted redirect, and both
// onError branches (email-taken vs unknown). The disabled button state is
// exercised via isMutationInFlight.
import { fireEvent, render, screen } from "@testing-library/react";

const mockCommit = jest.fn();
let mockInFlight = false;
const mockPush = jest.fn();
const mockTrackEvent = jest.fn();

jest.mock("react-relay", () => ({
  graphql: () => ({}),
  useMutation: () => [mockCommit, mockInFlight],
}));

jest.mock("react-router-dom", () => ({
  useHistory: () => ({ push: mockPush }),
}));

jest.mock("~/api/analytics", () => ({
  ANALYTICS_EVENT_NAMES: {
    LANDING_PAGE_REGISTER_NOW_BUTTON_CLICKED: "register-now-clicked",
  },
  useTrackEvent: () => mockTrackEvent,
}));

jest.mock("~/api/user", () => ({
  EMAIL_TAKEN_ERROR: "Email has already been taken",
}));

jest.mock("~/components/ui/icons/IconSubmitArrow", () => ({
  __esModule: true,
  default: () => <svg data-testid="submit-arrow" />,
}));

import { HeroEmailForm } from "~/components/views/LandingPage/components/HeroEmailForm/HeroEmailForm";

let mockAlert: jest.SpyInstance;

beforeAll(() => {
  // jsdom's location.reload is non-configurable and throws "Not implemented";
  // swap the whole location object so onCompleted/onError can call reload().
  const loc = { ...window.location, reload: jest.fn() };
  Object.defineProperty(window, "location", {
    value: loc,
    writable: true,
    configurable: true,
  });
});

beforeEach(() => {
  mockCommit.mockReset();
  mockPush.mockReset();
  mockTrackEvent.mockReset();
  mockInFlight = false;
  mockAlert = jest.spyOn(window, "alert").mockImplementation(() => undefined);
});

afterEach(() => {
  mockAlert.mockRestore();
});

const typeAndSubmit = (email: string) => {
  const input = screen.getByPlaceholderText(
    "Your email address",
  ) as HTMLInputElement;
  fireEvent.change(input, { target: { value: email } });
  fireEvent.submit(input.closest("form") as HTMLFormElement);
};

describe("HeroEmailForm", () => {
  it("renders the input and register button", () => {
    render(<HeroEmailForm />);
    expect(screen.getByPlaceholderText("Your email address")).toBeTruthy();
    expect(screen.getByText("Register Now")).toBeTruthy();
    expect(screen.getByTestId("submit-arrow")).toBeTruthy();
  });

  it("alerts and does not commit on an invalid email", () => {
    render(<HeroEmailForm />);
    typeAndSubmit("not-an-email");
    expect(mockAlert).toHaveBeenCalledWith(
      "Please enter a valid email address.",
    );
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it("commits the mutation and tracks a lowercased email on a valid submit", () => {
    render(<HeroEmailForm />);
    typeAndSubmit("Person@Example.COM");
    expect(mockCommit).toHaveBeenCalledTimes(1);
    const call = mockCommit.mock.calls[0][0];
    expect(call.variables).toEqual({ email: "Person@Example.COM" });
    expect(mockTrackEvent).toHaveBeenCalledWith("register-now-clicked", {
      email: "person@example.com",
    });
  });

  it("redirects to registration on completion", () => {
    mockCommit.mockImplementation(({ onCompleted }) => onCompleted());
    render(<HeroEmailForm />);
    typeAndSubmit("valid@example.com");
    expect(mockPush).toHaveBeenCalledWith("/users/register");
  });

  it("redirects with the email error when the address is taken", () => {
    mockCommit.mockImplementation(({ onError }) =>
      onError({ message: "Email has already been taken" }),
    );
    render(<HeroEmailForm />);
    typeAndSubmit("valid@example.com");
    expect(mockPush).toHaveBeenCalledWith("/users/register?error=email");
  });

  it("redirects with the unknown error for any other failure", () => {
    mockCommit.mockImplementation(({ onError }) =>
      onError({ message: "server exploded" }),
    );
    render(<HeroEmailForm />);
    typeAndSubmit("valid@example.com");
    expect(mockPush).toHaveBeenCalledWith("/users/register?error=unknown");
  });

  it("disables the submit button while the mutation is in flight", () => {
    mockInFlight = true;
    render(<HeroEmailForm />);
    const button = screen.getByRole("button") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});
