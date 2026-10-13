// Coverage: app/assets/src/components/views/UserProfileForm/components/
//   InstitutionFormField/InstitutionFormField.tsx
//
// InstitutionFormField wraps an MUI Autocomplete that searches the ROR v2 API for
// institutions as the user types (debounced), offers the returned display names,
// and reports the typed institution + the matching ROR id to the parent. The MUI
// Autocomplete is stubbed so the test can drive onInputChange / onSelect
// directly; axios is mocked; timers are faked to step over the debounce.
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

import {
  InstitutionFormField,
  ROR_SEARCH_DEBOUNCE_MS,
  ROR_SEARCH_URL,
  rorDisplayName,
  rorNameToId,
  sanitizeRORQuery,
} from "~/components/views/UserProfileForm/components/InstitutionFormField/InstitutionFormField";

const STANFORD_ID = "https://ror.org/00f54p054";
const ILVO_ID = "https://ror.org/05cjt1n05";

// A ROR v2 search result: names[] (ror_display / label / acronym ...), no top-level name.
const v2Item = (displayName: string, id = STANFORD_ID, extra: any[] = []) => ({
  id,
  names: [
    ...extra,
    { lang: null, types: ["ror_display", "label"], value: displayName },
  ],
  locations: [{ geonames_details: { country_name: "United States" } }],
  types: ["education"],
});

const rorResponse = (...items: any[]) => ({ data: { items } });

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

