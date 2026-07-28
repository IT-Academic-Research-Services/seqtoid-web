// CZID-586 (#586) frontend coverage:
// app/assets/src/components/common/SupportPortal/collectDiagnostics.ts
//
// This module distils the "what was the user doing when it broke" context for
// the in-app support portal (#440). Nearly all of its uncovered weight is
// branch weight: the route -> task pattern table, the several ways a project id
// can be discovered, the error-name truncation arms, and the "unknown"
// fallbacks in the fuller diagnostics payload. Each arm is pinned below.
import {
  collectDiagnostics,
  collectQuickReport,
  deriveAccountName,
  deriveErrorName,
  deriveProject,
  deriveTask,
  getLastClientError,
  recordClientError,
} from "~/components/common/SupportPortal/collectDiagnostics";

// The module keeps a single module-level "last error" slot; reset it between
// tests so ordering cannot leak.
const clearRecordedError = () => recordClientError(null as unknown as string);

const setLocation = (url: string) => window.history.pushState({}, "", url);

const userContext = (overrides = {}) =>
  ({
    admin: false,
    userId: 42,
    userName: "Test User",
    userEmail: "test@example.com",
    ...overrides,
  } as any);

describe("recordClientError / getLastClientError", () => {
  afterEach(clearRecordedError);

  it("round-trips the most recently recorded error", () => {
    recordClientError("TypeError: x is not a function");
    expect(getLastClientError()).toBe("TypeError: x is not a function");
  });

  it("keeps only the latest error", () => {
    recordClientError("first");
    recordClientError("second");
    expect(getLastClientError()).toBe("second");
  });
});

describe("deriveErrorName", () => {
  it("returns the friendly placeholder when nothing was captured", () => {
    expect(deriveErrorName(null)).toBe("No error detected");
    expect(deriveErrorName("")).toBe("No error detected");
  });

  it("strips the ' @ file:line:col' location suffix our listener appends", () => {
    expect(deriveErrorName("TypeError: bad @ http://host/app.js:12:3")).toBe(
      "TypeError: bad",
    );
  });

  it("keeps only the first line of a multi-line error", () => {
    expect(deriveErrorName("Error: boom\n    at foo (a.js:1:1)")).toBe(
      "Error: boom",
    );
  });

  it("truncates a very long error name to 160 characters with an ellipsis", () => {
    const long = "E".repeat(300);
    const result = deriveErrorName(long);
    expect(result).toHaveLength(160);
    expect(result.endsWith("...")).toBe(true);
    expect(result.slice(0, 157)).toBe("E".repeat(157));
  });

  it("leaves an error name exactly at the 160-char boundary untouched", () => {
    const exact = "E".repeat(160);
    expect(deriveErrorName(exact)).toBe(exact);
  });

  it("falls back to 'Unknown error' when the payload is only location noise", () => {
    expect(deriveErrorName(" @ http://host/app.js:1:1")).toBe("Unknown error");
  });
});

describe("deriveTask", () => {
  it.each([
    ["/bulk_download/new", "Bulk download"],
    ["/samples/upload", "Sample upload"],
    ["/my_data", "My Data"],
    ["/public", "Public data"],
    ["/samples/1234", "Sample report"],
    ["/samples", "Samples"],
    ["/projects/77", "Project"],
    ["/projects", "Projects"],
    ["/visualizations/heatmap", "Visualization"],
    ["/pipeline_viz/6.8", "Pipeline visualization"],
    ["/user_settings", "Account settings"],
    ["/auth0/callback", "Sign in"],
    ["/home", "Home"],
    ["/", "Home"],
    ["", "Home"],
  ])("maps %s to the %s task label", (route, label) => {
    expect(deriveTask(route)).toBe(label);
  });

  it("ignores the query string when matching", () => {
    expect(deriveTask("/my_data?projectId=9&tab=samples")).toBe("My Data");
  });

  it("humanises an unrecognised first path segment", () => {
    expect(deriveTask("/cli_user_instructions/extra")).toBe(
      "Cli User Instructions",
    );
  });

  it("falls back to Home when the path has no usable segment", () => {
    // A query-only route: the path splits to nothing after the "?" is dropped.
    expect(deriveTask("///")).toBe("Home");
  });
});

