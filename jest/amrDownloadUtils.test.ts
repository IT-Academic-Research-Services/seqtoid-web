// Frontend coverage: AmrDownloadDropdown/amrDownloadUtils.ts builds the AMR
// download URLs and filenames. getAmrDownloadLink is a pure switch over the
// download option; downloadAmrGeneLevelData assembles a gene-level URL and
// navigates. Cover every switch arm, the unmatched-option default, and the
// gene-level URL assembly.
import {
  DownloadOptions,
  downloadAmrGeneLevelData,
  getAmrDownloadLink,
} from "~/components/views/SampleView/components/SampleViewHeader/components/PrimaryHeaderControls/components/SampleViewDownloadButton/components/AmrDownloadDropdown/amrDownloadUtils";

const workflowRun = { id: "42" } as any;
const sample = { name: "SampleA" } as any;

describe("getAmrDownloadLink", () => {
  it("builds the non-host reads download", () => {
    expect(
      getAmrDownloadLink(
        workflowRun,
        sample,
        DownloadOptions.NON_HOST_READS_LABEL,
      ),
    ).toEqual({
      downloadUrl:
        "/workflow_runs/42/amr_report_downloads?downloadType=non_host_reads",
      fileName: "SampleA_42_non_host_reads.fasta.gz",
    });
  });

  it("builds the non-host contigs download", () => {
    expect(
      getAmrDownloadLink(
        workflowRun,
        sample,
        DownloadOptions.NON_HOST_CONTIGS_LABEL,
      ),
    ).toEqual({
      downloadUrl:
        "/workflow_runs/42/amr_report_downloads?downloadType=non_host_contigs",
      fileName: "SampleA_42_contigs.fasta",
    });
  });

  it("builds the comprehensive AMR metrics download", () => {
    expect(
      getAmrDownloadLink(
        workflowRun,
        sample,
        DownloadOptions.COMPREHENSIVE_AMR_METRICS_LABEL,
      ),
    ).toEqual({
      downloadUrl:
        "/workflow_runs/42/amr_report_downloads?downloadType=comprehensive_amr_metrics_tsv",
      fileName: "SampleA_42_comprehensive_amr_metrics.tsv",
    });
  });

  it("builds the intermediate files download", () => {
    expect(
      getAmrDownloadLink(
        workflowRun,
        sample,
        DownloadOptions.INTERMEDIATE_FILES_LABEL,
      ),
    ).toEqual({
      downloadUrl:
        "/workflow_runs/42/amr_report_downloads?downloadType=zip_link",
      fileName: "SampleA_42_amr_intermediate_files.zip",
    });
  });

  it("returns empty strings for an unrecognized option (default branch)", () => {
    expect(
      getAmrDownloadLink(workflowRun, sample, "not a real option"),
    ).toEqual({ downloadUrl: "", fileName: "" });
  });
});

describe("downloadAmrGeneLevelData", () => {
  let originalLocation: Location;

  beforeEach(() => {
    originalLocation = window.location;
    // Replace location with a plain object so assigning href is observable and
    // does not trigger jsdom navigation.
    delete (window as any).location;
    (window as any).location = { href: "" };
  });

  afterEach(() => {
    (window as any).location = originalLocation;
  });

  it("assembles the gene-level download URL with query params", () => {
    downloadAmrGeneLevelData("tsv", "idx-1", "mecA", "99");
    expect(window.location.href).toBe(
      "/workflow_runs/99/amr_gene_level_downloads?downloadType=tsv&indexId=idx-1&geneName=mecA",
    );
  });
});
