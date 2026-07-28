// BRANCH coverage:
// app/assets/src/components/views/SampleUploadFlow/components/UploadSampleStep/
//   components/PreUploadQCCheck/PreUploadQCCheck.tsx
//
// The existing suites always end up with exactly one offending file, so every
// warning caption only ever rendered its singular form and the plural ternaries
// ("1 file" vs "2 files", "does not appear" vs "do not appear") were never
// taken. This suite drives two offending files through each warning, plus the
// three validation fall-throughs the other suites miss: a recognised file type
// that is neither FASTA nor FASTQ, reads that match neither platform regex, and
// an already-validated sample carrying an unrecognised format.
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
        { "data-testid": "issue-group" },
        ReactLib.createElement(
          "div",
          { "data-testid": "caption" },
          props.caption,
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

const ILLUMINA_READ = "@a00123:45:HWXYZ:1:1101:1000:2000/1";
const NANOPORE_READ = "@12345678-1234-4123-8abc-1234567890ab";

const makeFile = (name: string, content = "seqdata") =>
  new File([content], name);

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

// Captions are built from multi-line template literals, so compare on
// whitespace-normalised text.
const captions = () =>
  screen
    .queryAllByTestId("caption")
    .map(node => (node.textContent || "").replace(/\s+/g, " ").trim());

const hasCaption = (needle: string) =>
  captions().some(caption => caption.includes(needle));

beforeEach(() => {
  jest.clearAllMocks();
  mockSliceFile.mockResolvedValue({
    text: async () => "line1\nline2\nline3\n@validread\nACGT",
  });
  mockGetFileType.mockResolvedValue("FASTQ sequence text");
  mockGetReadNames.mockResolvedValue([ILLUMINA_READ]);
});

describe("PreUploadQCCheck -- plural warning captions", () => {
  it("pluralises the duplicate-read-id warning for two FASTA files", async () => {
    mockGetFileType.mockResolvedValue("FASTA text");
    // Same id twice -> the unique-set is smaller than the list.
    mockGetReadNames.mockResolvedValue([">dup", ">dup"]);

    renderQC({
      samples: [singleSample("a.fasta"), singleSample("b.fasta")],
    });

    await waitFor(() => expect(hasCaption("duplicate read IDs")).toBe(true));
    expect(
      hasCaption("2 files will not be uploaded because there are duplicate"),
    ).toBe(true);
  });

  it("pluralises the truncated-file warning for two FASTQ files", async () => {
    const CLI = defaultCLI();
    // seqtk reports a FASTA record (">") for the last four lines, which is how
    // the component detects truncation.
    CLI.exec = jest.fn().mockResolvedValue(">notafastqread");

    renderQC({
      CLI,
      samples: [singleSample("a.fastq"), singleSample("b.fastq")],
    });

    await waitFor(() =>
      expect(hasCaption("appear to be truncated")).toBe(true),
    );
    expect(hasCaption("2 files")).toBe(true);
  });

  it("pluralises the platform warning for two Nanopore files under Illumina", async () => {
    mockGetReadNames.mockResolvedValue([NANOPORE_READ]);

    renderQC({
      sequenceTechnology: ILLUMINA,
      samples: [singleSample("ont1.fastq"), singleSample("ont2.fastq")],
    });

    await waitFor(() =>
      expect(hasCaption("not appear to be an Illumina output")).toBe(true),
    );
    expect(hasCaption("2 files will not be uploaded")).toBe(true);
    expect(hasCaption("files do not appear to be an Illumina output")).toBe(
      true,
    );
  });

  it("pluralises the platform warning for two Illumina files under Nanopore", async () => {
    mockGetReadNames.mockResolvedValue([ILLUMINA_READ]);

    renderQC({
      sequenceTechnology: NANOPORE,
      samples: [singleSample("ill1.fastq"), singleSample("ill2.fastq")],
    });

    await waitFor(() =>
      expect(hasCaption("not appear to be a Nanopore output")).toBe(true),
    );
    expect(hasCaption("2 files will not be uploaded")).toBe(true);
    expect(hasCaption("files do not appear to be a Nanopore output")).toBe(
      true,
    );
  });
});

describe("PreUploadQCCheck -- validation fall-throughs", () => {
  it("runs no format-specific checks for a recognised non-FASTA/FASTQ type", async () => {
    // htsfile recognised the file (so it is not "unknown text"), but it is
    // neither FASTA nor FASTQ, so neither validation block runs.
    mockGetFileType.mockResolvedValue("BAM binary");

    const { handleSampleDeselect } = renderQC({
      sequenceTechnology: ILLUMINA,
      samples: [singleSample("reads.bam")],
    });

    await waitFor(() => expect(mockGetFileType).toHaveBeenCalled());
    expect(mockGetReadNames).not.toHaveBeenCalled();
    expect(screen.queryAllByTestId("issue-group")).toHaveLength(0);
    // The sample is still valid, and with no format it is left selected.
    expect(handleSampleDeselect).not.toHaveBeenCalled();
  });

  it("leaves the format unset when the reads match neither platform regex", async () => {
    mockGetReadNames.mockResolvedValue(["not-a-recognised-read-name"]);

    const { changeState } = renderQC({
      sequenceTechnology: ILLUMINA,
      samples: [singleSample("mystery.fastq")],
    });

    await waitFor(() => expect(changeState).toHaveBeenCalled());
    const updated =
      changeState.mock.calls[changeState.mock.calls.length - 1][0];
    expect(updated[0].format).toBeUndefined();
    // Without a format, neither platform-mismatch warning can render.
    expect(hasCaption("not appear to be an Illumina output")).toBe(false);
    expect(hasCaption("not appear to be a Nanopore output")).toBe(false);
  });

  it("leaves an already-validated sample with an unknown format untouched", async () => {
    const { handleSampleDeselect } = renderQC({
      sequenceTechnology: ILLUMINA,
      samples: [
        singleSample("done.fastq", {
          finishedValidating: true,
          isValid: true,
          format: "SomeOtherPlatform",
        }),
      ],
    });

    await waitFor(() => expect(mockGetFileType).not.toHaveBeenCalled());
    // Neither the Illumina nor the Nanopore checkbox branch applies, so the
    // selection is left exactly as the user left it.
    expect(handleSampleDeselect).not.toHaveBeenCalled();
  });
});
