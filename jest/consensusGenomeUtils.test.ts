// Frontend coverage: ConsensusGenomeView/utils.ts getConsensusGenomeHelpLink
// picks the SARS-CoV-2 doc link for the SARS-CoV-2 accession and the generic
// viral doc link otherwise. Pure branch -- cover both arms.
import {
  SARS_COV_2_CONSENSUS_GENOME_DOC_LINK,
  VIRAL_CONSENSUS_GENOME_DOC_LINK,
} from "~/components/utils/documentationLinks";
import { getConsensusGenomeHelpLink } from "~/components/views/SampleView/components/ConsensusGenomeView/utils";
import { SARS_COV_2_ACCESSION_ID } from "~/components/views/SampleView/utils";

describe("getConsensusGenomeHelpLink", () => {
  it("returns the SARS-CoV-2 doc link for the SARS-CoV-2 accession id", () => {
    expect(getConsensusGenomeHelpLink(SARS_COV_2_ACCESSION_ID)).toBe(
      SARS_COV_2_CONSENSUS_GENOME_DOC_LINK,
    );
  });

  it("returns the generic viral doc link for any other accession id", () => {
    expect(getConsensusGenomeHelpLink("NC_045512.2")).toBe(
      VIRAL_CONSENSUS_GENOME_DOC_LINK,
    );
    expect(getConsensusGenomeHelpLink("")).toBe(
      VIRAL_CONSENSUS_GENOME_DOC_LINK,
    );
  });
});
