// Coverage for app/assets/src/components/views/ForgotPassword/ForgotPassword.tsx
//
// ForgotPassword is a two-state screen: the email form, and (after a
// successful submit) the shared ConfirmationMessage. The only logic it owns is
// the `if (email)` guard in handleFormSubmit, so both arms of that guard are
// exercised here -- submitting with an empty field must NOT hit the API and
// must NOT swap the view, while submitting with an address must do both.
import { fireEvent, render, screen } from "@testing-library/react";
import { ForgotPassword } from "~/components/views/ForgotPassword/ForgotPassword";

const mockRequestPasswordReset = jest.fn();

jest.mock("~/api/user", () => ({
  requestPasswordReset: (...args: unknown[]) =>
    mockRequestPasswordReset(...args),
}));

describe("ForgotPassword", () => {
  beforeEach(() => {
    mockRequestPasswordReset.mockReset();
  });

  it("renders the email form on first paint", () => {
    render(<ForgotPassword />);

    expect(screen.getByText("Forgot your password?")).toBeTruthy();
    expect(screen.getByText(/Please enter your email address/)).toBeTruthy();
    const input = screen.getByPlaceholderText(
      "Enter your registered email",
    ) as HTMLInputElement;
    expect(input.getAttribute("type")).toBe("email");
    expect(screen.getByText("Send Email")).toBeTruthy();
  });

  it("does nothing when the email field is left empty", () => {
    render(<ForgotPassword />);

    fireEvent.click(screen.getByText("Send Email"));

    expect(mockRequestPasswordReset).not.toHaveBeenCalled();
    // still on the form, not on the confirmation screen
    expect(screen.getByText("Forgot your password?")).toBeTruthy();
  });

  it("ignores a submit after the field is cleared back to an empty string", () => {
    render(<ForgotPassword />);
    const input = screen.getByPlaceholderText("Enter your registered email");

    fireEvent.change(input, { target: { value: "someone@example.com" } });
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(screen.getByText("Send Email"));

    expect(mockRequestPasswordReset).not.toHaveBeenCalled();
    expect(screen.getByText("Forgot your password?")).toBeTruthy();
  });

  it("requests a reset and swaps in the confirmation message", () => {
    render(<ForgotPassword />);
    const input = screen.getByPlaceholderText("Enter your registered email");

    fireEvent.change(input, { target: { value: "tester@example.com" } });
    fireEvent.click(screen.getByText("Send Email"));

    expect(mockRequestPasswordReset).toHaveBeenCalledTimes(1);
    expect(mockRequestPasswordReset).toHaveBeenCalledWith("tester@example.com");
    expect(
      screen.getByText(/Form submitted! Please check your email/),
    ).toBeTruthy();
    expect(screen.queryByText("Forgot your password?")).toBeNull();
  });
});
