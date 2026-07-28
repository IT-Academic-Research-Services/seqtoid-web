// Coverage: app/assets/src/components/views/SampleView/components/AmrView/components/AmrSampleReport/columnDefinitions/constants.ts
//
// A table of tooltip copy for the AMR sample report columns. These strings are
// user-facing and the help-centre anchors are grouped per column family, so the
// tests pin both the copy and the gene/reads/contigs anchor each entry points at.
import * as constants from "~/components/views/SampleView/components/AmrView/components/AmrSampleReport/columnDefinitions/constants";

const GENES_ANCHOR =
  "https://helpcenter.seqtoid.org/articles/amr-sample-report-metrics-and-analysis/#amr-gene-information";
const READS_ANCHOR =
  "https://helpcenter.seqtoid.org/articles/amr-sample-report-metrics-and-analysis/#read-metrics";
const CONTIGS_ANCHOR =
  "https://helpcenter.seqtoid.org/articles/amr-sample-report-metrics-and-analysis/#contig-metrics";

const GENE_GROUP = [
  "GENE_COLUMN_TOOLTIP_STRINGS",
  "GENE_FAMILY_COLUMN_TOOLTIP_STRINGS",
  "DRUG_CLASS_COLUMN_TOOLTIP_STRINGS",
  "HIGH_LEVEL_DRUG_CLASS_COLUMN_TOOLTIP_STRINGS",
  "MECHANISMS_COLUMN_TOOLTIP_STRINGS",
  "MODEL_COLUMN_TOOLTIP_STRINGS",
];

const CONTIGS_GROUP = [
  "CUTOFF_COLUMN_TOOLTIP_STRINGS",
  "CONTIGS_COLUMN_TOOLTIP_STRINGS",
  "CONTIGS_PERCENT_COVERAGE_COLUMN_TOOLTIP_STRINGS",
  "CONTIGS_PERCENT_IDENTITY_COLUMN_TOOLTIP_STRINGS",
  "CONTIGS_SPECIES_COLUMN_TOOLTIP_STRINGS",
];

const READS_GROUP = [
  "READS_COLUMN_TOOLTIP_STRINGS",
  "READS_PERCENT_COVERAGE_COLUMN_TOOLTIP_STRINGS",
  "READS_COVERAGE_DEPTH_TOOLTIP_STRINGS",
  "READS_SPECIES_COLUMN_TOOLTIP_STRINGS",
  "READS_DPM_COLUMN_TOOLTIP_STRINGS",
  "READS_RPM_COLUMN_TOOLTIP_STRINGS",
];

const ALL_TOOLTIPS = [...GENE_GROUP, ...CONTIGS_GROUP, ...READS_GROUP];

describe("AMR column definition constants", () => {
  it("exports the contigs column group id", () => {
    expect(constants.CONTIGS_COLUMN_GROUP).toBe("contigs-column-group");
  });

  it.each(ALL_TOOLTIPS)(
    "%s has non-empty copy and a 'Learn More.' link",
    name => {
      const tooltip = (constants as Record<string, $TSFixMe>)[name];
      expect(tooltip).toBeDefined();
      expect(typeof tooltip.regularText).toBe("string");
      expect(tooltip.regularText.length).toBeGreaterThan(0);
      expect(typeof tooltip.boldText).toBe("string");
      expect(tooltip.boldText.length).toBeGreaterThan(0);
      expect(tooltip.link.linkText).toBe("Learn More.");
      expect(tooltip.link.href).toMatch(
        /^https:\/\/helpcenter\.seqtoid\.org\/articles\/amr-sample-report-metrics-and-analysis\/#/,
      );
    },
  );

  it.each(GENE_GROUP)("%s links to the gene-information anchor", name => {
    expect((constants as Record<string, $TSFixMe>)[name].link.href).toBe(
      GENES_ANCHOR,
    );
  });

  it.each(CONTIGS_GROUP)("%s links to the contig-metrics anchor", name => {
    expect((constants as Record<string, $TSFixMe>)[name].link.href).toBe(
      CONTIGS_ANCHOR,
    );
  });

  it.each(READS_GROUP)("%s links to the read-metrics anchor", name => {
    expect((constants as Record<string, $TSFixMe>)[name].link.href).toBe(
      READS_ANCHOR,
    );
  });

  it("uses the expected bold labels, one per column", () => {
    const boldLabels = ALL_TOOLTIPS.map(
      name => (constants as Record<string, $TSFixMe>)[name].boldText,
    );
    expect(boldLabels).toEqual([
      "Gene",
      "Gene Family",
      "Drug Class",
      "High-level Drug Class",
      "Mechanism",
      "Model",
      "Cutoff",
      "Contigs",
      "Contigs % Coverage",
      "Contigs % Identity",
      "Contigs Species",
      "Reads",
      "Reads % Coverage",
      "Reads Coverage Depth",
      "Reads Species",
      "Reads dPM",
      "Reads rPM",
    ]);
    // No duplicate labels -- each column gets its own tooltip.
    expect(new Set(boldLabels).size).toBe(boldLabels.length);
  });

  it("spells out the cutoff paradigm and the high-level drug class caveat", () => {
    expect(constants.CUTOFF_COLUMN_TOOLTIP_STRINGS.regularText).toContain(
      '"Nudged" specifies Loose matches that have at least 95% identity',
    );
    expect(
      constants.HIGH_LEVEL_DRUG_CLASS_COLUMN_TOOLTIP_STRINGS.regularText,
    ).toContain("Not available for pipeline versions before v1.2.14.");
  });
});
