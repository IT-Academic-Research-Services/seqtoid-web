// Coverage: .../SampleView/components/SampleReportConent/SampleReportContent.tsx
//
// SampleReportContent is the status gate in front of every report body. It
// picks one of six outcomes from loadingResults + the workflow run status +
// sample.upload_error: the loading message, the children, the failure message,
// the with-issue message (SMP-1908), the in-progress message, or the
// waiting-to-start message. This drives every branch: no run at all, a run with
// no status, RUNNING, CREATED, SUCCEEDED, SUCCEEDED_WITH_ISSUE, a failed status,
// and an upload_error that suppresses the in-progress and with-issue branches.
// The optional loadingInfo/eventNames chains are exercised present and absent.
import { render, screen } from "@testing-library/react";
import { SampleReportContent } from "~/components/views/SampleView/components/SampleReportConent/SampleReportContent";

jest.mock("~/components/common/SampleMessage", () => ({
  SampleMessage: (props: $TSFixMe) => (
    <div
      data-testid="sample-message"
      data-status={String(props.status)}
      data-type={String(props.type)}
      data-message={String(props.message)}
      data-link={String(props.link)}
      data-link-text={String(props.linkText)}
      data-event={String(props.analyticsEventName)}
    />
  ),
}));

jest.mock(
  "~/components/views/SampleView/components/SampleReportConent/components/FailedMessage",
  () => ({
    FailedMessage: (props: $TSFixMe) => (
      <div
        data-testid="failed-message"
        data-sample-id={String(props.sample?.id)}
        data-run-status={String(props.workflowRun?.status)}
        data-event={String(props.analyticsEventName)}
      />
    ),
  }),
);

jest.mock("~/components/ui/icons", () => ({
  IconLoading: () => <span data-testid="icon-loading" />,
  IconInfo: () => <span data-testid="icon-info" />,
}));

