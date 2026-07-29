// Frontend coverage: edge arms of CoverageVizBottomSidebar/utils.ts that the
// main coverageVizUtils suite does not reach -- the tooltip builder's
// fall-through when a hit group holds neither contigs nor reads, and species
// aggregation when a taxon is missing from the coverage-viz payload.
import {
  getCombinedAccessionDataForSpecies,
  getGenomeVizTooltipData,
} from "~/components/common/CoverageVizBottomSidebar/utils";

describe("getGenomeVizTooltipData fall-through", () => {
  it("leaves the section unnamed and countless for an empty hit group", () => {
    // [numContigs, numReads, ...] both zero: none of the naming arms match.
    const emptyHitGroup = [0, 0, 0, 10, 20, 10, 0.5, 0, 0, 0];
    const [section] = getGenomeVizTooltipData([emptyHitGroup] as $TSFixMe, 0);

    expect(section.name).toBeNull();
    const keys = section.data.map(row => row[0]);
    expect(keys).not.toContain("# NT Contigs");
    expect(keys).not.toContain("# Loose NT Reads");
    // The alignment rows are still emitted, without the "Avg. " prefix since
    // numContigs + numReads is not greater than 1.
    expect(keys).toEqual([
      "Reference Alignment Range",
      "Alignment Length",
      "Percentage Matched",
      "# Mismatches",
      "# Gaps",
    ]);
  });
});

describe("getCombinedAccessionDataForSpecies with partial data", () => {
  it("skips species that have no entry in the coverage-viz payload", () => {
    const byTaxon = {
      10: { best_accessions: [{ id: "x" }], num_accessions: 2 },
    };
    const species = [
      { taxId: 10, name: "Species Ten", commonName: "ten" },
      // No entry for taxon 20 at all.
      { taxId: 20, name: "Species Twenty", commonName: "twenty" },
    ];

    const combined = getCombinedAccessionDataForSpecies(species, byTaxon);
    expect(combined.best_accessions).toEqual([
      { id: "x", taxon_name: "Species Ten", taxon_common_name: "ten" },
    ]);
    // The missing taxon contributes nothing rather than poisoning the sum.
    expect(combined.num_accessions).toBe(2);
  });
});
