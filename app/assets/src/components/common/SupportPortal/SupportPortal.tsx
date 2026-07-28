import { Button, Icon } from "@czi-sds/components";
import React, { useContext, useEffect, useMemo, useState } from "react";
import { createSupportRequest } from "~/api/support";
import { UserContext } from "~/components/common/UserContext";
import { logError } from "~/components/utils/logUtil";
import Modal from "~ui/containers/Modal";
import Textarea from "~ui/controls/Textarea";
import {
  collectDiagnostics,
  collectQuickReport,
  Diagnostics,
  getRunFailure,
  QuickReport,
  recordClientError,
} from "./collectDiagnostics";
import { onOpenSupportPortal } from "./openSupportPortal";
import cs from "./support_portal.scss";

// Human-friendly labels for the minimal, user-facing quick report.
const QUICK_REPORT_LABELS: { [K in keyof QuickReport]: string } = {
  errorName: "Error",
  task: "What you were doing",
  project: "Project",
  accountName: "Account",
};

// Human-friendly labels for the fuller diagnostics shown only behind "More
// details". These are primarily for the support-side payload, not the user.
const DIAGNOSTIC_LABELS: { [K in keyof Diagnostics]: string } = {
  release: "App release",
  environment: "Environment",
  userId: "User ID",
  userEmail: "User email",
  userRole: "Role",
  url: "URL",
  route: "Route",
  userAgent: "Browser",
  language: "Language",
  viewport: "Viewport",
  screen: "Screen",
  timestamp: "Timestamp",
  timezone: "Timezone",
  recentError: "Recent error",
};

type SubmitStatus = "idle" | "submitting" | "success" | "error";

// Install a single global listener that remembers the most recent client-side
// error so it can be attached to a support request. Guarded so it only runs once.
let errorListenerInstalled = false;
const installErrorListener = () => {
  if (errorListenerInstalled || typeof window === "undefined") return;
  errorListenerInstalled = true;

  window.addEventListener("error", (event: ErrorEvent) => {
    recordClientError(
      `${event.message} @ ${event.filename}:${event.lineno}:${event.colno}`,
    );
  });
  window.addEventListener(
    "unhandledrejection",
    (event: PromiseRejectionEvent) => {
      const reason =
        event.reason instanceof Error
          ? event.reason.message
          : String(event.reason);
      recordClientError(`Unhandled promise rejection: ${reason}`);
    },
  );
};

