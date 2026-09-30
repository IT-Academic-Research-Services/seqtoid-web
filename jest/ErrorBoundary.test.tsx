import * as Sentry from "@sentry/react";
import { fireEvent, render, screen } from "@testing-library/react";
import ErrorBoundary from "~/components/common/ErrorBoundary";
import {
  onOpenSupportPortal,
  SUPPORT_PORTAL_OPEN_EVENT,
} from "~/components/common/SupportPortal/openSupportPortal";

jest.mock("@sentry/react", () => ({
  __esModule: true,
  ...jest.requireActual("@sentry/react"),
  captureException: jest.fn(() => "event-id"),
}));

const expectSentryCaptureException = (message: string) => {
  expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  const caughtError = (Sentry.captureException as any).mock.calls[0][0];
  expect(caughtError).toBeInstanceOf(Error);
  expect(caughtError.message).toBe(message);
};

// A child that throws on demand so we can drive the boundary into its error
// state deterministically.
const Boom = ({ message = "kaboom" }: { message?: string }) => {
  throw new Error(message);
};

// A child whose throwing is controlled externally by the test, so we can flip
// it off between the initial failure and the retry click to prove that "Try
// again" actually recovers the subtree (rather than relying on render timing).
const flaky = { shouldThrow: true };
const FlakyChild = () => {
  if (flaky.shouldThrow) {
    throw new Error("transient failure");
  }
  return <div data-testid="recovered">recovered content</div>;
};

describe("ErrorBoundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    flaky.shouldThrow = true;
    // Silence the intentional console.error the boundary emits on catch.
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders the friendly fallback when a child throws", () => {
    render(
      <ErrorBoundary view="report">
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByTestId("error-fallback")).toBeTruthy();
    // A human title + message, not a raw stack trace.
    expect(screen.getByTestId("error-fallback-title").textContent).toBeTruthy();
    expect(screen.getByTestId("error-fallback").getAttribute("role")).toBe(
      "alert",
    );
    // The raw thrown message is never shown to the user.
    expect(screen.queryByText("kaboom")).toBeNull();
    expectSentryCaptureException("kaboom");
  });

  it("still reports the error to Sentry (observability preserved)", () => {
    render(
      <ErrorBoundary view="heatmap">
        <Boom message="sentry-me" />
      </ErrorBoundary>,
    );

    expectSentryCaptureException("sentry-me");
  });

  it("suppresses the Sentry report when shouldReportError returns false", () => {
    render(
      <ErrorBoundary view="report" shouldReportError={() => false}>
        <Boom message="expected-not-found" />
      </ErrorBoundary>,
    );

    // The fallback still renders -- only observability reporting is gated.
    expect(screen.getByTestId("error-fallback")).toBeTruthy();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("still reports when shouldReportError returns true", () => {
    render(
      <ErrorBoundary view="report" shouldReportError={() => true}>
        <Boom message="real-defect" />
      </ErrorBoundary>,
    );

    expectSentryCaptureException("real-defect");
  });

  it("offers both a retry and a contact-support action for retryable errors", () => {
    render(
      <ErrorBoundary view="downloads">
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByTestId("error-fallback-retry")).toBeTruthy();
    expect(screen.getByTestId("error-fallback-report")).toBeTruthy();

    expectSentryCaptureException("kaboom");
  });

  it("recovers the subtree when the user clicks Try again", () => {
    render(
      <ErrorBoundary>
        <FlakyChild />
      </ErrorBoundary>,
    );

    // Initially failed -> fallback shown.
    expect(screen.getByTestId("error-fallback")).toBeTruthy();

    // Simulate the transient condition clearing, then retry: the boundary
    // resets and the child now renders successfully.
    flaky.shouldThrow = false;
    fireEvent.click(screen.getByTestId("error-fallback-retry"));
    expect(screen.getByTestId("recovered")).toBeTruthy();
    expect(screen.queryByTestId("error-fallback")).toBeNull();
    expectSentryCaptureException("transient failure");
  });

  it("wires 'Report a problem' to the in-app support portal (#440)", () => {
    const handler = jest.fn();
    const unsubscribe = onOpenSupportPortal(handler);

    render(
      <ErrorBoundary view="report">
        <Boom />
      </ErrorBoundary>,
    );

    fireEvent.click(screen.getByTestId("error-fallback-report"));

    expect(handler).toHaveBeenCalledTimes(1);
    // The support note carries the failing view for context.
    expect(handler.mock.calls[0][0].note).toContain("report");
    unsubscribe();
    expectSentryCaptureException("kaboom");
  });

  it("shows a non-retryable message with no retry button for a NOT_FOUND error", () => {
    const NotFound = () => {
      const err = new Error("resource not found") as Error & { code: string };
      err.code = "NOT_FOUND";
      throw err;
    };

    render(
      <ErrorBoundary>
        <NotFound />
      </ErrorBoundary>,
    );

    // Contact-support is always offered; retry is not, for a non-retryable error.
    expect(screen.getByTestId("error-fallback-report")).toBeTruthy();
    expect(screen.queryByTestId("error-fallback-retry")).toBeNull();
    expectSentryCaptureException("resource not found");
  });

  it("openSupportPortal dispatches the documented custom event", () => {
    const spy = jest.fn();
    window.addEventListener(SUPPORT_PORTAL_OPEN_EVENT, spy);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {
      openSupportPortal,
    } = require("~/components/common/SupportPortal/openSupportPortal");
    openSupportPortal({ note: "hello" });
    expect(spy).toHaveBeenCalledTimes(1);
    window.removeEventListener(SUPPORT_PORTAL_OPEN_EVENT, spy);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});
