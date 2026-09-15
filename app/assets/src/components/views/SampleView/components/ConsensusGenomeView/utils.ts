import { SARS_COV_2_ACCESSION_ID } from "~/components/views/SampleView/utils";
import { SampleStatus, WorkflowRun } from "~/interface/sample";
import {
  SARS_COV_2_CONSENSUS_GENOME_DOC_LINK,
  VIRAL_CONSENSUS_GENOME_DOC_LINK,
} from "~utils/documentationLinks";

export const getConsensusGenomeHelpLink = (accession_id: string) => {
  return accession_id === SARS_COV_2_ACCESSION_ID
    ? SARS_COV_2_CONSENSUS_GENOME_DOC_LINK
    : VIRAL_CONSENSUS_GENOME_DOC_LINK;
};

// SMP-1908. A consensus-genome run can finish "complete with an issue" -- it did not fail,
// but produced no genome (e.g. insufficient coverage). The status arrives in either of two
// Rails vocabularies (a Relay dataID collision, see WORKFLOW_RUN_STATUS_CATEGORY): the raw
// WorkflowRun::STATUS column ("SUCCEEDED_WITH_ISSUE") or the SFN-mapped form
// ("COMPLETE - ISSUE"). Both must be recognised.
const RAW_SUCCEEDED_WITH_ISSUE = "SUCCEEDED_WITH_ISSUE";
const COMPLETE_WITH_ISSUE_STATUSES: ReadonlySet<string> = new Set([
  RAW_SUCCEEDED_WITH_ISSUE,
  SampleStatus.COMPLETE_ISSUE, // "COMPLETE - ISSUE"
]);

export const CONSENSUS_GENOME_COMPLETE_ISSUE_LABEL = "Complete - Issue";

// Last-resort banner copy when a complete-with-issue run carries no reason at all
// (neither the stored error_message column nor a live input_error message/label).
const CONSENSUS_GENOME_ISSUE_FALLBACK =
  "This consensus genome run completed with an issue, so no consensus genome was produced.";

// Human sentences for the known input-error labels, used only when neither the stored
// error_message column nor the live input_error.message is present (the nil-message edge
// case), so the banner still says something specific.
const INPUT_ERROR_LABEL_MESSAGES: Record<string, string> = {
  InsufficientReadsError:
    "There were not enough reads after filtering to produce a consensus genome.",
  InvalidInputFileError: "There was an error parsing one of the input files.",
  InvalidFileFormatError:
    "The input file provided has a formatting error in it.",
  BrokenReadPairError:
    "There were too many discordant read pairs in the paired-end sample.",
};

export const isConsensusGenomeCompleteWithIssue = (
  status?: string | null,
): boolean => status != null && COMPLETE_WITH_ISSUE_STATUSES.has(status);

// The reason to surface for a complete-with-issue consensus-genome run, or null when the
// run is not in that state. Prefers the persisted error_message column (durable) over the
// live input_error (re-derived from the SFN archive, nil once garbage collected), then the
// label-derived sentence, then a generic fallback -- so a complete-with-issue run always
// gets a banner with some explanation. (SMP-1908)
export const getConsensusGenomeIssueMessage = (
  workflowRun?: WorkflowRun | null,
): string | null => {
  if (!workflowRun || !isConsensusGenomeCompleteWithIssue(workflowRun.status)) {
    return null;
  }
  const storedMessage = workflowRun.error_message?.trim();
  if (storedMessage) {
    return storedMessage;
  }
  const liveMessage = workflowRun.input_error?.message?.trim();
  if (liveMessage) {
    return liveMessage;
  }
  const label = workflowRun.input_error?.label?.trim();
  return (
    (label && INPUT_ERROR_LABEL_MESSAGES[label]) ||
    CONSENSUS_GENOME_ISSUE_FALLBACK
  );
};
