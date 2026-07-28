// Frontend coverage: app/assets/src/components/views/BulkDownloadListView/constants.ts
// The status helpers here decide what a user sees for every bulk download row
// (badge colour, status wording, tooltip), so both sides of each status branch
// are exercised -- including the "succeeded but with an error message" case,
// which is the one that historically gets mis-classified as a plain success.
import { WorkflowType } from "~/components/utils/workflows";
import {
  AUTO_UPDATE_DELAY,
  AUTO_UPDATE_MAX_COUNT,
  BULK_DOWNLOAD_DOCUMENTATION_LINKS,
  BULK_DOWNLOAD_TYPES,
  CONDITIONAL_FIELDS,
  DEFAULT_BACKGROUND_MODEL,
  FailedStatus,
  getDownloadDisplayName,
  getStatusDisplay,
  getStatusType,
  getTooltipText,
  HOST_GENOME_NAMES,
  InProgressStatus,
  OPTIONAL_FIELDS,
  WORKFLOW_OBJECT_LABELS,
} from "~/components/views/BulkDownloadListView/constants";
import { BulkDownloadStatus } from "~/interface/shared";

const download = (status?: BulkDownloadStatus, errorMessage?: string) =>
  ({ status, errorMessage } as $TSFixMe);

describe("BulkDownloadListView constants tables", () => {
  it("declares the conditional fields with their dependent fields and trigger values", () => {
    expect(CONDITIONAL_FIELDS).toHaveLength(3);

    const fileFormat = CONDITIONAL_FIELDS.find(f => f.field === "file_format");
    expect(fileFormat).toBeDefined();
    expect(fileFormat?.downloadType).toBe("reads_non_host");
    expect(fileFormat?.dependentFields).toEqual(["taxa_with_reads"]);
    // "all" and undefined (nothing chosen yet) both surface the file format field.
    expect(fileFormat?.triggerValues).toContain("all");
    expect(fileFormat?.triggerValues).toContain(undefined);

    const biomBackground = CONDITIONAL_FIELDS.find(
      f => f.field === "background" && f.downloadType === "biom_format",
    );
    expect(biomBackground?.dependentFields).toEqual(["metric", "filter_by"]);
    expect(biomBackground?.triggerValues).toEqual(["NR.zscore", "NT.zscore"]);

    // Every conditional field must be fully specified or the UI cannot evaluate it.
    CONDITIONAL_FIELDS.forEach(field => {
      expect(typeof field.field).toBe("string");
      expect(typeof field.downloadType).toBe("string");
      expect(field.dependentFields.length).toBeGreaterThan(0);
      expect(field.triggerValues.length).toBeGreaterThan(0);
    });
  });

  it("declares the optional fields", () => {
    expect(OPTIONAL_FIELDS).toEqual([
      { field: "filter_by", downloadType: "biom_format" },
      { field: "background", downloadType: "sample_taxon_report" },
    ]);
  });

  it("exposes stable download type keys and polling constants", () => {
    expect(BULK_DOWNLOAD_TYPES.SAMPLE_METADATA).toBe("sample_metadata");
    expect(BULK_DOWNLOAD_TYPES.BIOM_FORMAT_DOWNLOAD_TYPE).toBe("biom_format");
    expect(BULK_DOWNLOAD_TYPES.ORIGINAL_INPUT_FILES).toBe(
      "original_input_file",
    );
    expect(BULK_DOWNLOAD_TYPES.HOST_GENE_COUNTS).toBe("host_gene_counts");
    expect(BULK_DOWNLOAD_TYPES.CONSENSUS_GENOME_INTERMEDIATE_OUTPUT_FILES).toBe(
      "consensus_genome_intermediate_output_files",
    );
    expect(BULK_DOWNLOAD_TYPES.AMR_RESULTS_BULK_DOWNLOAD).toBe(
      "amr_results_bulk_download",
    );

    expect(DEFAULT_BACKGROUND_MODEL).toBe(26);
    expect(AUTO_UPDATE_MAX_COUNT).toBe(15);
    expect(AUTO_UPDATE_DELAY).toBe(20000);
    expect(HOST_GENOME_NAMES.HUMAN).toBe("Human");
  });

  it("partitions statuses into in-progress and failed buckets with no overlap", () => {
    expect(InProgressStatus).toEqual([
      BulkDownloadStatus.RUNNING,
      BulkDownloadStatus.CREATED,
      BulkDownloadStatus.PENDING,
      BulkDownloadStatus.STARTED,
    ]);
    expect(FailedStatus).toEqual([
      BulkDownloadStatus.SUCCEEDED_WITH_ISSUE,
      BulkDownloadStatus.FAILED,
      BulkDownloadStatus.TIMED_OUT,
      BulkDownloadStatus.ABORTED,
    ]);
    // A status must never be both in progress and failed.
    InProgressStatus.forEach(status => {
      expect(FailedStatus).not.toContain(status);
    });
    // SUCCEEDED is terminal-good and belongs to neither bucket.
    expect(InProgressStatus).not.toContain(BulkDownloadStatus.SUCCEEDED);
    expect(FailedStatus).not.toContain(BulkDownloadStatus.SUCCEEDED);
  });

  it("maps documentation links only for the three documented download types", () => {
    const keys = Object.keys(BULK_DOWNLOAD_DOCUMENTATION_LINKS);
    expect(keys).toHaveLength(3);
    keys.forEach(key => {
      expect(typeof BULK_DOWNLOAD_DOCUMENTATION_LINKS[key]).toBe("string");
      expect(BULK_DOWNLOAD_DOCUMENTATION_LINKS[key]).toContain("http");
    });
    expect(
      BULK_DOWNLOAD_DOCUMENTATION_LINKS[BULK_DOWNLOAD_TYPES.SAMPLE_METADATA],
    ).toBeUndefined();
  });

  it("labels the workflow objects, with null for unsupported workflows", () => {
    expect(WORKFLOW_OBJECT_LABELS[WorkflowType.SHORT_READ_MNGS]).toBe("sample");
    expect(WORKFLOW_OBJECT_LABELS[WorkflowType.LONG_READ_MNGS]).toBe("sample");
    expect(WORKFLOW_OBJECT_LABELS[WorkflowType.AMR]).toBe("sample");
    expect(WORKFLOW_OBJECT_LABELS[WorkflowType.CONSENSUS_GENOME]).toBe(
      "consensus genome",
    );
    expect(WORKFLOW_OBJECT_LABELS[WorkflowType.AMR_DEPRECATED]).toBeNull();
    expect(WORKFLOW_OBJECT_LABELS[WorkflowType.BENCHMARK]).toBeNull();
  });
});

