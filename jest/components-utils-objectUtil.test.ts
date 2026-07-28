// Supplementary coverage for app/assets/src/components/utils/objectUtil.ts.
// jest/objectUtil.test.ts covers the primary happy paths; these cases pin the
// asymmetry of diff() (it reports target-side additions/changes only, never
// deletions), the primitive/null short-circuits in camelize(), and the
// degenerate inputs of the two lookup maps.
import {
  camelize,
  diff,
  reduceObjectArrayToLookupDict,
  TwoWayKeyListMap,
  TwoWayKeyStringMap,
} from "~/components/utils/objectUtil";

describe("objectUtil.diff -- asymmetry and nesting", () => {
  it("does NOT report keys that exist only on the base object", () => {
    // `b` is missing from the target; diff walks the target, so it is invisible.
    expect(diff({ a: 1 }, { a: 1, b: 2 })).toEqual({});
  });

  it("reports a key that exists only on the target", () => {
    expect(diff({ a: 1, b: 2 }, { a: 1 })).toEqual({ b: 2 });
  });

  it("recurses into nested objects and reports only the changed leaf", () => {
    expect(diff({ d: { baz: 1, bat: 9 } }, { d: { baz: 1, bat: 2 } })).toEqual({
      d: { bat: 9 },
    });
  });

  it("returns the whole value (not a recursive diff) when the base side is a primitive", () => {
    expect(diff({ d: { baz: 1 } }, { d: 5 })).toEqual({ d: { baz: 1 } });
  });

  it("returns the target value when the target side is a primitive", () => {
    expect(diff({ d: 5 }, { d: { baz: 1 } })).toEqual({ d: 5 });
  });

  it("returns an empty object for an empty target", () => {
    expect(diff({}, { a: 1 })).toEqual({});
  });
});

describe("objectUtil.camelize -- short circuits", () => {
  it("returns null and undefined unchanged", () => {
    expect(camelize(null)).toBeNull();
    expect(camelize(undefined)).toBeUndefined();
  });

  it("returns booleans and numbers unchanged", () => {
    expect(camelize(false)).toBe(false);
    expect(camelize(0)).toBe(0);
  });

  it("camelCases keys nested inside arrays of objects", () => {
    expect(camelize({ outer_list: [{ inner_key: 1 }] })).toEqual({
      outerList: { "0": { innerKey: 1 } },
    });
  });

  it("leaves already-camelCased keys alone", () => {
    expect(camelize({ alreadyCamel: 1 })).toEqual({ alreadyCamel: 1 });
  });

  it("returns a new object rather than mutating the input", () => {
    const input = { foo_bar: 1 };
    const output = camelize(input);
    expect(output).not.toBe(input);
    expect(input).toEqual({ foo_bar: 1 });
  });
});

describe("objectUtil.reduceObjectArrayToLookupDict -- collisions and coercion", () => {
  it("keeps the LAST object when two entries share a key", () => {
    const arr = [
      { id: "a", n: 1 },
      { id: "a", n: 2 },
    ];
    expect(reduceObjectArrayToLookupDict(arr, "id")).toEqual({
      a: { id: "a", n: 2 },
    });
  });

  it("coerces numeric ids to string keys", () => {
    const arr = [{ id: 7, n: 1 }];
    const dict = reduceObjectArrayToLookupDict(arr, "id");
    expect(Object.keys(dict)).toEqual(["7"]);
    expect(dict["7"]).toEqual({ id: 7, n: 1 });
  });

  it("keys on undefined when the field is absent", () => {
    const dict = reduceObjectArrayToLookupDict([{ n: 1 }], "id");
    expect(dict["undefined"]).toEqual({ n: 1 });
  });
});

describe("objectUtil two-way maps -- degenerate inputs", () => {
  it("TwoWayKeyStringMap returns undefined for unknown keys in both directions", () => {
    const map = new TwoWayKeyStringMap({ a: "1" });
    expect(map.get("nope")).toBeUndefined();
    expect(map.revGet("nope")).toBeUndefined();
  });

  it("TwoWayKeyStringMap handles an empty map", () => {
    const map = new TwoWayKeyStringMap({});
    expect(map.map).toEqual({});
    expect(map.reverseMap).toEqual({});
  });

  it("TwoWayKeyListMap tolerates a key with an empty value list", () => {
    const map = new TwoWayKeyListMap({ a: [], b: ["1"] });
    expect(map.get("a")).toEqual([]);
    expect(map.revGet("1")).toBe("b");
  });

  it("TwoWayKeyListMap throws when a value repeats inside a SINGLE list", () => {
    expect(() => new TwoWayKeyListMap({ a: ["1", "1"] })).toThrow(
      /Duplicate value, 1, in TwoWayKeyListMap/,
    );
  });

  it("TwoWayKeyListMap returns undefined for unknown lookups", () => {
    const map = new TwoWayKeyListMap({ a: ["1"] });
    expect(map.get("zz")).toBeUndefined();
    expect(map.revGet("zz")).toBeUndefined();
  });
});
