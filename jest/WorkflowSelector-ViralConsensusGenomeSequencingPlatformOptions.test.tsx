// Frontend coverage:
// .../WorkflowSelector/components/ViralConsensusGenomeSequencingPlatformOptions/
//   ViralConsensusGenomeSequencingPlatformOptions.tsx
//
// This panel is the viral consensus-genome upload form. Its logic is four
// conditionals: reference sequence and primer BED each render either an upload
// button or the already-uploaded file name; the "new version available" flag is
// derived by comparing the first character of the project's pipeline version
// against the latest major version (tolerating an absent version via optional
// chaining); and the bad-file-name IssueGroup only appears while the parent
// reports a reference-sequence naming error. The panel also swallows clicks so
// interacting with it does not re-trigger the enclosing analysis-type card.
//
// Children are stubbed so the assertions land on the props this file computes.
import { fireEvent, render, screen } from "@testing-library/react";
import { ViralConsensusGenomeSequencingPlatformOptions } from "~/components/views/SampleUploadFlow/components/WorkflowSelector/components/ViralConsensusGenomeSequencingPlatformOptions/ViralConsensusGenomeSequencingPlatformOptions";
import { WorkflowLinksConfig } from "~/components/views/SampleUploadFlow/components/WorkflowSelector/workflowTypeConfig";
import { UploadWorkflows } from "~/components/views/SampleUploadFlow/constants";

// scss reached through the `~/` alias bypasses jest's global style mock.
jest.mock(
  "~/components/views/SampleUploadFlow/components/WorkflowSelector/workflow_selector.scss",
  () => ({}),
  { virtual: true },
);

jest.mock("~/components/ui/controls/ExternalLink", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => <a href={props.href}>{props.children}</a>,
}));

jest.mock("@czi-sds/components", () => ({
  __esModule: true,
  // TooltipIcon (rendered as each tooltip's trigger) reaches for Icon.
  Icon: () => <span data-testid="tooltip-icon" />,
  Tooltip: (props: $TSFixMe) => (
    <span data-testid="sds-tooltip">
      <span data-testid="sds-tooltip-title">{props.title}</span>
      {props.children}
    </span>
  ),
}));

let mockVersionIndicatorProps: $TSFixMe = null;
jest.mock(
  "~/components/views/SampleUploadFlow/components/WorkflowSelector/components/PipelineVersionIndicator",
  () => ({
    __esModule: true,
    PipelineVersionIndicator: (props: $TSFixMe) => {
      mockVersionIndicatorProps = props;
      return (
        <div
          data-testid="pipeline-version-indicator"
          data-new-version={String(props.isNewVersionAvailable)}
          data-version={String(props.version)}
        />
      );
    },
  }),
);

let mockTaxonFilterProps: $TSFixMe = null;
jest.mock(
  "~/components/views/SampleUploadFlow/components/WorkflowSelector/components/ViralConsensusGenomeSequencingPlatformOptions/components/UploadTaxonFilter",
  () => ({
    __esModule: true,
    UploadTaxonFilter: (props: $TSFixMe) => {
      mockTaxonFilterProps = props;
      return (
        <button
          data-testid="upload-taxon-filter"
          data-selected={props.selectedTaxon?.name}
          onClick={() => props.onChange({ id: 9, name: "Rhinovirus" })}
        >
          taxon
        </button>
      );
    },
  }),
);

jest.mock(
  "~/components/views/SampleUploadFlow/components/WorkflowSelector/components/ViralConsensusGenomeSequencingPlatformOptions/components/UploadButton",
  () => ({
    __esModule: true,
    UploadButton: (props: $TSFixMe) => (
      <button
        data-testid={`upload-button-${(props.fileTypes || []).join("|")}`}
        onClick={() => props.onFileChanged({ name: "picked-file" })}
      >
        upload
      </button>
    ),
  }),
);

jest.mock(
  "~/components/views/SampleUploadFlow/components/WorkflowSelector/components/ViralConsensusGenomeSequencingPlatformOptions/components/UploadedFileName",
  () => ({
    __esModule: true,
    UploadedFileName: (props: $TSFixMe) => (
      <button
        data-testid={`uploaded-file-${props.fileName}`}
        onClick={() => props.onFileChanged()}
      >
        {props.fileName}
      </button>
    ),
  }),
);

jest.mock("~/components/ui/notifications/IssueGroup", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => (
    <div data-testid="issue-group" data-type={props.type}>
      <span data-testid="issue-caption">{props.caption}</span>
      <span data-testid="issue-rows">{JSON.stringify(props.rows)}</span>
    </div>
  ),
}));

const baseProps = {
  bedFileName: "",
  refSeqFileName: "",
  hasRefSeqFileNameError: false,
  selectedTaxon: { id: 1, name: "Unknown" } as $TSFixMe,
  onBedFileChanged: jest.fn(),
  onRefSeqFileChanged: jest.fn(),
  onTaxonChange: jest.fn(),
};

const renderOptions = (overrides: $TSFixMe = {}) =>
  render(
    <ViralConsensusGenomeSequencingPlatformOptions
      {...baseProps}
      {...overrides}
    />,
  );

beforeEach(() => {
  mockVersionIndicatorProps = null;
  mockTaxonFilterProps = null;
  jest.clearAllMocks();
});

