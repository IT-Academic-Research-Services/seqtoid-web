// Coverage: app/assets/src/components/views/DiscoveryView/components/ProjectHeader/components/ProjectSettingsModal/UserManagementForm.tsx
//
// UserManagementForm validates the add-member fields, PUTs the invite, and
// renders the member list. Its behaviour forks on appConfig.autoAccountCreationEnabled:
// with it on, the name field disappears, the button reads "Send Invite", the
// user list shows only emails, and a null username is sent. Both forks plus the
// invalid-field and success paths are exercised here.
const mockPut = jest.fn();
jest.mock("axios", () => ({
  __esModule: true,
  default: { put: (...args: unknown[]) => mockPut(...args) },
}));

jest.mock("~ui/controls", () => {
  const ReactLib = require("react");
  return {
    Input: (props: $TSFixMe) =>
      ReactLib.createElement("input", {
        id: props.id,
        value: props.value,
        onChange: (e: $TSFixMe) => props.onChange(e.target.value),
      }),
  };
});

jest.mock("~ui/controls/buttons/SecondaryButton", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: (props: $TSFixMe) =>
      ReactLib.createElement("button", { onClick: props.onClick }, props.text),
  };
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { UserContext } from "~/components/common/UserContext";
import UserManagementForm from "~/components/views/DiscoveryView/components/ProjectHeader/components/ProjectSettingsModal/UserManagementForm";

const _React: typeof React = React;

const renderForm = (
  autoAccountCreationEnabled: boolean,
  props: $TSFixMe = {},
) =>
  render(
    <UserContext.Provider value={{ appConfig: { autoAccountCreationEnabled } }}>
      <UserManagementForm
        users={props.users ?? [{ name: "Alice", email: "alice@czid.org" }]}
        csrf="csrf-token"
        onUserAdded={props.onUserAdded ?? jest.fn()}
        project={{ id: "42" }}
      />
    </UserContext.Provider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockPut.mockResolvedValue({});
});

describe("UserManagementForm (manual account creation)", () => {
  it("renders the name field, an Add button and name (email) list entries", () => {
    renderForm(false);
    expect(screen.getByText("Full Name")).toBeTruthy();
    expect(screen.getByText("Add")).toBeTruthy();
    expect(screen.getByText("Alice (alice@czid.org)")).toBeTruthy();
  });

  it("shows an invalid-fields message when name and email are empty", () => {
    renderForm(false);
    fireEvent.click(screen.getByText("Add"));
    expect(screen.getByText("Invalid email and name")).toBeTruthy();
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("sends the invite with the entered username and reports success", async () => {
    const onUserAdded = jest.fn();
    renderForm(false, { onUserAdded });
    fireEvent.change(document.getElementById("fullName")!, {
      target: { value: "Bob" },
    });
    fireEvent.change(document.getElementById("email")!, {
      target: { value: "bob@czid.org" },
    });
    fireEvent.click(screen.getByText("Add"));

    await waitFor(() => expect(mockPut).toHaveBeenCalled());
    const [, body] = mockPut.mock.calls[0];
    expect(body.user_name_to_add).toBe("Bob");
    expect(body.user_email_to_add).toBe("bob@czid.org");
    expect(body.authenticity_token).toBe("csrf-token");
    expect(onUserAdded).toHaveBeenCalledWith("Bob", "bob@czid.org");
    await screen.findByText("Invitation sent! User added.");
  });

  it("clears the status message on name/email edits", () => {
    renderForm(false);
    fireEvent.click(screen.getByText("Add"));
    expect(screen.getByText("Invalid email and name")).toBeTruthy();
    fireEvent.change(document.getElementById("fullName")!, {
      target: { value: "X" },
    });
    expect(screen.queryByText("Invalid email and name")).toBeNull();
  });
});

describe("UserManagementForm (auto account creation)", () => {
  it("hides the name field, renames the button and lists emails only", () => {
    renderForm(true);
    expect(screen.queryByText("Full Name")).toBeNull();
    expect(screen.getByText("Send Invite")).toBeTruthy();
    expect(screen.getByText("alice@czid.org")).toBeTruthy();
    expect(screen.queryByText("Alice (alice@czid.org)")).toBeNull();
  });

  it("only requires a valid email and sends a null username", async () => {
    const onUserAdded = jest.fn();
    renderForm(true, { onUserAdded });
    fireEvent.change(document.getElementById("email")!, {
      target: { value: "carol@czid.org" },
    });
    fireEvent.click(screen.getByText("Send Invite"));

    await waitFor(() => expect(mockPut).toHaveBeenCalled());
    expect(mockPut.mock.calls[0][1].user_name_to_add).toBeNull();
    expect(onUserAdded).toHaveBeenCalledWith(null, "carol@czid.org");
  });

  it("rejects an invalid email even when name is not required", () => {
    renderForm(true);
    fireEvent.change(document.getElementById("email")!, {
      target: { value: "not-an-email" },
    });
    fireEvent.click(screen.getByText("Send Invite"));
    expect(screen.getByText("Invalid email")).toBeTruthy();
    expect(mockPut).not.toHaveBeenCalled();
  });
});
