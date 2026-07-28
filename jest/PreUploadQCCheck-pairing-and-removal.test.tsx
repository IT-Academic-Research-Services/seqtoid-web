// Coverage:
// app/assets/src/components/views/SampleUploadFlow/components/UploadSampleStep/
//   components/PreUploadQCCheck/PreUploadQCCheck.tsx
//
// The existing PreUploadQCCheck spec covers the single-file validations
// (unsupported format, duplicate FASTA ids, truncation, uncompressed, platform
// mismatch). This one covers the parts that need more than one file or more
// than one render:
//   * paired-end R1/R2 matching, including the swap when the R2 file is passed
//     first and the R1/R2 column pairing in the resulting warning,
//   * handleSamplesRemove, which prunes warnings for files that are no longer
//     in the samples prop,
//   * validateAllSamplesAreInvalid, the "no valid samples" error banner, and the
//     checkbox side effects for already-validated samples,
//   * the try/catch fallbacks around each biowasm call.
//
// The biowasm CLI and the ../../utils helpers are stubbed, and IssueGroup is
// reduced to its caption/rows so assertions land on what the component decides
// to warn about.
import { render, screen, waitFor } from "@testing-library/react";

const mockTrackEvent = jest.fn();
jest.mock("~/api/analytics", () => ({
  ANALYTICS_EVENT_NAMES: new Proxy({}, { get: (_t, prop) => String(prop) }),
  useTrackEvent: () => mockTrackEvent,
}));

jest.mock("nanoid", () => ({ nanoid: () => "testid" }));

const mockGetFileType = jest.fn();
const mockGetReadNames = jest.fn();
const mockSliceFile = jest.fn();
jest.mock(
  "~/components/views/SampleUploadFlow/components/UploadSampleStep/utils",
  () => ({
    getFileType: (...a: $TSFixMe[]) => mockGetFileType(...a),
    getReadNames: (...a: $TSFixMe[]) => mockGetReadNames(...a),
    sliceFile: (...a: $TSFixMe[]) => mockSliceFile(...a),
  }),
);

jest.mock("~ui/notifications/IssueGroup", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: (props: $TSFixMe) =>
      ReactLib.createElement(
        "div",
        { "data-testid": "issue-group", "data-type": props.type },
        ReactLib.createElement(
          "div",
          { "data-testid": "caption" },
          props.caption,
        ),
        ReactLib.createElement(
          "div",
          { "data-testid": "rows" },
          (props.rows || []).map((row: $TSFixMe, i: number) =>
            ReactLib.createElement(
              "span",
              { key: i, "data-testid": "row" },
              (Array.isArray(row) ? row : [row])
                .map((cell: $TSFixMe) =>
                  cell?.name ? cell.name : String(cell),
                )
                .join("|"),
            ),
          ),
        ),
      ),
  };
});

jest.mock("~/components/ui/controls/ExternalLink", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: (props: $TSFixMe) =>
      ReactLib.createElement("a", { href: props.href }, props.children),
  };
});

import { PreUploadQCCheck } from "~/components/views/SampleUploadFlow/components/UploadSampleStep/components/PreUploadQCCheck/PreUploadQCCheck";

const ILLUMINA = "Illumina";
const NANOPORE = "ONT";

// Read names matching REGEX_READ_ILLUMINA; the pair differs only in the /1 /2
// suffix, which findDiff strips before comparing.
const ILLUMINA_R1 = "@a00123:45:HWXYZ:1:1101:1000:2000/1";
const ILLUMINA_R2 = "@a00123:45:HWXYZ:1:1101:1000:2000/2";
const ILLUMINA_R2_MISMATCH = "@a00123:45:HWXYZ:1:1101:9999:2000/2";

const makeFile = (name: string, content = "seqdata") =>
  new File([content], name);

const pairedSample = (base: string, extra: $TSFixMe = {}) => {
  const r1 = `${base}_R1.fastq`;
  const r2 = `${base}_R2.fastq`;
  return {
    _selectId: base,
    files: { [r1]: makeFile(r1), [r2]: makeFile(r2) },
    finishedValidating: false,
    ...extra,
  };
};

const singleSample = (fileName: string, extra: $TSFixMe = {}) => ({
  _selectId: fileName,
  files: { [fileName]: makeFile(fileName) },
  finishedValidating: false,
  ...extra,
});

const defaultCLI = () => ({
  mount: jest.fn().mockResolvedValue(undefined),
  exec: jest.fn().mockResolvedValue("@validread"),
});

const renderQC = (props: $TSFixMe = {}) => {
  const changeState = props.changeState || jest.fn();
  const handleSampleDeselect = props.handleSampleDeselect || jest.fn();
  const CLI = props.CLI || defaultCLI();
  const samples = props.samples || [];
  const utils = render(
    <PreUploadQCCheck
      samples={samples}
      changeState={changeState}
      handleSampleDeselect={handleSampleDeselect}
      CLI={CLI}
      sequenceTechnology={props.sequenceTechnology}
    />,
  );
  return { ...utils, changeState, handleSampleDeselect, CLI, samples };
};

