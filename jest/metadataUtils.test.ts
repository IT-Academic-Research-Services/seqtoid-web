// CZID-586 (#586) frontend coverage: Metadata/utils.ts holds the CSV/metadata
// shaping logic used across the upload flow -- host detection, CSV-to-object
// conversion, value clamping, and batched location geosearch. The clamping
// (ensureDefinedValue) has several interacting numeric branches worth pinning.
import { getGeoSearchSuggestions } from "~/api/locations";
import {
  ensureDefinedValue,
  geosearchCSVLocations,
  isRowHuman,
  processCSVMetadata,
} from "~/components/common/Metadata/utils";
import { processLocationSelection } from "~/components/ui/controls/GeoSearchInputBox";

jest.mock("~/api/locations", () => ({
  getGeoSearchSuggestions: jest.fn(),
}));
jest.mock("~/components/ui/controls/GeoSearchInputBox", () => ({
  processLocationSelection: jest.fn((v: unknown) => v),
}));

const mockedSuggestions = getGeoSearchSuggestions as jest.MockedFunction<
  typeof getGeoSearchSuggestions
>;

describe("isRowHuman", () => {
  it("is true when Host Organism is human (case-insensitive)", () => {
    expect(isRowHuman({ "Host Organism": "Human" } as any)).toBeTruthy();
  });
  it("is true when Host Genome is human", () => {
    expect(isRowHuman({ "Host Genome": "human" } as any)).toBeTruthy();
  });
  it("is falsy for a non-human host", () => {
    expect(isRowHuman({ "Host Organism": "Mosquito" } as any)).toBeFalsy();
  });
});

describe("processCSVMetadata", () => {
  it("zips headers to rows and drops empty cells", () => {
    const csv = {
      headers: ["Sample Name", "Host Organism", "Age"],
      rows: [
        ["s1", "Human", ""],
        ["s2", "", "40"],
      ],
    } as any;
    const result = processCSVMetadata(csv);
    expect(result.headers).toEqual(csv.headers);
    // Empty values are stripped, so "Age" is absent from row 0 and "Host
    // Organism" is absent from row 1.
    expect(result.rows[0]).toEqual({
      "Sample Name": "s1",
      "Host Organism": "Human",
    });
    expect(result.rows[1]).toEqual({ "Sample Name": "s2", Age: "40" });
  });

  // SMP-1663: a CSV that uses the snake_case "collection_location" header (as
  // emitted by our own metadata export) must be aliased to the canonical
  // "collection_location_v2" so the location geosearch and confirmation menu,
  // which key off "collection_location_v2", pick up the value.
  it("aliases the legacy collection_location header to collection_location_v2", () => {
    const csv = {
      headers: ["Sample Name", "collection_location"],
      rows: [["s1", "California, USA"]],
    } as any;
    const result = processCSVMetadata(csv);
    expect(result.headers).toEqual(["Sample Name", "collection_location_v2"]);
    expect(result.rows[0]).toEqual({
      "Sample Name": "s1",
      collection_location_v2: "California, USA",
    });
  });

  // Guard against collapsing two distinct columns: if the canonical header is
  // already present, leave the legacy one untouched.
  it("does not rewrite the legacy header when the canonical one is present", () => {
    const csv = {
      headers: ["Sample Name", "collection_location", "collection_location_v2"],
      rows: [["s1", "legacy", "California, USA"]],
    } as any;
    const result = processCSVMetadata(csv);
    expect(result.headers).toEqual([
      "Sample Name",
      "collection_location",
      "collection_location_v2",
    ]);
    expect(result.rows[0]).toEqual({
      "Sample Name": "s1",
      collection_location: "legacy",
      collection_location_v2: "California, USA",
    });
  });
});

describe("ensureDefinedValue", () => {
  it("coerces undefined/null to an empty string", () => {
    expect(
      ensureDefinedValue({
        key: "anything",
        value: undefined,
        type: "string",
        taxaCategory: "human",
      }),
    ).toBe("");
    expect(
      ensureDefinedValue({
        key: "anything",
        value: null,
        type: "string",
        taxaCategory: "human",
      }),
    ).toBe("");
  });

  it("passes through a normal string value untouched", () => {
    expect(
      ensureDefinedValue({
        key: "collection_location",
        value: "California",
        type: "string",
        taxaCategory: "human",
      }),
    ).toBe("California");
  });

  it("clamps a negative number to 0 for a no-negative field", () => {
    expect(
      ensureDefinedValue({
        key: "host_age",
        value: "-5",
        type: "number",
        taxaCategory: "human",
      }),
    ).toBe(0);
  });

  it("caps host_age at maxValue + 1 for human samples", () => {
    // host_age max is 90 -> values above are stored as 91.
    expect(
      ensureDefinedValue({
        key: "host_age",
        value: 200,
        type: "number",
        taxaCategory: "human",
      }),
    ).toBe(91);
  });

  it("does not cap host_age for non-human samples", () => {
    expect(
      ensureDefinedValue({
        key: "host_age",
        value: 200,
        type: "number",
        taxaCategory: "mosquito",
      }),
    ).toBe(200);
  });
});

describe("geosearchCSVLocations", () => {
  beforeEach(() => {
    mockedSuggestions.mockReset();
    (processLocationSelection as jest.Mock).mockClear();
  });

  it("returns undefined when metadata has no rows", async () => {
    // @ts-expect-error deliberately passing an empty shape
    expect(await geosearchCSVLocations(null, { name: "loc" })).toBeUndefined();
  });

  it("replaces matched plain-text locations with the top geosearch result", async () => {
    mockedSuggestions.mockResolvedValue([{ name: "San Francisco, CA" }] as any);
    (processLocationSelection as jest.Mock).mockImplementation(
      (v: unknown) => `resolved:${JSON.stringify(v)}`,
    );

    const metadata = {
      headers: ["collection_location"],
      rows: [{ collection_location: "SF" }],
    } as any;

    const result = await geosearchCSVLocations(metadata, {
      name: "collection_location",
    } as any);

    expect(mockedSuggestions).toHaveBeenCalledWith("SF", 1);
    expect(result?.rows[0].collection_location).toContain("resolved:");
  });

  it("leaves rows unchanged when there is no geosearch match", async () => {
    mockedSuggestions.mockResolvedValue([] as any);
    const metadata = {
      headers: ["collection_location"],
      rows: [{ collection_location: "Nowhere" }],
    } as any;

    const result = await geosearchCSVLocations(metadata, {
      name: "collection_location",
    } as any);

    expect(result?.rows[0].collection_location).toBe("Nowhere");
  });
});
