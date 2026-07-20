// CZID-462 coverage: app/assets/src/components/utils/csv.ts
// Pure CSV helpers: parsing, formula-injection sanitizing, blob URL creation,
// and the applied-filters descriptor row.
import {
  createCSVObjectURL,
  createCSVRowForAppliedFilters,
  parseCSVBlob,
  sanitizeCSVRow,
} from "../app/assets/src/components/utils/csv";

describe("utils/csv", () => {
  describe("parseCSVBlob", () => {
    it("splits a headered CSV blob into headers and rows", () => {
      const { headers, rows } = parseCSVBlob("a,b,c\n1,2,3\n4,5,6");
      expect(headers).toEqual(["a", "b", "c"]);
      expect(rows).toEqual([
        ["1", "2", "3"],
        ["4", "5", "6"],
      ]);
    });

    it("skips empty lines", () => {
      const { rows } = parseCSVBlob("a,b\n\n1,2\n");
      expect(rows).toEqual([["1", "2"]]);
    });
  });

  describe("sanitizeCSVRow", () => {
    it("strips leading formula characters to defend against CSV injection", () => {
      expect(sanitizeCSVRow(["=1+1", "+cmd", "-x", "@ref"])).toEqual([
        "1+1",
        "cmd",
        "x",
        "ref",
      ]);
    });

    it("passes numbers through and coerces other non-strings to empty", () => {
      expect(sanitizeCSVRow([42, null as $TSFixMe, "safe"])).toEqual([
        42,
        "",
        "safe",
      ]);
    });

    it("logs and returns undefined for an empty row", () => {
      expect(sanitizeCSVRow([])).toBeUndefined();
    });
  });

  describe("createCSVObjectURL", () => {
    it("assembles headers + rows into a text/csv blob and returns its object URL", () => {
      // jsdom does not implement URL.createObjectURL, so install a stub that
      // captures the Blob the util hands it.
      let capturedBlob: Blob | undefined;
      const original = (URL as $TSFixMe).createObjectURL;
      (URL as $TSFixMe).createObjectURL = jest.fn((blob: $TSFixMe) => {
        capturedBlob = blob;
        return "blob:mock-url";
      });

      const url = createCSVObjectURL(["h1", "h2"], [["a", "b"]]);
      expect(url).toBe("blob:mock-url");
      expect(capturedBlob?.type).toBe("text/csv");
      (URL as $TSFixMe).createObjectURL = original;
    });
  });

  describe("createCSVRowForAppliedFilters", () => {
    it("emits labelled rows for each active filter category with a count header", () => {
      const row = createCSVRowForAppliedFilters(
        {
          categories: {
            categories: ["viruses"],
            subcategories: { Viruses: ["Phage"] },
          },
          taxa: [{ name: "Escherichia coli" }],
          thresholdsShortReads: [
            { metricDisplay: "rPM", operator: ">=", value: 1 },
          ],
          readSpecificity: 1,
          flags: ["known_pathogen"],
        } as $TSFixMe,
        [{ id: 26, name: "Default Background" }],
        { background: 26 } as $TSFixMe,
      );

      const joined = row.join(" | ");
      expect(joined).toContain("Background:");
      expect(joined).toContain("Default Background");
      expect(joined).toContain("Filters Applied:");
      expect(joined).toContain("Categories:");
      expect(joined).toContain("Taxon Name:, Escherichia coli");
      expect(joined).toContain("Thresholds:");
      expect(joined).toContain("Read Specificity:");
      expect(joined).toContain("Pathogen Flags:");
    });

    it("omits the background row when no background is selected", () => {
      const row = createCSVRowForAppliedFilters(
        { readSpecificity: 1 } as $TSFixMe,
        [],
        {} as $TSFixMe,
      );
      const joined = row.join(" | ");
      expect(joined).not.toContain("Background:");
      // readSpecificity 1 maps to the "Specific Only" label.
      expect(joined).toContain("Specific Only");
    });

    it("silently drops readSpecificity 0 (All) because the falsy-value guard skips it", () => {
      // NOTE (pre-existing behavior): the entries loop uses `if (!optionVal)
      // continue`, so a readSpecificity of 0 ("All") is treated as absent and
      // never written to the applied-filters row. Documented, not papered over.
      const row = createCSVRowForAppliedFilters(
        { readSpecificity: 0 } as $TSFixMe,
        [],
        {} as $TSFixMe,
      );
      const joined = row.join(" | ");
      expect(joined).not.toContain("Read Specificity:");
      expect(joined).toContain("0 Filter Applied:");
    });
  });
});
