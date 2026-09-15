// Frontend coverage: ConsensusGenomeView/utils.ts getConsensusGenomeHelpLink
// picks the SARS-CoV-2 doc link for the SARS-CoV-2 accession and the generic
// viral doc link otherwise. Pure branch -- cover both arms.
//
// Also covers the SMP-1908 "Complete - Issue" reason helpers:
// isConsensusGenomeCompleteWithIssue (both status vocabularies) and
// getConsensusGenomeIssueMessage (the error_message -> input_error.message ->
// label -> generic fallback chain).
import {
  SARS_COV_2_CONSENSUS_GENOME_DOC_LINK,
  VIRAL_CONSENSUS_GENOME_DOC_LINK,
} from "~/components/utils/documentationLinks";
import {
  getConsensusGenomeHelpLink,
  getConsensusGenomeIssueMessage,
  isConsensusGenomeCompleteWithIssue,
} from "~/components/views/SampleView/components/ConsensusGenomeView/utils";
import { SARS_COV_2_ACCESSION_ID } from "~/components/views/SampleView/utils";
import { WorkflowRun } from "~/interface/sample";

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

// Build a workflow-run-like object for the reason helpers; only the fields the
// helpers read matter, so the rest is intentionally omitted.
const run = (fields: Partial<WorkflowRun>): WorkflowRun =>
  fields as WorkflowRun;

describe("isConsensusGenomeCompleteWithIssue", () => {
  it("recognises both status vocabularies (raw and SFN-mapped)", () => {
    expect(isConsensusGenomeCompleteWithIssue("SUCCEEDED_WITH_ISSUE")).toBe(
      true,
    );
    expect(isConsensusGenomeCompleteWithIssue("COMPLETE - ISSUE")).toBe(true);
  });

  it("is false for a plain success, a failure, and in-progress states", () => {
    expect(isConsensusGenomeCompleteWithIssue("SUCCEEDED")).toBe(false);
    expect(isConsensusGenomeCompleteWithIssue("COMPLETE")).toBe(false);
    expect(isConsensusGenomeCompleteWithIssue("FAILED")).toBe(false);
    expect(isConsensusGenomeCompleteWithIssue("RUNNING")).toBe(false);
  });

  it("is false for a null or undefined status", () => {
    expect(isConsensusGenomeCompleteWithIssue(null)).toBe(false);
    expect(isConsensusGenomeCompleteWithIssue(undefined)).toBe(false);
  });
});

describe("getConsensusGenomeIssueMessage", () => {
  it("returns null when the run is not complete-with-issue", () => {
    expect(getConsensusGenomeIssueMessage(null)).toBeNull();
    expect(
      getConsensusGenomeIssueMessage(
        run({ status: "SUCCEEDED", error_message: "ignored" }),
      ),
    ).toBeNull();
  });

  it("prefers the stored error_message column (sample 2915's case)", () => {
    const reason =
      "There was insufficient coverage so a consensus genome could not be created.";
    expect(
      getConsensusGenomeIssueMessage(
        run({
          status: "SUCCEEDED_WITH_ISSUE",
          error_message: reason,
          input_error: { label: "InsufficientReadsError", message: "other" },
        }),
      ),
    ).toBe(reason);
  });

  it("recognises the SFN-mapped status too", () => {
    expect(
      getConsensusGenomeIssueMessage(
        run({ status: "COMPLETE - ISSUE", error_message: "the reason" }),
      ),
    ).toBe("the reason");
  });

  it("falls back to the live input_error.message when the column is blank", () => {
    expect(
      getConsensusGenomeIssueMessage(
        run({
          status: "SUCCEEDED_WITH_ISSUE",
          error_message: "   ",
          input_error: { label: "InsufficientReadsError", message: "live msg" },
        }),
      ),
    ).toBe("live msg");
  });

  it("falls back to label-derived text when both messages are blank", () => {
    expect(
      getConsensusGenomeIssueMessage(
        run({
          status: "SUCCEEDED_WITH_ISSUE",
          error_message: null,
          input_error: { label: "InsufficientReadsError", message: "" },
        }),
      ),
    ).toBe(
      "There were not enough reads after filtering to produce a consensus genome.",
    );
  });

  it("falls back to a generic sentence when nothing is available", () => {
    expect(
      getConsensusGenomeIssueMessage(run({ status: "SUCCEEDED_WITH_ISSUE" })),
    ).toBe(
      "This consensus genome run completed with an issue, so no consensus genome was produced.",
    );
  });
});
