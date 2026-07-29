// Coverage for GeoSearchInputBox: the location autocomplete used by the
// metadata forms. Two halves are exercised here -- the exported pure helpers
// (human-privacy truncation of a city-level location and the warning text) and
// the component's own geosearch category assembly, including the plain-text
// fallback on both the "no matches" and "API error" paths.
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { getGeoSearchSuggestions } from "~/api/locations";
import GeoSearchInputBox, {
  LOCATION_PRIVACY_WARNING,
  LOCATION_UNRESOLVED_WARNING,
  getLocationWarning,
  processLocationSelection,
} from "~/components/ui/controls/GeoSearchInputBox";

jest.mock("~/api/locations", () => ({
  getGeoSearchSuggestions: jest.fn(),
}));

// Keeps prettier's organize-imports from dropping the React import that the
// classic JSX runtime needs in scope.
const _React: typeof React = React;

const mockedSuggestions = getGeoSearchSuggestions as jest.Mock;

const PLACEHOLDER = "Enter a city, region or country";

describe("processLocationSelection", () => {
  const cityLocation = {
    name: "Redwood City, San Mateo County, California, USA",
    geo_level: "city",
    city_name: "Redwood City",
    subdivision_name: "San Mateo County",
    state_name: "California",
    country_name: "USA",
  } as $TSFixMe;

  it("returns the location untouched for non-human samples", () => {
    expect(processLocationSelection(cityLocation, false)).toBe(cityLocation);
  });

  it("returns plain-text locations untouched", () => {
    expect(processLocationSelection("Somewhere", true)).toBe("Somewhere");
  });

  it("returns non-city locations untouched", () => {
    const state = { ...cityLocation, geo_level: "state" };
    expect(processLocationSelection(state, true)).toBe(state);
  });

  it("drops the city and downgrades to subdivision for human samples", () => {
    const result = processLocationSelection(cityLocation, true) as $TSFixMe;
    expect(result).not.toBe(cityLocation);
    // The original object is not mutated.
    expect(cityLocation.city_name).toBe("Redwood City");
    expect(result.city_name).toBe("");
    expect(result.subdivision_name).toBe("San Mateo County");
    expect(result.geo_level).toBe("subdivision");
    expect(result.refetch_adjusted_location).toBe(true);
    expect(result.name).toBe("San Mateo County, California, USA");
  });

  it("also drops a subdivision that duplicates the city name, falling back to state", () => {
    const result = processLocationSelection(
      { ...cityLocation, subdivision_name: "Redwood City" },
      true,
    ) as $TSFixMe;
    expect(result.subdivision_name).toBe("");
    expect(result.geo_level).toBe("state");
    expect(result.name).toBe("California, USA");
  });

  it("falls back to country level when only the country survives", () => {
    const result = processLocationSelection(
      {
        ...cityLocation,
        subdivision_name: "",
        state_name: "",
      },
      true,
    ) as $TSFixMe;
    expect(result.geo_level).toBe("country");
    expect(result.name).toBe("USA");
  });

  it("keeps the original geo level when nothing broader is known", () => {
    const result = processLocationSelection(
      {
        name: "Nowhere",
        geo_level: "city",
        city_name: "Nowhere",
        subdivision_name: "",
        state_name: "",
        country_name: "",
      } as $TSFixMe,
      true,
    ) as $TSFixMe;
    expect(result.geo_level).toBe("city");
    expect(result.name).toBe("");
  });
});

describe("getLocationWarning", () => {
  it("warns when the location did not resolve at all", () => {
    expect(getLocationWarning(null)).toBe(LOCATION_UNRESOLVED_WARNING);
    expect(getLocationWarning(undefined)).toBe(LOCATION_UNRESOLVED_WARNING);
    expect(getLocationWarning({ name: "Plain text" })).toBe(
      LOCATION_UNRESOLVED_WARNING,
    );
  });

  it("warns when the location was truncated for privacy", () => {
    expect(
      getLocationWarning({
        geo_level: "state",
        refetch_adjusted_location: true,
      }),
    ).toBe(LOCATION_PRIVACY_WARNING);
  });

  it("returns no warning for a clean resolved location", () => {
    expect(getLocationWarning({ geo_level: "city" })).toBe("");
  });
});

