// Coverage: app/assets/src/components/views/UserProfileForm/components/
//   CountryFormField/CountryFormField.tsx
//
// CountryFormField wraps a real MUI Autocomplete. These tests render the real
// Autocomplete (only axios is mocked) so they exercise the actual typing,
// filtering and selection behaviour a user sees -- the previous suite stubbed
// MUI out entirely, which is why the two field bugs went unnoticed.
//
// The three assertions tagged REQUIRED reproduce the in-app support report from
// user 468 (env-prod SHA 56e14321, "I can't choose country"): they FAIL against
// the pre-fix component and PASS after it.
import { act, fireEvent, render, screen } from "@testing-library/react";
import axios from "axios";
import React from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */

const _React: typeof React = React;

jest.mock("axios");

import { CountryFormField } from "~/components/views/UserProfileForm/components/CountryFormField/CountryFormField";

function country(name: string, region: string, incomeLevel: string) {
  return {
    name,
    region: { value: region },
    incomeLevel: { value: incomeLevel },
  };
}

// A small but representative slice of the World Bank response. "Malaysia" and
// "Mali" match the query "Mal"; "Kenya" and "Norway" do not, so they let us
// assert that filtering actually narrowed the list.
const WORLD_BANK_RESPONSE = {
  data: [
    { page: 1 },
    [
      country("Malaysia", "East Asia & Pacific", "Upper middle income"),
      country("Mali", "Sub-Saharan Africa", "Low income"),
      country("Kenya", "Sub-Saharan Africa", "Lower middle income"),
      country("Norway", "Europe & Central Asia", "High income"),
    ],
  ],
};

function renderComp() {
  const setCountry = jest.fn();
  const setWorldBankIncome = jest.fn();
  const utils = render(
    <CountryFormField
      setCountry={setCountry}
      setWorldBankIncome={setWorldBankIncome}
    />,
  );
  return { setCountry, setWorldBankIncome, ...utils };
}

// Flush pending microtasks (the mount fetch resolving) inside act().
async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

function openDropdown(input: HTMLElement) {
  fireEvent.mouseDown(input);
  fireEvent.keyDown(input, { key: "ArrowDown" });
}

// Mirrors a real user: the field is focused first, then text is entered. MUI
// only preserves typed text while the input is focused, so skipping the focus
// would not reflect what the user does.
function typeInto(input: HTMLElement, text: string) {
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: text } });
}

beforeEach(() => {
  jest.clearAllMocks();
  (axios.get as jest.Mock).mockResolvedValue(WORLD_BANK_RESPONSE);
});

describe("CountryFormField", () => {
  // REQUIRED #1 -- root cause A: the list was only fetched on the first
  // keystroke, so an unprompted click showed "No options".
  it("populates the options list on mount, before any input", async () => {
    renderComp();
    await flush();
    const input = screen.getByRole("combobox");
    openDropdown(input);
    await flush();
    expect(screen.queryAllByRole("option").length).toBeGreaterThan(0);
    expect(screen.queryByText("Malaysia")).toBeTruthy();
  });

  // REQUIRED #2 -- root cause B: the selected value and the typed text were the
  // same state, reset to null on non-exact input, so the first character the
  // user typed was wiped.
  it("leaves the input reading 'Mal' after typing 'Mal' once", async () => {
    renderComp();
    await flush();
    const input = screen.getByRole("combobox") as HTMLInputElement;
    typeInto(input, "Mal");
    await flush();
    expect(input.value).toBe("Mal");
  });

  // REQUIRED #3 -- with the text preserved, the list filters to the match and
  // the country can be chosen on the first attempt (reporting its income).
  it("shows Malaysia in the filtered options and selects it on the first attempt", async () => {
    const { setCountry, setWorldBankIncome } = renderComp();
    await flush();
    const input = screen.getByRole("combobox") as HTMLInputElement;
    typeInto(input, "Mal");
    await flush();
    // Filtering actually narrowed the list: "Mal" matches stay, others drop.
    expect(screen.queryByText("Malaysia")).toBeTruthy();
    expect(screen.queryByText("Kenya")).toBeNull();
    // And it is selectable on this first attempt.
    fireEvent.click(screen.getByText("Malaysia"));
    expect(setCountry).toHaveBeenLastCalledWith("Malaysia");
    expect(setWorldBankIncome).toHaveBeenLastCalledWith("Upper middle income");
  });

  // Requirement #3 of the fix: a failed fetch surfaces inline on the field,
  // never via a blocking window.alert.
  it("shows an inline error and does not call window.alert when the fetch fails", async () => {
    const alertSpy = jest.spyOn(window, "alert").mockImplementation(() => {});
    (axios.get as jest.Mock).mockRejectedValueOnce(new Error("network down"));
    renderComp();
    await flush();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(/could not load the country list/i)).toBeTruthy();
    alertSpy.mockRestore();
  });
});
