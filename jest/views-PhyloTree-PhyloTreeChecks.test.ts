// Coverage for app/assets/src/components/views/PhyloTree/PhyloTreeChecks.ts
// Every static helper is exercised on both sides of its conditional.
import PhyloTreeChecks from "~/components/views/PhyloTree/PhyloTreeChecks";

describe("PhyloTreeChecks", () => {
  it("exposes the documented thresholds", () => {
    expect(PhyloTreeChecks.MIN_READS).toBe(1);
    expect(PhyloTreeChecks.RECOMMENDED_MIN_READS).toBe(5);
    expect(PhyloTreeChecks.MIN_SAMPLES).toBe(4);
    expect(PhyloTreeChecks.MAX_SAMPLES).toBe(100);
  });

  describe("passesCreateCondition", () => {
    it("passes when EITHER NT or NR meets the minimum", () => {
      expect(PhyloTreeChecks.passesCreateCondition(1, 0)).toBe(true);
      expect(PhyloTreeChecks.passesCreateCondition(0, 1)).toBe(true);
      expect(PhyloTreeChecks.passesCreateCondition(50, 50)).toBe(true);
    });

    it("fails when both counts are below the minimum", () => {
      expect(PhyloTreeChecks.passesCreateCondition(0, 0)).toBe(false);
      expect(PhyloTreeChecks.passesCreateCondition(0.5, 0.9)).toBe(false);
    });
  });

  describe("isNumberOfSamplesValid", () => {
    it("accepts counts inside the inclusive range", () => {
      expect(PhyloTreeChecks.isNumberOfSamplesValid(4)).toBe(true);
      expect(PhyloTreeChecks.isNumberOfSamplesValid(50)).toBe(true);
      expect(PhyloTreeChecks.isNumberOfSamplesValid(100)).toBe(true);
    });

    it("rejects counts below the minimum", () => {
      expect(PhyloTreeChecks.isNumberOfSamplesValid(3)).toBe(false);
      expect(PhyloTreeChecks.isNumberOfSamplesValid(0)).toBe(false);
    });

    it("rejects counts above the maximum", () => {
      expect(PhyloTreeChecks.isNumberOfSamplesValid(101)).toBe(false);
    });
  });

  describe("hasSamplesWithFewReads", () => {
    it("is true when at least one sample is below the recommended minimum", () => {
      expect(PhyloTreeChecks.hasSamplesWithFewReads([10, 4, 20])).toBe(true);
    });

    it("is false when every sample meets the recommended minimum", () => {
      expect(PhyloTreeChecks.hasSamplesWithFewReads([5, 6, 100])).toBe(false);
    });

    it("is false for an empty array", () => {
      expect(PhyloTreeChecks.hasSamplesWithFewReads([])).toBe(false);
    });
  });

  describe("countSamplesWithFewReads", () => {
    it("counts a sample when EITHER its NT or NR read count is low", () => {
      // pairs: [10,10] ok, [1,10] low NT, [10,2] low NR, [1,1] both low
      expect(
        PhyloTreeChecks.countSamplesWithFewReads(
          [10, 1, 10, 1],
          [10, 10, 2, 1],
        ),
      ).toBe(3);
    });

    it("returns 0 when every pair is above the recommendation", () => {
      expect(PhyloTreeChecks.countSamplesWithFewReads([9, 8], [7, 6])).toBe(0);
    });

    it("returns 0 for empty inputs", () => {
      expect(PhyloTreeChecks.countSamplesWithFewReads([], [])).toBe(0);
    });
  });
});
