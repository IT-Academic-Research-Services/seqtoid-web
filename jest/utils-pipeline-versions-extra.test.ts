// Additional coverage: app/assets/src/components/utils/pipeline_versions.ts
// Complements jest/pipeline_versions.test.ts by driving the alpha/beta ordinal
// conversions, missing version fields, and each MINIMUM_VERSIONS feature gate.
import {
  ACCESSION_COVERAGE_STATS_FEATURE,
  AMR_MODERN_HOST_FILTERING_FEATURE,
  AMR_PIPELINE,
  CONSENSUS_GENOME_FEATURE,
  COVERAGE_VIZ_FEATURE,
  isPipelineFeatureAvailable,
  isPipelineVersionAtLeast,
  LONG_READ_MNGS_COV_VIS_WITH_ONE_READ,
  MASS_NORMALIZED_FEATURE,
  MINIMUM_VERSIONS,
  SHORT_READ_MNGS_MODERN_HOST_FILTERING_FEATURE,
} from "~/components/utils/pipeline_versions";

describe("isPipelineVersionAtLeast (extra branches)", () => {
  it("orders alpha below beta below a numeric field", () => {
    // alpha => -2, beta => -1, so beta satisfies an alpha requirement...
    expect(isPipelineVersionAtLeast("1.0.beta", "1.0.alpha")).toBe(true);
    // ...but alpha does not satisfy a beta requirement.
    expect(isPipelineVersionAtLeast("1.0.alpha", "1.0.beta")).toBe(false);
    // and any real patch number outranks both.
    expect(isPipelineVersionAtLeast("1.0.0", "1.0.beta")).toBe(true);
    expect(isPipelineVersionAtLeast("1.0.alpha", "1.0.0")).toBe(false);
  });

  it("treats alpha/beta in the minor position the same way", () => {
    expect(isPipelineVersionAtLeast("1.beta.0", "1.alpha.0")).toBe(true);
    expect(isPipelineVersionAtLeast("1.alpha.0", "1.beta.0")).toBe(false);
  });

  it("treats missing version fields as 0", () => {
    expect(isPipelineVersionAtLeast("5", "5.0.0")).toBe(true);
    expect(isPipelineVersionAtLeast("5", "5.0.1")).toBe(false);
    expect(isPipelineVersionAtLeast("5.1", "5")).toBe(true);
  });

  it("treats non-numeric junk fields as 0", () => {
    expect(isPipelineVersionAtLeast("x.y.z", "0.0.0")).toBe(true);
    expect(isPipelineVersionAtLeast("x.y.z", "0.0.1")).toBe(false);
  });

  it("returns false for a null pipeline version", () => {
    // @ts-expect-error deliberately passing null to hit the guard
    expect(isPipelineVersionAtLeast(null, "1.0.0")).toBe(false);
  });

  it("fails when the minor version is lower even though the patch is higher", () => {
    expect(isPipelineVersionAtLeast("1.1.9", "1.2.0")).toBe(false);
  });
});

describe("isPipelineFeatureAvailable across MINIMUM_VERSIONS", () => {
  const cases: Array<[keyof typeof MINIMUM_VERSIONS, string, string]> = [
    [MASS_NORMALIZED_FEATURE, "4.0", "3.9"],
    [COVERAGE_VIZ_FEATURE, "3.6", "3.5"],
    [CONSENSUS_GENOME_FEATURE, "3.7", "3.6"],
    [ACCESSION_COVERAGE_STATS_FEATURE, "6.0", "5.9"],
    [SHORT_READ_MNGS_MODERN_HOST_FILTERING_FEATURE, "8.0.0", "7.9.9"],
    [AMR_MODERN_HOST_FILTERING_FEATURE, "0.3.1", "0.3.0"],
    [AMR_PIPELINE, "5", "4"],
    [LONG_READ_MNGS_COV_VIS_WITH_ONE_READ, "0.7.5", "0.7.4"],
  ];

  it.each(cases)(
    "%s is available at its minimum version and unavailable below it",
    (feature, atMinimum, belowMinimum) => {
      expect(isPipelineFeatureAvailable(feature, atMinimum)).toBe(true);
      expect(isPipelineFeatureAvailable(feature, belowMinimum)).toBe(false);
    },
  );

  it("reports a feature as unavailable when the pipeline version is missing", () => {
    expect(isPipelineFeatureAvailable(MASS_NORMALIZED_FEATURE, "")).toBe(false);
  });

  it("keys MINIMUM_VERSIONS by every exported feature constant", () => {
    cases.forEach(([feature, atMinimum]) => {
      expect(MINIMUM_VERSIONS[feature]).toBe(atMinimum);
    });
  });
});
