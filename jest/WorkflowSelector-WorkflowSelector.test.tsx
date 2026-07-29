// Frontend coverage:
// app/assets/src/components/views/SampleUploadFlow/components/WorkflowSelector/
//   WorkflowSelector.tsx
//
// WorkflowSelector renders the four "Analysis Type" cards (mNGS, AMR, viral CG,
// SARS-CoV-2 CG) and decides, per card, whether it is disabled (not in
// `enabledWorkflows`) and whether it is currently selected. Two smaller pieces
// of logic hang off that:
//   * the AMR blurb links to GitHub only while the AMR card is enabled,
//   * the AMR pipeline-version indicator flags "new version available" by
//     comparing the project's pinned AMR version against the latest major one,
//     tolerating both maps being absent.
// The module also exports shouldDisableSequencingPlatformOption, the per-tab
// rule for greying out a sequencing platform radio.
//
// Every child card/option component is stubbed so the assertions land on the
// props WorkflowSelector computes rather than on the childrens' own rendering.
import { fireEvent, render, screen } from "@testing-library/react";

const analysisTypeProps: Record<string, $TSFixMe> = {};

jest.mock(
  "~/components/views/SampleUploadFlow/components/WorkflowSelector/components/AnalysisType",
  () => ({
    __esModule: true,
    AnalysisType: (props: $TSFixMe) => {
      analysisTypeProps[props.testKey] = props;
      return (
        <div
          data-testid={`analysis-type-${props.testKey}`}
          data-disabled={String(props.isDisabled)}
          data-selected={String(props.isSelected)}
          data-title={props.title}
          onClick={props.onClick}
        >
          <span data-testid={`description-${props.testKey}`}>
            {props.description}
          </span>
          {props.sequencingPlatformOptions}
          {props.customIcon}
        </div>
      );
    },
  }),
);

const platformStub = (name: string) => ({
  __esModule: true,
  [name]: (props: $TSFixMe) => (
    <div data-testid={name} data-props={JSON.stringify(props ?? {})} />
  ),
});

jest.mock(
  "~/components/views/SampleUploadFlow/components/WorkflowSelector/components/MetagenomicsSequencingPlatformOptions",
  () => platformStub("MetagenomicsSequencingPlatformOptions"),
);
jest.mock(
  "~/components/views/SampleUploadFlow/components/WorkflowSelector/components/ConsensusGenomeSequencingPlatformOptions",
  () => platformStub("ConsensusGenomeSequencingPlatformOptions"),
);
jest.mock(
  "~/components/views/SampleUploadFlow/components/WorkflowSelector/components/ViralConsensusGenomeSequencingPlatformOptions",
  () => platformStub("ViralConsensusGenomeSequencingPlatformOptions"),
);

jest.mock(
  "~/components/views/SampleUploadFlow/components/WorkflowSelector/components/PipelineVersionIndicator",
  () => ({
    __esModule: true,
    PipelineVersionIndicator: (props: $TSFixMe) => (
      <div
        data-testid="amr-version-indicator"
        data-new-version={String(props.isNewVersionAvailable)}
        data-version={JSON.stringify(props.version ?? null)}
      />
    ),
  }),
);

jest.mock("~/components/ui/controls/ExternalLink", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => (
    <a data-testid="amr-github-link" href={props.href}>
      {props.children}
    </a>
  ),
}));

jest.mock("~ui/icons", () => ({
  __esModule: true,
  IconCovidVirusXLarge: (props: $TSFixMe) => (
    <span data-testid="covid-icon" data-classname={String(props.className)} />
  ),
}));

import {
  shouldDisableSequencingPlatformOption,
  WorkflowSelector,
} from "~/components/views/SampleUploadFlow/components/WorkflowSelector/WorkflowSelector";
import {
  BASESPACE_UPLOAD,
  ILLUMINA,
  LOCAL_UPLOAD,
  NANOPORE,
  NO_TECHNOLOGY_SELECTED,
  REMOTE_UPLOAD,
  UPLOAD_WORKFLOWS,
  UploadWorkflows,
} from "~/components/views/SampleUploadFlow/constants";

