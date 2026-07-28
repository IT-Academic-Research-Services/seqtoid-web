// Frontend coverage:
// app/assets/src/components/views/AdminSettings/components/UpdateAppConfig/UpdateAppConfig.tsx
//
// UpdateAppConfig lets an admin pick an app config from a dropdown, edit its
// value and submit it. The logic worth covering is: onSelectAppConfig (looks
// up the config by key and seeds the input with its current value), the submit
// button's disabled predicate (no selection, or value unchanged), and
// onSubmitAppConfig (awaits handleSetAppConfig and shows the returned status).
// The heavy SDS Dropdown/InputText/Button are replaced with minimal, driveable
// stubs so the assertions target the component's own branching.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UpdateAppConfig } from "~/components/views/AdminSettings/components/UpdateAppConfig/UpdateAppConfig";

jest.mock("@czi-sds/components", () => ({
  // Dropdown: renders one option button per config, plus a "clear" button that
  // fires onChange(null) to exercise the falsy-guard branch.
  Dropdown: ({ options, onChange, label }: $TSFixMe) => (
    <div>
      <span data-testid="dropdown-label">{label}</span>
      {options.map((opt: $TSFixMe) => (
        <button
          key={opt.name}
          data-testid={`option-${opt.name}`}
          onClick={() => onChange({ name: opt.name })}
        >
          {opt.name}
        </button>
      ))}
      <button data-testid="option-null" onClick={() => onChange(null)}>
        clear
      </button>
    </div>
  ),
  InputText: ({ value, onChange }: $TSFixMe) => (
    <input
      data-testid="value-input"
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

const appConfigs = [
  { key: "FEATURE_A", value: "on" },
  { key: "FEATURE_B", value: "off" },
];

describe("UpdateAppConfig", () => {
  it("defaults the dropdown label and disables submit with no selection", () => {
    render(
      <UpdateAppConfig
        appConfigs={appConfigs as $TSFixMe}
        handleSetAppConfig={jest.fn()}
      />,
    );
    expect(screen.getByTestId("dropdown-label").textContent).toBe(
      "Select App Config",
    );
    expect((screen.getByTestId("submit") as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("seeds the input and the label when a config is selected", () => {
    render(
      <UpdateAppConfig
        appConfigs={appConfigs as $TSFixMe}
        handleSetAppConfig={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("option-FEATURE_A"));
    expect((screen.getByTestId("value-input") as HTMLInputElement).value).toBe(
      "on",
    );
    expect(screen.getByTestId("dropdown-label").textContent).toBe("FEATURE_A");
  });

  it("ignores a null selection from the dropdown", () => {
    render(
      <UpdateAppConfig
        appConfigs={appConfigs as $TSFixMe}
        handleSetAppConfig={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("option-null"));
    // Still the default label -- onSelectAppConfig was not called.
    expect(screen.getByTestId("dropdown-label").textContent).toBe(
      "Select App Config",
    );
  });

  it("keeps submit disabled while the value equals the current value", () => {
    render(
      <UpdateAppConfig
        appConfigs={appConfigs as $TSFixMe}
        handleSetAppConfig={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("option-FEATURE_A"));
    // Selected but value unchanged -> still disabled.
    expect((screen.getByTestId("submit") as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("enables submit once the value is edited and posts it, showing the status", async () => {
    const handleSetAppConfig = jest
      .fn()
      .mockResolvedValue("App config updated");
    render(
      <UpdateAppConfig
        appConfigs={appConfigs as $TSFixMe}
        handleSetAppConfig={handleSetAppConfig}
      />,
    );
    fireEvent.click(screen.getByTestId("option-FEATURE_B"));
    fireEvent.change(screen.getByTestId("value-input"), {
      target: { value: "on" },
    });
    const submit = screen.getByTestId("submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(false);

    fireEvent.click(submit);
    expect(handleSetAppConfig).toHaveBeenCalledWith({
      key: "FEATURE_B",
      value: "on",
    });
    await waitFor(() =>
      expect(screen.getByText("App config updated")).toBeTruthy(),
    );
  });
});