const mockLogError = jest.fn();
jest.mock("~/components/utils/logUtil", () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

beforeEach(() => mockLogError.mockClear());

const LOADING_INFO = {
  message: "Your AMR results are being generated!",
  linkText: "Learn more",
  helpLink: "https://example.test/help",
};

const renderContent = (overrides: $TSFixMe = {}) =>
  render(
    <SampleReportContent
      loadingResults={false}
      workflowRun={{ status: "RUNNING" } as $TSFixMe}
      sample={{ id: 12, upload_error: null } as $TSFixMe}
      loadingInfo={LOADING_INFO}
      eventNames={{ loading: "loading-event", error: "error-event" }}
      {...overrides}
    >
      <div data-testid="report-body">report</div>
    </SampleReportContent>,
  );

const message = () => screen.getByTestId("sample-message");

describe("SampleReportContent", () => {
  it("shows the loading message while results are still loading", () => {
    renderContent({ loadingResults: true });

    expect(message().getAttribute("data-message")).toBe("Loading report data.");
    expect(message().getAttribute("data-status")).toBe("Loading");
    expect(screen.queryByTestId("report-body")).toBeNull();
  });

  it("prefers the loading message over a succeeded run", () => {
    renderContent({
      loadingResults: true,
      workflowRun: { status: "SUCCEEDED" },
    });

    expect(message().getAttribute("data-status")).toBe("Loading");
    expect(screen.queryByTestId("report-body")).toBeNull();
  });

  it("renders the children once the run has succeeded", () => {
    renderContent({ workflowRun: { status: "SUCCEEDED" } });

    expect(screen.getByTestId("report-body")).not.toBeNull();
    expect(screen.queryByTestId("sample-message")).toBeNull();
    expect(screen.queryByTestId("failed-message")).toBeNull();
  });

  it("shows the in-progress message with the caller's loading copy for a running run", () => {
    renderContent();

    expect(message().getAttribute("data-status")).toBe("IN PROGRESS");
    expect(message().getAttribute("data-message")).toBe(LOADING_INFO.message);
    expect(message().getAttribute("data-link")).toBe(LOADING_INFO.helpLink);
    expect(message().getAttribute("data-link-text")).toBe(
      LOADING_INFO.linkText,
    );
    expect(message().getAttribute("data-event")).toBe("loading-event");
  });

  it("treats a missing workflow run as in progress", () => {
    renderContent({ workflowRun: null });

    expect(message().getAttribute("data-status")).toBe("IN PROGRESS");
    expect(screen.queryByTestId("failed-message")).toBeNull();
  });

  it("treats a workflow run without a status as in progress", () => {
    renderContent({ workflowRun: { status: undefined } });

    expect(message().getAttribute("data-status")).toBe("IN PROGRESS");
  });

  it("tolerates missing loadingInfo and eventNames on the in-progress branch", () => {
    renderContent({
      workflowRun: null,
      loadingInfo: undefined,
      eventNames: undefined,
    });

    expect(message().getAttribute("data-message")).toBe("undefined");
    expect(message().getAttribute("data-link")).toBe("undefined");
    expect(message().getAttribute("data-event")).toBe("undefined");
  });

  it("shows the waiting-to-start message for a created run", () => {
    renderContent({ workflowRun: { status: "CREATED" } });

    expect(message().getAttribute("data-message")).toBe(
      "Waiting to Start or Receive Files",
    );
    expect(message().getAttribute("data-status")).toBe("IN PROGRESS");
  });

  it("shows the failure message for a failed run", () => {
    renderContent({ workflowRun: { status: "FAILED" } });

    const failed = screen.getByTestId("failed-message");
    expect(failed.getAttribute("data-run-status")).toBe("FAILED");
    expect(failed.getAttribute("data-sample-id")).toBe("12");
    expect(failed.getAttribute("data-event")).toBe("error-event");
    expect(screen.queryByTestId("sample-message")).toBeNull();
  });

  it("shows the failure message when the sample has an upload error, even mid-run", () => {
    renderContent({
      workflowRun: { status: "RUNNING" },
      sample: { id: 12, upload_error: "Upload failed" },
    });

    expect(screen.getByTestId("failed-message")).not.toBeNull();
    expect(screen.queryByTestId("sample-message")).toBeNull();
  });

  it("shows the failure message when a created run belongs to a sample with an upload error", () => {
    renderContent({
      workflowRun: { status: "CREATED" },
      sample: { id: 12, upload_error: "Upload failed" },
    });

    expect(screen.getByTestId("failed-message")).not.toBeNull();
  });

  it("passes an undefined error event name through when eventNames is omitted", () => {
    renderContent({
      workflowRun: { status: "FAILED" },
      eventNames: undefined,
    });

    expect(
      screen.getByTestId("failed-message").getAttribute("data-event"),
    ).toBe("undefined");
  });

  // SMP-1501 / SMP-1476: a Relay store dataID collision can overwrite the raw Rails
  // status ("SUCCEEDED") with the SFN-mapped Rails value ("COMPLETE") on the same record
  // after a browser back/forward, so the success values of BOTH vocabularies must render
  // the report. (The with-issue values are covered separately below.)
  it.each(["SUCCEEDED", "COMPLETE"])(
    "renders the report for the success status %s",
    status => {
      renderContent({ workflowRun: { status } });

      expect(screen.getByTestId("report-body")).not.toBeNull();
      expect(screen.queryByTestId("failed-message")).toBeNull();
      expect(mockLogError).not.toHaveBeenCalled();
    },
  );

  // SMP-1908: a run that finished "with an issue" produced no results, so the empty report
  // body would be a blank screen. Surface the stored reason via SampleMessage instead. Both
  // Rails status vocabularies must be recognised (the SMP-1501 dataID collision above).
  describe("complete-with-issue runs", () => {
    it.each(["SUCCEEDED_WITH_ISSUE", "COMPLETE - ISSUE"])(
      "shows the issue message, not the report body, for %s",
      status => {
        renderContent({
          workflowRun: { status, error_message: "insufficient coverage" },
        });

        expect(message().getAttribute("data-message")).toBe(
          "insufficient coverage",
        );
        expect(message().getAttribute("data-status")).toBe("COMPLETE");
        expect(message().getAttribute("data-type")).toBe("success");
        expect(screen.queryByTestId("report-body")).toBeNull();
        expect(screen.queryByTestId("failed-message")).toBeNull();
        expect(mockLogError).not.toHaveBeenCalled();
      },
    );

    // Regression guard: a with-issue run still carries a live input_error -- that is WHY it
    // is SUCCEEDED_WITH_ISSUE (workflow_run.rb promotes the status only when input_error is
    // present). An earlier draft tested input_error before the with-issue branch and so
    // rendered FailedMessage. The branch must be reached regardless.
    it("reaches the issue branch even when input_error is populated", () => {
      renderContent({
        workflowRun: {
          status: "SUCCEEDED_WITH_ISSUE",
          input_error: {
            label: "InsufficientReadsError",
            message: "not enough reads",
          },
        },
      });

      expect(screen.queryByTestId("failed-message")).toBeNull();
      expect(screen.queryByTestId("report-body")).toBeNull();
      expect(message().getAttribute("data-message")).toBe("not enough reads");
    });

    it("shows a generic message when the run carries no reason", () => {
      renderContent({ workflowRun: { status: "SUCCEEDED_WITH_ISSUE" } });

      expect(message().getAttribute("data-message")).toBe(
        "This run completed with an issue, so no results were produced.",
      );
    });

    // A terminal upload error still wins: the with-issue branch sits AFTER upload_error.
    it("prefers the upload-error failure over the issue message", () => {
      renderContent({
        workflowRun: { status: "SUCCEEDED_WITH_ISSUE", error_message: "x" },
        sample: { id: 12, upload_error: "Upload failed" },
      });

      expect(screen.getByTestId("failed-message")).not.toBeNull();
      expect(screen.queryByTestId("sample-message")).toBeNull();
    });
  });

  it.each(["FAILED", "TIMED_OUT", "ABORTED"])(
    "shows the failure message for the terminal status %s",
    status => {
      renderContent({ workflowRun: { status } });

      expect(screen.getByTestId("failed-message")).not.toBeNull();
      expect(screen.queryByTestId("report-body")).toBeNull();
      expect(mockLogError).not.toHaveBeenCalled();
    },
  );

  it("defaults an unrecognised status to in progress (not failure) and logs it once", () => {
    renderContent({ workflowRun: { id: 7, status: "SOME_NEW_STATUS" } });

    expect(message().getAttribute("data-status")).toBe("IN PROGRESS");
    expect(screen.queryByTestId("failed-message")).toBeNull();
    expect(mockLogError).toHaveBeenCalledTimes(1);
    const [arg] = mockLogError.mock.calls[0];
    expect(arg.message).toContain("Unrecognized workflow run status");
    expect(arg.details).toMatchObject({
      status: "SOME_NEW_STATUS",
      sampleId: 12,
      workflowRunId: 7,
    });
  });

  it("does not log for a known status or an absent status", () => {
    renderContent({ workflowRun: { status: "COMPLETE" } });
    renderContent({ workflowRun: { status: undefined } });
    renderContent({ workflowRun: null });

    expect(mockLogError).not.toHaveBeenCalled();
  });
});
