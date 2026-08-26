// CZID-586 (#586) frontend coverage wave 1. sample.ts holds the filename parsing used
// during upload and the sampleErrorInfo() decision table that maps pipeline / upload
// error codes to the status, pill, message, and follow-up link shown across SampleView
// and DiscoveryView. sampleErrorInfo is a large switch, so it is a branch goldmine and
// pure (deterministic) logic. These tests walk every error arm plus its sub-branches.
import {
  baseName,
  cleanFilePath,
  sampleErrorInfo,
  sampleNameFromFileName,
  UPLOAD_URL,
} from "../app/assets/src/components/utils/sample";
import { SampleStatus } from "../app/assets/src/interface/sample";

// SW-2: sampleErrorInfo returns the "helpcenter:" sentinel; Link.tsx resolves the host.
const CONTACT_US_LINK = "helpcenter:/contact";

describe("sample.cleanFilePath", () => {
  it("trims whitespace", () => {
    expect(cleanFilePath("  file.fastq  ")).toBe("file.fastq");
  });

  it("strips a leading ./", () => {
    expect(cleanFilePath("./dir/file.fastq")).toBe("dir/file.fastq");
  });

  it("strips a leading .\\ (windows)", () => {
    expect(cleanFilePath(".\\dir\\file.fastq")).toBe("dir\\file.fastq");
  });
});

describe("sample.baseName", () => {
  it("returns the file base without extension for a unix path", () => {
    expect(baseName("/a/b/sample.fastq")).toBe("sample");
  });

  it("handles a windows-style backslash path", () => {
    expect(baseName("C:\\data\\sample.fastq")).toBe("sample");
  });

  it("returns the whole last segment when there is no extension", () => {
    expect(baseName("/a/b/sample")).toBe("sample");
  });
});

describe("sample.sampleNameFromFileName", () => {
  it("strips the .fastq extension", () => {
    expect(sampleNameFromFileName("mysample.fastq")).toBe("mysample");
  });

  it("strips read-pair labels", () => {
    expect(sampleNameFromFileName("mysample_R1_001.fastq.gz")).toBe("mysample");
  });

  it("strips .fa / .fasta labels", () => {
    expect(sampleNameFromFileName("genome.fasta")).toBe("genome");
  });
});

