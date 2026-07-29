import {
  Diagnostics,
  QuickReport,
} from "~/components/common/SupportPortal/collectDiagnostics";
import { postWithCSRF } from "./core";

// The optional handle to a failed run this report is about. The server resolves it
// through the user's viewable-samples power and attaches (support-only) L1 failure
// detail. Sent snake_case as run_context.
export interface RunContext {
  sampleId: number;
  runId?: number;
  workflow?: string;
}

export interface SupportRequestPayload {
  description: string;
  // The minimal, user-facing report (error / task / project / account). This is
  // exactly what the end user sees in the quick-report popup (#440).
  quickReport: QuickReport;
  // The fuller diagnostics set, sent for the support-side payload only. Never
  // surfaced to the end user except behind the "More details" expand.
  diagnostics: Diagnostics;
  // Present only when the report is about a failed sample/run.
  runContext?: RunContext;
}

// Submits an in-app support/issue report to the Rails support_requests endpoint (#440).
export const createSupportRequest = ({
  description,
  quickReport,
  diagnostics,
  runContext,
}: SupportRequestPayload) =>
  postWithCSRF("/support_requests", {
    description,
    quick_report: quickReport,
    diagnostics,
    ...(runContext
      ? {
          run_context: {
            sample_id: runContext.sampleId,
            run_id: runContext.runId,
            workflow: runContext.workflow,
          },
        }
      : {}),
  });
