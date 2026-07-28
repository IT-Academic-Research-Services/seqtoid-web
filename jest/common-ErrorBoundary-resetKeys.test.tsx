// Coverage: app/assets/src/components/common/ErrorBoundary.tsx
//
// jest/ErrorBoundary.test.tsx already covers the happy path (fallback render,
// Sentry reporting, retry). This spec targets the branches it leaves alone:
// the custom `fallback` render-prop, the `inline` flag, the componentDidUpdate
// resetKeys auto-recovery (every guard: no error, missing prev, missing next,
// length change, element change, unchanged) and the componentDidCatch error
// normalisation for a thrown value with no `.message`.
import * as Sentry from "@sentry/react";
import { fireEvent, render, screen } from "@testing-library/react";
import ErrorBoundary from "~/components/common/ErrorBoundary";

const boom = { shouldThrow: true };
const Child = () => {
  if (boom.shouldThrow) throw new Error("child exploded");
  return <div data-testid="ok">ok</div>;
};

const mockRecordClientError = jest.fn();
jest.mock("~/components/common/SupportPortal/collectDiagnostics", () => ({
  __esModule: true,
  recordClientError: (msg: string) => mockRecordClientError(msg),
}));

describe("ErrorBoundary branch coverage", () => {
  let captureSpy: jest.SpyInstance;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    boom.shouldThrow = true;
    mockRecordClientError.mockClear();
    captureSpy = jest
      .spyOn(Sentry, "captureException")
      .mockImplementation(() => "event-id");
    consoleSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    captureSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it("renders a custom fallback render-prop instead of the default fallback", () => {
    render(
      <ErrorBoundary
        fallback={({ error }) => (
          <div data-testid="custom">custom: {(error as Error).message}</div>
        )}
      >
        <Child />
      </ErrorBoundary>,
    );

    expect(screen.getByTestId("custom").textContent).toBe(
      "custom: child exploded",
    );
    expect(screen.queryByTestId("error-fallback")).toBeNull();
  });

  it("lets the custom fallback reset the boundary via resetError", () => {
    render(
      <ErrorBoundary
        fallback={({ resetError }) => (
          <button data-testid="custom-retry" onClick={resetError} />
        )}
      >
        <Child />
      </ErrorBoundary>,
    );

    boom.shouldThrow = false;
    fireEvent.click(screen.getByTestId("custom-retry"));
    expect(screen.getByTestId("ok")).toBeTruthy();
  });

  it("passes the inline flag through to the default fallback", () => {
    const { container } = render(
      <ErrorBoundary inline view="report">
        <Child />
      </ErrorBoundary>,
    );
    // Inline still renders the shared fallback (with its alert role), just in
    // its compact form.
    const fallback = screen.getByTestId("error-fallback");
    expect(fallback).toBeTruthy();
    expect(fallback.getAttribute("role")).toBe("alert");
    expect(container.textContent).toBeTruthy();
  });

  it("records the thrown message for the support portal", () => {
    render(
      <ErrorBoundary>
        <Child />
      </ErrorBoundary>,
    );
    expect(mockRecordClientError).toHaveBeenCalledWith("child exploded");
  });

  it("stringifies a thrown value that has no message", () => {
    const Throws = () => {
      // eslint-disable-next-line no-throw-literal
      throw "plain string failure";
    };
    render(
      <ErrorBoundary>
        <Throws />
      </ErrorBoundary>,
    );
    expect(mockRecordClientError).toHaveBeenCalledWith("plain string failure");
    expect(screen.getByTestId("error-fallback")).toBeTruthy();
  });

  it("auto-resets when a resetKeys entry changes", () => {
    const { rerender } = render(
      <ErrorBoundary resetKeys={["sample-a"]}>
        <Child />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("error-fallback")).toBeTruthy();

    boom.shouldThrow = false;
    rerender(
      <ErrorBoundary resetKeys={["sample-b"]}>
        <Child />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("ok")).toBeTruthy();
  });

  it("auto-resets when the resetKeys array length changes", () => {
    const { rerender } = render(
      <ErrorBoundary resetKeys={["a"]}>
        <Child />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("error-fallback")).toBeTruthy();

    boom.shouldThrow = false;
    rerender(
      <ErrorBoundary resetKeys={["a", "b"]}>
        <Child />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("ok")).toBeTruthy();
  });

  it("stays in the error state when resetKeys are unchanged", () => {
    const { rerender } = render(
      <ErrorBoundary resetKeys={["same"]}>
        <Child />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("error-fallback")).toBeTruthy();

    boom.shouldThrow = false;
    rerender(
      <ErrorBoundary resetKeys={["same"]}>
        <Child />
      </ErrorBoundary>,
    );
    // Identical keys -> no auto-reset, the fallback is still showing.
    expect(screen.getByTestId("error-fallback")).toBeTruthy();
    expect(screen.queryByTestId("ok")).toBeNull();
  });

  it("does not auto-reset when resetKeys are absent on either render", () => {
    const { rerender } = render(
      <ErrorBoundary>
        <Child />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("error-fallback")).toBeTruthy();

    boom.shouldThrow = false;
    // prev has no resetKeys -> guard returns early even though next has some.
    rerender(
      <ErrorBoundary resetKeys={["now-present"]}>
        <Child />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("error-fallback")).toBeTruthy();

    // next has no resetKeys -> guard returns early again.
    rerender(
      <ErrorBoundary>
        <Child />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("error-fallback")).toBeTruthy();
  });

  it("ignores resetKeys churn while there is no error at all", () => {
    boom.shouldThrow = false;
    const { rerender } = render(
      <ErrorBoundary resetKeys={["x"]}>
        <Child />
      </ErrorBoundary>,
    );
    rerender(
      <ErrorBoundary resetKeys={["y"]}>
        <Child />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("ok")).toBeTruthy();
    expect(captureSpy).not.toHaveBeenCalled();
  });
});
