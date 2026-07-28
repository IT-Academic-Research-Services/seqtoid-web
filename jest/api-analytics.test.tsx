// Coverage: app/assets/src/api/analytics.ts
// The module is a thin shim over Segment's global `window.analytics`. The
// branches worth driving: analytics absent vs present, present-with-`user()`
// (trait enrichment) vs present-without, a global analytics context vs none,
// and withAnalytics being handed a non-function.
import { renderHook } from "@testing-library/react";
import React from "react";
import {
  ANALYTICS_EVENT_NAMES,
  trackEventFromClassComponent,
  trackPageTransition,
  useTrackEvent,
  useWithAnalytics,
  withAnalyticsFromClassComponent,
} from "~/api/analytics";
import eventNames from "~/api/events";
import { GlobalContext } from "~/globalContext/reducer";

type AnalyticsStub = {
  track: jest.Mock;
  page: jest.Mock;
  user?: jest.Mock;
};

const win = window as unknown as {
  analytics?: AnalyticsStub;
  GIT_VERSION?: string;
};

const installAnalytics = (withUser: boolean): AnalyticsStub => {
  const stub: AnalyticsStub = { track: jest.fn(), page: jest.fn() };
  if (withUser) {
    stub.user = jest.fn(() => ({
      traits: () => ({
        admin: true,
        biohub_user: false,
        czi_user: false,
        has_samples: true,
      }),
    }));
  }
  win.analytics = stub;
  return stub;
};

afterEach(() => {
  delete win.analytics;
  delete win.GIT_VERSION;
  jest.restoreAllMocks();
});

describe("ANALYTICS_EVENT_NAMES", () => {
  it("re-exports the shared event-name map for import convenience", () => {
    expect(ANALYTICS_EVENT_NAMES).toBe(eventNames);
  });
});

describe("logAnalyticsEvent (via trackEventFromClassComponent)", () => {
  it("does nothing when window.analytics is not installed", async () => {
    const stub = installAnalytics(false);
    delete win.analytics;

    await trackEventFromClassComponent({ projectIds: null }, "SOME_EVENT", {
      a: 1,
    });

    expect(stub.track).not.toHaveBeenCalled();
  });

  it("tracks the raw event data when analytics has no user() helper", async () => {
    const stub = installAnalytics(false);

    await trackEventFromClassComponent({ projectIds: 7 }, "MODAL_CLOSED", {
      sampleId: 3,
    });

    expect(stub.track).toHaveBeenCalledTimes(1);
    const [name, data] = stub.track.mock.calls[0];
    expect(name).toBe("MODAL_CLOSED");
    expect(data.sampleId).toBe(3);
    // No user() means no trait enrichment.
    expect("admin" in data).toBe(false);
    expect("category" in data).toBe(false);
    expect(data.globalContext).toEqual({ projectIds: 7 });
  });

  it("enriches the payload with user traits, git version, label and category", async () => {
    const stub = installAnalytics(true);
    win.GIT_VERSION = "v1.2.3";

    await trackEventFromClassComponent(
      { projectIds: [1, 2] },
      "SAMPLES_VIEW_ROW_CLICKED",
      { sampleId: 9 },
    );

    const [, data] = stub.track.mock.calls[0];
    expect(data.admin).toBe(true);
    expect(data.biohub_user).toBe(false);
    expect(data.has_samples).toBe(true);
    expect(data.git_version).toBe("v1.2.3");
    // `category` is the leading underscore-delimited token of the event name.
    expect(data.category).toBe("SAMPLES");
    // `label` is the JSON of the ORIGINAL event data, before enrichment.
    expect(data.label).toBe(JSON.stringify({ sampleId: 9 }));
    // Caller-supplied keys survive the enrichment spread.
    expect(data.sampleId).toBe(9);
    expect(data.globalContext).toEqual({ projectIds: [1, 2] });
  });

  it("lets the caller override an enriched trait", async () => {
    const stub = installAnalytics(true);

    await trackEventFromClassComponent({ projectIds: null }, "X_EVENT", {
      admin: false,
    });

    expect(stub.track.mock.calls[0][1].admin).toBe(false);
  });

  it("omits globalContext when no analytics context is supplied", async () => {
    const stub = installAnalytics(false);

    await trackEventFromClassComponent(
      null as unknown as { projectIds: null },
      "NO_CONTEXT_EVENT",
      { a: 1 },
    );

    expect("globalContext" in stub.track.mock.calls[0][1]).toBe(false);
  });

  it("defaults eventData to an empty object", async () => {
    const stub = installAnalytics(false);

    await trackEventFromClassComponent(
      null as unknown as { projectIds: null },
      "BARE_EVENT",
    );

    expect(stub.track).toHaveBeenCalledWith("BARE_EVENT", {});
  });
});

