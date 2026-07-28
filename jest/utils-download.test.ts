// Coverage: app/assets/src/components/utils/download.ts
// Pure helpers that derive the sample download menu (labels, paths, new-page
// flags) from pipeline run metadata, plus the analytics event-name builder.
import {
  getDownloadContigUrl,
  getDownloadDropdownOptions,
  getDownloadLinks,
  getLinkInfoForDownloadOption,
  logDownloadOption,
} from "~/components/utils/download";

const NON_HOST_READS = "Download Non-Host Reads (.fasta)";
const NON_HOST_CONTIGS = "Download Non-Host Contigs (.fasta)";
const NON_HOST_CONTIGS_MAPPING = "Download Non-Host Contigs Summary (.csv)";
const UNMAPPED_READS = "Download Unmapped Reads (.fasta)";
const RESULTS_FOLDER = "View Results Folder";
const PIPELINE_VIZ = "View Pipeline Visualization";

describe("utils/download", () => {
  describe("getDownloadDropdownOptions", () => {
    it("offers only the results folder when the run has no stage-two output, no assembly and no version", () => {
      expect(getDownloadDropdownOptions({})).toEqual([
        { text: RESULTS_FOLDER, value: RESULTS_FOLDER },
      ]);
    });

    it("adds the reads options once stage two produced adjusted remaining reads", () => {
      const options = getDownloadDropdownOptions({
        adjusted_remaining_reads: 1234,
      }).map(o => o.text);

      expect(options).toEqual([NON_HOST_READS, UNMAPPED_READS, RESULTS_FOLDER]);
    });

    it("adds the contig options only when assembled is exactly 1", () => {
      expect(
        getDownloadDropdownOptions({ assembled: 1 }).map(o => o.text),
      ).toEqual([NON_HOST_CONTIGS, NON_HOST_CONTIGS_MAPPING, RESULTS_FOLDER]);

      // assembled: 0 (and any non-1 value) must not unlock contig downloads.
      expect(
        getDownloadDropdownOptions({ assembled: 0 }).map(o => o.text),
      ).toEqual([RESULTS_FOLDER]);
      expect(
        getDownloadDropdownOptions({ assembled: true }).map(o => o.text),
      ).toEqual([RESULTS_FOLDER]);
    });

    it("adds the pipeline visualization option when a pipeline version is present", () => {
      const options = getDownloadDropdownOptions({
        pipeline_version: "7.1",
      }).map(o => o.text);
      expect(options).toEqual([RESULTS_FOLDER, PIPELINE_VIZ]);
    });

    it("returns every option for a fully complete assembled run", () => {
      const options = getDownloadDropdownOptions({
        adjusted_remaining_reads: 10,
        assembled: 1,
        pipeline_version: "8.0",
      });

      expect(options).toHaveLength(6);
      // text and value are always the same string.
      options.forEach(option => expect(option.text).toBe(option.value));
      expect(options.map(o => o.value)).toEqual([
        NON_HOST_READS,
        NON_HOST_CONTIGS,
        NON_HOST_CONTIGS_MAPPING,
        UNMAPPED_READS,
        RESULTS_FOLDER,
        PIPELINE_VIZ,
      ]);
    });
  });

  describe("getLinkInfoForDownloadOption", () => {
    const pipelineRun = { pipeline_version: "7.1" };

    it("returns the in-page path for the non-host reads download", () => {
      expect(
        getLinkInfoForDownloadOption(NON_HOST_READS, 55, pipelineRun),
      ).toEqual({
        path: "/samples/55/nonhost_fasta?pipeline_version=7.1",
        newPage: false,
      });
    });

    it("returns the in-page path for the contigs fasta and contigs summary downloads", () => {
      expect(
        getLinkInfoForDownloadOption(NON_HOST_CONTIGS, 55, pipelineRun),
      ).toEqual({
        path: "/samples/55/contigs_fasta?pipeline_version=7.1",
        newPage: false,
      });
      expect(
        getLinkInfoForDownloadOption(NON_HOST_CONTIGS_MAPPING, 55, pipelineRun),
      ).toEqual({
        path: "/samples/55/contigs_summary?pipeline_version=7.1",
        newPage: false,
      });
    });

    it("returns the in-page path for unmapped reads", () => {
      expect(
        getLinkInfoForDownloadOption(UNMAPPED_READS, 55, pipelineRun),
      ).toEqual({
        path: "/samples/55/unidentified_fasta?pipeline_version=7.1",
        newPage: false,
      });
    });

    it("marks the results folder and pipeline viz as new-page links", () => {
      expect(
        getLinkInfoForDownloadOption(RESULTS_FOLDER, 55, pipelineRun),
      ).toEqual({
        path: "/samples/55/results_folder?pipeline_version=7.1",
        newPage: true,
      });
      expect(
        getLinkInfoForDownloadOption(PIPELINE_VIZ, 55, pipelineRun),
      ).toEqual({
        path: "/samples/55/pipeline_viz/7.1",
        newPage: true,
      });
    });

    it("returns undefined for an option that is not a download option", () => {
      expect(
        getLinkInfoForDownloadOption("Not A Real Option", 55, pipelineRun),
      ).toBeUndefined();
    });
  });

  describe("getDownloadLinks", () => {
    it("returns only the results folder link for a bare run", () => {
      expect(getDownloadLinks(7, {})).toEqual([
        {
          label: RESULTS_FOLDER,
          path: "/samples/7/results_folder?pipeline_version=undefined",
          newPage: true,
        },
      ]);
    });

    it("pairs every available option with its path and newPage flag", () => {
      const links = getDownloadLinks(7, {
        adjusted_remaining_reads: 3,
        assembled: 1,
        pipeline_version: "6.5",
      });

      expect(links).toHaveLength(6);
      expect(links[0]).toEqual({
        label: NON_HOST_READS,
        path: "/samples/7/nonhost_fasta?pipeline_version=6.5",
        newPage: false,
      });
      expect(links[links.length - 1]).toEqual({
        label: PIPELINE_VIZ,
        path: "/samples/7/pipeline_viz/6.5",
        newPage: true,
      });
      // Only the two "View ..." options open a new page.
      expect(links.filter(l => l.newPage).map(l => l.label)).toEqual([
        RESULTS_FOLDER,
        PIPELINE_VIZ,
      ]);
    });
  });

  describe("logDownloadOption", () => {
    it("builds a slugified, lowercased event name and forwards the details", () => {
      const trackEvent = jest.fn();
      logDownloadOption({
        trackEvent,
        component: "SamplesHeatmapHeader",
        option: "Current Heatmap View (.csv)",
        details: { sampleId: 1 },
      });

      expect(trackEvent).toHaveBeenCalledWith(
        "SamplesHeatmapHeader-download-current-heatmap-view-csv-_clicked",
        { sampleId: 1 },
      );
    });

    it("collapses underscores in the option into dashes", () => {
      const trackEvent = jest.fn();
      logDownloadOption({
        trackEvent,
        component: "Comp",
        option: "sample_taxon_report",
        details: {},
      });

      expect(trackEvent).toHaveBeenCalledWith(
        "Comp-download-sample-taxon-report_clicked",
        {},
      );
    });

    it("defaults details to an empty object when omitted", () => {
      const trackEvent = jest.fn();
      // @ts-expect-error deliberately omitting the optional-at-runtime details
      logDownloadOption({ trackEvent, component: "C", option: "Reads" });

      expect(trackEvent).toHaveBeenCalledWith("C-download-reads_clicked", {});
    });
  });

  describe("getDownloadContigUrl", () => {
    it("builds the taxid contig download URL from sample, taxon and version", () => {
      expect(
        getDownloadContigUrl({
          pipelineVersion: "8.2",
          sampleId: 42,
          taxId: 573,
        }),
      ).toBe(
        "/samples/42/taxid_contigs_download?taxid=573&pipeline_version=8.2",
      );
    });
  });
});