// Floating in-app self-help portal (#440), redesigned as two layers:
//   (A) A MINIMAL end-user quick-report popup that shows only the error, the
//       task/page, the project, and the account name -- nothing technical.
//   (B) A "More details" expand that reveals the fuller diagnostics (also sent,
//       richer, to the support side and never required of the user).
// Submitting packages the minimal quick report + the full diagnostics; the Rails
// controller enriches that into a rich support-side payload (correlation id,
// runbook match, log deep-links) that the user never sees.
const SupportPortal = () => {
  const userContext = useContext(UserContext);
  const [open, setOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<SubmitStatus>("idle");

  useEffect(() => {
    installErrorListener();
  }, []);

  // Allow any part of the app -- notably the error-boundary fallback (#466) --
  // to open this portal via `openSupportPortal()`. We pre-fill the optional
  // description with the note the caller passed so the user has context.
  useEffect(() => {
    return onOpenSupportPortal(({ note }) => {
      setStatus("idle");
      setShowDetails(false);
      setDescription(note ? `${note}. ` : "");
      setOpen(true);
    });
  }, []);

  // Recompute both the minimal quick report and the full diagnostics each time
  // the panel opens so route/project/errors reflect the state at report time.
  const quickReport = useMemo(
    () => (open ? collectQuickReport(userContext) : null),
    [open, userContext],
  );
  const diagnostics = useMemo(
    () => (open ? collectDiagnostics(userContext) : null),
    [open, userContext],
  );

  const handleOpen = () => {
    setStatus("idle");
    setShowDetails(false);
    setDescription("");
    setOpen(true);
  };

  const handleClose = () => setOpen(false);

  const handleSubmit = async () => {
    if (!quickReport || !diagnostics) return;
    setStatus("submitting");
    try {
      // When the report is about a failed run, pass the run handle so the server can
      // attach (support-only) L1 pipeline-failure detail, access-controlled.
      const failure = getRunFailure();
      const runContext = failure
        ? {
            sampleId: failure.sampleId,
            runId: failure.runId,
            workflow: failure.workflow,
          }
        : undefined;
      await createSupportRequest({
        description,
        quickReport,
        diagnostics,
        runContext,
      });
      setStatus("success");
    } catch (error) {
      logError({
        message: "Failed to submit support request",
        details: { error },
      });
      setStatus("error");
    }
  };

  // Only show for authenticated users; the portal is part of the app shell but
  // diagnostics/reporting only make sense in an authenticated session. The
  // portal can render in paths outside the UserContext provider tree, where
  // `userContext` is undefined -- guard defensively so no read can throw
  // (the #505 report/portal null-guard class).
  if (!userContext?.userSignedIn) return null;

  return (
    <>
      <button
        className={cs.floatingButton}
        onClick={handleOpen}
        aria-label="Help and diagnostics"
        data-testid="support-portal-button"
      >
        <Icon
          className={cs.buttonIcon}
          sdsIcon="questionMark"
          sdsSize="l"
          sdsType="static"
        />
      </button>
      {open && (
        <Modal narrow open onClose={handleClose} xlCloseIcon>
          <div className={cs.panel} data-testid="support-portal-panel">
            <div className={cs.header}>Report an issue</div>
            <div className={cs.subheader}>
              Here&apos;s what we noticed. Add anything else below and send it to
              our team &mdash; we&apos;ll take it from here.
            </div>

            {/* (A) MINIMAL user-facing summary: error / task / project / account. */}
            <div
              className={cs.quickReport}
              data-testid="support-portal-quick-report"
            >
              {quickReport &&
                (Object.keys(quickReport) as (keyof QuickReport)[]).map(key => (
                  <div className={cs.quickRow} key={key}>
                    <span className={cs.quickKey}>
                      {QUICK_REPORT_LABELS[key]}
                    </span>
                    <span className={cs.quickValue} title={quickReport[key]}>
                      {quickReport[key]}
                    </span>
                  </div>
                ))}
            </div>

            <div className={cs.sectionLabel}>
              Anything else? (optional)
            </div>
            <Textarea
              className={cs.textarea}
              value={description}
              onChange={setDescription}
              placeholder="What went wrong? What were you trying to do?"
              data-testid="support-portal-description"
            />

            {/* "More details" expands the full portal / fuller diagnostics. */}
            <button
              className={cs.detailsToggle}
              onClick={() => setShowDetails(v => !v)}
              data-testid="support-portal-details-toggle"
              aria-expanded={showDetails}
            >
              {showDetails ? "Hide details" : "More details"}
            </button>

            {showDetails && (
              <div
                className={cs.diagnostics}
                data-testid="support-portal-diagnostics"
              >
                {diagnostics &&
                  (Object.keys(diagnostics) as (keyof Diagnostics)[]).map(
                    key => (
                      <div className={cs.diagnosticRow} key={key}>
                        <span className={cs.key}>{DIAGNOSTIC_LABELS[key]}</span>
                        <span className={cs.value} title={diagnostics[key]}>
                          {diagnostics[key]}
                        </span>
                      </div>
                    ),
                  )}
              </div>
            )}

            {status === "success" && (
              <div className={`${cs.statusMessage} ${cs.success}`}>
                Thanks! Your report was sent. Our team will take a look.
              </div>
            )}
            {status === "error" && (
              <div className={`${cs.statusMessage} ${cs.error}`}>
                Sorry, we couldn&apos;t send your report. Please try again.
              </div>
            )}

            <div className={cs.actions}>
              {status === "success" ? (
                <Button
                  sdsStyle="rounded"
                  sdsType="primary"
                  onClick={handleClose}
                >
                  Done
                </Button>
              ) : (
                <>
                  <Button
                    sdsStyle="rounded"
                    sdsType="secondary"
                    onClick={handleClose}
                    disabled={status === "submitting"}
                  >
                    Cancel
                  </Button>
                  <Button
                    sdsStyle="rounded"
                    sdsType="primary"
                    onClick={handleSubmit}
                    disabled={status === "submitting"}
                    data-testid="support-portal-submit"
                  >
                    {status === "submitting" ? "Sending…" : "Report an issue"}
                  </Button>
                </>
              )}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
};

export default SupportPortal;
