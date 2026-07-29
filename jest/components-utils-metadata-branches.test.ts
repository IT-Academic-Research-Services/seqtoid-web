// Branch coverage top-up for app/assets/src/components/utils/metadata.ts.
// The existing utilsMetadata.test.ts covers the happy paths; these hit the two
// remaining conditional arms: the defaulted `flatten` parameter and the
// non-object (scalar) side of the flatten mapValues predicate.
import {
  formatSendValue,
  processMetadata,
  processMetadataTypes,
  returnHipaaCompliantMetadata,
} from "../app/assets/src/components/utils/metadata";

describe("processMetadata flatten defaulting", () => {
  const raw = [
    {
      key: "collection_location",
      base_type: "location",
      location_validated_value: { name: "San Francisco", id: 7 },
    },
  ] as $TSFixMe;

  it("defaults flatten to false when the caller omits it", () => {
    // `flatten` omitted entirely -> default parameter branch.
    const result = processMetadata({ metadata: raw } as $TSFixMe);
    expect(result.collection_location).toEqual({
      name: "San Francisco",
      id: 7,
    });
  });

  it("leaves scalar values untouched when flattening", () => {
    const mixed = [
      {
        key: "collection_location",
        base_type: "location",
        location_validated_value: { name: "San Francisco" },
      },
      { key: "host_age", base_type: "number", number_validated_value: 42 },
      { key: "sex", base_type: "string", string_validated_value: "Female" },
    ] as $TSFixMe;

    expect(processMetadata({ metadata: mixed, flatten: true })).toEqual({
      collection_location: "San Francisco",
      host_age: 42,
      sex: "Female",
    });
  });

  it("returns an empty object for undefined metadata", () => {
    expect(
      processMetadata({ metadata: undefined, flatten: true } as $TSFixMe),
    ).toEqual({});
  });
});

describe("processMetadataTypes edge inputs", () => {
  it("returns an empty object for undefined", () => {
    expect(processMetadataTypes(undefined)).toEqual({});
  });

  it("returns an empty object for an empty list", () => {
    expect(processMetadataTypes([])).toEqual({});
  });
});

describe("returnHipaaCompliantMetadata boundaries", () => {
  it("caps host_age exactly at the maximum", () => {
    expect(returnHipaaCompliantMetadata("host_age", "90")).toBe("≥ 90");
  });

  it("keeps the value just below the maximum", () => {
    expect(returnHipaaCompliantMetadata("host_age", "89")).toBe("89");
  });

  it("passes through unparseable host_age values", () => {
    // Number.parseInt -> NaN, so the >= comparison is false.
    expect(returnHipaaCompliantMetadata("host_age", "unknown")).toBe("unknown");
  });
});

describe("formatSendValue non-object inputs", () => {
  it("stringifies numeric zero rather than dropping it", () => {
    expect(formatSendValue(0)).toEqual({ String: "0" });
  });

  it("wraps arrays via the object arm (arrays are objects)", () => {
    const value = ["a"] as $TSFixMe;
    expect(formatSendValue(value)).toEqual({
      query_SampleMetadata_metadata_items_location_validated_value_oneOf_1_Input:
        value,
    });
  });
});
