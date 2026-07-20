// CZID-462 coverage: app/assets/src/components/views/DiscoveryView/components/DiscoveryMap/utils.ts
import {
  indexOfMapLevel,
  isValidCoordinate,
} from "../app/assets/src/components/views/DiscoveryView/components/DiscoveryMap/utils";

describe("DiscoveryMap/utils", () => {
  describe("indexOfMapLevel", () => {
    it("returns the ordinal position within MAP_LEVEL_ORDER", () => {
      expect(indexOfMapLevel("country")).toBe(0);
      expect(indexOfMapLevel("state")).toBe(1);
      expect(indexOfMapLevel("city")).toBe(3);
    });

    it("returns -1 for an unknown level", () => {
      expect(indexOfMapLevel("galaxy")).toBe(-1);
    });
  });

  describe("isValidCoordinate", () => {
    it("accepts in-range lat/lng including the boundaries", () => {
      expect(isValidCoordinate(0, 0)).toBe(true);
      expect(isValidCoordinate(90, 180)).toBe(true);
      expect(isValidCoordinate(-90, -180)).toBe(true);
    });

    it("rejects out-of-range latitude", () => {
      expect(isValidCoordinate(90.1, 0)).toBe(false);
      expect(isValidCoordinate(-91, 0)).toBe(false);
    });

    it("rejects out-of-range longitude", () => {
      expect(isValidCoordinate(0, 181)).toBe(false);
      expect(isValidCoordinate(0, -181)).toBe(false);
    });
  });
});
