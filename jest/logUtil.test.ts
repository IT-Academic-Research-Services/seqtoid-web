// CZID-462 (#586) coverage: app/assets/src/components/utils/logUtil.ts
import * as Sentry from "@sentry/browser";
import { AxiosError } from "axios";
import {
  isTransientNetworkError,
  logError,
} from "../app/assets/src/components/utils/logUtil";

jest.mock("@sentry/browser", () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

describe("logUtil.ts logError", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("routes to captureException when an exception is provided", () => {
    const exception = new Error("boom");
    logError({ message: "failed", exception, details: { id: 1 } });
    expect(Sentry.captureException).toHaveBeenCalledWith(exception, {
      extra: { message: "failed", id: 1 },
    });
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it("routes to captureMessage when an exception is provided but is no an Error", () => {
    const exception = "invalid thingy" as unknown as Error;
    logError({ message: "bad error", exception, details: { id: 77 } });
    expect(Sentry.captureMessage).toHaveBeenCalledWith("bad error", {
      extra: { exception: '"invalid thingy"', id: 77 },
    });
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("routes to captureMessage when no exception is provided", () => {
    logError({ message: "just a message", details: { foo: "bar" } });
    expect(Sentry.captureMessage).toHaveBeenCalledWith("just a message", {
      extra: { foo: "bar" },
    });
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("defaults details to an empty object", () => {
    logError({ message: "no details" });
    expect(Sentry.captureMessage).toHaveBeenCalledWith("no details", {
      extra: {},
    });
  });
});

// SMP-1494 (DEV-REACTJS-PROJECT-5): the discovery view caught EVERY error from
// fetchCgFilteredWorkflowRuns() and reported it to Sentry, including transient
// client network blips (axios ERR_NETWORK on GET /projects.json). Only genuine
// errors should be reported.
describe("logUtil.ts isTransientNetworkError", () => {
  it("is true for an axios ERR_NETWORK error (the SMP-1494 case)", () => {
    expect(
      isTransientNetworkError(new AxiosError("Network Error", "ERR_NETWORK")),
    ).toBe(true);
  });

  it("is true for a canceled request", () => {
    expect(
      isTransientNetworkError(new AxiosError("canceled", "ERR_CANCELED")),
    ).toBe(true);
  });

  it("is false for a generic application error", () => {
    expect(isTransientNetworkError(new Error("boom"))).toBe(false);
  });

  it("is false for an axios error with a real HTTP response (a 4xx/5xx, not a network failure)", () => {
    expect(
      isTransientNetworkError(new AxiosError("Bad Request", "ERR_BAD_REQUEST")),
    ).toBe(false);
  });

  it("is false for null/undefined", () => {
    expect(isTransientNetworkError(null)).toBe(false);
    expect(isTransientNetworkError(undefined)).toBe(false);
  });
});