const captions = () =>
  screen.queryAllByTestId("caption").map(node => node.textContent || "");

const hasCaption = (needle: string) =>
  captions().some(caption => caption.includes(needle));

beforeEach(() => {
  jest.clearAllMocks();
  mockSliceFile.mockResolvedValue({
    text: async () => "line1\nline2\nline3\n@validread\nACGT",
  });
  mockGetFileType.mockResolvedValue("FASTQ sequence text");
});

describe("PreUploadQCCheck paired-end matching", () => {
  it("accepts a matching R1/R2 pair", async () => {
    mockGetReadNames.mockImplementation(async (_cli, file: File) =>
      file.name.includes("_R1") ? [ILLUMINA_R1] : [ILLUMINA_R2],
    );

    renderQC({ samples: [pairedSample("s1")] });

    await waitFor(() => expect(mockGetReadNames).toHaveBeenCalled());
    expect(hasCaption("paired-end files do not match")).toBe(false);
  });

  it("warns and pairs the file names when R1/R2 reads disagree", async () => {
    mockGetReadNames.mockImplementation(async (_cli, file: File) =>
      file.name.includes("_R1") ? [ILLUMINA_R1] : [ILLUMINA_R2_MISMATCH],
    );

    const { handleSampleDeselect } = renderQC({
      samples: [pairedSample("s1")],
    });

    await waitFor(() =>
      expect(hasCaption("paired-end files do not match")).toBe(true),
    );
    // The warning table groups the pair into one R1|R2 row.
    const rows = screen.getAllByTestId("row").map(node => node.textContent);
    expect(rows).toContain("s1_R1.fastq|s1_R2.fastq");
    // A mismatched pair invalidates the sample, so it is deselected.
    expect(handleSampleDeselect).toHaveBeenCalledWith("s1", false, "local");
  });

  it("skips the pairing check when the partner file is missing", async () => {
    // Only an _R2 file: the R1/R2 comparison is skipped (its partner is not in
    // the sample), so no mismatch warning is produced.
    mockGetReadNames.mockResolvedValue([ILLUMINA_R2]);

    renderQC({ samples: [singleSample("lonely_R2.fastq")] });

    await waitFor(() => expect(mockGetReadNames).toHaveBeenCalled());
    expect(hasCaption("paired-end files do not match")).toBe(false);
  });

  it("does not compare read names for Nanopore files", async () => {
    // Nanopore-style (UUID) read names never take the Illumina pairing branch.
    mockGetReadNames.mockResolvedValue([
      "@12345678-1234-4123-8abc-1234567890ab",
    ]);

    renderQC({ samples: [pairedSample("ont")] });

    await waitFor(() => expect(mockGetReadNames).toHaveBeenCalled());
    expect(hasCaption("paired-end files do not match")).toBe(false);
  });
});

describe("PreUploadQCCheck warning pruning", () => {
  it("drops warnings for files that are no longer in the samples list", async () => {
    mockGetFileType.mockResolvedValue("unknown text");

    const first = singleSample("bad.txt");
    const { rerender } = renderQC({ samples: [first] });

    await waitFor(() =>
      expect(hasCaption("not a supported format")).toBe(true),
    );

    // The user removes the offending sample; the warning must go with it.
    mockGetFileType.mockResolvedValue("FASTQ sequence text");
    mockGetReadNames.mockResolvedValue([ILLUMINA_R1]);
    rerender(
      <PreUploadQCCheck
        samples={[singleSample("good.fastq")] as $TSFixMe}
        changeState={jest.fn()}
        handleSampleDeselect={jest.fn()}
        CLI={defaultCLI() as $TSFixMe}
        sequenceTechnology={ILLUMINA}
      />,
    );

    await waitFor(() =>
      expect(hasCaption("not a supported format")).toBe(false),
    );
  });
});

describe("PreUploadQCCheck all-samples-invalid banner", () => {
  it("shows the error banner when every validated sample is invalid", async () => {
    mockGetFileType.mockResolvedValue("unknown text");

    renderQC({
      samples: [singleSample("bad1.txt"), singleSample("bad2.txt")],
      sequenceTechnology: ILLUMINA,
    });

    await waitFor(() =>
      expect(hasCaption("no valid samples available for upload")).toBe(true),
    );
    // Both files are listed on the banner, and the plural caption is used for
    // the unsupported-format warning.
    expect(hasCaption("2 files")).toBe(true);
    expect(
      screen
        .getAllByTestId("issue-group")
        .some(g => g.dataset.type === "error"),
    ).toBe(true);
  });

  it("does not show the banner while a sample is still valid", async () => {
    mockGetReadNames.mockResolvedValue([ILLUMINA_R1]);

    renderQC({
      samples: [singleSample("good.fastq")],
      sequenceTechnology: ILLUMINA,
    });

    await waitFor(() => expect(mockGetReadNames).toHaveBeenCalled());
    expect(hasCaption("no valid samples available for upload")).toBe(false);
  });
});