describe("ViralConsensusGenomeSequencingPlatformOptions -- version indicator", () => {
  it("passes the viral CG help links and flags no update when versions match", () => {
    renderOptions({ pipelineVersion: "1.2.0", latestMajorVersion: "1" });

    expect(
      screen
        .getByTestId("pipeline-version-indicator")
        .getAttribute("data-new-version"),
    ).toBe("false");
    expect(mockVersionIndicatorProps.isPipelineVersion).toBe(true);
    const config = WorkflowLinksConfig[UploadWorkflows.VIRAL_CONSENSUS_GENOME];
    expect(mockVersionIndicatorProps.versionHelpLink).toBe(
      config.pipelineVersionLink,
    );
    expect(mockVersionIndicatorProps.warningHelpLink).toBe(config.warningLink);
  });

  it("flags a new version when the major versions differ", () => {
    renderOptions({ pipelineVersion: "1.2.0", latestMajorVersion: "2" });

    expect(
      screen
        .getByTestId("pipeline-version-indicator")
        .getAttribute("data-new-version"),
    ).toBe("true");
  });

  it("tolerates a missing pipeline version without throwing", () => {
    renderOptions({ latestMajorVersion: "2" });

    const indicator = screen.getByTestId("pipeline-version-indicator");
    expect(indicator.getAttribute("data-version")).toBe("undefined");
    // undefined?.[0] is undefined, which differs from "2".
    expect(indicator.getAttribute("data-new-version")).toBe("true");
  });
});

describe("ViralConsensusGenomeSequencingPlatformOptions -- reference sequence", () => {
  it("offers a fasta upload button while no file is chosen", () => {
    renderOptions({ refSeqFileName: "" });

    const button = screen.getByTestId(
      "upload-button-.fasta|.fa|fasta.gz|.fa.gz",
    );
    fireEvent.click(button);
    expect(baseProps.onRefSeqFileChanged).toHaveBeenCalledWith({
      name: "picked-file",
    });
    expect(screen.queryByTestId("uploaded-file-ref.fasta")).toBeNull();
  });

  it("shows the uploaded file name once a file is chosen", () => {
    renderOptions({ refSeqFileName: "ref.fasta" });

    expect(
      screen.queryByTestId("upload-button-.fasta|.fa|fasta.gz|.fa.gz"),
    ).toBeNull();
    fireEvent.click(screen.getByTestId("uploaded-file-ref.fasta"));
    expect(baseProps.onRefSeqFileChanged).toHaveBeenCalledWith();
  });
});

describe("ViralConsensusGenomeSequencingPlatformOptions -- primer BED file", () => {
  it("offers a bed upload button while no primer file is chosen", () => {
    renderOptions({ bedFileName: "" });

    fireEvent.click(screen.getByTestId("upload-button-.bed|.bed.gz"));
    expect(baseProps.onBedFileChanged).toHaveBeenCalledWith({
      name: "picked-file",
    });
  });

  it("shows the uploaded primer file name once chosen", () => {
    renderOptions({ bedFileName: "primers.bed" });

    expect(screen.queryByTestId("upload-button-.bed|.bed.gz")).toBeNull();
    expect(screen.getByTestId("uploaded-file-primers.bed")).toBeTruthy();
  });
});

describe("ViralConsensusGenomeSequencingPlatformOptions -- file name error", () => {
  it("renders no issue group while the file name is acceptable", () => {
    renderOptions({
      refSeqFileName: "ref.fasta",
      hasRefSeqFileNameError: false,
    });

    expect(screen.queryByTestId("issue-group")).toBeNull();
  });

  it("warns with the offending file name when the name is rejected", () => {
    renderOptions({
      refSeqFileName: "bad name.fasta",
      hasRefSeqFileNameError: true,
    });

    const issue = screen.getByTestId("issue-group");
    expect(issue.getAttribute("data-type")).toBe("warning");
    expect(screen.getByTestId("issue-caption").textContent).toBeTruthy();
    expect(screen.getByTestId("issue-rows").textContent).toBe(
      JSON.stringify([["bad name.fasta"]]),
    );
  });
});

describe("ViralConsensusGenomeSequencingPlatformOptions -- taxon and click guard", () => {
  it("forwards the selected taxon and its change handler", () => {
    const onTaxonChange = jest.fn();
    renderOptions({
      selectedTaxon: { id: 3, name: "SARS-CoV-2" },
      onTaxonChange,
    });

    expect(
      screen.getByTestId("upload-taxon-filter").getAttribute("data-selected"),
    ).toBe("SARS-CoV-2");
    fireEvent.click(screen.getByTestId("upload-taxon-filter"));
    expect(onTaxonChange).toHaveBeenCalledWith({ id: 9, name: "Rhinovirus" });
    expect(mockTaxonFilterProps.selectedTaxon.id).toBe(3);
  });

  it("stops clicks inside the panel from reaching the enclosing card", () => {
    const onCardClick = jest.fn();
    render(
      <div onClick={onCardClick}>
        <ViralConsensusGenomeSequencingPlatformOptions {...baseProps} />
      </div>,
    );

    fireEvent.click(screen.getByTestId("upload-taxon-filter"));
    expect(onCardClick).not.toHaveBeenCalled();
  });
});