describe("trackPageTransition", () => {
  it("calls analytics.page when analytics is installed", () => {
    const stub = installAnalytics(false);
    trackPageTransition();
    expect(stub.page).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when analytics is missing", () => {
    const stub = installAnalytics(false);
    delete win.analytics;
    trackPageTransition();
    expect(stub.page).not.toHaveBeenCalled();
  });
});

describe("withAnalytics (via withAnalyticsFromClassComponent)", () => {
  it("returns a wrapper that forwards args, returns the handler result and tracks", () => {
    const stub = installAnalytics(false);
    const handler = jest.fn((a: number, b: number) => a + b);

    const wrapped = withAnalyticsFromClassComponent(
      { projectIds: 4 },
      handler,
      "BUTTON_CLICKED",
      { source: "header" },
    );

    // Nothing is tracked until the wrapper is actually invoked.
    expect(stub.track).not.toHaveBeenCalled();

    expect(wrapped(2, 3)).toBe(5);
    expect(handler).toHaveBeenCalledWith(2, 3);
    expect(stub.track).toHaveBeenCalledTimes(1);
    expect(stub.track.mock.calls[0][0]).toBe("BUTTON_CLICKED");
    expect(stub.track.mock.calls[0][1].source).toBe("header");
  });

  it("logs an error when the handler is not a function", () => {
    installAnalytics(false);
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    withAnalyticsFromClassComponent(
      { projectIds: null },
      undefined as unknown as () => void,
      "BAD_HANDLER_EVENT",
    );

    expect(consoleError).toHaveBeenCalledWith(
      'Missing event handler function "undefined"',
    );
  });

  it("defaults eventData to an empty object in the wrapper", () => {
    const stub = installAnalytics(false);
    const wrapped = withAnalyticsFromClassComponent(
      null as unknown as { projectIds: null },
      () => undefined,
      "NO_DATA_EVENT",
    );
    wrapped();
    expect(stub.track).toHaveBeenCalledWith("NO_DATA_EVENT", {});
  });
});

describe("useTrackEvent / useWithAnalytics", () => {
  const wrapperWithProjectIds = (discoveryProjectIds: number[] | null) => {
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <GlobalContext.Provider
        value={
          {
            globalContextState: { discoveryProjectIds },
            globalContextDispatch: jest.fn(),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any
        }
      >
        {children}
      </GlobalContext.Provider>
    );
    return Wrapper;
  };

  it("useTrackEvent attaches the discovery project ids from context", () => {
    const stub = installAnalytics(false);
    const { result } = renderHook(() => useTrackEvent(), {
      wrapper: wrapperWithProjectIds([11, 12]),
    });

    result.current("HOOKED_EVENT", { a: 1 });

    expect(stub.track.mock.calls[0][1].globalContext).toEqual({
      projectIds: [11, 12],
    });
  });

  it("useTrackEvent falls back to null projectIds with no provider", () => {
    const stub = installAnalytics(false);
    const { result } = renderHook(() => useTrackEvent());

    result.current("UNPROVIDED_EVENT");

    expect(stub.track.mock.calls[0][1].globalContext).toEqual({
      projectIds: null,
    });
  });

  it("useTrackEvent falls back to null when the state has no project ids", () => {
    const stub = installAnalytics(false);
    const { result } = renderHook(() => useTrackEvent(), {
      wrapper: wrapperWithProjectIds(null),
    });

    result.current("NULL_IDS_EVENT");

    expect(stub.track.mock.calls[0][1].globalContext).toEqual({
      projectIds: null,
    });
  });

  it("useWithAnalytics returns a wrapper that calls the handler and tracks", () => {
    const stub = installAnalytics(false);
    const handler = jest.fn(() => "done");
    const { result } = renderHook(() => useWithAnalytics(), {
      wrapper: wrapperWithProjectIds([5]),
    });

    const wrapped = result.current(handler, "WRAPPED_EVENT", { z: 2 });
    expect(wrapped("arg")).toBe("done");
    expect(handler).toHaveBeenCalledWith("arg");
    expect(stub.track.mock.calls[0][0]).toBe("WRAPPED_EVENT");
    expect(stub.track.mock.calls[0][1].z).toBe(2);
    expect(stub.track.mock.calls[0][1].globalContext).toEqual({
      projectIds: [5],
    });
  });
});
