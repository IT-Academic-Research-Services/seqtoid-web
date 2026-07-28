// Coverage for app/assets/src/components/views/MetadataDictionary/constants.ts
import {
  GROUP_ORDER,
  getGroupIndex,
} from "~/components/views/MetadataDictionary/constants";

describe("MetadataDictionary/constants", () => {
  it("exposes the canonical group ordering", () => {
    expect(GROUP_ORDER).toEqual(["Sample", "Host", "Infection", "Sequencing"]);
  });

  describe("getGroupIndex", () => {
    it("returns the position of a known group", () => {
      expect(getGroupIndex("Sample")).toBe(0);
      expect(getGroupIndex("Host")).toBe(1);
      expect(getGroupIndex("Infection")).toBe(2);
      expect(getGroupIndex("Sequencing")).toBe(3);
    });

    it("sorts unknown groups last by returning the list length", () => {
      expect(getGroupIndex("Custom")).toBe(GROUP_ORDER.length);
      expect(getGroupIndex(undefined)).toBe(GROUP_ORDER.length);
      // Case-sensitive: a near-miss is still "unknown".
      expect(getGroupIndex("sample")).toBe(GROUP_ORDER.length);
    });

    it("orders a mixed list so unknown groups come after known ones", () => {
      const groups = ["Custom", "Sequencing", "Sample", "Other"];
      const sorted = [...groups].sort(
        (a, b) => getGroupIndex(a) - getGroupIndex(b),
      );
      expect(sorted.slice(0, 2)).toEqual(["Sample", "Sequencing"]);
      expect(sorted.slice(2).sort()).toEqual(["Custom", "Other"]);
    });
  });
});
