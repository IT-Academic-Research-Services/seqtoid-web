// CZID-462 coverage: app/assets/src/components/utils/urls.ts
// SampleView URL generation + cross-source selected-option transforms. Pure.
import {
  DISCOVERY_VIEW_SOURCE_TEMP_PERSISTED_OPTIONS,
  generateUrlToSampleView,
  getTempSelectedOptions,
  HEATMAP_SOURCE_TEMP_PERSISTED_OPTIONS,
} from "../app/assets/src/components/utils/urls";

describe("utils/urls", () => {
  describe("generateUrlToSampleView", () => {
    it("builds a bare sample path when no options are supplied", () => {
      expect(generateUrlToSampleView({ sampleId: "123" })).toBe("/samples/123");
    });

    it("prefixes a snapshot share path when snapshotShareId is set", () => {
      const url = generateUrlToSampleView({
        sampleId: "123",
        snapshotShareId: "abc",
      });
      expect(url.startsWith("/pub/abc/samples/123")).toBe(true);
    });

    it("drops the default background (26) from the query unless persistDefaultBg is set", () => {
      const withoutPersist = generateUrlToSampleView({
        sampleId: "123",
        // @ts-expect-error partial temp options are fine for this path
        tempSelectedOptions: { background: 26 },
      });
      // Default background is intentionally not persisted -> not present in URL.
      expect(withoutPersist).not.toContain("26");

      const withPersist = generateUrlToSampleView({
        sampleId: "123",
        persistDefaultBg: true,
        // @ts-expect-error partial temp options are fine for this path
        tempSelectedOptions: { background: 26 },
      });
      expect(withPersist).toContain("26");
    });
  });

  describe("getTempSelectedOptions", () => {
    it("maps discovery-view thresholds straight through (taxonThresholdsSelected)", () => {
      const result = getTempSelectedOptions({
        source: DISCOVERY_VIEW_SOURCE_TEMP_PERSISTED_OPTIONS,
        selectedOptions: {
          background: 7,
          readSpecificity: 1,
          taxonSelected: [{ label: "x", value: 1 }],
          taxonThresholdsSelected: [{ metric: "nt:z_score", value: 1 }],
          annotationsSelected: [{ name: "hit" }],
          categories: ["viruses"],
          subcategories: { Viruses: ["Phage"] },
        } as $TSFixMe,
      });

      expect(result.background).toBe(7);
      expect(result.readSpecificity).toBe(1);
      expect(result.taxa).toEqual([{ label: "x", value: 1 }]);
      expect(result.annotations).toEqual(["hit"]);
      expect(result.categories).toEqual({
        categories: ["viruses"],
        subcategories: { Viruses: ["Phage"] },
      });
      expect(result.thresholdsShortReads).toEqual([
        { metric: "nt:z_score", value: 1 },
      ]);
    });

    it("converts heatmap NT_/NR_ threshold metrics into SampleView nt:/nr: form", () => {
      const result = getTempSelectedOptions({
        source: HEATMAP_SOURCE_TEMP_PERSISTED_OPTIONS,
        selectedOptions: {
          thresholdFilters: [
            { metric: "NT_zscore", value: 2 },
            { metric: "NR_r", value: 5 },
          ],
        } as $TSFixMe,
      });

      expect(result.thresholdsShortReads).toEqual([
        { metric: "nt:z_score", value: 2 },
        { metric: "nr:count", value: 5 },
      ]);
    });

    it("defaults thresholds to an empty array (and logs) for an unknown source", () => {
      const spy = jest.spyOn(console, "error").mockImplementation(() => {});
      const result = getTempSelectedOptions({
        source: "" as $TSFixMe,
        selectedOptions: { background: 1 } as $TSFixMe,
      });
      expect(result.thresholdsShortReads).toEqual([]);
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it("supplies empty defaults when optional selections are missing", () => {
      const result = getTempSelectedOptions({
        source: DISCOVERY_VIEW_SOURCE_TEMP_PERSISTED_OPTIONS,
        selectedOptions: {} as $TSFixMe,
      });
      expect(result.taxa).toEqual([]);
      expect(result.annotations).toEqual([]);
      expect(result.categories).toEqual({ categories: [], subcategories: {} });
    });
  });
});