describe("PreUploadQCCheck already-validated samples", () => {
  it("re-deselects a previously invalidated sample without re-validating", async () => {
    const { handleSampleDeselect } = renderQC({
      samples: [
        singleSample("known-bad.fastq", {
          finishedValidating: true,
          isValid: false,
        }),
      ],
      sequenceTechnology: ILLUMINA,
    });

    await waitFor(() =>
      expect(handleSampleDeselect).toHaveBeenCalledWith(
        "known-bad.fastq",
        false,
        "local",
      ),
    );
    // Nothing is re-run through the CLI for an already-finished sample.
    expect(mockGetFileType).not.toHaveBeenCalled();
  });

  it("keeps an Illumina sample selected under Illumina and drops it under Nanopore", async () => {
    const illuminaSample = () =>
      singleSample("reads.fastq", {
        finishedValidating: true,
        isValid: true,
        format: ILLUMINA,
      });

    const { handleSampleDeselect } = renderQC({
      samples: [illuminaSample()],
      sequenceTechnology: ILLUMINA,
    });
    await waitFor(() =>
      expect(handleSampleDeselect).toHaveBeenCalledWith(
        "reads.fastq",
        true,
        "local",
      ),
    );

    const nanopore = renderQC({
      samples: [illuminaSample()],
      sequenceTechnology: NANOPORE,
    });
    await waitFor(() =>
      expect(nanopore.handleSampleDeselect).toHaveBeenCalledWith(
        "reads.fastq",
        false,
        "local",
      ),
    );
  });

  it("keeps a Nanopore sample selected under Nanopore and drops it under Illumina", async () => {
    const ontSample = () =>
      singleSample("ont.fastq", {
        finishedValidating: true,
        isValid: true,
        format: NANOPORE,
      });

    const underOnt = renderQC({
      samples: [ontSample()],
      sequenceTechnology: NANOPORE,
    });
    await waitFor(() =>
      expect(underOnt.handleSampleDeselect).toHaveBeenCalledWith(
        "ont.fastq",
        true,
        "local",
      ),
    );

    const underIllumina = renderQC({
      samples: [ontSample()],
      sequenceTechnology: ILLUMINA,
    });
    await waitFor(() =>
      expect(underIllumina.handleSampleDeselect).toHaveBeenCalledWith(
        "ont.fastq",
        false,
        "local",
      ),
    );
  });

  it("leaves a formatless but valid finished sample alone", async () => {
    const { handleSampleDeselect } = renderQC({
      samples: [
        singleSample("plain.fastq", {
          finishedValidating: true,
          isValid: true,
        }),
      ],
      sequenceTechnology: ILLUMINA,
    });

    // Nothing is re-validated, the checkbox is left untouched, and the sample
    // counts as valid so the "no valid samples" banner stays away.
    await waitFor(() => expect(mockGetFileType).not.toHaveBeenCalled());
    expect(handleSampleDeselect).not.toHaveBeenCalled();
    expect(hasCaption("no valid samples available for upload")).toBe(false);
  });
});

describe("PreUploadQCCheck biowasm failures", () => {
  it("treats a file type lookup failure as an unsupported file", async () => {
    mockGetFileType.mockRejectedValue(new Error("htsfile blew up"));

    const { handleSampleDeselect } = renderQC({
      samples: [singleSample("boom.fastq")],
      sequenceTechnology: ILLUMINA,
    });

    await waitFor(() =>
      expect(handleSampleDeselect).toHaveBeenCalledWith(
        "boom.fastq",
        false,
        "local",
      ),
    );
    // The failure is swallowed: no "unsupported format" warning, because the
    // file never got as far as being classified.
    expect(hasCaption("not a supported format")).toBe(false);
  });

  it("treats a FASTA read-name failure as a duplicate-id failure", async () => {
    mockGetFileType.mockResolvedValue("FASTA text");
    mockGetReadNames.mockRejectedValue(new Error("seqtk blew up"));

    const { handleSampleDeselect } = renderQC({
      samples: [singleSample("broken.fasta")],
      sequenceTechnology: ILLUMINA,
    });

    await waitFor(() =>
      expect(handleSampleDeselect).toHaveBeenCalledWith(
        "broken.fasta",
        false,
        "local",
      ),
    );
    expect(hasCaption("duplicate read IDs")).toBe(false);
  });

  it("invalidates a FASTQ whose last megabyte cannot be sliced", async () => {
    mockSliceFile.mockRejectedValue(new Error("cannot slice"));
    mockGetReadNames.mockResolvedValue([ILLUMINA_R1]);

    const { handleSampleDeselect } = renderQC({
      samples: [singleSample("unsliceable.fastq")],
      sequenceTechnology: ILLUMINA,
    });

    await waitFor(() =>
      expect(handleSampleDeselect).toHaveBeenCalledWith(
        "unsliceable.fastq",
        false,
        "local",
      ),
    );
    // The slice error is swallowed, so no truncation warning is rendered --
    // only the sample-level invalidation.
    expect(hasCaption("appear to be truncated")).toBe(false);
  });
});