// Type `value` and let the debounced search run and resolve.
async function type(value: string | null, reason = "input") {
  await act(async () => {
    mockAuto.props.onInputChange({}, value, reason);
  });
  await act(async () => {
    jest.advanceTimersByTime(ROR_SEARCH_DEBOUNCE_MS);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  mockAuto.props = null;
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("sanitizeRORQuery", () => {
  it.each([
    ["ILVO -", "ILVO"],
    ["ILVO (", "ILVO"],
    ["CZ Biohub SF:", "CZ Biohub SF"],
    ["Ghent University /", "Ghent University"],
    ["Max Planck (Berlin)", "Max Planck Berlin"],
    ['"quoted" [x] {y} a^b ~c *d ?e !f \\g', "quoted x y a b c d e f g"],
    ["Food AND Drug OR NOT", "Food and Drug or not"],
    ["Université Paris-Saclay", "Université Paris Saclay"],
    ["   ", ""],
  ])("turns %p into the plain-text search %p", (input, expected) => {
    expect(sanitizeRORQuery(input)).toBe(expected);
  });
});

describe("rorDisplayName / rorNameToId", () => {
  it("prefers the ror_display name over acronyms and labels", () => {
    expect(
      rorDisplayName(
        v2Item("Stanford University", STANFORD_ID, [
          { types: ["acronym"], value: "SU" },
        ]),
      ),
    ).toBe("Stanford University");
  });

  it("falls back to a label, then the first name", () => {
    expect(
      rorDisplayName({ names: [{ types: ["label"], value: "Label Name" }] }),
    ).toBe("Label Name");
    expect(
      rorDisplayName({ names: [{ types: ["acronym"], value: "ACR" }] }),
    ).toBe("ACR");
    expect(rorDisplayName({})).toBeUndefined();
  });

  it("treats an error body or any non-list reply as no results", () => {
    // ROR answers HTTP 200 with this for a query-syntax error.
    expect(rorNameToId({ errors: ["parse_exception"] })).toEqual({});
    expect(rorNameToId(undefined)).toEqual({});
    expect(rorNameToId({ items: null })).toEqual({});
  });

  it("maps each display name to its ROR id, skipping items without either", () => {
    expect(
      rorNameToId({
        items: [v2Item("Stanford University"), { names: [] }, { id: "x" }],
      }),
    ).toEqual({ "Stanford University": STANFORD_ID });
  });
});

describe("InstitutionFormField", () => {
  it("renders the Institution title and autocomplete", () => {
    const { getByText, getByTestId } = renderComp();
    expect(getByText("Institution")).toBeTruthy();
    expect(getByTestId("autocomplete")).toBeTruthy();
  });

  it("does not report anything before the user types", () => {
    const { setInstitution, setRORId } = renderComp();
    expect(setInstitution).not.toHaveBeenCalled();
    expect(setRORId).not.toHaveBeenCalled();
  });

  it("searches the v2 endpoint with a sanitized, URL-encoded query after the debounce", async () => {
    (axios.get as jest.Mock).mockResolvedValue(rorResponse());
    renderComp();
    await act(async () => {
      mockAuto.props.onInputChange({}, "ILVO -", "input");
    });
    expect(axios.get).not.toHaveBeenCalled(); // still inside the debounce window
    await act(async () => {
      jest.advanceTimersByTime(ROR_SEARCH_DEBOUNCE_MS);
    });
    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(axios.get).toHaveBeenCalledWith(`${ROR_SEARCH_URL}?query=ILVO`);
  });

  it("sends one search for a burst of keystrokes", async () => {
    (axios.get as jest.Mock).mockResolvedValue(rorResponse());
    renderComp();
    await act(async () => {
      mockAuto.props.onInputChange({}, "S", "input");
      mockAuto.props.onInputChange({}, "St", "input");
      mockAuto.props.onInputChange({}, "Sta", "input");
    });
    await act(async () => {
      jest.advanceTimersByTime(ROR_SEARCH_DEBOUNCE_MS);
    });
    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(axios.get).toHaveBeenCalledWith(`${ROR_SEARCH_URL}?query=Sta`);
  });

  it("offers the v2 display names and reports the ROR id on an exact match", async () => {
    (axios.get as jest.Mock).mockResolvedValue(
      rorResponse(v2Item("Stanford University")),
    );
    const { setInstitution, setRORId } = renderComp();
    await type("Stanford University");
    expect(mockAuto.props.options).toEqual(["Stanford University"]);
    expect(setInstitution).toHaveBeenLastCalledWith("Stanford University");
    expect(setRORId).toHaveBeenLastCalledWith(STANFORD_ID);
  });

  it("shows every ROR match, including ones found by acronym", async () => {
    (axios.get as jest.Mock).mockResolvedValue(
      rorResponse(
        v2Item("Instituut voor Landbouw en Visserijonderzoek", ILVO_ID, [
          { types: ["acronym"], value: "ILVO" },
        ]),
      ),
    );
    renderComp();
    await type("ILVO");
    const { options, filterOptions } = mockAuto.props;
    expect(options).toEqual(["Instituut voor Landbouw en Visserijonderzoek"]);
    // MUI calls filterOptions(options, { inputValue }) before rendering the list; the default would
    // drop this option because its name does not contain "ILVO".
    expect(filterOptions(options, { inputValue: "ILVO" })).toEqual(options);
  });

  it("reports the typed institution with an empty ROR id when nothing matches", async () => {
    (axios.get as jest.Mock).mockResolvedValue(rorResponse());
    const { setInstitution, setRORId } = renderComp();
    await type("My Lab Not In ROR ");
    // Reported even with zero results (it used to be dropped, leaving the form unsubmittable).
    expect(setInstitution).toHaveBeenLastCalledWith("My Lab Not In ROR");
    expect(setRORId).toHaveBeenLastCalledWith("");
    expect(mockAuto.props.options).toEqual([]);
  });

  it("does not crash when ROR answers 200 with an errors body instead of items", async () => {
    (axios.get as jest.Mock).mockResolvedValue({
      data: { errors: ["search_phase_execution_exception"] },
    });
    const { setInstitution, getByTestId } = renderComp();
    await type("CZ Biohub SF:");
    expect(getByTestId("autocomplete")).toBeTruthy();
    expect(mockAuto.props.options).toEqual([]);
    expect(setInstitution).toHaveBeenLastCalledWith("CZ Biohub SF:");
  });

  it("keeps the field usable without an alert when the request fails", async () => {
    const alertSpy = jest.spyOn(window, "alert").mockImplementation(() => {});
    (axios.get as jest.Mock).mockRejectedValueOnce(
      new Error("ror unreachable"),
    );
    const { setInstitution } = renderComp();
    await type("Broken");
    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockAuto.props.options).toEqual([]);
    expect(setInstitution).toHaveBeenLastCalledWith("Broken");
    alertSpy.mockRestore();
  });

  it("ignores a reply that arrives after a newer search was sent", async () => {
    let resolveFirst: (v: any) => void = () => {};
    (axios.get as jest.Mock)
      .mockImplementationOnce(() => new Promise(r => (resolveFirst = r)))
      .mockResolvedValueOnce(rorResponse(v2Item("Stanford University")));
    renderComp();
    await type("Stan");
    await type("Stanford University");
    expect(mockAuto.props.options).toEqual(["Stanford University"]);
    await act(async () => {
      resolveFirst(
        rorResponse(v2Item("Stale Result", "https://ror.org/stale")),
      );
    });
    expect(mockAuto.props.options).toEqual(["Stanford University"]);
  });

  it("does not search for input that is only reserved characters", async () => {
    renderComp();
    await type("-(:");
    expect(axios.get).not.toHaveBeenCalled();
  });

  it("clears the input on a clear reason without searching", async () => {
    (axios.get as jest.Mock).mockResolvedValue(rorResponse());
    const { setInstitution } = renderComp();
    await type("Stanford");
    (axios.get as jest.Mock).mockClear();
    await type(null, "clear");
    expect(axios.get).not.toHaveBeenCalled();
    expect(setInstitution).toHaveBeenLastCalledWith("");
  });

  it("searches on a non-null value even for a non-input reason", async () => {
    (axios.get as jest.Mock).mockResolvedValue(rorResponse());
    renderComp();
    await type("MIT", "reset");
    expect(axios.get).toHaveBeenCalledWith(`${ROR_SEARCH_URL}?query=MIT`);
  });

  it("reports the selected option", async () => {
    const { setInstitution } = renderComp();
    act(() => {
      mockAuto.props.onSelect({ target: { value: "Typed Institution" } });
    });
    expect(setInstitution).toHaveBeenLastCalledWith("Typed Institution");
  });
});
