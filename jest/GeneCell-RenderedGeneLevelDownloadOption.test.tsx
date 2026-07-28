// Coverage: app/assets/src/components/views/SampleView/components/AmrView/
//   components/AmrSampleReport/columnDefinitions/components/GeneCell/
//   components/RenderedGeneLevelDownloadOption/RenderedGeneLevelDownloadOption.tsx
//
// RenderedGeneLevelDownloadOption renders a single download MenuItem (Contigs or
// Reads) wrapped in a Tooltip. The disabled state and tooltip text depend on the
// option type, the pipeline version (contigs), and whether there are any
// contigs/reads. On click it maps the human-readable option name back to a
// download-type constant and delegates to downloadAmrGeneLevelData with the
// right index id (geneId for reads, aroAccession for contigs). The SDS
// MenuItem/Tooltip, the pipeline-version check, and the download util are all
// stubbed so every disabled branch and the click delegation are asserted
// directly.
import { fireEvent, render, screen } from "@testing-library/react";

let lastTooltipTitle: $TSFixMe = null;
jest.mock("@czi-sds/components", () => {
  const ReactLib = require("react");
  return {
    Tooltip: (props: $TSFixMe) => {
      lastTooltipTitle = props.title;
      return ReactLib.createElement(
        "div",
        { "data-testid": "tooltip", "data-title": props.title },
        props.children,
      );
    },
    MenuItem: (props: $TSFixMe) =>
      ReactLib.createElement(
        "div",
        {
          role: "menuitem",
          "data-disabled": String(!!props.disabled),
          onClick: props.onClick,
        },
        props.children,
      ),
  };
});

const mockIsAmrGeneLevelContigDownloadAvailable = jest.fn();
jest.mock("~/components/utils/pipeline_versions", () => ({
  isAmrGeneLevelContigDownloadAvailable: (v: $TSFixMe) =>
    mockIsAmrGeneLevelContigDownloadAvailable(v),
}));

const mockDownloadAmrGeneLevelData = jest.fn();
jest.mock(
  "~/components/views/SampleView/components/SampleViewHeader/components/PrimaryHeaderControls/components/SampleViewDownloadButton/components/AmrDownloadDropdown/amrDownloadUtils",
  () => ({
    downloadAmrGeneLevelData: (...args: $TSFixMe[]) =>
      mockDownloadAmrGeneLevelData(...args),
  }),
);

import {
  geneLevelDownloadOptions,
  RenderedGeneLevelDownloadOption,
} from "~/components/views/SampleView/components/AmrView/components/AmrSampleReport/columnDefinitions/components/GeneCell/components/RenderedGeneLevelDownloadOption/RenderedGeneLevelDownloadOption";

const CONTIGS_OPTION = { name: "Contigs (.fasta)" };
const READS_OPTION = { name: "Reads (.fasta)" };

const baseProps = {
  aroAccession: "ARO:123",
  contigs: "5",
  geneId: "gene-99",
  geneName: "aadA",
  reads: "42",
  workflowRunId: "wf-7",
  workflowWdlVersion: "1.3.0",
};

const renderOption = (overrides: $TSFixMe = {}) =>
  render(
    <RenderedGeneLevelDownloadOption
      {...baseProps}
      option={overrides.option ?? CONTIGS_OPTION}
      {...overrides}
    />,
  );

beforeEach(() => {
  jest.clearAllMocks();
  lastTooltipTitle = null;
  mockIsAmrGeneLevelContigDownloadAvailable.mockReturnValue(true);
});

describe("geneLevelDownloadOptions", () => {
  it("exposes the contigs and reads download options", () => {
    expect(geneLevelDownloadOptions).toEqual([
      { name: "Contigs (.fasta)" },
      { name: "Reads (.fasta)" },
    ]);
  });
});

describe("RenderedGeneLevelDownloadOption - contigs", () => {
  it("is enabled with an empty tooltip when contigs are available", () => {
    renderOption({ option: CONTIGS_OPTION, contigs: "5" });
    expect(screen.getByRole("menuitem").dataset.disabled).toBe("false");
    expect(lastTooltipTitle).toBe("");
    expect(screen.getByText("Contigs (.fasta)")).toBeTruthy();
  });

  it("is disabled with a no-contigs tooltip when contigs is '0'", () => {
    renderOption({ option: CONTIGS_OPTION, contigs: "0" });
    expect(screen.getByRole("menuitem").dataset.disabled).toBe("true");
    expect(lastTooltipTitle).toBe("There are no contigs for this gene");
  });

  it("is disabled when contigs is null", () => {
    renderOption({ option: CONTIGS_OPTION, contigs: null });
    expect(screen.getByRole("menuitem").dataset.disabled).toBe("true");
  });

  it("is disabled with a version tooltip when contig download is unavailable", () => {
    mockIsAmrGeneLevelContigDownloadAvailable.mockReturnValue(false);
    renderOption({ option: CONTIGS_OPTION, contigs: "5" });
    expect(screen.getByRole("menuitem").dataset.disabled).toBe("true");
    expect(lastTooltipTitle).toBe(
      "Gene-level contig download is not available for pipeline runs before v1.2.14",
    );
  });

  it("downloads contigs using the aroAccession as index id", () => {
    renderOption({ option: CONTIGS_OPTION });
    fireEvent.click(screen.getByRole("menuitem"));
    expect(mockDownloadAmrGeneLevelData).toHaveBeenCalledWith(
      "download-contigs",
      "ARO:123",
      "aadA",
      "wf-7",
    );
  });
});

describe("RenderedGeneLevelDownloadOption - reads", () => {
  it("is enabled when there are reads", () => {
    renderOption({ option: READS_OPTION, reads: "42" });
    expect(screen.getByRole("menuitem").dataset.disabled).toBe("false");
    expect(lastTooltipTitle).toBe("");
  });

  it("is disabled with a no-reads tooltip when reads is '0'", () => {
    renderOption({ option: READS_OPTION, reads: "0" });
    expect(screen.getByRole("menuitem").dataset.disabled).toBe("true");
    expect(lastTooltipTitle).toBe("There are no reads for this gene");
  });

  it("is disabled when reads is null", () => {
    renderOption({ option: READS_OPTION, reads: null });
    expect(screen.getByRole("menuitem").dataset.disabled).toBe("true");
  });

  it("downloads reads using the geneId as index id", () => {
    renderOption({ option: READS_OPTION });
    fireEvent.click(screen.getByRole("menuitem"));
    expect(mockDownloadAmrGeneLevelData).toHaveBeenCalledWith(
      "download-reads",
      "gene-99",
      "aadA",
      "wf-7",
    );
  });
});
