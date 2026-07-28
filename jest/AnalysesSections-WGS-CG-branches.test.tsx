// Branch coverage for the ReviewStep analysis summary sections:
//   .../ReviewStep/components/AnalysesSections/components/WGSAnalysisSection/WGSAnalysisSection.tsx
//   .../ReviewStep/components/AnalysesSections/components/CGAnalysisSection/CGAnalysisSection.tsx
//
// WGSAnalysisSection is three `??` fallbacks; each needs a present value and a
// nullish one. CGAnalysisSection has two `technology === NANOPORE &&` gates and
// a `clearlabs ? "Yes" : "No"` ternary.
import { render, screen } from "@testing-library/react";
import { CGAnalysisSection } from "~/components/views/SampleUploadFlow/components/ReviewStep/components/AnalysesSections/components/CGAnalysisSection/CGAnalysisSection";
import { WGSAnalysisSection } from "~/components/views/SampleUploadFlow/components/ReviewStep/components/AnalysesSections/components/WGSAnalysisSection/WGSAnalysisSection";
import {
  CG_WETLAB_DISPLAY_NAMES,
  SEQUENCING_TECHNOLOGY_OPTIONS,
} from "~/components/views/SampleUploadFlow/constants";

describe("WGSAnalysisSection", () => {
  it("renders the supplied taxon, reference sequence and trim primer", () => {
    render(
      <WGSAnalysisSection
        taxon="Klebsiella pneumoniae"
        refSeqFile="ref.fasta"
        bedFile="primers.bed"
      />,
    );

    expect(screen.getByText("Klebsiella pneumoniae")).toBeTruthy();
    expect(screen.getByText("ref.fasta")).toBeTruthy();
    expect(screen.getByText("primers.bed")).toBeTruthy();
    expect(screen.queryByText("unknown")).toBeNull();
    expect(screen.queryByText("None provided")).toBeNull();
  });

  it("falls back to the placeholder copy when the values are null", () => {
    render(
      <WGSAnalysisSection
        taxon={null as $TSFixMe}
        refSeqFile={null as $TSFixMe}
        bedFile={null as $TSFixMe}
      />,
    );

    expect(screen.getByText("unknown")).toBeTruthy();
    expect(screen.getAllByText("None provided")).toHaveLength(2);
  });

  it("falls back to the placeholder copy when the values are undefined", () => {
    render(
      <WGSAnalysisSection
        taxon={undefined as $TSFixMe}
        refSeqFile={undefined as $TSFixMe}
        bedFile={undefined as $TSFixMe}
      />,
    );

    expect(screen.getByText("unknown")).toBeTruthy();
    expect(screen.getAllByText("None provided")).toHaveLength(2);
  });
});

describe("CGAnalysisSection", () => {
  it("shows the Clear Labs and Medaka rows for Nanopore with clearlabs on", () => {
    render(
      <CGAnalysisSection
        clearlabs={true}
        medakaModel="r941_min_high_g360"
        technology={SEQUENCING_TECHNOLOGY_OPTIONS.NANOPORE}
        wetlabProtocol="artic"
      />,
    );

    expect(screen.getByText("Used Clear Labs:")).toBeTruthy();
    expect(screen.getByText("Yes")).toBeTruthy();
    expect(screen.getByText("Medaka Model:")).toBeTruthy();
    expect(screen.getByText("r941_min_high_g360")).toBeTruthy();
    expect(screen.getByText(CG_WETLAB_DISPLAY_NAMES.artic)).toBeTruthy();
  });

  it("shows No for the clearlabs ternary's false arm", () => {
    render(
      <CGAnalysisSection
        clearlabs={false}
        medakaModel="r941_min_fast_g303"
        technology={SEQUENCING_TECHNOLOGY_OPTIONS.NANOPORE}
        wetlabProtocol="midnight"
      />,
    );

    expect(screen.getByText("No")).toBeTruthy();
    expect(screen.queryByText("Yes")).toBeNull();
    expect(screen.getByText(CG_WETLAB_DISPLAY_NAMES.midnight)).toBeTruthy();
  });

  it("hides both Nanopore-only rows for Illumina and still shows the wetlab protocol", () => {
    render(
      <CGAnalysisSection
        clearlabs={true}
        medakaModel="r941_min_high_g360"
        technology={SEQUENCING_TECHNOLOGY_OPTIONS.ILLUMINA}
        wetlabProtocol="msspe"
      />,
    );

    expect(screen.queryByText("Used Clear Labs:")).toBeNull();
    expect(screen.queryByText("Medaka Model:")).toBeNull();
    expect(screen.queryByText("Yes")).toBeNull();
    expect(screen.getByText("Wetlab Protocol:")).toBeTruthy();
    expect(screen.getByText(CG_WETLAB_DISPLAY_NAMES.msspe)).toBeTruthy();
  });
});
