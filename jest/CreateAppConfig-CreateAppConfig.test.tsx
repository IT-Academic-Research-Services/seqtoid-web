// Coverage for
// app/assets/src/components/views/AdminSettings/components/CreateAppConfig/CreateAppConfig.tsx
//
// A two-field admin form: name + value, a submit button whose disabled
// predicate is `!(name && value)`, and a status line fed by the awaited
// handleSetAppConfig result. The branches covered here are all three states of
// the disabled predicate (neither field, one field, both fields), the
// `?? ""` null-to-empty-string coercion of the initial state, and the async
// status write-back.
//
// The SDS InputText/Button are replaced with minimal driveable stubs so the
// assertions target this component's own logic.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CreateAppConfig } from "~/components/views/AdminSettings/components/CreateAppConfig/CreateAppConfig";

jest.mock("@czi-sds/components", () => ({
  InputText: ({ id, label, value, onChange }: $TSFixMe) => (
    <input
      data-testid={id}
      aria-label={label}
      value={value}
      onChange={e => onChange(e)}
    />
  ),
  Button: ({ children, onClick, disabled }: $TSFixMe) => (
    <button data-testid="submit" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

const nameInput = () => screen.getByTestId("appConfigName") as HTMLInputElement;
const valueInput = () =>
  screen.getByTestId("appConfigValue") as HTMLInputElement;
const submit = () => screen.getByTestId("submit") as HTMLButtonElement;

describe("CreateAppConfig", () => {
  it("starts with empty inputs (null state coerced to '') and submit disabled", () => {
    render(<CreateAppConfig handleSetAppConfig={jest.fn()} />);
    expect(nameInput().value).toBe("");
    expect(valueInput().value).toBe("");
    expect(submit().disabled).toBe(true);
  });

  it("keeps submit disabled when only the name is filled in", () => {
    render(<CreateAppConfig handleSetAppConfig={jest.fn()} />);
    fireEvent.change(nameInput(), { target: { value: "NEW_FLAG" } });
    expect(nameInput().value).toBe("NEW_FLAG");
    expect(submit().disabled).toBe(true);
  });

  it("keeps submit disabled when only the value is filled in", () => {
    render(<CreateAppConfig handleSetAppConfig={jest.fn()} />);
    fireEvent.change(valueInput(), { target: { value: "on" } });
    expect(valueInput().value).toBe("on");
    expect(submit().disabled).toBe(true);
  });

  it("re-disables submit if a filled field is cleared back to empty", () => {
    render(<CreateAppConfig handleSetAppConfig={jest.fn()} />);
    fireEvent.change(nameInput(), { target: { value: "NEW_FLAG" } });
    fireEvent.change(valueInput(), { target: { value: "on" } });
    expect(submit().disabled).toBe(false);

    fireEvent.change(valueInput(), { target: { value: "" } });
    expect(submit().disabled).toBe(true);
  });

  it("posts both fields and renders the returned status", async () => {
    const handleSetAppConfig = jest
      .fn()
      .mockResolvedValue("App config created");
    render(<CreateAppConfig handleSetAppConfig={handleSetAppConfig} />);

    fireEvent.change(nameInput(), { target: { value: "NEW_FLAG" } });
    fireEvent.change(valueInput(), { target: { value: "on" } });
    expect(submit().disabled).toBe(false);

    fireEvent.click(submit());
    expect(handleSetAppConfig).toHaveBeenCalledWith({
      key: "NEW_FLAG",
      value: "on",
    });
    await waitFor(() =>
      expect(screen.getByText("App config created")).toBeTruthy(),
    );
  });

  it("shows the latest status when the form is submitted twice", async () => {
    const handleSetAppConfig = jest
      .fn()
      .mockResolvedValueOnce("ok")
      .mockResolvedValueOnce("failed");
    render(<CreateAppConfig handleSetAppConfig={handleSetAppConfig} />);

    fireEvent.change(nameInput(), { target: { value: "A" } });
    fireEvent.change(valueInput(), { target: { value: "1" } });
    fireEvent.click(submit());
    await waitFor(() => expect(screen.getByText("ok")).toBeTruthy());

    fireEvent.click(submit());
    await waitFor(() => expect(screen.getByText("failed")).toBeTruthy());
    expect(screen.queryByText("ok")).toBeNull();
    expect(handleSetAppConfig).toHaveBeenCalledTimes(2);
  });
});