describe("GeoSearchInputBox rendering", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockedSuggestions.mockReset();
  });
  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  const typeAndSearch = async (value: string) => {
    fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), {
      target: { value },
    });
    await act(async () => {
      jest.advanceTimersByTime(300); // past the 200ms debounce
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  it("shows the string value it is given", () => {
    render(<GeoSearchInputBox value="Berlin" />);
    expect(
      (screen.getByPlaceholderText(PLACEHOLDER) as HTMLInputElement).value,
    ).toBe("Berlin");
  });

  it("shows the name of an object value", () => {
    render(<GeoSearchInputBox value={{ name: "Berlin, Germany" }} />);
    expect(
      (screen.getByPlaceholderText(PLACEHOLDER) as HTMLInputElement).value,
    ).toBe("Berlin, Germany");
  });

  it("renders an empty box for a null value", () => {
    render(<GeoSearchInputBox value={null} />);
    expect(
      (screen.getByPlaceholderText(PLACEHOLDER) as HTMLInputElement).value,
    ).toBe("");
  });

  it("splits server suggestions into title/description and offers plain text", async () => {
    mockedSuggestions.mockResolvedValue([
      { name: "Paris, Ile-de-France, France", locationiq_id: 42 },
    ]);
    render(<GeoSearchInputBox onResultSelect={jest.fn()} />);
    await typeAndSearch("paris");

    expect(mockedSuggestions).toHaveBeenCalledWith("paris");
    expect(screen.getByText("Location Results")).toBeTruthy();
    expect(screen.getByText("Paris")).toBeTruthy();
    expect(screen.getByText("Ile-de-France, France")).toBeTruthy();
    // With matches, the fallback is labelled as an override, not "no results".
    expect(screen.getByText("Use Plain Text (No Location Match)")).toBeTruthy();
  });

  it("offers only the plain-text option when there are no matches", async () => {
    mockedSuggestions.mockResolvedValue([]);
    render(<GeoSearchInputBox onResultSelect={jest.fn()} />);
    await typeAndSearch("zzzzz");

    expect(screen.getByText("No Results (Use Plain Text)")).toBeTruthy();
    expect(screen.queryByText("Location Results")).toBeNull();
    expect(screen.getByText("zzzzz")).toBeTruthy();
  });

  it("falls back to plain text when the geosearch API errors", async () => {
    const consoleSpy = jest
      .spyOn(console, "log")
      .mockImplementation(() => undefined);
    mockedSuggestions.mockRejectedValue(new Error("no api key"));
    render(<GeoSearchInputBox onResultSelect={jest.fn()} />);
    await typeAndSearch("paris");

    expect(consoleSpy).toHaveBeenCalled();
    expect(screen.getByText("No Results (Use Plain Text)")).toBeTruthy();
    expect(screen.queryByText("Location Results")).toBeNull();
    consoleSpy.mockRestore();
  });

  it("passes a picked suggestion straight through to onResultSelect", async () => {
    const onResultSelect = jest.fn();
    mockedSuggestions.mockResolvedValue([
      { name: "Paris, Ile-de-France, France", locationiq_id: 42 },
    ]);
    render(<GeoSearchInputBox onResultSelect={onResultSelect} />);
    await typeAndSearch("paris");

    fireEvent.mouseDown(screen.getByText("Paris"));
    expect(onResultSelect).toHaveBeenCalledTimes(1);
    expect(onResultSelect.mock.calls[0][0].result).toMatchObject({
      title: "Paris",
      description: "Ile-de-France, France",
      key: "loc-42",
    });
  });

  it("wraps a committed plain-text entry in a name object", async () => {
    const onResultSelect = jest.fn();
    mockedSuggestions.mockResolvedValue([]);
    render(<GeoSearchInputBox onResultSelect={onResultSelect} />);
    await typeAndSearch("Mars Base One");

    // Blurring commits whatever was typed as unresolved plain text.
    fireEvent.blur(screen.getByPlaceholderText(PLACEHOLDER));
    expect(onResultSelect).toHaveBeenCalledTimes(1);
    expect(onResultSelect.mock.calls[0][0].result).toEqual({
      name: "Mars Base One",
    });
  });
});
