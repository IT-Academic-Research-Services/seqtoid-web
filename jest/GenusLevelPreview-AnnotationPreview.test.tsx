// Coverage: .../ReportTable/components/columns/components/GenusLevelPreview/
//   components/AnnotationPreview/AnnotationPreview.tsx
//
// AnnotationPreview renders up to three static annotation flags (hit /
// not-a-hit / inconclusive) with their counts, each guarded by an independent
// "count > 0" test. AnnotationLabel is stubbed so the flag type and the static
// flag are observable without pulling in the SDS icon set and the popup portal.
import { render, screen } from "@testing-library/react";

jest.mock("~/components/ui/labels/AnnotationLabel", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => (
    <span data-testid={`label-${props.type}`}>{String(props.isStatic)}</span>
  ),
}));

import { AnnotationPreview } from "~/components/views/SampleView/components/MngsReport/components/ReportTable/components/columns/components/GenusLevelPreview/components/AnnotationPreview/AnnotationPreview";

const renderPreview = (tag2Count: $TSFixMe) =>
  render(<AnnotationPreview tag2Count={tag2Count} />);

describe("AnnotationPreview with no counts to show", () => {
  it("renders no flags when every count is zero", () => {
    const { container } = renderPreview({
      hit: 0,
      not_a_hit: 0,
      inconclusive: 0,
    });
    expect(container.querySelectorAll("[data-testid]")).toHaveLength(0);
    expect(container.textContent).toBe("");
  });

  it("renders no flags when the counts object is empty", () => {
    const { container } = renderPreview({});
    expect(container.querySelectorAll("[data-testid]")).toHaveLength(0);
  });
});

describe("AnnotationPreview per-annotation branches", () => {
  it("renders only the hit flag and its count", () => {
    renderPreview({ hit: 7, not_a_hit: 0, inconclusive: 0 });
    expect(screen.getByTestId("label-hit")).toBeTruthy();
    expect(screen.queryByTestId("label-not_a_hit")).toBeNull();
    expect(screen.queryByTestId("label-inconclusive")).toBeNull();
    expect(screen.getByText("7")).toBeTruthy();
  });

  it("renders only the not-a-hit flag and its count", () => {
    renderPreview({ hit: 0, not_a_hit: 2, inconclusive: 0 });
    expect(screen.getByTestId("label-not_a_hit")).toBeTruthy();
    expect(screen.queryByTestId("label-hit")).toBeNull();
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("renders only the inconclusive flag and its count", () => {
    renderPreview({ hit: 0, not_a_hit: 0, inconclusive: 4 });
    expect(screen.getByTestId("label-inconclusive")).toBeTruthy();
    expect(screen.queryByTestId("label-not_a_hit")).toBeNull();
    expect(screen.getByText("4")).toBeTruthy();
  });

  it("renders all three flags in hit / not-a-hit / inconclusive order", () => {
    const { container } = renderPreview({
      hit: 1,
      not_a_hit: 2,
      inconclusive: 3,
    });
    const ids = Array.from(container.querySelectorAll("[data-testid]")).map(
      el => el.getAttribute("data-testid"),
    );
    expect(ids).toEqual(["label-hit", "label-not_a_hit", "label-inconclusive"]);
  });

  it("always marks the flags as static previews", () => {
    renderPreview({ hit: 1, not_a_hit: 1, inconclusive: 1 });
    expect(screen.getByTestId("label-hit").textContent).toBe("true");
    expect(screen.getByTestId("label-not_a_hit").textContent).toBe("true");
    expect(screen.getByTestId("label-inconclusive").textContent).toBe("true");
  });
});