const ALL_WORKFLOWS = [
  UPLOAD_WORKFLOWS.MNGS.value,
  UPLOAD_WORKFLOWS.AMR.value,
  UPLOAD_WORKFLOWS.VIRAL_CONSENSUS_GENOME.value,
  UPLOAD_WORKFLOWS.COVID_CONSENSUS_GENOME.value,
];

const renderSelector = (props: $TSFixMe = {}) =>
  render(
    <WorkflowSelector
      bedFileName=""
      refSeqFileName=""
      hasRefSeqFileNameError={false}
      enabledWorkflows={ALL_WORKFLOWS}
      onBedFileChanged={jest.fn()}
      onRefSeqFileChanged={jest.fn()}
      onTaxonChange={jest.fn()}
      onWorkflowToggle={jest.fn()}
      currentTab={LOCAL_UPLOAD}
      projectPipelineVersions={{}}
      latestMajorPipelineVersions={{}}
      selectedTaxon={{ id: 1, name: "Unknown" } as $TSFixMe}
      selectedTechnology={NO_TECHNOLOGY_SELECTED}
      selectedWorkflows={new Set()}
      {...props}
    />,
  );

const card = (workflow: UploadWorkflows) =>
  screen.getByTestId(`analysis-type-${workflow}`);

describe("shouldDisableSequencingPlatformOption", () => {
  it("disables Nanopore mNGS on the remote tab only", () => {
    expect(
      shouldDisableSequencingPlatformOption(
        REMOTE_UPLOAD,
        NANOPORE,
        UPLOAD_WORKFLOWS.MNGS.value,
      ),
    ).toBe(true);
    expect(
      shouldDisableSequencingPlatformOption(
        REMOTE_UPLOAD,
        ILLUMINA,
        UPLOAD_WORKFLOWS.MNGS.value,
      ),
    ).toBe(false);
    expect(
      shouldDisableSequencingPlatformOption(
        REMOTE_UPLOAD,
        NANOPORE,
        UPLOAD_WORKFLOWS.COVID_CONSENSUS_GENOME.value,
      ),
    ).toBe(false);
  });

  it("disables every Nanopore option on the basespace tab", () => {
    expect(
      shouldDisableSequencingPlatformOption(
        BASESPACE_UPLOAD,
        NANOPORE,
        UPLOAD_WORKFLOWS.COVID_CONSENSUS_GENOME.value,
      ),
    ).toBe(true);
    expect(
      shouldDisableSequencingPlatformOption(
        BASESPACE_UPLOAD,
        ILLUMINA,
        UPLOAD_WORKFLOWS.COVID_CONSENSUS_GENOME.value,
      ),
    ).toBe(false);
  });

  it("never disables an option on the local tab", () => {
    expect(
      shouldDisableSequencingPlatformOption(
        LOCAL_UPLOAD,
        NANOPORE,
        UPLOAD_WORKFLOWS.MNGS.value,
      ),
    ).toBe(false);
  });

  it("returns undefined for an unrecognised tab", () => {
    expect(
      shouldDisableSequencingPlatformOption(
        "somethingElse" as $TSFixMe,
        NANOPORE,
        UPLOAD_WORKFLOWS.MNGS.value,
      ),
    ).toBeUndefined();
  });
});