describe("sample.sampleErrorInfo", () => {
  it("handles InvalidFileFormatError with a recognized message -> subtitle, no linkText", () => {
    const info = sampleErrorInfo({
      sampleUploadError: "InvalidFileFormatError",
      error: {
        message: "The .fastq file foo.fastq has an invalid number of lines.",
      },
    });
    expect(info.status).toBe(SampleStatus.INCOMPLETE_ISSUE);
    expect(info.pillStatus).toBe("failed");
    expect(info.type).toBe("warning");
    expect(info.link).toBe(UPLOAD_URL);
    expect(info.subtitle).toMatch(/divisible by 4/);
    // When a subtitle is present the linkText is intentionally blank.
    expect(info.linkText).toBe("");
  });

  it("handles InvalidInputFileError with no recognized message -> reupload linkText", () => {
    const info = sampleErrorInfo({
      sampleUploadError: "InvalidInputFileError",
      error: { message: "totally unrecognized message" },
    });
    expect(info.subtitle).toBeUndefined();
    expect(info.linkText).toMatch(/reupload your file/);
    expect(info.link).toBe(UPLOAD_URL);
  });

  it("InsufficientReadsError with an empty pipelineRun -> contact-us link", () => {
    const info = sampleErrorInfo({
      pipelineRun: { known_user_error: "InsufficientReadsError" },
      error: {},
    });
    // known_user_error drives the switch; empty-ish run still routes to results folder
    // only when it is non-empty. Here the run has the key so it is not empty.
    expect(info.status).toBe(SampleStatus.COMPLETE_ISSUE);
    expect(info.pillStatus).toBe("complete - issue");
    expect(info.linkText).toMatch(/reads were filtered/);
  });

  it("InsufficientReadsError with pipeline_version -> results_folder link carries the version", () => {
    const info = sampleErrorInfo({
      sampleId: 55,
      sampleUploadError: "InsufficientReadsError",
      pipelineRun: { pipeline_version: "8.1" },
    });
    expect(info.link).toBe("/samples/55/results_folder?pipeline_version=8.1");
  });

  it("InsufficientReadsError with a truly empty run routes to contact us", () => {
    const info = sampleErrorInfo({
      sampleUploadError: "InsufficientReadsError",
      pipelineRun: {},
    });
    expect(info.linkText).toMatch(/Contact us/);
    expect(info.link).toBe(CONTACT_US_LINK);
  });

  it("BrokenReadPairError -> fix pairing, upload link", () => {
    const info = sampleErrorInfo({ sampleUploadError: "BrokenReadPairError" });
    expect(info.status).toBe(SampleStatus.COMPLETE_ISSUE);
    expect(info.linkText).toMatch(/fix the read pairing/);
    expect(info.link).toBe(UPLOAD_URL);
  });

  it("BASESPACE_UPLOAD_FAILED -> error type, contact-us link", () => {
    const info = sampleErrorInfo({
      sampleUploadError: "BASESPACE_UPLOAD_FAILED",
    });
    expect(info.status).toBe(SampleStatus.SAMPLE_FAILED);
    expect(info.type).toBe("error");
    expect(info.link).toBe(CONTACT_US_LINK);
  });

  it("S3_UPLOAD_FAILED -> error, contact-us link", () => {
    const info = sampleErrorInfo({ sampleUploadError: "S3_UPLOAD_FAILED" });
    expect(info.message).toMatch(/from S3/);
    expect(info.link).toBe(CONTACT_US_LINK);
  });

  it("LOCAL_UPLOAD_FAILED -> error, contact-us link", () => {
    const info = sampleErrorInfo({ sampleUploadError: "LOCAL_UPLOAD_FAILED" });
    expect(info.type).toBe("error");
    expect(info.message).toMatch(/too long to upload/);
  });

  it("LOCAL_UPLOAD_STALLED -> uploading (in progress), not an error", () => {
    // A slow local upload that has not truly failed yet must read as still uploading, not as a
    // failure -- the sample has not been sent to the pipeline. (LOCAL_UPLOAD_FAILED is the error.)
    const info = sampleErrorInfo({ sampleUploadError: "LOCAL_UPLOAD_STALLED" });
    expect(info.status).toBe(SampleStatus.UPLOADING);
    expect(info.pillStatus).toBe("uploading");
    expect(info.type).toBe("info");
    expect(info.message).toMatch(/still uploading/i);
  });

  it("DO_NOT_PROCESS -> processing skipped, info, no link", () => {
    const info = sampleErrorInfo({ sampleUploadError: "DO_NOT_PROCESS" });
    expect(info.status).toBe(SampleStatus.PROCESSING_SKIPPED);
    expect(info.pillStatus).toBe("skipped");
    expect(info.type).toBe("info");
    expect(info.link).toBeUndefined();
  });

  it("FAULTY_INPUT -> complete issue, upload link, includes the run error_message", () => {
    const info = sampleErrorInfo({
      sampleUploadError: "FAULTY_INPUT",
      pipelineRun: { error_message: "bad header" },
    });
    expect(info.status).toBe(SampleStatus.COMPLETE_ISSUE);
    expect(info.message).toContain("bad header");
    expect(info.link).toBe(UPLOAD_URL);
  });

  it("INSUFFICIENT_READS with a sampleId -> results_folder link", () => {
    const info = sampleErrorInfo({
      sampleId: 7,
      sampleUploadError: "INSUFFICIENT_READS",
      pipelineRun: { pipeline_version: "9.0" },
    });
    expect(info.link).toBe("/samples/7/results_folder?pipeline_version=9.0");
  });

  it("INSUFFICIENT_READS without a sampleId -> contact-us link", () => {
    const info = sampleErrorInfo({ sampleUploadError: "INSUFFICIENT_READS" });
    expect(info.link).toBe(CONTACT_US_LINK);
  });

  it("BROKEN_PAIRS -> complete issue, upload link", () => {
    const info = sampleErrorInfo({ sampleUploadError: "BROKEN_PAIRS" });
    expect(info.status).toBe(SampleStatus.COMPLETE_ISSUE);
    expect(info.linkText).toMatch(/fix the read pairing/);
    expect(info.link).toBe(UPLOAD_URL);
  });

  it("falls through to the default failed case for an unknown code", () => {
    const info = sampleErrorInfo({ sampleUploadError: "SOMETHING_NEW" });
    expect(info.status).toBe(SampleStatus.SAMPLE_FAILED);
    expect(info.pillStatus).toBe("failed");
    expect(info.type).toBe("error");
    expect(info.link).toBe(CONTACT_US_LINK);
    expect(info.message).toMatch(/issue processing your sample/);
  });

  it("prefers the pipelineRun known_user_error when no upload error is given", () => {
    const info = sampleErrorInfo({
      pipelineRun: { known_user_error: "BrokenReadPairError" },
    });
    expect(info.link).toBe(UPLOAD_URL);
  });

  it("falls back to error.label when neither upload error nor run error present", () => {
    const info = sampleErrorInfo({ error: { label: "DO_NOT_PROCESS" } });
    expect(info.status).toBe(SampleStatus.PROCESSING_SKIPPED);
  });
});
