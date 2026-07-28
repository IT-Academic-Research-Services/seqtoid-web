// Supplementary branch coverage for app/assets/src/components/utils/sample.ts.
// jest/sample.test.ts already walks every arm of the sampleErrorInfo() switch.
// What it never exercises is the *sub*-branches inside those arms:
//
//   * `message = pipelineRun.error_message || error.message` -- the tests only
//     ever supply error.message, so the pipelineRun-wins side is untaken.
//   * `subtitle = message !== undefined ? subtextError(message) : undefined`
//     -- the undefined-message side (no message from either source).
//   * `pipelineRun ? pipelineRun.error_message : ""` in FAULTY_INPUT -- the
//     falsy side, reachable only when a null run is passed explicitly (the
//     `= {}` default only fires for undefined).
//
// It also pins down the errorMap lookup in subtextError(), which is what turns a
// raw pipeline error string into the user-facing "here's what to do" subtitle.
import {
  baseName,
  cleanFilePath,
  sampleErrorInfo,
  sampleNameFromFileName,
  UPLOAD_URL,
} from "~/components/utils/sample";
import { SampleStatus } from "~/interface/sample";

const CONTACT_US_LINK = "https://helpcenter.seqtoid.org/contact";

describe("sample.sampleErrorInfo message source precedence", () => {
  it("prefers the pipelineRun error_message over error.message (InvalidFileFormatError)", () => {
    const info = sampleErrorInfo({
      sampleUploadError: "InvalidFileFormatError",
      pipelineRun: {
        error_message: "There was an error unzipping the input file foo.gz",
      },
      error: { message: "ignored fallback message" },
    });

    expect(info.message).toMatch(/error unzipping/);
    expect(info.subtitle).toMatch(/proper \.gz file/);
    // A subtitle suppresses the generic linkText.
    expect(info.linkText).toBe("");
    expect(info.link).toBe(UPLOAD_URL);
  });

  it("leaves subtitle undefined when neither source supplies a message", () => {
    const info = sampleErrorInfo({
      sampleUploadError: "InvalidInputFileError",
    });

    expect(info.message).toBeUndefined();
    expect(info.subtitle).toBeUndefined();
    // No subtitle -> the fallback reupload instruction is shown instead.
    expect(info.linkText).toMatch(/check your file format/);
    expect(info.status).toBe(SampleStatus.INCOMPLETE_ISSUE);
  });

  it("InsufficientReadsError surfaces a subtitle from the pipelineRun message", () => {
    const info = sampleErrorInfo({
      sampleId: 12,
      pipelineRun: {
        known_user_error: "InsufficientReadsError",
        error_message: "There was an insufficient number of reads in sample 12",
      },
    });

    expect(info.status).toBe(SampleStatus.COMPLETE_ISSUE);
    expect(info.message).toMatch(/insufficient number of reads/);
    expect(info.subtitle).toMatch(/sequencing quality/);
    expect(info.link).toBe("/samples/12/results_folder");
  });

  it("InsufficientReadsError leaves subtitle undefined for an unrecognized message", () => {
    const info = sampleErrorInfo({
      sampleId: 12,
      pipelineRun: {
        known_user_error: "InsufficientReadsError",
        error_message: "something the errorMap has never heard of",
      },
    });

    expect(info.message).toBe("something the errorMap has never heard of");
    expect(info.subtitle).toBeUndefined();
  });

  it("BrokenReadPairError carries through the pipelineRun error_message", () => {
    const info = sampleErrorInfo({
      pipelineRun: {
        known_user_error: "BrokenReadPairError",
        error_message: "Paired input files had different read counts",
      },
    });

    expect(info.message).toBe("Paired input files had different read counts");
    // This arm never computes a subtitle, even for a message the map knows.
    expect(info.subtitle).toBeUndefined();
    expect(info.type).toBe("warning");
    expect(info.link).toBe(UPLOAD_URL);
  });

  it("BrokenReadPairError falls back to error.message", () => {
    const info = sampleErrorInfo({
      sampleUploadError: "BrokenReadPairError",
      error: { message: "from the error object" },
    });

    expect(info.message).toBe("from the error object");
  });
});

