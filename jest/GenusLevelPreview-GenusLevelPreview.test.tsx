// Coverage: app/assets/src/components/views/SampleView/components/MngsReport/
//   components/ReportTable/components/columns/components/GenusLevelPreview/
//   GenusLevelPreview.tsx
//
// GenusLevelPreview is the little suffix rendered after a genus name in the
// mNGS report table. It makes three decisions: whether the row carries any
// non-zero species annotation counts, whether the row carries pathogen tags,
// and -- derived from those two -- whether a colon separator is needed at all.
// The two child previews are stubbed so each decision can be observed directly
// instead of through their rendered markup.
import { render, screen } from "@testing-library/react";

// This scss is imported via a "~/"-prefixed path, which the jest alias resolves
// before the css/scss style mock, so it must be stubbed explicitly.
jest.mock(
  "~/components/views/SampleView/components/MngsReport/components/ReportTable/report_table.scss",
  () => ({}),
);

jest.mock(
  "~/components/views/SampleView/components/MngsReport/components/ReportTable/components/columns/components/GenusLevelPreview/components/AnnotationPreview",
  () => ({
    AnnotationPreview: (props: $TSFixMe) => (
      <span data-testid="annotation-preview">
        {JSON.stringify(props.tag2Count)}
      </span>
    ),
  }),
);

jest.mock(
  "~/components/views/SampleView/components/MngsReport/components/ReportTable/components/columns/components/GenusLevelPreview/components/PathogenPreview",
  () => ({
    PathogenPreview: (props: $TSFixMe) => (
      <span data-testid="pathogen-preview">
        {JSON.stringify(props.tag2Count)}
      </span>
    ),
  }),
);

import { GenusLevelPreview } from "~/components/views/SampleView/components/MngsReport/components/ReportTable/components/columns/components/GenusLevelPreview/GenusLevelPreview";

const renderPreview = (rowData: $TSFixMe) =>
  render(<GenusLevelPreview rowData={rowData} />);

const hasColon = (container: HTMLElement) =>
  container.textContent?.startsWith(":") ?? false;

describe("GenusLevelPreview with no annotations and no pathogens", () => {
  it("renders nothing at all when the row has neither key", () => {
    const { container } = renderPreview({ taxId: 1 });
    expect(screen.queryByTestId("annotation-preview")).toBeNull();
    expect(screen.queryByTestId("pathogen-preview")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("omits the colon when pathogens is an empty object", () => {
    const { container } = renderPreview({ pathogens: {} });
    expect(hasColon(container)).toBe(false);
    expect(screen.queryByTestId("pathogen-preview")).toBeNull();
  });

  it("omits the previews when every annotation count is zero", () => {
    const { container } = renderPreview({
      species_annotations: { hit: 0, not_a_hit: 0, inconclusive: 0 },
    });
    expect(screen.queryByTestId("annotation-preview")).toBeNull();
    expect(hasColon(container)).toBe(false);
  });
});

describe("GenusLevelPreview annotation branch", () => {
  it("shows the annotation preview when only the hit count is non-zero", () => {
    const { container } = renderPreview({
      species_annotations: { hit: 2, not_a_hit: 0, inconclusive: 0 },
    });
    expect(screen.getByTestId("annotation-preview").textContent).toContain(
      '"hit":2',
    );
    expect(hasColon(container)).toBe(true);
  });

  it("shows the annotation preview when only the not-a-hit count is non-zero", () => {
    renderPreview({
      species_annotations: { hit: 0, not_a_hit: 5, inconclusive: 0 },
    });
    expect(screen.getByTestId("annotation-preview").textContent).toContain(
      '"not_a_hit":5',
    );
  });

  it("shows the annotation preview when only the inconclusive count is non-zero", () => {
    renderPreview({
      species_annotations: { hit: 0, not_a_hit: 0, inconclusive: 1 },
    });
    expect(screen.getByTestId("annotation-preview")).toBeTruthy();
  });

  it("passes the whole species_annotations object through untouched", () => {
    renderPreview({
      species_annotations: { hit: 1, not_a_hit: 2, inconclusive: 3 },
    });
    expect(
      JSON.parse(screen.getByTestId("annotation-preview").textContent ?? "{}"),
    ).toEqual({ hit: 1, not_a_hit: 2, inconclusive: 3 });
  });
});

describe("GenusLevelPreview pathogen branch", () => {
  it("shows only the pathogen preview when there are no annotations", () => {
    const { container } = renderPreview({ pathogens: { knownPathogen: 3 } });
    expect(screen.getByTestId("pathogen-preview").textContent).toContain(
      '"knownPathogen":3',
    );
    expect(screen.queryByTestId("annotation-preview")).toBeNull();
    expect(hasColon(container)).toBe(true);
  });

  it("shows both previews, pathogens first, when both are present", () => {
    const { container } = renderPreview({
      pathogens: { knownPathogen: 1 },
      species_annotations: { hit: 4, not_a_hit: 0, inconclusive: 0 },
    });
    const rendered = Array.from(
      container.querySelectorAll("[data-testid]"),
    ).map(el => el.getAttribute("data-testid"));
    expect(rendered).toEqual(["pathogen-preview", "annotation-preview"]);
    expect(hasColon(container)).toBe(true);
  });
});
