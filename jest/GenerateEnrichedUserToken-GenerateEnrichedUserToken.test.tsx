// Coverage for
// app/assets/src/components/views/AdminSettings/components/GenerateEnrichedUserToken/GenerateEnrichedUserToken.tsx
//
// The admin "generate enriched user token" panel keeps a userId, an
// include-headers checkbox and a success-callout intent in local state. The
// Generate button is disabled while the id is empty; once clicked it fetches a
// token, copies it to the clipboard and shows the success callout. Only the
// core `get` helper and the clipboard are mocked; the SDS widgets render for
// real so the disabled/enabled and callout branches are exercised end to end.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { get } from "~/api/core";
import { GenerateEnrichedUserToken } from "~/components/views/AdminSettings/components/GenerateEnrichedUserToken/GenerateEnrichedUserToken";

jest.mock("~/api/core", () => ({
  get: jest.fn(),
}));

// Keep prettier's organize-imports from dropping the React import the classic
// JSX runtime needs in scope.
const _React: typeof React = React;

const mockedGet = get as jest.Mock;

const writeText = jest.fn();

beforeAll(() => {
  Object.defineProperty(global.navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});

beforeEach(() => {
  mockedGet.mockReset();
  writeText.mockReset();
});

function userIdInput() {
  return document.getElementById("userId") as HTMLInputElement;
}

function generateButton() {
  return screen.getByRole("button", { name: /Generate Token/i });
}

describe("GenerateEnrichedUserToken", () => {
  it("disables the Generate button until a user id is entered", () => {
    render(<GenerateEnrichedUserToken />);
    expect((generateButton() as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(userIdInput(), { target: { value: "42" } });
    expect((generateButton() as HTMLButtonElement).disabled).toBe(false);
    expect(userIdInput().value).toBe("42");
  });

  it("fetches, copies the token and shows the success callout with headers by default", async () => {
    mockedGet.mockResolvedValue({ token: "tok-abc" });
    render(<GenerateEnrichedUserToken />);

    fireEvent.change(userIdInput(), { target: { value: "99" } });
    fireEvent.click(generateButton());

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("tok-abc"));
    // include_headers defaults to true.
    expect(mockedGet).toHaveBeenCalledWith("/enrich_token_for_admin", {
      params: { include_headers: true, user_id: "99" },
    });
    expect(
      (await screen.findByText(/Successfully copied enriched user token/))
        .textContent,
    ).toContain("99");
  });

  it("passes include_headers=false after toggling the checkbox", async () => {
    mockedGet.mockResolvedValue({ token: "tok-xyz" });
    render(<GenerateEnrichedUserToken />);

    fireEvent.change(userIdInput(), { target: { value: "7" } });
    // The only checkbox on the panel is the include-headers toggle.
    const checkbox = document.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    fireEvent.click(checkbox);
    fireEvent.click(generateButton());

    await waitFor(() =>
      expect(mockedGet).toHaveBeenCalledWith("/enrich_token_for_admin", {
        params: { include_headers: false, user_id: "7" },
      }),
    );
  });

  it("does not show the callout when the API returns no token", async () => {
    mockedGet.mockResolvedValue({ token: undefined });
    render(<GenerateEnrichedUserToken />);

    fireEvent.change(userIdInput(), { target: { value: "3" } });
    fireEvent.click(generateButton());

    await waitFor(() => expect(mockedGet).toHaveBeenCalled());
    expect(writeText).not.toHaveBeenCalled();
    expect(
      screen.queryByText(/Successfully copied enriched user token/),
    ).toBeNull();
  });
});