describe("getStatusType", () => {
  it("returns default when there is no bulk download at all", () => {
    expect(getStatusType(undefined)).toBe("default");
  });

  it("returns warning for succeeded-with-an-error-message", () => {
    expect(
      getStatusType(download(BulkDownloadStatus.SUCCEEDED, "2 files missing")),
    ).toBe("warning");
  });

  it("returns warning for the explicit SUCCEEDED_WITH_ISSUE status", () => {
    expect(
      getStatusType(download(BulkDownloadStatus.SUCCEEDED_WITH_ISSUE)),
    ).toBe("warning");
  });

  it("returns default for every in-progress status", () => {
    InProgressStatus.forEach(status => {
      expect(getStatusType(download(status))).toBe("default");
    });
  });

  it("returns error for the failed statuses", () => {
    [
      BulkDownloadStatus.FAILED,
      BulkDownloadStatus.TIMED_OUT,
      BulkDownloadStatus.ABORTED,
    ].forEach(status => {
      expect(getStatusType(download(status))).toBe("error");
    });
  });

  it("returns success for a clean success (no error message)", () => {
    expect(getStatusType(download(BulkDownloadStatus.SUCCEEDED))).toBe(
      "success",
    );
    expect(getStatusType(download(BulkDownloadStatus.SUCCEEDED, ""))).toBe(
      "success",
    );
  });

  it("falls back to default for an unrecognised status", () => {
    expect(getStatusType(download("SOMETHING_NEW" as $TSFixMe))).toBe(
      "default",
    );
  });
});

describe("getStatusDisplay", () => {
  it("returns an empty string when status is missing", () => {
    expect(getStatusDisplay(undefined)).toBe("");
    expect(getStatusDisplay(undefined, "an error")).toBe("");
  });

  it("says 'complete with issue' for success plus an error message", () => {
    expect(
      getStatusDisplay(BulkDownloadStatus.SUCCEEDED, "some files missing"),
    ).toBe("complete with issue");
    expect(getStatusDisplay(BulkDownloadStatus.SUCCEEDED_WITH_ISSUE)).toBe(
      "complete with issue",
    );
  });

  it("says 'in progress' for each in-progress status", () => {
    InProgressStatus.forEach(status => {
      expect(getStatusDisplay(status)).toBe("in progress");
    });
  });

  it("says 'failed' for the failing statuses", () => {
    [
      BulkDownloadStatus.FAILED,
      BulkDownloadStatus.TIMED_OUT,
      BulkDownloadStatus.ABORTED,
    ].forEach(status => {
      expect(getStatusDisplay(status)).toBe("failed");
    });
  });

  it("says 'complete' for a clean success", () => {
    expect(getStatusDisplay(BulkDownloadStatus.SUCCEEDED)).toBe("complete");
  });

  it("logs and returns an empty string for an unknown status", () => {
    const spy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    expect(getStatusDisplay("MYSTERY" as $TSFixMe)).toBe("");
    expect(spy).toHaveBeenCalledWith("No Display Status Found");
    spy.mockRestore();
  });
});

describe("getTooltipText", () => {
  it("surfaces the error message only for succeeded-with-error", () => {
    expect(
      getTooltipText(download(BulkDownloadStatus.SUCCEEDED, "partial failure")),
    ).toBe("partial failure");
  });

  it("returns null when succeeded cleanly, failed, or absent", () => {
    expect(getTooltipText(download(BulkDownloadStatus.SUCCEEDED))).toBeNull();
    expect(
      getTooltipText(download(BulkDownloadStatus.FAILED, "hard failure")),
    ).toBeNull();
    expect(getTooltipText(undefined)).toBeNull();
  });
});

describe("getDownloadDisplayName", () => {
  it("resolves the human-readable name for a known download type", () => {
    expect(getDownloadDisplayName("sample_metadata")).toBe("Sample Metadata");
    expect(getDownloadDisplayName("biom_format")).toBe(
      "Combined Microbiome File",
    );
  });

  it("returns undefined for an unknown download type instead of throwing", () => {
    expect(getDownloadDisplayName("not_a_real_type")).toBeUndefined();
  });
});
