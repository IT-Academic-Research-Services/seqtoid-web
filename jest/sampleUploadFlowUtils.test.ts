// Coverage for app/assets/src/components/views/SampleUploadFlow/utils.ts
// `removeLaneFromName` is exercised separately in jest/utils.test.ts; this suite
// covers the remaining exports: search matching/sorting, lane grouping, and the
// BaseSpace OAuth popup helper.
import {
  doesResultMatch,
  groupSamplesByLane,
  openBasespaceOAuthPopup,
  sortResults,
  sortResultsByMatch,
} from "../app/assets/src/components/views/SampleUploadFlow/utils";

const mockOpenUrlInPopupWindow = jest.fn();
jest.mock("../app/assets/src/components/utils/links", () => ({
  openUrlInPopupWindow: (...args: unknown[]) =>
    mockOpenUrlInPopupWindow(...args),
}));

describe("SampleUploadFlow/utils", () => {
  describe("doesResultMatch", () => {
    it("returns true when the query is empty or null", () => {
      expect(doesResultMatch({ name: "anything" }, "")).toBe(true);
      expect(doesResultMatch({ name: "anything" }, null)).toBe(true);
    });

    it("matches characters in order (acronym-style, spaces ignored)", () => {
      // "hb" -> h.*b matches "Human Blood"
      expect(doesResultMatch({ name: "Human Blood" }, "hb")).toBe(true);
      // spaces in the query are stripped before matching
      expect(doesResultMatch({ name: "Human Blood" }, "h b")).toBe(true);
    });

    it("returns false when characters are not present in order", () => {
      expect(doesResultMatch({ name: "Human Blood" }, "zx")).toBe(false);
      // order matters: "bh" cannot match "Human Blood" (b comes after h)
      expect(doesResultMatch({ name: "Human Blood" }, "bh")).toBe(false);
    });
  });

  describe("sortResultsByMatch", () => {
    it("returns the index of the (case-insensitive) match", () => {
      expect(sortResultsByMatch({ name: "Human Blood" }, "blood")).toBe(6);
      expect(sortResultsByMatch({ name: "Human Blood" }, "HUMAN")).toBe(0);
    });

    it("returns MAX_SAFE_INTEGER when there is no substring match", () => {
      expect(sortResultsByMatch({ name: "Human Blood" }, "xyz")).toBe(
        Number.MAX_SAFE_INTEGER,
      );
    });
  });

  describe("sortResults", () => {
    const results = [
      { name: "Cerebrospinal Fluid", rank: 3 },
      { name: "Blood Plasma", rank: 1 },
      { name: "Whole Blood", rank: 2 },
    ];

    it("sorts by the provided func when query is empty", () => {
      const sorted = sortResults(results, "", r => r.rank);
      expect(sorted.map(r => r.rank)).toEqual([1, 2, 3]);
    });

    it("re-sorts by match position when a query is present", () => {
      // Query "blood" -> "Blood Plasma" (index 0) before "Whole Blood" (index 6),
      // and "Cerebrospinal Fluid" (no match) sinks to the bottom.
      const sorted = sortResults(results, "blood", r => r.rank);
      expect(sorted.map(r => r.name)).toEqual([
        "Blood Plasma",
        "Whole Blood",
        "Cerebrospinal Fluid",
      ]);
    });
  });

  describe("openBasespaceOAuthPopup", () => {
    beforeEach(() => mockOpenUrlInPopupWindow.mockClear());

    it("builds the OAuth URL with response_type=code and opens the popup", () => {
      openBasespaceOAuthPopup({ client_id: "abc", redirect_uri: "https://x" });

      expect(mockOpenUrlInPopupWindow).toHaveBeenCalledTimes(1);
      const [url, windowName, width, height] =
        mockOpenUrlInPopupWindow.mock.calls[0];
      expect(url).toContain("https://basespace.illumina.com/oauth/authorize?");
      expect(url).toContain("response_type=code");
      expect(url).toContain("client_id=abc");
      expect(windowName).toBe("BASESPACE_OAUTH_WINDOW");
      expect(width).toBe(1000);
      expect(height).toBe(600);
    });
  });

  describe("groupSamplesByLane", () => {
    it("collapses BaseSpace lanes: joins dataset ids/selectIds and sums file sizes", () => {
      const samples = [
        {
          name: "SampleA_L001",
          file_type: "fastq",
          basespace_project_id: "P1",
          basespace_dataset_id: 10,
          file_size: 100,
          _selectId: "s1",
        },
        {
          name: "SampleA_L002",
          file_type: "fastq",
          basespace_project_id: "P1",
          basespace_dataset_id: 20,
          file_size: 250,
          _selectId: "s2",
        },
      ];

      // @ts-expect-error partial SampleFromApi shape is sufficient for this path
      const result = groupSamplesByLane({ samples, sampleType: "basespace" });

      expect(result).toHaveLength(1);
      const merged = result[0] as Record<string, unknown>;
      expect(merged.name).toBe("SampleA");
      expect(merged.basespace_dataset_id).toBe("10,20");
      expect(merged.file_size).toBe(350);
      expect(merged._selectId).toBe("s1,s2");
    });

    it("keeps distinct BaseSpace samples in separate groups", () => {
      const samples = [
        {
          name: "SampleA_L001",
          file_type: "fastq",
          basespace_project_id: "P1",
          basespace_dataset_id: 10,
          file_size: 100,
          _selectId: "s1",
        },
        {
          name: "SampleB_L001",
          file_type: "fastq",
          basespace_project_id: "P1",
          basespace_dataset_id: 30,
          file_size: 200,
          _selectId: "s2",
        },
      ];

      // @ts-expect-error partial SampleFromApi shape is sufficient for this path
      const result = groupSamplesByLane({ samples, sampleType: "basespace" });
      expect(result).toHaveLength(2);
    });

    it("concatenates local lane files into a grouped result keyed by sample", () => {
      const mkSample = (lane: string) => ({
        name: `SampleA_${lane}`,
        input_files_attributes: [
          {
            source: `SampleA_${lane}_R1.fastq`,
            parts: `SampleA_${lane}_R1.fastq`,
          },
          {
            source: `SampleA_${lane}_R2.fastq`,
            parts: `SampleA_${lane}_R2.fastq`,
          },
        ],
        files: {
          r1: new File(["r1"], `SampleA_${lane}_R1.fastq`),
          r2: new File(["r2"], `SampleA_${lane}_R2.fastq`),
        },
      });
      const samples = [mkSample("L001"), mkSample("L002")];

      // @ts-expect-error partial SampleFromApi shape is sufficient for this path
      const result = groupSamplesByLane({
        samples,
        sampleType: "local",
      }) as Record<string, $TSFixMe>;

      const keys = Object.keys(result);
      expect(keys).toHaveLength(1);
      const group = result[keys[0]];
      // Both lanes land in the same group and are concatenated.
      expect(group.files).toHaveLength(2);
      expect(group.concatenated.name).toBe("SampleA");
      expect(group.filesR1).toHaveLength(2);
      expect(group.filesR2).toHaveLength(2);
      // The lane numbers are stripped from the concatenated source names.
      expect(group.concatenated.input_files_attributes[0].source).toBe(
        "SampleA_R1.fastq",
      );
    });
  });
});
