// Frontend coverage / SMP-1815 regression: opening the report-table annotation
// menu must fire its analytics events through trackEvent (event name first,
// flat payload second). The bug this guards against called withAnalytics --
// which expects a handler FUNCTION as its first arg and RETURNS a wrapper -- so
// passing the event-name string tripped the "Missing event handler function"
// guard in withAnalytics and no event was ever sent. These tests assert the
// menu-opened events are tracked with the right names and context, and that no
// "Missing event handler" error is logged.
import { fireEvent, render, screen } from "@testing-library/react";

const mockTrackEvent = jest.fn();

jest.mock("~/api/analytics", () => ({
  ...jest.requireActual("~/api/analytics"),
  useTrackEvent: () => mockTrackEvent,
}));

jest.mock("~/api/blast", () => ({
  createAnnotation: jest.fn().mockResolvedValue({}),
}));

// Stub the SDS Menu/MenuItem so the test renders without the full popover.
jest.mock("@czi-sds/components", () => ({
  __esModule: true,
  // Render menu contents only when open, mirroring the real popover -- so the
  // trigger label is the only AnnotationLabel present before the menu opens.
  Menu: (props: $TSFixMe) =>
    props.open ? <div data-testid="menu">{props.children}</div> : null,
  MenuItem: (props: $TSFixMe) => (
    <div onClick={props.onClick}>{props.children}</div>
  ),
}));

// AnnotationLabel forwards its onClick; render it as a button so we can click.
jest.mock("~/components/ui/labels/AnnotationLabel", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => (
    <button data-testid="annotation-label" onClick={props.onClick} />
  ),
}));

import { ANALYTICS_EVENT_NAMES } from "~/api/analytics";
import { AnnotationMenu } from "~/components/views/SampleView/components/MngsReport/components/ReportTable/components/columns/components/AnnotationMenu/AnnotationMenu";

const analyticsContext = {
  projectId: 7,
  sampleId: 99,
  taxId: 573,
  taxLevel: 1,
  taxName: "Klebsiella pneumoniae",
};

const renderMenu = (overrides: $TSFixMe = {}) =>
  render(
    <AnnotationMenu
      onAnnotationUpdate={jest.fn()}
      pipelineRunId={123}
      taxonId={573}
      currentLabelType="none"
      analyticsContext={analyticsContext}
      {...overrides}
    />,
  );

describe("AnnotationMenu analytics (SMP-1815)", () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {
      // swallow -- asserted on below
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("tracks both menu-opened events with the flat analytics context on open", () => {
    renderMenu();

    fireEvent.click(screen.getByTestId("annotation-label"));

    expect(mockTrackEvent).toHaveBeenCalledWith(
      ANALYTICS_EVENT_NAMES.REPORT_TABLE_ANNOTATION_MENU_OPENED,
      { ...analyticsContext },
    );
    expect(mockTrackEvent).toHaveBeenCalledWith(
      ANALYTICS_EVENT_NAMES.REPORT_TABLE_ANNOTATION_MENU_OPENED_ALLISON_TESTING,
      { ...analyticsContext },
    );
    expect(mockTrackEvent).toHaveBeenCalledTimes(2);
  });

  it("passes the event NAME (a string) as the first trackEvent arg, not a handler", () => {
    renderMenu();

    fireEvent.click(screen.getByTestId("annotation-label"));

    mockTrackEvent.mock.calls.forEach(([eventName]) => {
      expect(typeof eventName).toBe("string");
    });
  });

  it("does not log a 'Missing event handler' error when the menu opens", () => {
    renderMenu();

    fireEvent.click(screen.getByTestId("annotation-label"));

    const loggedMissingHandler = consoleErrorSpy.mock.calls.some(args =>
      String(args[0]).includes("Missing event handler"),
    );
    expect(loggedMissingHandler).toBe(false);
  });
});
