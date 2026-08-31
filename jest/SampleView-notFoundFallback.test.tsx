// Frontend coverage: app/assets/src/components/views/SampleView/SampleView.tsx
// (the ErrorBoundary fallback branch, SMP-1633)
//
// When the Relay sample query throws because the sample is missing or the user
// has no access, the report boundary must show a friendly "not found" message
// and must NOT report the (expected) error to Sentry. A genuine error still
// gets the generic retry + contact-support fallback and is still reported.
//
// Unlike the main SampleView suite, this file does NOT mock ErrorBoundary --
// the real boundary is what we are exercising. Relay's useLazyLoadQuery is made
// to throw so the boundary catches during render, before any child mounts.
import * as Sentry from "@sentry/react";
import { render, screen, waitFor } from "@testing-library/react";
import { SampleView } from "~/components/views/SampleView/SampleView";
import { GlobalContext } from "~/globalContext/reducer";

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

// The `~`-aliased scss import in SampleView resolves ahead of the global scss
// moduleNameMapper, so stub it explicitly (same as the main SampleView suite).
jest.mock("~/components/common/SampleMessage/sample_message.scss", () => ({}), {
  virtual: true,
});

// The one lever this suite pulls: what the sample query does on render.
let mockLazyLoadImpl: () => unknown = () => ({ SampleForReport: null });

jest.mock("react-relay", () => ({
  __esModule: true,
  useLazyLoadQuery: () => mockLazyLoadImpl(),
  useRelayEnvironment: () => ({ name: "test-env" }),
}));

// The graphql tag needs the relay compiler at build time; stub it so the module
// loads under jest, and give fetchQuery a no-op subscription.
jest.mock("relay-runtime", () => ({
  __esModule: true,
  graphql: () => ({ kind: "Request" }),
  fetchQuery: jest.fn(() => ({ subscribe: () => undefined })),
}));

const mockTrackEvent = jest.fn();
jest.mock("~/api/analytics", () => ({
  __esModule: true,
  useTrackEvent: () => mockTrackEvent,
  ANALYTICS_EVENT_NAMES: {},
}));

// The presentational children pull in `~`-aliased scss that jest can't parse,
// and none of them render on the throw path anyway (the query throws before any
// child mounts). Stub them so SampleView's module graph loads. ErrorBoundary,
// SampleMessage and the icons are left REAL -- they are what the fallback renders.
jest.mock("~/components/views/SampleView/components/SampleViewHeader", () => ({
  __esModule: true,
  SampleViewHeader: () => <div data-testid="sample-view-header" />,
}));
jest.mock("~/components/views/SampleView/components/TabSwitcher", () => ({
  __esModule: true,
  TabSwitcher: () => <div data-testid="tab-switcher" />,
}));
jest.mock("~/components/views/SampleView/components/ReportPanel", () => ({
  __esModule: true,
  ReportPanel: () => <div data-testid="report-panel" />,
}));
jest.mock(
  "~/components/views/SampleView/components/DetailsSidebarSwitcher",
  () => ({
    __esModule: true,
    DetailsSidebarSwitcher: () => <div data-testid="details-sidebar" />,
  }),
);
jest.mock("~/components/views/SampleView/components/ModalManager", () => ({
  __esModule: true,
  ModalManager: () => <div data-testid="modal-manager" />,
}));
jest.mock("~/components/common/CoverageVizBottomSidebar", () => ({
  __esModule: true,
  default: () => <div data-testid="coverage-viz" />,
}));
jest.mock("~/components/common/CoverageVizBottomSidebar/utils", () => ({
  __esModule: true,
  getCoverageVizParams: jest.fn(() => ({ stubbed: true })),
}));
jest.mock("~/components/layout/NarrowContainer", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => <div>{props.children}</div>,
}));

const NOT_FOUND_COPY =
  "This sample doesn't exist, or you don't have access to it.";

const globalContextValue = {
  globalContextState: {} as $TSFixMe,
  globalContextDispatch: jest.fn(),
};

const renderSampleView = () =>
  render(
    <GlobalContext.Provider value={globalContextValue as $TSFixMe}>
      <SampleView sampleId={278} />
    </GlobalContext.Provider>,
  );

describe("SampleView -- missing / forbidden sample (SMP-1633)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.history.replaceState({}, "", "/");
    localStorage.clear();
    // Silence the intentional boundary console.error + React's own logging.
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    mockLazyLoadImpl = () => ({ SampleForReport: null });
  });

  it("shows the friendly not-found message and does NOT report to Sentry", async () => {
    mockLazyLoadImpl = () => {
      // The real thrown shape from relay/environment.ts for a missing sample:
      // the fatal wrapper carrying the Rails resolver message.
      throw new Error(
        "[GQL fatal] SampleViewSampleQuery returned no data: " +
          '[{"message":"Couldn\'t find Sample with \'id\'=278 [WHERE (1=0)]"}]',
      );
    };

    renderSampleView();

    await waitFor(() => expect(screen.getByText(NOT_FOUND_COPY)).toBeTruthy());
    // The friendly SampleMessage renders, not the generic error fallback.
    expect(screen.getByTestId("sample-message")).toBeTruthy();
    expect(screen.queryByTestId("error-fallback")).toBeNull();
    // A missing/forbidden sample is expected, so it is never sent to Sentry.
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("shows the generic fallback and DOES report a genuine error to Sentry", async () => {
    mockLazyLoadImpl = () => {
      throw new Error("network exploded");
    };

    renderSampleView();

    await waitFor(() =>
      expect(screen.getByTestId("error-fallback")).toBeTruthy(),
    );
    // Not the not-found copy -- this is the real failure experience.
    expect(screen.queryByText(NOT_FOUND_COPY)).toBeNull();
    // Observability preserved for real defects.
    expectSentryCaptureException("network exploded");
  });
});
