// Coverage for
// app/assets/src/components/views/SampleView/components/MngsReport/components/
//   ReportTable/components/columns/components/AnnotationMenu/AnnotationMenu.tsx
//
// AnnotationMenu is the per-row "annotate this taxon" affordance: an
// AnnotationLabel trigger that anchors an SDS Menu with four choices (Hit /
// Not a hit / Inconclusive / None). Its behaviour is (a) the open/closed
// branch driven by anchorEl, (b) the analytics calls fired on open and on
// selection, and (c) the createAnnotation POST -- where "None" is deliberately
// sent as null -- followed by the onAnnotationUpdate callback once the promise
// settles. All four items and both anchorEl states are exercised.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockWithAnalytics = jest.fn();
const mockTrackEvent = jest.fn();
jest.mock("~/api/analytics", () => ({
  ...jest.requireActual("~/api/analytics"),
  useWithAnalytics: () => mockWithAnalytics,
  useTrackEvent: () => mockTrackEvent,
}));

const mockCreateAnnotation = jest.fn();
jest.mock("~/api/blast", () => ({
  createAnnotation: (...args: unknown[]) => mockCreateAnnotation(...args),
}));

// The real label renders SDS tooltips/icons; here it just needs to be a
// clickable trigger whose `type` and static/tooltip flags are observable.
jest.mock("~/components/ui/labels/AnnotationLabel", () => ({
  __esModule: true,
  default: ({ type, onClick, isStatic, hideTooltip }: $TSFixMe) =>
    onClick ? (
      <button
        data-testid="annotation-trigger"
        data-type={String(type)}
        onClick={onClick}
      >
        trigger
      </button>
    ) : (
      <span
        data-testid={`annotation-label-${String(type)}`}
        data-static={String(isStatic)}
        data-hide-tooltip={String(hideTooltip)}
      />
    ),
}));

// Minimal stand-ins for the SDS popover so `open` is directly observable and
// the items are reachable without a real portal/anchor.
jest.mock("@czi-sds/components", () => ({
  __esModule: true,
  Menu: ({ open, children, onClose }: $TSFixMe) => (
    <div data-testid="menu" data-open={String(open)}>
      <button data-testid="menu-backdrop" onClick={onClose}>
        close
      </button>
      {children}
    </div>
  ),
  MenuItem: ({ children, onClick }: $TSFixMe) => (
    <button className="menu-item" onClick={onClick}>
      {children}
    </button>
  ),
}));

import { AnnotationMenu } from "~/components/views/SampleView/components/MngsReport/components/ReportTable/components/columns/components/AnnotationMenu/AnnotationMenu";

const ANALYTICS_CONTEXT = { sampleId: 7, taxonName: "Klebsiella" };

const renderMenu = (overrides: $TSFixMe = {}) => {
  const props = {
    onAnnotationUpdate: jest.fn(),
    pipelineRunId: 123,
    taxonId: 573,
    currentLabelType: "none",
    analyticsContext: ANALYTICS_CONTEXT,
    ...overrides,
  };
  render(<AnnotationMenu {...props} />);
  return props;
};

const itemByText = (text: string) =>
  screen
    .getAllByRole("button")
    .find(el => el.className === "menu-item" && el.textContent === text)!;

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateAnnotation.mockResolvedValue({});
});

describe("AnnotationMenu -- open/close", () => {
  it("starts closed, with the trigger reflecting the current annotation", () => {
    renderMenu({ currentLabelType: "hit" });
    expect(screen.getByTestId("menu").getAttribute("data-open")).toBe("false");
    expect(
      screen.getByTestId("annotation-trigger").getAttribute("data-type"),
    ).toBe("hit");
  });

  it("passes an undefined label type straight through when the row is unannotated", () => {
    renderMenu({ currentLabelType: undefined });
    expect(
      screen.getByTestId("annotation-trigger").getAttribute("data-type"),
    ).toBe("undefined");
  });

  it("opens on trigger click and closes again via onClose", () => {
    renderMenu();
    fireEvent.click(screen.getByTestId("annotation-trigger"));
    expect(screen.getByTestId("menu").getAttribute("data-open")).toBe("true");

    fireEvent.click(screen.getByTestId("menu-backdrop"));
    expect(screen.getByTestId("menu").getAttribute("data-open")).toBe("false");
  });

  it("fires both menu-opened analytics events with the row context", () => {
    renderMenu();
    fireEvent.click(screen.getByTestId("annotation-trigger"));

    expect(mockWithAnalytics).toHaveBeenCalledTimes(2);
    expect(mockWithAnalytics.mock.calls[0][1]).toBe(ANALYTICS_CONTEXT);
    // The second call stringifies the same context.
    expect(mockWithAnalytics.mock.calls[1][1]).toBe(
      JSON.stringify(ANALYTICS_CONTEXT),
    );
    expect(mockWithAnalytics.mock.calls[0][0]).not.toBe(
      mockWithAnalytics.mock.calls[1][0],
    );
  });
});