describe("sample.sampleErrorInfo FAULTY_INPUT run handling", () => {
  it("renders an empty error fragment when the pipelineRun is null", () => {
    const info = sampleErrorInfo({
      sampleUploadError: "FAULTY_INPUT",
      pipelineRun: null as any,
    });

    expect(info.status).toBe(SampleStatus.COMPLETE_ISSUE);
    expect(info.message).toBe(
      "Sorry, something was wrong with your input file. .",
    );
    expect(info.link).toBe(UPLOAD_URL);
  });

  it("renders an empty error fragment when the run has no error_message", () => {
    const info = sampleErrorInfo({ sampleUploadError: "FAULTY_INPUT" });

    expect(info.message).toContain("something was wrong with your input file");
    expect(info.linkText).toMatch(/reupload your file/);
  });
});

describe("sample.sampleErrorInfo INSUFFICIENT_READS link building", () => {
  it("omits the version query param when the run has no pipeline_version", () => {
    const info = sampleErrorInfo({
      sampleId: 3,
      sampleUploadError: "INSUFFICIENT_READS",
      pipelineRun: {},
    });

    expect(info.link).toBe("/samples/3/results_folder");
  });

  it("still routes to contact-us when the sampleId is missing but a version exists", () => {
    const info = sampleErrorInfo({
      sampleUploadError: "INSUFFICIENT_READS",
      pipelineRun: { pipeline_version: "9.1" },
    });

    expect(info.link).toBe(CONTACT_US_LINK);
    expect(info.linkText).toMatch(/reads were filtered out/);
  });
});

describe("sample.sampleErrorInfo subtextError map lookups", () => {
  const cases: Array<[string, RegExp]> = [
    ["The maximum line length was exceeded in sample x", /10,000 characters/],
    ["Paired input files must match", /same number of reads/],
    ["The input file abc.fastq is invalid.", /\.fastq file is valid/],
    [
      'The input .fastq file x did not begin with an "@"',
      /\.fastq file and try/,
    ],
    [
      'The input .fasta file x read ID did not begin with a ">"',
      /\.fasta file and try/,
    ],
    ["The input file x has duplicate read IDs", /remove duplicate read ids/],
    [
      "The file x contain reads longer than the 500 bp limit for the Illumina-supported pipeline",
      /sequencing platform/,
    ],
    [
      "The SeqtoID pipeline expects a single input file but got two",
      /check your input file/,
    ],
    [
      "There was an error parsing the input file x",
      /not corrupted and is in the \.fastq format/,
    ],
    ["The file x is in .fasta format but should not be", /upload a \.fastq/],
  ];

  it.each(cases)("maps %s to its remediation subtitle", (message, expected) => {
    const info = sampleErrorInfo({
      sampleUploadError: "InvalidFileFormatError",
      error: { message },
    });

    expect(info.subtitle).toMatch(expected);
  });
});

describe("sample filename helpers -- edge cases", () => {
  it("cleanFilePath leaves an interior ./ untouched", () => {
    expect(cleanFilePath("dir/./file.fastq")).toBe("dir/./file.fastq");
  });

  it("cleanFilePath is a no-op for a bare filename", () => {
    expect(cleanFilePath("file.fastq")).toBe("file.fastq");
  });

  it("baseName strips only the LAST extension", () => {
    expect(baseName("/a/b/sample.fastq.gz")).toBe("sample.fastq");
  });

  it("baseName handles a bare filename with no directory", () => {
    expect(baseName("sample.fq")).toBe("sample");
  });

  it("baseName returns an empty string for an empty path", () => {
    expect(baseName("")).toBe("");
  });

  it("sampleNameFromFileName strips R2 labels as well as R1", () => {
    expect(sampleNameFromFileName("mysample_R2_001.fastq.gz")).toBe("mysample");
  });

  it("sampleNameFromFileName leaves a name with no recognized suffix alone", () => {
    expect(sampleNameFromFileName("plain_name.txt")).toBe("plain_name");
  });
});
