import React from "react";
import * as Sentry from "@sentry/react";
import { recordClientError } from "~/components/common/SupportPortal/collectDiagnostics";
import ErrorFallback from "./ErrorBoundary/ErrorFallback";

interface ErrorBoundaryProps {
  children?: React.ReactNode;
  // Optional custom fallback. Receives the caught error and a `resetError`
  // callback that re-mounts the wrapped subtree so a retry can recover. When
  // omitted, the shared friendly `ErrorFallback` (#466) is rendered.
  fallback?: (args: {
    error: unknown;
    resetError: () => void;
  }) => React.ReactNode;
  // Short label for the view being wrapped ("report", "heatmap", "downloads").
  // Threaded into the fallback message and the "Report a problem" support note.
  view?: string;
  // Renders the default fallback in its compact inline form.
  inline?: boolean;
  // When any value in this array changes, the boundary auto-resets. Useful so a
  // boundary that failed for sample A clears itself when the user navigates to
  // sample B, rather than staying stuck on the error state.
  resetKeys?: ReadonlyArray<unknown>;
  // Optional gate for Sentry reporting. Return false to suppress the Sentry
  // capture + client-error record for a caught error that is expected rather
  // than a product defect (e.g. a missing/forbidden resource). Defaults to
  // reporting everything, so existing call sites are unchanged. The friendly
  // fallback still renders regardless; only observability reporting is gated.
  shouldReportError?: (error: unknown) => boolean;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: unknown;
}

// A real React error boundary (#466). It catches render-time errors from its
// subtree and shows a friendly, actionable fallback (retry + contact-support)
// instead of a blank or broken view -- while STILL reporting the error to
// Sentry so we don't lose observability (#382).
//
// This replaces the previous no-op boundary, which logged to the console but
// returned `children` from render (so a genuine render error still crashed the
// tree). Existing call sites (`import ErrorBoundary from
// "~/components/common/ErrorBoundary"`) keep working unchanged and now get the
// friendly fallback for free.
class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Preserve observability by default, but let the caller opt a specific,
    // expected error out of reporting (SMP-1633) -- only an explicit `false`
    // suppresses it, so an unset prop keeps the report-everything behavior.
    if (this.props.shouldReportError?.(error) !== false) {
      // Report to Sentry with the React component stack.
      Sentry.captureException(error, {
        extra: { componentStack: info?.componentStack, view: this.props.view },
      });
      // Remember it for the self-help portal's quick report (#440).
      recordClientError(error?.message ? String(error.message) : String(error));
    }
    // eslint-disable-next-line no-console
    console.error("ErrorBoundary", error, info);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    // Auto-recover when the caller's resetKeys change (e.g. route/id change).
    if (!this.state.hasError) return;
    const prev = prevProps.resetKeys;
    const next = this.props.resetKeys;
    if (!prev || !next) return;
    const changed =
      prev.length !== next.length || next.some((k, i) => k !== prev[i]);
    if (changed) this.resetError();
  }

  resetError = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    if (this.props.fallback) {
      return this.props.fallback({
        error: this.state.error,
        resetError: this.resetError,
      });
    }

    return (
      <ErrorFallback
        error={this.state.error}
        onRetry={this.resetError}
        view={this.props.view}
        inline={this.props.inline}
      />
    );
  }
}

export default ErrorBoundary;
