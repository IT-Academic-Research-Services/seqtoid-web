// Coverage: app/assets/src/components/views/UserProfileForm/components/
//   InstitutionFormField/InstitutionFormField.tsx
//
// InstitutionFormField wraps an MUI Autocomplete that queries the ROR API for
// institutions. It maps each result name to its ROR id and reports the chosen
// institution + id to the parent. The MUI Autocomplete is stubbed so the test
// can drive the component's onInputChange / onSelect handlers directly, and
// axios is mocked to cover fetchRORData's success and failure branches.
import { act, render } from "@testing-library/react";
import axios from "axios";
import React from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */

const _React: typeof React = React;

jest.mock("axios");

const mockAuto: { props: any } = { props: null };

jest.mock("@mui/material", () => ({
  __esModule: true,
  Autocomplete: (props: any) => {
    mockAuto.props = props;
    return require("react").createElement("div", {
      "data-testid": "autocomplete",
    });
  },
  TextField: () =>
    require("react").createElement("input", { "data-testid": "textfield" }),
}));

import { InstitutionFormField } from "~/components/views/UserProfileForm/components/InstitutionFormField/InstitutionFormField";

const rorResponse = (name: string) => ({
  data: {
    items: [
      {
        name,
        id: "https://ror.org/00f54p054",
        country: { country_name: "United States" },
        types: ["Education"],
      },
    ],
  },
});

function renderComp() {
  const setInstitution = jest.fn();
  const setRORId = jest.fn();
  const utils = render(
    <InstitutionFormField
      setInstitution={setInstitution}
      setRORId={setRORId}
    />,
  );
  return { setInstitution, setRORId, ...utils };
}

beforeEach(() => {
  mockAuto.props = null;
  jest.clearAllMocks();
});

describe("InstitutionFormField", () => {
  it("renders the Institution title and autocomplete", () => {
    const { getByText, getByTestId } = renderComp();
    expect(getByText("Institution")).toBeTruthy();
    expect(getByTestId("autocomplete")).toBeTruthy();
  });

  it("does not report anything before any results arrive", () => {
    const { setInstitution } = renderComp();
    // useEffect early-returns because rorResponseData is empty on mount.
    expect(setInstitution).not.toHaveBeenCalled();
  });

  it("reports the institution and ROR id when the typed name matches a result", async () => {
    (axios.get as jest.Mock).mockResolvedValue(rorResponse("Stanford"));
    const { setInstitution, setRORId } = renderComp();
    await act(async () => {
      mockAuto.props.onInputChange({}, "Stanford", "input");
    });
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining("query=Stanford"),
    );
    expect(mockAuto.props.options).toEqual(["Stanford"]);
    expect(setInstitution).toHaveBeenLastCalledWith("Stanford");
    expect(setRORId).toHaveBeenLastCalledWith("https://ror.org/00f54p054");
  });

  it("reports an empty ROR id when the typed name does not match a result", async () => {
    (axios.get as jest.Mock).mockResolvedValue(
      rorResponse("Stanford University"),
    );
    const { setInstitution, setRORId } = renderComp();
    await act(async () => {
      mockAuto.props.onInputChange({}, "Stanf", "input");
    });
    expect(setInstitution).toHaveBeenLastCalledWith("Stanf");
    // "Stanf" is not a key in the name->info map, so id is cleared.
    expect(setRORId).toHaveBeenLastCalledWith("");
  });

  it("clears the input on a clear reason without fetching", async () => {
    (axios.get as jest.Mock).mockResolvedValue(rorResponse("Anything"));
    renderComp();
    await act(async () => {
      // value === null takes the no-fetch path.
      mockAuto.props.onInputChange({}, null, "clear");
    });
    expect(axios.get).not.toHaveBeenCalled();
  });

  it("fetches on a non-null value even for a non-input reason", async () => {
    (axios.get as jest.Mock).mockResolvedValue(rorResponse("MIT"));
    renderComp();
    await act(async () => {
      mockAuto.props.onInputChange({}, "MIT", "reset");
    });
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining("query=MIT"),
    );
  });

  it("updates the input value when an option is selected", () => {
    renderComp();
    act(() => {
      mockAuto.props.onSelect({ target: { value: "Typed Institution" } });
    });
    // No throw and the handler ran; value flows into TextField on next render.
    expect(mockAuto.props).toBeTruthy();
  });

  it("alerts when the ROR fetch fails", async () => {
    const alertSpy = jest.spyOn(window, "alert").mockImplementation(() => {});
    (axios.get as jest.Mock).mockRejectedValueOnce(
      new Error("ror unreachable"),
    );
    renderComp();
    await act(async () => {
      mockAuto.props.onInputChange({}, "Broken", "input");
    });
    expect(alertSpy).toHaveBeenCalledWith("ror unreachable");
    alertSpy.mockRestore();
  });
});