describe("AnnotationMenu -- items", () => {
  it("renders the four annotation choices, each with a static tooltip-free label", () => {
    renderMenu();
    const items = screen
      .getAllByRole("button")
      .filter(el => el.className === "menu-item");
    expect(items.map(el => el.textContent)).toEqual([
      "Hit",
      "Not a hit",
      "Inconclusive",
      "None",
    ]);

    const hitLabel = screen.getByTestId("annotation-label-hit");
    expect(hitLabel.getAttribute("data-static")).toBe("true");
    expect(hitLabel.getAttribute("data-hide-tooltip")).toBe("true");
    expect(screen.getByTestId("annotation-label-not_a_hit")).toBeTruthy();
    expect(screen.getByTestId("annotation-label-inconclusive")).toBeTruthy();
    expect(screen.getByTestId("annotation-label-none")).toBeTruthy();
  });
});

describe("AnnotationMenu -- selection", () => {
  it.each([
    ["Hit", "hit"],
    ["Not a hit", "not_a_hit"],
    ["Inconclusive", "inconclusive"],
  ])("posts %s as %s and refreshes the row", async (label, annotationType) => {
    const { onAnnotationUpdate } = renderMenu();
    fireEvent.click(screen.getByTestId("annotation-trigger"));
    fireEvent.click(itemByText(label));

    expect(mockCreateAnnotation).toHaveBeenCalledWith({
      pipelineRunId: 123,
      taxId: 573,
      annotationType,
    });
    // Optimistic update: the callback receives the taxon id and chosen type so
    // the caller can patch just that row instead of refetching (SMP-1605).
    await waitFor(() =>
      expect(onAnnotationUpdate).toHaveBeenCalledWith(573, annotationType),
    );
    expect(onAnnotationUpdate).toHaveBeenCalledTimes(1);
  });

  it("posts the None choice as null rather than the string 'none'", async () => {
    const { onAnnotationUpdate } = renderMenu();
    fireEvent.click(screen.getByTestId("annotation-trigger"));
    fireEvent.click(itemByText("None"));

    expect(mockCreateAnnotation).toHaveBeenCalledWith({
      pipelineRunId: 123,
      taxId: 573,
      annotationType: null,
    });
    // "None" forwards a null type so the caller can clear the taxon's label.
    await waitFor(() =>
      expect(onAnnotationUpdate).toHaveBeenCalledWith(573, null),
    );
  });

  it("closes the menu after a choice is made", () => {
    renderMenu();
    fireEvent.click(screen.getByTestId("annotation-trigger"));
    expect(screen.getByTestId("menu").getAttribute("data-open")).toBe("true");

    fireEvent.click(itemByText("Hit"));
    expect(screen.getByTestId("menu").getAttribute("data-open")).toBe("false");
  });

  it("tracks the selection with the row context plus the chosen type", () => {
    renderMenu();
    fireEvent.click(screen.getByTestId("annotation-trigger"));
    fireEvent.click(itemByText("Inconclusive"));

    expect(mockTrackEvent).toHaveBeenCalledTimes(1);
    expect(mockTrackEvent.mock.calls[0][1]).toEqual({
      ...ANALYTICS_CONTEXT,
      annotationType: "inconclusive",
    });
  });

  it("still fires without an analytics context and forwards a null pipelineRunId", () => {
    renderMenu({ analyticsContext: undefined, pipelineRunId: null });
    fireEvent.click(screen.getByTestId("annotation-trigger"));
    fireEvent.click(itemByText("Hit"));

    expect(mockCreateAnnotation).toHaveBeenCalledWith({
      pipelineRunId: null,
      taxId: 573,
      annotationType: "hit",
    });
    expect(mockTrackEvent.mock.calls[0][1]).toEqual({
      annotationType: "hit",
    });
  });

  it("does not call onAnnotationUpdate before the request resolves", () => {
    let resolveRequest: (v?: unknown) => void = () => undefined;
    mockCreateAnnotation.mockReturnValue(
      new Promise(resolve => {
        resolveRequest = resolve;
      }),
    );
    const { onAnnotationUpdate } = renderMenu();
    fireEvent.click(screen.getByTestId("annotation-trigger"));
    fireEvent.click(itemByText("Hit"));

    expect(onAnnotationUpdate).not.toHaveBeenCalled();
    resolveRequest();
  });
});
