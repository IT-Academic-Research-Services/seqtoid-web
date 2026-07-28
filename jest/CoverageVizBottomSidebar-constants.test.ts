// Frontend coverage: CoverageVizBottomSidebar/constants.ts holds the fill
// colors and the METRIC_COLUMNS table that drives the metric grid rendered in
// the sidebar body. The grid is keyed by `metric.key` against the object built
// by getAccessionMetrics, so the keys are a real contract -- assert them.
import {
  BLAST_NOT_AVAILABLE,
  CONTIG_FILL_COLOR,
  METRIC_COLUMNS,
  READ_FILL_COLOR,
  REF_ACC_COLOR,
} from "~/components/common/CoverageVizBottomSidebar/constants";

describe("CoverageVizBottomSidebar constants", () => {
  it("exposes distinct hex fill colors for reads, contigs and the reference", () => {
    const colors = [READ_FILL_COLOR, CONTIG_FILL_COLOR, REF_ACC_COLOR];
    colors.forEach(color => expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/));
    expect(new Set(colors).size).toBe(3);
  });

  it("explains why BLAST is unavailable in terms of NT contigs", () => {
    expect(BLAST_NOT_AVAILABLE).toContain("at least one contig matching NT");
  });
});

describe("METRIC_COLUMNS", () => {
  const allMetrics = METRIC_COLUMNS.flat();

  it("is a non-empty array of non-empty columns", () => {
    expect(METRIC_COLUMNS.length).toBeGreaterThan(0);
    METRIC_COLUMNS.forEach(column => {
      expect(Array.isArray(column)).toBe(true);
      expect(column.length).toBeGreaterThan(0);
    });
  });

  it("gives every metric a key, a display name and a tooltip", () => {
    allMetrics.forEach(metric => {
      expect(typeof metric.key).toBe("string");
      expect(metric.key.length).toBeGreaterThan(0);
      expect(typeof metric.name).toBe("string");
      expect(metric.name.length).toBeGreaterThan(0);
      expect(typeof metric.tooltip).toBe("string");
      expect(metric.tooltip.length).toBeGreaterThan(0);
    });
  });

  it("uses unique keys so the metric lookup cannot collide", () => {
    const keys = allMetrics.map(metric => metric.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("includes the keys that getAccessionMetrics populates", () => {
    const keys = allMetrics.map(metric => metric.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "referenceNCBIEntry",
        "referenceLength",
        "alignedContigs",
        "alignedReads",
        "coverageDepth",
        "coverageBreadth",
        "maxAlignedLength",
        "avgMismatchedPercent",
      ]),
    );
  });
});