describe("WorkflowSelector", () => {
  beforeEach(() => {
    Object.keys(analysisTypeProps).forEach(k => delete analysisTypeProps[k]);
  });

  it("renders all four analysis types with their labels", () => {
    renderSelector();

    expect(screen.getByText("Analysis Type")).toBeTruthy();
    ALL_WORKFLOWS.forEach(workflow => {
      expect(card(workflow)).toBeTruthy();
    });
    expect(card(UPLOAD_WORKFLOWS.MNGS.value).dataset.title).toBe(
      "Metagenomics",
    );
    expect(card(UPLOAD_WORKFLOWS.AMR.value).dataset.title).toBe(
      "Antimicrobial Resistance",
    );
  });

  it("enables every card when all workflows are enabled", () => {
    renderSelector();

    ALL_WORKFLOWS.forEach(workflow => {
      expect(card(workflow).dataset.disabled).toBe("false");
    });
  });

  it("disables the cards missing from enabledWorkflows", () => {
    renderSelector({ enabledWorkflows: [UPLOAD_WORKFLOWS.MNGS.value] });

    expect(card(UPLOAD_WORKFLOWS.MNGS.value).dataset.disabled).toBe("false");
    expect(card(UPLOAD_WORKFLOWS.AMR.value).dataset.disabled).toBe("true");
    expect(
      card(UPLOAD_WORKFLOWS.VIRAL_CONSENSUS_GENOME.value).dataset.disabled,
    ).toBe("true");
    expect(
      card(UPLOAD_WORKFLOWS.COVID_CONSENSUS_GENOME.value).dataset.disabled,
    ).toBe("true");
  });

  it("marks only the workflows present in selectedWorkflows as selected", () => {
    renderSelector({
      selectedWorkflows: new Set([
        UPLOAD_WORKFLOWS.MNGS.value,
        UPLOAD_WORKFLOWS.AMR.value,
      ]),
    });

    expect(card(UPLOAD_WORKFLOWS.MNGS.value).dataset.selected).toBe("true");
    expect(card(UPLOAD_WORKFLOWS.AMR.value).dataset.selected).toBe("true");
    expect(
      card(UPLOAD_WORKFLOWS.VIRAL_CONSENSUS_GENOME.value).dataset.selected,
    ).toBe("false");
  });

  it("links to the AMR pipeline on GitHub while AMR is enabled", () => {
    renderSelector();

    const link = screen.getByTestId("amr-github-link") as HTMLAnchorElement;
    expect(link.textContent).toBe("here");
    expect(link.getAttribute("href")).toContain("github");
  });

  it("drops the GitHub link from the AMR blurb when AMR is disabled", () => {
    renderSelector({ enabledWorkflows: [UPLOAD_WORKFLOWS.MNGS.value] });

    expect(screen.queryByTestId("amr-github-link")).toBeNull();
    expect(
      screen.getByTestId(`description-${UPLOAD_WORKFLOWS.AMR.value}`)
        .textContent,
    ).toContain("here.");
  });

  it("flags a new AMR pipeline version when the project pin lags the latest", () => {
    renderSelector({
      projectPipelineVersions: { amr: ["1.2.0"] },
      latestMajorPipelineVersions: { amr: "2.0.0" },
    });

    const indicator = screen.getByTestId("amr-version-indicator");
    expect(indicator.dataset.newVersion).toBe("true");
    expect(indicator.dataset.version).toBe(JSON.stringify(["1.2.0"]));
  });

  it("does not flag a new AMR version when the pin matches the latest", () => {
    renderSelector({
      projectPipelineVersions: { amr: ["2.0.0"] },
      latestMajorPipelineVersions: { amr: "2.0.0" },
    });

    expect(screen.getByTestId("amr-version-indicator").dataset.newVersion).toBe(
      "false",
    );
  });

  it("tolerates both pipeline version maps being undefined", () => {
    renderSelector({
      projectPipelineVersions: undefined,
      latestMajorPipelineVersions: undefined,
    });

    const indicator = screen.getByTestId("amr-version-indicator");
    // undefined !== undefined is false, so no "new version" nag is shown.
    expect(indicator.dataset.newVersion).toBe("false");
    expect(indicator.dataset.version).toBe("null");
  });

  it("passes the covid icon a class name only while the covid card is disabled", () => {
    const { unmount } = renderSelector();
    expect(screen.getByTestId("covid-icon").dataset.classname).toBe("false");
    unmount();

    renderSelector({ enabledWorkflows: [] });
    // scss modules resolve to {} under jest, so the truthy branch yields
    // `undefined` -- what matters is that it is no longer the `false` produced
    // by the short circuit.
    expect(screen.getByTestId("covid-icon").dataset.classname).toBe(
      "undefined",
    );
  });

  it("toggles mNGS and AMR without a technology, and viral CG with Illumina", () => {
    const onWorkflowToggle = jest.fn();
    renderSelector({ onWorkflowToggle });

    fireEvent.click(card(UPLOAD_WORKFLOWS.MNGS.value));
    expect(onWorkflowToggle).toHaveBeenLastCalledWith(
      UPLOAD_WORKFLOWS.MNGS.value,
    );

    fireEvent.click(card(UPLOAD_WORKFLOWS.AMR.value));
    expect(onWorkflowToggle).toHaveBeenLastCalledWith(
      UPLOAD_WORKFLOWS.AMR.value,
    );

    fireEvent.click(card(UPLOAD_WORKFLOWS.VIRAL_CONSENSUS_GENOME.value));
    expect(onWorkflowToggle).toHaveBeenLastCalledWith(
      UPLOAD_WORKFLOWS.VIRAL_CONSENSUS_GENOME.value,
      ILLUMINA,
    );

    fireEvent.click(card(UPLOAD_WORKFLOWS.COVID_CONSENSUS_GENOME.value));
    expect(onWorkflowToggle).toHaveBeenLastCalledWith(
      UPLOAD_WORKFLOWS.COVID_CONSENSUS_GENOME.value,
    );
    expect(onWorkflowToggle).toHaveBeenCalledTimes(4);
  });

  it("renders one sequencing-platform panel per applicable workflow", () => {
    renderSelector();

    expect(
      screen.getByTestId("MetagenomicsSequencingPlatformOptions"),
    ).toBeTruthy();
    expect(
      screen.getByTestId("ViralConsensusGenomeSequencingPlatformOptions"),
    ).toBeTruthy();
    expect(
      screen.getByTestId("ConsensusGenomeSequencingPlatformOptions"),
    ).toBeTruthy();
  });

  it("threads the viral CG file/taxon state down to its platform options", () => {
    const onBedFileChanged = jest.fn();
    renderSelector({
      bedFileName: "primers.bed",
      refSeqFileName: "ref.fasta",
      hasRefSeqFileNameError: true,
      onBedFileChanged,
      projectPipelineVersions: { "consensus-genome": "3.4.9" },
      latestMajorPipelineVersions: { "consensus-genome": "4.0.0" },
    });

    const props = JSON.parse(
      screen.getByTestId("ViralConsensusGenomeSequencingPlatformOptions")
        .dataset.props as string,
    );
    expect(props.bedFileName).toBe("primers.bed");
    expect(props.refSeqFileName).toBe("ref.fasta");
    expect(props.hasRefSeqFileNameError).toBe(true);
    expect(props.pipelineVersion).toBe("3.4.9");
    expect(props.latestMajorVersion).toBe("4.0.0");
  });

  it("threads the selected technology and covid options through", () => {
    renderSelector({
      selectedTechnology: ILLUMINA,
      selectedWetlabProtocol: "artic",
      usedClearLabs: true,
      s3UploadEnabled: true,
      selectedMedakaModel: "r941",
      selectedGuppyBasecallerSetting: "fast",
    });

    const mngsProps = JSON.parse(
      screen.getByTestId("MetagenomicsSequencingPlatformOptions").dataset
        .props as string,
    );
    expect(mngsProps.selectedTechnology).toBe(ILLUMINA);
    expect(mngsProps.selectedGuppyBasecallerSetting).toBe("fast");

    const cgProps = JSON.parse(
      screen.getByTestId("ConsensusGenomeSequencingPlatformOptions").dataset
        .props as string,
    );
    expect(cgProps.usedClearLabs).toBe(true);
    expect(cgProps.isS3UploadEnabled).toBe(true);
    expect(cgProps.selectedMedakaModel).toBe("r941");
    expect(cgProps.selectedWetlabProtocol).toBe("artic");
  });
});
