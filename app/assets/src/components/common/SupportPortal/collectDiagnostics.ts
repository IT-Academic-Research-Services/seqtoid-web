import UserContextType from "~/interface/allowedFeatures";

export interface Diagnostics {
  release: string;
  environment: string;
  userId: string;
  userEmail: string;
  userRole: string;
  url: string;
  route: string;
  userAgent: string;
  language: string;
  viewport: string;
  screen: string;
  timestamp: string;
  timezone: string;
  recentError: string;
}

// The minimal, user-facing slice of a report. This is ALL the end user sees in
// the quick-report popup (#440): the error that just happened, the friendly name
// of the task/page they were on, the project they're working in (when known), and
// their account name. The fuller `Diagnostics` set is only shown behind the
// "More details" expand and is otherwise reserved for the support-side payload.
export interface QuickReport {
  errorName: string;
  task: string;
  project: string;
  accountName: string;
}

// The most recent client-side error observed on the page. We record it via a
// lightweight window "error" / "unhandledrejection" listener (installed once by
// SupportPortal) so a user reporting an issue can attach the error that just
// happened without needing to reproduce it. This intentionally avoids reaching
// into Sentry internals, which are not exposed as a queryable client-side store.
let lastClientError: string | null = null;

export const recordClientError = (error: string) => {
  lastClientError = error;
};

export const getLastClientError = (): string | null => lastClientError;

// The failed run the current view is about, recorded by views that know it (e.g.
// SampleView) so the support report can be about a PIPELINE failure, not just a
// front-end JS error. Mirrors recordClientError: a small module-level store the
// portal reads at report time. `userFacing` is the friendly one-liner shown to the
// user in the modal; `sampleId`/`runId`/`workflow` are the handle the server uses to
// pull the (support-only) L1 failure detail. Views clear it on unmount.
export interface RunFailureContext {
  sampleId: number;
  runId?: number;
  workflow?: string;
  status?: string;
  userFacing: string;
}

let currentRunFailure: RunFailureContext | null = null;

export const recordRunFailure = (ctx: RunFailureContext | null): void => {
  currentRunFailure = ctx;
};

export const clearRunFailure = (): void => {
  currentRunFailure = null;
};

export const getRunFailure = (): RunFailureContext | null => currentRunFailure;

// Distil a raw error string (which may include "@ file:line:col" location noise)
// down to a short, human-readable error name for the quick-report popup. Falls
// back to a friendly "No error detected" when nothing has been captured.
export const deriveErrorName = (raw: string | null): string => {
  if (!raw) return "No error detected";
  // Drop the "@ filename:line:col" location suffix our listener appends.
  const withoutLocation = raw.split(" @ ")[0].trim();
  // Keep it to a single, readable line.
  const firstLine = withoutLocation.split("\n")[0].trim();
  return firstLine.length > 160
    ? `${firstLine.slice(0, 157)}...`
    : firstLine || "Unknown error";
};

// Map a route/pathname to a friendly task label a non-technical user recognises,
// e.g. "/my_data" -> "My Data", a bulk-download page -> "Bulk download". Ordered
// by specificity: the first matching pattern wins.
const TASK_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /bulk_download|bulk-download/i, label: "Bulk download" },
  { pattern: /\/samples\/upload|\/upload/i, label: "Sample upload" },
  { pattern: /\/my_data/i, label: "My Data" },
  { pattern: /\/public/i, label: "Public data" },
  { pattern: /\/samples\/\d+/i, label: "Sample report" },
  { pattern: /\/samples/i, label: "Samples" },
  { pattern: /\/projects\/\d+/i, label: "Project" },
  { pattern: /\/projects/i, label: "Projects" },
  { pattern: /\/visualizations|\/heatmap|\/phylo_tree/i, label: "Visualization" },
  { pattern: /\/pipeline_viz/i, label: "Pipeline visualization" },
  { pattern: /\/user_settings|\/users/i, label: "Account settings" },
  { pattern: /\/(login|auth|sign_in|callback)/i, label: "Sign in" },
  { pattern: /^\/?$|\/home/i, label: "Home" },
];

export const deriveTask = (route: string): string => {
  const path = (route || "").split("?")[0];
  const match = TASK_PATTERNS.find(t => t.pattern.test(path));
  if (match) return match.label;
  // Best-effort: humanise the first path segment (e.g. "/foo_bar" -> "Foo Bar").
  const segment = path.split("/").filter(Boolean)[0];
  if (!segment) return "Home";
  return segment
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
};

// Best-effort resolution of the project the user is currently working in. There
// is no single global "current project" store, so we read it from the query
// string (?projectId=) or a /projects/:id path segment when present.
export const deriveProject = (route: string): string => {
  if (typeof window !== "undefined") {
    try {
      const params = new URLSearchParams(window.location.search);
      const named = params.get("projectName");
      if (named) return named;
      const id = params.get("projectId") || params.get("project_id");
      if (id) return `Project ${id}`;
    } catch {
      // fall through to path parsing
    }
  }
  const projectMatch = (route || "").match(/\/projects\/(\d+)/);
  if (projectMatch) return `Project ${projectMatch[1]}`;
  return "Not in a project";
};

// The account/display name for the current user, preferring a human name over an
// email, falling back to a friendly placeholder.
export const deriveAccountName = (userContext: UserContextType): string =>
  userContext.userName || userContext.userEmail || "Unknown account";

// Builds the minimal, user-facing quick report shown in the popup (#440).
export const collectQuickReport = (
  userContext: UserContextType,
): QuickReport => {
  const route =
    typeof window !== "undefined"
      ? window.location.pathname + window.location.search
      : "";
  // A recorded pipeline failure is the point of the report, so it takes precedence
  // over an incidental client-side JS error in the user-facing Error row.
  const runFailure = getRunFailure();
  return {
    errorName: runFailure
      ? runFailure.userFacing
      : deriveErrorName(getLastClientError()),
    task: deriveTask(route),
    project: deriveProject(route),
    accountName: deriveAccountName(userContext),
  };
};

// Collects readily-available, non-sensitive diagnostics about the current
// session, app build, and browser. This is the fuller set: it is NOT shown to
// the user by default (only behind "More details") and is primarily consumed by
// the support-side payload builder in support_requests_controller (#440).
export const collectDiagnostics = (userContext: UserContextType): Diagnostics => {
  const viewport =
    typeof window !== "undefined"
      ? `${window.innerWidth}x${window.innerHeight}`
      : "unknown";
  const screenSize =
    typeof window !== "undefined" && window.screen
      ? `${window.screen.width}x${window.screen.height}`
      : "unknown";

  let timezone = "unknown";
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown";
  } catch {
    timezone = "unknown";
  }

  return {
    release: window.GIT_RELEASE_SHA || "unknown",
    environment: window.ENVIRONMENT || "unknown",
    userId: userContext.userId != null ? String(userContext.userId) : "unknown",
    userEmail: userContext.userEmail || "unknown",
    userRole: userContext.admin ? "admin" : "user",
    url: window.location.href,
    route: window.location.pathname + window.location.search,
    userAgent: navigator.userAgent,
    language: navigator.language,
    viewport,
    screen: screenSize,
    timestamp: new Date().toISOString(),
    timezone,
    recentError: getLastClientError() || "none",
  };
};
