// Coverage: app/assets/src/components/views/UserProfileForm/components/
//   CZIDUsecaseFormField/constants.tsx
//
// The constants module is the single source of truth for the "how do you plan
// to use SeqtoID" option list, the max number of selections allowed, and the
// free-text checkbox prefix. These assertions pin the option ordering and the
// membership of every named export in the exported list.
import {
  AMR_DETECTION_OPTION,
  CHECKBOX_WITH_INPUT_PREFIX,
  CLINICAL_RESEARCH_OPTION,
  CZID_USECASE_OPTIONS,
  DISCOVER_NOVEL_VIRUSES_OPTION,
  IDENTIFY_KNOWN_PATHOGEN_OPTION,
  MAX_SELECTIONS,
  MICROBIOME_ANALYSIS_OPTION,
  OUTBREAK_DETECTION_OPTION,
  PHYLOGENETIC_TREE_OPTION,
  SC2_CONSENSUS_GENOME_OPTION,
  SURVEILLANCE_OF_VECTORS_OPTION,
  TRAIN_OTHERS_OPTION,
  VIRAL_CONSENSUS_GENOME_NON_SC2_OPTION,
} from "~/components/views/UserProfileForm/components/CZIDUsecaseFormField/constants";

describe("CZIDUsecaseFormField constants", () => {
  it("allows at most three selections", () => {
    expect(MAX_SELECTIONS).toBe(3);
  });

  it("uses 'Other:' as the free-text checkbox prefix", () => {
    expect(CHECKBOX_WITH_INPUT_PREFIX).toBe("Other:");
  });

  it("lists all eleven usecase options in declaration order", () => {
    expect(CZID_USECASE_OPTIONS).toEqual([
      IDENTIFY_KNOWN_PATHOGEN_OPTION,
      OUTBREAK_DETECTION_OPTION,
      DISCOVER_NOVEL_VIRUSES_OPTION,
      CLINICAL_RESEARCH_OPTION,
      MICROBIOME_ANALYSIS_OPTION,
      SURVEILLANCE_OF_VECTORS_OPTION,
      AMR_DETECTION_OPTION,
      VIRAL_CONSENSUS_GENOME_NON_SC2_OPTION,
      SC2_CONSENSUS_GENOME_OPTION,
      PHYLOGENETIC_TREE_OPTION,
      TRAIN_OTHERS_OPTION,
    ]);
    expect(CZID_USECASE_OPTIONS).toHaveLength(11);
  });

  it("exposes human readable, non-empty, unique option labels", () => {
    CZID_USECASE_OPTIONS.forEach(option => {
      expect(typeof option).toBe("string");
      expect(option.length).toBeGreaterThan(0);
    });
    expect(new Set(CZID_USECASE_OPTIONS).size).toBe(
      CZID_USECASE_OPTIONS.length,
    );
  });

  it("keeps the specific wording used by the profile form copy", () => {
    expect(IDENTIFY_KNOWN_PATHOGEN_OPTION).toBe(
      "Identify a known pathogen in my sample(s)",
    );
    expect(OUTBREAK_DETECTION_OPTION).toBe(
      "Detect and monitor potential outbreaks",
    );
    expect(DISCOVER_NOVEL_VIRUSES_OPTION).toBe("Discover novel viruses");
    expect(CLINICAL_RESEARCH_OPTION).toBe("Perform clinical research");
    expect(MICROBIOME_ANALYSIS_OPTION).toBe("Conduct Microbiome analysis");
    expect(AMR_DETECTION_OPTION).toBe("Detect AMR-related sequences");
    expect(PHYLOGENETIC_TREE_OPTION).toBe("Build phylogenetic trees");
    expect(TRAIN_OTHERS_OPTION).toBe(
      "Train others to analyze and/or interpret data",
    );
    expect(SURVEILLANCE_OF_VECTORS_OPTION).toContain("Surveillance of vectors");
    expect(VIRAL_CONSENSUS_GENOME_NON_SC2_OPTION).toContain(
      "other than SARS-CoV-2",
    );
    expect(SC2_CONSENSUS_GENOME_OPTION).toContain("SARS-CoV-2");
  });

  it("does not include the free-text prefix as a fixed option", () => {
    expect(CZID_USECASE_OPTIONS).not.toContain(CHECKBOX_WITH_INPUT_PREFIX);
  });
});
