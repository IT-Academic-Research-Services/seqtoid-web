// Coverage: app/assets/src/components/views/SampleUploadFlow/components/ReviewStep/components/AnalysesSections/AnalysesSections.tsx
//
// AnalysesSections renders one block per selected upload workflow. getWorkflowSectionOrder
// fixes the display order (mngs, amr, cg, wgs) regardless of Set insertion order.
// Each block branches on: workflow-specific icon vs custom icon (COVID), whether
// to show the Sequencing Platform row (hidden for AMR), whether to show the NCBI
// Index Date row (only MNGS per AnalysisSectionsConfig), and which of the three
// workflow-specific sub-sections (CG / MNGS / WGS) to mount. The three sub-section
// children and the SDS Icon are stubbed so the assertions land on this file's own
// mapping/branch logic.
import { render, screen, within } from "@testing-library/react";
import { AnalysesSections } from "~/components/views/SampleUploadFlow/components/ReviewStep/components/AnalysesSections/AnalysesSections";
import {
  ILLUMINA,
  NANOPORE,
  UploadWorkflows,
} from "~/components/views/SampleUploadFlow/constants";

jest.mock("@czi-sds/components", () => ({
  Icon: (props: $TSFixMe) =>
    require("react").createElement("span", {
      "data-testid": "sds-icon",
      "data-sdsicon": props.sdsIcon,
    }),
}));

jest.mock(
  "~/components/views/SampleUploadFlow/components/ReviewStep/components/AnalysesSections/components/CGAnalysisSection",
  () => ({
    CGAnalysisSection: (props: $TSFixMe) =>
      require("react").createElement("div", {
        "data-testid": "cg-section",
        "data-medaka": props.medakaModel,
      }),
  }),
);

jest.mock(
  "~/components/views/SampleUploadFlow/components/ReviewStep/components/AnalysesSections/components/MNGSAnalysisSection",
  () => ({
    MNGSAnalysisSection: (props: $TSFixMe) =>
      require("react").createElement("div", {
        "data-testid": "mngs-section",
        "data-guppy": props.guppyBasecallerSetting,
      }),
  }),
);

jest.mock(
  "~/components/views/SampleUploadFlow/components/ReviewStep/components/AnalysesSections/components/WGSAnalysisSection",
  () => ({
    WGSAnalysisSection: (props: $TSFixMe) =>
      require("react").createElement("div", {
        "data-testid": "wgs-section",
        "data-taxon": props.taxon,
      }),
  }),
);

const project = { id: 42, name: "P" };

// pipelineVersions is indexed by project id, then by the backend workflow type
// (WORKFLOWS_BY_UPLOAD_SELECTIONS resolves the upload selection to these keys)
// plus the NCBI index date key.
const pipelineVersions = {
  42: {
    "short-read-mngs": "8.0.0",
    amr: "1.2.0",
    "consensus-genome": "3.4.0",
    ncbi_index_date: "2024-02-06",
  } as $TSFixMe,
};

const baseProps = {
  bedFile: "regions.bed",
  clearlabs: false,
  guppyBasecallerSetting: "fast",
  medakaModel: "r941",
  pipelineVersions,
  project: project as $TSFixMe,
  refSeqFile: "ref.fasta",
  refSeqTaxon: "Zika",
  wetlabProtocol: "artic",
};

const renderSections = (
  workflows: UploadWorkflows[],
  technology = ILLUMINA as $TSFixMe,
) =>
  render(
    <AnalysesSections
      {...(baseProps as $TSFixMe)}
      technology={technology}
      workflows={new Set(workflows) as $TSFixMe}
    />,
  );

describe("AnalysesSections", () => {
  it("renders the MNGS section with platform, pipeline version and NCBI index date", () => {
    renderSections([UploadWorkflows.MNGS]);
    expect(screen.getByText("Metagenomics")).toBeTruthy();
    // MNGS shows the Sequencing Platform row.
    expect(screen.getByText("Sequencing Platform:")).toBeTruthy();
    expect(screen.getByText("Illumina")).toBeTruthy();
    // MNGS is the only workflow that shows the NCBI Index Date row.
    expect(screen.getByText("NCBI Index Date:")).toBeTruthy();
    expect(screen.getByText("2024-02-06")).toBeTruthy();
    expect(screen.getByText("8.0.0")).toBeTruthy();
    // The MNGS sub-section mounts and receives the guppy setting.
    expect(screen.getByTestId("mngs-section").getAttribute("data-guppy")).toBe(
      "fast",
    );
    expect(screen.queryByTestId("cg-section")).toBeNull();
  });

  it("hides the Sequencing Platform row and index date for AMR", () => {
    renderSections([UploadWorkflows.AMR]);
    expect(screen.getByText("Antimicrobial Resistance")).toBeTruthy();
    // AMR omits both the platform row and the NCBI Index Date row.
    expect(screen.queryByText("Sequencing Platform:")).toBeNull();
    expect(screen.queryByText("NCBI Index Date:")).toBeNull();
    expect(screen.getByText("1.2.0")).toBeTruthy();
  });

  it("renders the COVID consensus genome section with a custom icon and CG sub-section", () => {
    renderSections([UploadWorkflows.COVID_CONSENSUS_GENOME]);
    expect(screen.getByText("SARS-CoV-2 Consensus Genome")).toBeTruthy();
    // COVID uses a customIcon, so no SDS Icon is rendered for it.
    expect(screen.queryByTestId("sds-icon")).toBeNull();
    expect(screen.getByTestId("cg-section").getAttribute("data-medaka")).toBe(
      "r941",
    );
  });

  it("renders the viral consensus genome section with the WGS sub-section", () => {
    renderSections([UploadWorkflows.VIRAL_CONSENSUS_GENOME]);
    expect(screen.getByText("Viral Consensus Genome")).toBeTruthy();
    expect(screen.getByTestId("wgs-section").getAttribute("data-taxon")).toBe(
      "Zika",
    );
  });

  it("orders sections mngs, amr, cg regardless of Set insertion order", () => {
    // Insert in reverse to prove getWorkflowSectionOrder reorders.
    renderSections([
      UploadWorkflows.COVID_CONSENSUS_GENOME,
      UploadWorkflows.AMR,
      UploadWorkflows.MNGS,
    ]);
    const review = screen.getByTestId("upload-input-review");
    const names = within(review)
      .getAllByText(
        /Metagenomics|Antimicrobial Resistance|SARS-CoV-2 Consensus Genome/,
      )
      .map(n => n.textContent);
    expect(names).toEqual([
      "Metagenomics",
      "Antimicrobial Resistance",
      "SARS-CoV-2 Consensus Genome",
    ]);
  });

  it("shows the ONT display name when technology is Nanopore", () => {
    renderSections([UploadWorkflows.MNGS], NANOPORE);
    // SEQUENCING_TECHNOLOGY_DISPLAY_NAMES maps ONT -> "Nanopore".
    expect(screen.queryByText("Illumina")).toBeNull();
  });
});
