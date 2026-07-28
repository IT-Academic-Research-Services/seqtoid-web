// Coverage: app/assets/src/components/views/SampleUploadFlow/components/UploadSampleStep/components/PreUploadQCCheck/PreUploadQCCheck.tsx
//
// PreUploadQCCheck runs a chain of client-side FASTA/FASTQ validations against
// each dropped sample (via a biowasm CLI) and renders a warning IssueGroup for
// each failure category: unsupported format, duplicate FASTA ids, truncated
// FASTQ, paired-end mismatch, uncompressed files, and platform mismatch. The
// biowasm CLI and the ../../utils helpers (getFileType / getReadNames /
// sliceFile) are stubbed so each validation branch can be driven deterministic-
// ally, and IssueGroup is stubbed so the assertions land on which warnings the
// component decides to render and the checkbox/deselect side effects.
import { render, screen, waitFor } from "@testing-library/react";

// ----- mocks -----
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
          (props.rows || []).map((r: $TSFixMe, i: number) =>
            ReactLib.createElement(
              "span",
              { key: i, "data-testid": "row" },
              String(r),
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

// An illumina-style read name that matches REGEX_READ_ILLUMINA.
const ILLUMINA_READ = "@a00123:45:HWXYZ:1:1101:1000:2000";
// A nanopore-style read name (UUID v4) that matches REGEX_READ_NANOPORE.
const NANOPORE_READ = "@12345678-1234-4123-8abc-1234567890ab";

const makeFile = (name: string, content = "seqdata") =>
  new File([content], name);

const makeSample = (fileName: string, extra: $TSFixMe = {}) => ({
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
  const utils = render(
    <PreUploadQCCheck
      samples={props.samples || []}
      changeState={changeState}
      handleSampleDeselect={handleSampleDeselect}
      CLI={CLI}
      sequenceTechnology={props.sequenceTechnology}
    />,
  );
  return { ...utils, changeState, handleSampleDeselect, CLI };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSliceFile.mockResolvedValue({
    text: async () => "line1\nline2\nline3\n@validread\nACGT",
  });
});

describe("PreUploadQCCheck unsupported format", () => {
  it("warns and deselects when a file is not FASTA/FASTQ", async () => {
    mockGetFileType.mockResolvedValue("unknown text");
    const { handleSampleDeselect } = renderQC({
      samples: [makeSample("bad.txt")],
    });

    await waitFor(() =>
      expect(screen.getAllByTestId("issue-group").length).toBeGreaterThan(0),
    );
    const captions = screen
      .getAllByTestId("caption")
      .map(c => c.textContent || "");
    expect(captions.some(c => c.includes("not a supported format"))).toBe(true);
    // Invalid file -> sample is deselected.
    expect(handleSampleDeselect).toHaveBeenCalledWith(
      "bad.txt",
      false,
      "local",
    );
    expect(mockTrackEvent).toHaveBeenCalled();
  });
});

describe("PreUploadQCCheck FASTA duplicates", () => {
  it("warns when a FASTA file has duplicate read ids", async () => {
    mockGetFileType.mockResolvedValue("FASTA text");
    mockGetReadNames.mockResolvedValue(["seq1", "seq1", "seq2"]);
    renderQC({ samples: [makeSample("dup.fasta")] });

    await waitFor(() => {
      const captions = screen
        .getAllByTestId("caption")
        .map(c => c.textContent || "");
      expect(captions.some(c => c.includes("duplicate read IDs"))).toBe(true);
    });
  });

  it("does not warn when the FASTA read ids are all unique", async () => {
    mockGetFileType.mockResolvedValue("FASTA text");
    mockGetReadNames.mockResolvedValue(["seq1", "seq2", "seq3"]);
    renderQC({ samples: [makeSample("ok.fasta")] });

    await waitFor(() => expect(mockGetReadNames).toHaveBeenCalled());
    const captions = screen
      .queryAllByTestId("caption")
      .map(c => c.textContent || "");
    expect(captions.some(c => c.includes("duplicate read IDs"))).toBe(false);
  });
});

describe("PreUploadQCCheck FASTQ truncation", () => {
  it("warns when the last FASTQ record is missing/invalid", async () => {
    mockGetFileType.mockResolvedValue("FASTQ sequence text");
    mockGetReadNames.mockResolvedValue([ILLUMINA_READ]);
    const CLI = {
      mount: jest.fn().mockResolvedValue(undefined),
      // Empty output from seqtk -> treated as truncated.
      exec: jest.fn().mockResolvedValue(""),
    };
    renderQC({ samples: [makeSample("trunc.fastq")], CLI });

    await waitFor(() => {
      const captions = screen
        .getAllByTestId("caption")
        .map(c => c.textContent || "");
      expect(captions.some(c => c.includes("appear to be truncated"))).toBe(
        true,
      );
    });
  });

  it("skips truncation checks for .gz files but still warns nothing", async () => {
    mockGetFileType.mockResolvedValue("FASTQ sequence text");
    mockGetReadNames.mockResolvedValue([ILLUMINA_READ]);
    renderQC({ samples: [makeSample("reads.fastq.gz")] });

    await waitFor(() => expect(mockGetReadNames).toHaveBeenCalled());
    // .gz means no uncompressed warning and no truncation warning.
    const captions = screen
      .queryAllByTestId("caption")
      .map(c => c.textContent || "");
    expect(captions.some(c => c.includes("appear to be truncated"))).toBe(
      false,
    );
    expect(captions.some(c => c.includes("uncompressed"))).toBe(false);
  });
});

describe("PreUploadQCCheck uncompressed files", () => {
  it("warns that a valid uncompressed FASTQ should be compressed", async () => {
    mockGetFileType.mockResolvedValue("FASTQ sequence text");
    mockGetReadNames.mockResolvedValue([ILLUMINA_READ]);
    renderQC({
      samples: [makeSample("reads.fastq")],
      sequenceTechnology: ILLUMINA,
    });

    await waitFor(() => {
      const captions = screen
        .getAllByTestId("caption")
        .map(c => c.textContent || "");
      expect(captions.some(c => c.includes("uncompressed"))).toBe(true);
    });
  });
});

describe("PreUploadQCCheck platform mismatch", () => {
  it("warns when Illumina is selected but a file looks like Nanopore", async () => {
    mockGetFileType.mockResolvedValue("FASTQ sequence text");
    mockGetReadNames.mockResolvedValue([NANOPORE_READ]);
    renderQC({
      samples: [makeSample("ontreads.fastq")],
      sequenceTechnology: ILLUMINA,
    });

    await waitFor(() => {
      const captions = screen
        .getAllByTestId("caption")
        .map(c => c.textContent || "");
      expect(
        captions.some(c => c.includes("not appear to be an Illumina output")),
      ).toBe(true);
    });
  });

  it("warns when Nanopore is selected but a file looks like Illumina", async () => {
    mockGetFileType.mockResolvedValue("FASTQ sequence text");
    mockGetReadNames.mockResolvedValue([ILLUMINA_READ]);
    renderQC({
      samples: [makeSample("illreads.fastq")],
      sequenceTechnology: NANOPORE,
    });

    await waitFor(() => {
      const captions = screen
        .getAllByTestId("caption")
        .map(c => c.textContent || "");
      expect(
        captions.some(c => c.includes("not appear to be a Nanopore output")),
      ).toBe(true);
    });
  });
});

describe("PreUploadQCCheck already-validated samples", () => {
  it("renders nothing and does not re-run validation for finished valid samples", async () => {
    const changeState = jest.fn();
    renderQC({
      samples: [
        {
          _selectId: "done",
          files: { "done.fastq": makeFile("done.fastq") },
          finishedValidating: true,
          isValid: true,
          format: ILLUMINA,
        },
      ],
      sequenceTechnology: ILLUMINA,
      changeState,
    });

    await waitFor(() => expect(mockGetFileType).not.toHaveBeenCalled());
    expect(screen.queryAllByTestId("issue-group")).toHaveLength(0);
  });
});
