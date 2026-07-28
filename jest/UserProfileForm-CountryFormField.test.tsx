// Coverage: app/assets/src/components/views/UserProfileForm/components/
//   CountryFormField/CountryFormField.tsx
//
// CountryFormField wraps an MUI Autocomplete. It fetches the World Bank
// country list on input, maps each country to its income level, and reports
// the chosen country + income back to the parent via setCountry /
// setWorldBankIncome. The MUI Autocomplete is stubbed so the test can invoke
// the component's own onChange / onInputChange handlers directly, and axios is
// mocked so fetchCountries' success and error branches are exercised.
import { act, render } from "@testing-library/react";
import axios from "axios";
import React from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */

const _React: typeof React = React;

jest.mock("axios");

// Captures the latest props handed to the stubbed Autocomplete.
const mockAuto: { props: any } = { props: null };

jest.mock("@mui/material", () => ({
  __esModule: true,
  Autocomplete: (props: any) => {
    mockAuto.props = props;
    return require("react").createElement("div", {
      "data-testid": "autocomplete",
    });
  },
  TextField: (props: any) =>
    require("react").createElement("input", { "data-testid": "textfield" }),
}));

import { CountryFormField } from "~/components/views/UserProfileForm/components/CountryFormField/CountryFormField";

const WORLD_BANK_RESPONSE = {
  data: [
    { page: 1 },
    [
      {
        name: "Kenya",
        region: { value: "Sub-Saharan Africa" },
        incomeLevel: { value: "Lower middle income" },
      },
      {
        name: "Norway",
        region: { value: "Europe" },
        incomeLevel: { value: "High income" },
      },
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

beforeEach(() => {
  mockAuto.props = null;
  jest.clearAllMocks();
  (axios.get as jest.Mock).mockResolvedValue(WORLD_BANK_RESPONSE);
});

describe("CountryFormField", () => {
  it("renders the Country title and the autocomplete", () => {
    const { getByText, getByTestId } = renderComp();
    expect(getByText("Country")).toBeTruthy();
    expect(getByTestId("autocomplete")).toBeTruthy();
  });

  it("reports an empty country and income on initial mount", () => {
    const { setCountry, setWorldBankIncome } = renderComp();
    // useEffect runs on mount with the empty inputValue.
    expect(setCountry).toHaveBeenCalledWith("");
    expect(setWorldBankIncome).toHaveBeenCalledWith("");
  });

  it("fetches the country list on input and populates the options", async () => {
    renderComp();
    await act(async () => {
      mockAuto.props.onInputChange({}, "Ken", "input");
    });
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining("prefix=Ken"),
    );
    // The fetched country names become the autocomplete options.
    expect(mockAuto.props.options).toEqual(["Kenya", "Norway"]);
  });

  it("selecting a known country reports it with its income level", async () => {
    const { setCountry, setWorldBankIncome } = renderComp();
    // First load the list so `countries` includes Kenya.
    await act(async () => {
      mockAuto.props.onInputChange({}, "Ken", "input");
    });
    // Now pick it via the onChange handler.
    await act(async () => {
      mockAuto.props.onChange({}, "Kenya");
    });
    expect(setCountry).toHaveBeenLastCalledWith("Kenya");
    expect(setWorldBankIncome).toHaveBeenLastCalledWith("Lower middle income");
  });

  it("selecting an unknown country name resets the input to null", async () => {
    const { setCountry } = renderComp();
    await act(async () => {
      mockAuto.props.onChange({}, "Atlantis");
    });
    // Not in the (empty) country list -> input becomes null -> trimmed via ?.
    // setCountry is called with undefined (null?.trim()).
    expect(setCountry).toHaveBeenLastCalledWith(undefined);
  });

  it("clearing the field resets the input value", async () => {
    const { setCountry } = renderComp();
    await act(async () => {
      mockAuto.props.onInputChange({}, "", "clear");
    });
    expect(setCountry).toHaveBeenLastCalledWith("");
    // A clear does not trigger a fetch.
    expect(axios.get).not.toHaveBeenCalled();
  });

  it("alerts when the country fetch fails", async () => {
    const alertSpy = jest.spyOn(window, "alert").mockImplementation(() => {});
    (axios.get as jest.Mock).mockRejectedValueOnce(new Error("network down"));
    renderComp();
    await act(async () => {
      mockAuto.props.onInputChange({}, "Ke", "input");
    });
    expect(alertSpy).toHaveBeenCalledWith("network down");
    alertSpy.mockRestore();
  });
});
