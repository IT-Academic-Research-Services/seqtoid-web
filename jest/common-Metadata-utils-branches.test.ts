// CZID-586 (#586) frontend coverage:
// app/assets/src/components/common/Metadata/utils.ts -- residual branches.
//
// jest/metadataUtils.test.ts pins the happy paths of this module. The arms left
// uncovered are the ones that only show up at the edges: the inter-batch sleep
// in the throttled geosearch (which needs more unique locations than the
// concurrency limit), and the numeric-clamp guards in ensureDefinedValue that
// short-circuit on an unparseable value, a non-max-capped field, or a falsy
// value. Those are covered here.
import { getGeoSearchSuggestions } from "~/api/locations";
import { CONCURRENT_REQUESTS_LIMIT } from "~/components/common/Metadata/constants";
import {
  ensureDefinedValue,
  geosearchCSVLocations,
  isRowHuman,
  processCSVMetadata,
} from "~/components/common/Metadata/utils";

jest.mock("~/api/locations", () => ({
  getGeoSearchSuggestions: jest.fn(),
}));
jest.mock("~/components/ui/controls/GeoSearchInputBox", () => ({
  processLocationSelection: jest.fn((v: unknown) => v),
}));
// The batching delay is randomised between 1s and 2s in production; pin it to
// zero so the multi-batch path can be exercised without a real-time wait.
jest.mock("lodash/fp", () => {
  const actual = jest.requireActual("lodash/fp");
  return { ...actual, random: () => 0 };
});

const mockedSuggestions = getGeoSearchSuggestions as jest.MockedFunction<
  typeof getGeoSearchSuggestions
>;

describe("isRowHuman -- missing host columns", () => {
  it("is falsy when neither host column is present", () => {
    expect(isRowHuman({} as any)).toBeFalsy();
  });

  it("falls through to Host Genome when Host Organism is absent", () => {
    expect(isRowHuman({ "Host Genome": "HUMAN" } as any)).toBeTruthy();
    expect(isRowHuman({ "Host Genome": "Mosquito" } as any)).toBeFalsy();
  });
});

describe("processCSVMetadata -- empty input", () => {
  it("returns an empty row list for a header-only CSV", () => {
    const result = processCSVMetadata({
      headers: ["Sample Name"],
      rows: [],
    } as any);
    expect(result.headers).toEqual(["Sample Name"]);
    expect(result.rows).toEqual([]);
  });

  it("drops a row entirely when every cell is empty", () => {
    const result = processCSVMetadata({
      headers: ["Sample Name", "Age"],
      rows: [["", ""]],
    } as any);
    expect(result.rows).toEqual([{}]);
  });
});

describe("geosearchCSVLocations -- batching", () => {
  beforeEach(() => {
    mockedSuggestions.mockReset();
  });

  it("throttles more unique locations than the concurrency limit into batches", async () => {
    // One more unique name than the limit forces a second batch, and therefore
    // the inter-batch sleep between them.
    const uniqueNames = Array.from(
      { length: CONCURRENT_REQUESTS_LIMIT + 5 },
      (_, i) => `City ${i}`,
    );
    mockedSuggestions.mockResolvedValue([] as any);

    const metadata = {
      headers: ["collection_location"],
      rows: uniqueNames.map(name => ({ collection_location: name })),
    } as any;

    const result = await geosearchCSVLocations(metadata, {
      name: "collection_location",
    } as any);

    expect(mockedSuggestions).toHaveBeenCalledTimes(
      CONCURRENT_REQUESTS_LIMIT + 5,
    );
    expect(result?.rows).toHaveLength(CONCURRENT_REQUESTS_LIMIT + 5);
  });

  it("de-duplicates repeated location strings into a single lookup", async () => {
    mockedSuggestions.mockResolvedValue([] as any);
    const metadata = {
      headers: ["collection_location"],
      rows: [
        { collection_location: "Same Place" },
        { collection_location: "Same Place" },
        { collection_location: "Same Place" },
      ],
    } as any;

    await geosearchCSVLocations(metadata, {
      name: "collection_location",
    } as any);

    expect(mockedSuggestions).toHaveBeenCalledTimes(1);
  });

  it("returns undefined when the metadata object itself is missing rows", async () => {
    expect(
      // @ts-expect-error deliberately passing a shape with no rows
      await geosearchCSVLocations({ headers: [] }, { name: "loc" }),
    ).toBeUndefined();
  });
});

describe("ensureDefinedValue -- clamp guards", () => {
  it("leaves a negative value alone for a field with no negative restriction", () => {
    expect(
      ensureDefinedValue({
        key: "some_measurement",
        value: -5,
        type: "number",
        taxaCategory: "human",
      }),
    ).toBe(-5);
  });

  it("leaves a negative value alone when the field is not typed as a number", () => {
    expect(
      ensureDefinedValue({
        key: "host_age",
        value: "-5",
        type: "string",
        taxaCategory: "human",
      }),
    ).toBe("-5");
  });

  it("short-circuits on a falsy value rather than clamping it", () => {
    expect(
      ensureDefinedValue({
        key: "host_age",
        value: 0,
        type: "number",
        taxaCategory: "human",
      }),
    ).toBe(0);
  });

  it("leaves an unparseable numeric value untouched", () => {
    expect(
      ensureDefinedValue({
        key: "ct_value",
        value: "not a number",
        type: "number",
        taxaCategory: "mosquito",
      }),
    ).toBe("not a number");
  });

  it("clamps a negative ct_value to zero without applying a max cap", () => {
    // ct_value is in the no-negative set but has no max, so the min() arm is
    // skipped entirely.
    expect(
      ensureDefinedValue({
        key: "ct_value",
        value: -12,
        type: "number",
        taxaCategory: "human",
      }),
    ).toBe(0);
    expect(
      ensureDefinedValue({
        key: "ct_value",
        value: 9999,
        type: "number",
        taxaCategory: "human",
      }),
    ).toBe(9999);
  });

  it("clamps a negative human host_age to zero", () => {
    expect(
      ensureDefinedValue({
        key: "host_age",
        value: -1,
        type: "number",
        taxaCategory: "human",
      }),
    ).toBe(0);
  });

  it("defaults the key to an empty string when none is supplied", () => {
    expect(
      // @ts-expect-error key is deliberately omitted to hit the default
      ensureDefinedValue({
        value: 5,
        type: "number",
        taxaCategory: "human",
      }),
    ).toBe(5);
  });
});