describe("deriveProject", () => {
  afterEach(() => setLocation("/"));

  it("prefers an explicit projectName query param", () => {
    setLocation("/my_data?projectName=Malaria%20Study&projectId=9");
    expect(deriveProject("/my_data")).toBe("Malaria Study");
  });

  it("falls back to the projectId query param", () => {
    setLocation("/my_data?projectId=9");
    expect(deriveProject("/my_data")).toBe("Project 9");
  });

  it("also accepts the snake_case project_id query param", () => {
    setLocation("/my_data?project_id=11");
    expect(deriveProject("/my_data")).toBe("Project 11");
  });

  it("falls back to a /projects/:id path segment when no query param is present", () => {
    setLocation("/projects/55");
    expect(deriveProject("/projects/55/samples")).toBe("Project 55");
  });

  it("reports 'Not in a project' when nothing identifies a project", () => {
    setLocation("/my_data");
    expect(deriveProject("/my_data")).toBe("Not in a project");
  });
});

describe("deriveAccountName", () => {
  it("prefers the human name", () => {
    expect(deriveAccountName(userContext())).toBe("Test User");
  });

  it("falls back to the email when there is no name", () => {
    expect(deriveAccountName(userContext({ userName: "" }))).toBe(
      "test@example.com",
    );
  });

  it("falls back to a placeholder when neither is known", () => {
    expect(
      deriveAccountName(userContext({ userName: "", userEmail: "" })),
    ).toBe("Unknown account");
  });
});

describe("collectQuickReport", () => {
  afterEach(() => {
    clearRecordedError();
    setLocation("/");
  });

  it("assembles the minimal user-facing summary from route + recorded error", () => {
    setLocation("/samples/upload?projectId=3");
    recordClientError("Error: upload aborted @ http://host/app.js:2:2");

    expect(collectQuickReport(userContext())).toEqual({
      errorName: "Error: upload aborted",
      task: "Sample upload",
      project: "Project 3",
      accountName: "Test User",
    });
  });

  it("reports 'No error detected' when nothing has failed yet", () => {
    setLocation("/my_data");
    expect(collectQuickReport(userContext()).errorName).toBe(
      "No error detected",
    );
  });
});

describe("collectDiagnostics", () => {
  afterEach(() => {
    clearRecordedError();
    setLocation("/");
    delete (window as any).GIT_RELEASE_SHA;
    delete (window as any).ENVIRONMENT;
  });

  it("collects the release, environment, user and browser context", () => {
    (window as any).GIT_RELEASE_SHA = "abc1234";
    (window as any).ENVIRONMENT = "staging";
    setLocation("/my_data?projectId=8");
    recordClientError("Error: kaboom");

    const diagnostics = collectDiagnostics(userContext({ admin: true }));

    expect(diagnostics.release).toBe("abc1234");
    expect(diagnostics.environment).toBe("staging");
    expect(diagnostics.userId).toBe("42");
    expect(diagnostics.userEmail).toBe("test@example.com");
    expect(diagnostics.userRole).toBe("admin");
    expect(diagnostics.route).toBe("/my_data?projectId=8");
    expect(diagnostics.url).toContain("/my_data?projectId=8");
    expect(diagnostics.userAgent).toBe(navigator.userAgent);
    expect(diagnostics.language).toBe(navigator.language);
    expect(diagnostics.viewport).toBe(
      `${window.innerWidth}x${window.innerHeight}`,
    );
    expect(diagnostics.screen).toBe(
      `${window.screen.width}x${window.screen.height}`,
    );
    expect(diagnostics.recentError).toBe("Error: kaboom");
    // A real ISO-8601 timestamp, not a placeholder.
    expect(Number.isNaN(Date.parse(diagnostics.timestamp))).toBe(false);
    expect(diagnostics.timezone).toEqual(expect.any(String));
    expect(diagnostics.timezone).not.toBe("");
  });

  it("falls back to 'unknown'/'none' when the globals and user fields are absent", () => {
    const diagnostics = collectDiagnostics(
      userContext({ userId: null, userEmail: "", admin: false }),
    );

    expect(diagnostics.release).toBe("unknown");
    expect(diagnostics.environment).toBe("unknown");
    expect(diagnostics.userId).toBe("unknown");
    expect(diagnostics.userEmail).toBe("unknown");
    expect(diagnostics.userRole).toBe("user");
    expect(diagnostics.recentError).toBe("none");
  });

  it("reports an unknown timezone when Intl resolution throws", () => {
    const spy = jest.spyOn(Intl, "DateTimeFormat").mockImplementation((() => {
      throw new Error("no ICU data");
    }) as unknown as typeof Intl.DateTimeFormat);

    expect(collectDiagnostics(userContext()).timezone).toBe("unknown");

    spy.mockRestore();
  });

  it("stringifies a userId of 0 rather than treating it as missing", () => {
    // `!= null` (not a truthiness check) is what makes id 0 survive.
    expect(collectDiagnostics(userContext({ userId: 0 })).userId).toBe("0");
  });
});
