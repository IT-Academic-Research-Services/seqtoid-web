// Coverage for
// app/assets/src/components/views/SampleView/components/MngsReport/components/ReportStatsRow/utils.ts
import { WORKFLOW_TABS } from "../app/assets/src/components/utils/workflows";
import {
  countFilters,
  filteredMessage,
  renderReportInfo,
} from "../app/assets/src/components/views/SampleView/components/MngsReport/components/ReportStatsRow/utils";

// Control the pre/post Modern-Host-Filtering branch deterministically.
const mockIsFeatureAvailable = jest.fn();
jest.mock("../app/assets/src/components/utils/pipeline_versions", () => ({
  isPipelineFeatureAvailable: (...args: unknown[]) =>
    mockIsFeatureAvailable(...args),
  SHORT_READ_MNGS_MODERN_HOST_FILTERING_FEATURE: "modern_host_filtering",
}));

const genus = (species: unknown[], filteredSpecies: unknown[]) => ({
  species,
  filteredSpecies,
});

describe("ReportStatsRow/utils", () => {
  describe("filteredMessage", () => {
    it("reports both filtered and total when they differ (counting nested species)", () => {
      // reportData: 1 genus row + 2 species = 3 total.
      // filtered: 1 genus row + 1 filteredSpecies = 2.
      const reportData = [genus([{}, {}], [{}])];
      const filteredReportData = [genus([{}], [{}])];
      expect(filteredMessage(filteredReportData, reportData)).toBe(
        "2 rows passing the above filters, out of 3 total rows ",
      );
    });

    it("reports only the total when filtered equals total", () => {
      const reportData = [genus([{}], [{}])];
      const filteredReportData = [genus([{}], [{}])];
      // total = 1 + 1 = 2, filtered = 1 + 1 = 2 -> equal
      expect(filteredMessage(filteredReportData, reportData)).toBe("2 rows ");
    });
  });

  describe("renderReportInfo - short read mNGS", () => {
    beforeEach(() => mockIsFeatureAvailable.mockReset());

    it("uses the post-MHF wording when the feature is available", () => {
      mockIsFeatureAvailable.mockReturnValue(true);
      const msg = renderReportInfo(
        WORKFLOW_TABS.SHORT_READ_MNGS,
        {
          truncatedReadsCount: 5000,
          preSubsamplingCount: 2000,
          postSubsamplingCount: 1000,
          taxonWhitelisted: true,
        },
        { pipeline_version: "8.0.0" },
      );
      // truncatedReadsCount is inserted raw (not locale-formatted).
      expect(msg).toContain("Initial input was truncated to 5000 reads.");
      // Post-MHF phrasing: "reads (N unique reads) subsampled"
      expect(msg).toContain("2,000 reads");
      expect(msg).toContain("(1,000 unique reads) subsampled");
      expect(msg).toContain("whitelist filter of respiratory pathogens");
    });

    it("uses the pre-MHF wording when the feature is unavailable", () => {
      mockIsFeatureAvailable.mockReturnValue(false);
      const msg = renderReportInfo(
        WORKFLOW_TABS.SHORT_READ_MNGS,
        {
          truncatedReadsCount: 0,
          preSubsamplingCount: 2000,
          postSubsamplingCount: 1000,
          taxonWhitelisted: false,
        },
        { pipeline_version: "6.0.0" },
      );
      // Pre-MHF phrasing: "N unique reads subsampled randomly from the M reads"
      expect(msg).toContain("1,000 unique reads subsampled");
      expect(msg).toContain("from the 2,000 reads");
      // truncatedReadsCount 0 and taxonWhitelisted false are compacted out.
      expect(msg).not.toContain("Initial input was truncated");
      expect(msg).not.toContain("whitelist filter");
    });

    it("omits the subsampling message when pre == post counts", () => {
      mockIsFeatureAvailable.mockReturnValue(false);
      const msg = renderReportInfo(
        WORKFLOW_TABS.SHORT_READ_MNGS,
        {
          truncatedReadsCount: 0,
          preSubsamplingCount: 1000,
          postSubsamplingCount: 1000,
          taxonWhitelisted: false,
        },
        { pipeline_version: "6.0.0" },
      );
      expect(msg).toBe("");
    });
  });

  describe("renderReportInfo - long read mNGS", () => {
    it("emits the bases-subsampling message and whitelist note", () => {
      const msg = renderReportInfo(
        WORKFLOW_TABS.LONG_READ_MNGS,
        {
          preSubsamplingCount: 900,
          postSubsamplingCount: 400,
          taxonWhitelisted: true,
        },
        { pipeline_version: "1.0.0" },
      );
      expect(msg).toContain("400 bases subsampled");
      expect(msg).toContain("from the 900 bases");
      expect(msg).toContain("whitelist filter of respiratory pathogens");
    });

    it("returns undefined for an unrelated tab", () => {
      const msg = renderReportInfo(
        WORKFLOW_TABS.AMR,
        // @ts-expect-error unused metadata for this branch
        {},
        { pipeline_version: "1.0.0" },
      );
      expect(msg).toBeUndefined();
    });
  });

  describe("countFilters", () => {
    const baseSelections = {
      categories: {
        categories: ["viruses"],
        subcategories: { viruses: ["phage"] },
      },
      thresholdsShortReads: [{}, {}],
      thresholdsLongReads: [{}],
      taxa: [{}],
      annotations: [{}, {}, {}],
    };

    it("counts short-read thresholds plus taxa, annotations, categories and subcategories", () => {
      // taxa 1 + shortThresholds 2 + annotations 3 + categories 1 + subcategories 1 = 8
      // @ts-expect-error partial FilterSelections shape is sufficient here
      expect(countFilters(WORKFLOW_TABS.SHORT_READ_MNGS, baseSelections)).toBe(
        8,
      );
    });

    it("uses long-read thresholds for the long-read tab", () => {
      // taxa 1 + longThresholds 1 + annotations 3 + categories 1 + subcategories 1 = 7
      // @ts-expect-error partial FilterSelections shape is sufficient here
      expect(countFilters(WORKFLOW_TABS.LONG_READ_MNGS, baseSelections)).toBe(
        7,
      );
    });

    it("tolerates missing category / subcategory maps", () => {
      const selections = {
        categories: {},
        thresholdsShortReads: [],
        thresholdsLongReads: [],
        taxa: [],
        annotations: [],
      };
      // @ts-expect-error partial FilterSelections shape is sufficient here
      expect(countFilters(WORKFLOW_TABS.SHORT_READ_MNGS, selections)).toBe(0);
    });
  });
});
