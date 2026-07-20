// Coverage for
// app/assets/src/components/views/SamplesHeatmapView/components/SamplesHeatmapFilters/samplesHeatmapFilterUtils.ts
import {
  optionsToSDSFormat,
  valueToName,
  valueToSDSFormatOption,
} from "../app/assets/src/components/views/SamplesHeatmapView/components/SamplesHeatmapFilters/samplesHeatmapFilterUtils";

const options = [
  { text: "NT rPM", value: "NT_rpm" },
  { text: "NR rPM", value: "NR_rpm" },
];

describe("samplesHeatmapFilterUtils", () => {
  describe("valueToName", () => {
    let errorSpy: jest.SpyInstance;
    beforeEach(() => {
      errorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
    });
    afterEach(() => errorSpy.mockRestore());

    it("returns empty string when there are no options", () => {
      expect(valueToName("NT_rpm", [])).toBe("");
    });

    it.each([
      ["", "empty"],
      [null, "null"],
      [undefined, "undefined"],
    ])("returns empty string for %s value", value => {
      // @ts-expect-error deliberately passing empty/null/undefined
      expect(valueToName(value, options)).toBe("");
    });

    it("returns the matching option text for a 1:1 mapping", () => {
      expect(valueToName("NT_rpm", options)).toBe("NT rPM");
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it("logs and returns the first text when a value maps to multiple options", () => {
      const dupes = [
        { text: "First", value: "dup" },
        { text: "Second", value: "dup" },
      ];
      expect(valueToName("dup", dupes)).toBe("First");
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("multiple options found for value dup"),
        dupes,
      );
    });

    it("logs and returns the stringified value when no option matches", () => {
      expect(valueToName(42, options)).toBe("42");
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("no options found for value 42"),
        options,
      );
    });
  });

  describe("valueToSDSFormatOption", () => {
    it("wraps the resolved name into text/name/value", () => {
      expect(valueToSDSFormatOption("NR_rpm", options)).toEqual({
        text: "NR rPM",
        name: "NR rPM",
        value: "NR_rpm",
      });
    });

    it("preserves the raw value even when the name resolves to empty", () => {
      expect(valueToSDSFormatOption("", options)).toEqual({
        text: "",
        name: "",
        value: "",
      });
    });
  });

  describe("optionsToSDSFormat", () => {
    it("copies text into a name field for each option", () => {
      expect(optionsToSDSFormat(options)).toEqual([
        { text: "NT rPM", name: "NT rPM", value: "NT_rpm" },
        { text: "NR rPM", name: "NR rPM", value: "NR_rpm" },
      ]);
    });

    it("defaults missing/empty text to an empty string for both text and name", () => {
      const result = optionsToSDSFormat([
        // @ts-expect-error text intentionally omitted
        { value: "x" },
      ]);
      expect(result).toEqual([{ text: "", name: "", value: "x" }]);
    });
  });
});
