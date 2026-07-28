// Coverage: .../ReportTable/components/columns/components/GenusLevelPreview/
//   components/PathogenPreview/PathogenPreview.tsx
//
// PathogenPreview shows one coloured dot plus a count per pathogen tag, wrapped
// in a hover popup that links to the pathogen list. Its two decisions are the
// early "no tags at all -> render nothing" return and the per-tag "count > 0"
// guard, which silently drops tags whose count is zero.
import { fireEvent, render, screen } from "@testing-library/react";
import { PathogenPreview } from "~/components/views/SampleView/components/MngsReport/components/ReportTable/components/columns/components/GenusLevelPreview/components/PathogenPreview/PathogenPreview";

const renderPreview = (tag2Count: $TSFixMe) =>
  render(<PathogenPreview tag2Count={tag2Count} />);

describe("PathogenPreview empty branch", () => {
  it("renders nothing when there are no tags", () => {
    const { container } = renderPreview({});
    expect(container.innerHTML).toBe("");
    expect(container.querySelector(".pathogen-preview")).toBeNull();
  });
});

describe("PathogenPreview populated branch", () => {
  it("renders the tag count inside the preview container", () => {
    const { container } = renderPreview({ knownPathogen: 12 });
    const preview = container.querySelector(".pathogen-preview");
    expect(preview).not.toBeNull();
    expect(screen.getByText("12")).toBeTruthy();
    expect(container.querySelectorAll(".pathogen-count")).toHaveLength(1);
  });

  it("renders a circular label coloured from the pathogen category", () => {
    const { container } = renderPreview({ knownPathogen: 1 });
    // CATEGORIES.knownPathogen maps to semantic-ui's "red" label colour.
    expect(container.querySelector(".ui.red.circular.label")).not.toBeNull();
  });

  it("keeps the container but drops tags whose count is zero", () => {
    const { container } = renderPreview({ knownPathogen: 0 });
    // The early return only fires on zero *tags*; a zero count still renders
    // the (now empty) preview span.
    expect(container.querySelector(".pathogen-preview")).not.toBeNull();
    expect(container.querySelectorAll(".pathogen-count")).toHaveLength(0);
  });

  it("shows the pathogen-list disclaimer when the preview is hovered", async () => {
    const { container } = renderPreview({ knownPathogen: 3 });
    fireEvent.mouseEnter(
      container.querySelector(".pathogen-preview") as HTMLElement,
    );
    expect(
      await screen.findByText(/cross-reference the literature/),
    ).toBeTruthy();
    expect(
      screen
        .getByText(/current pathogen list/)
        .closest("a")
        ?.getAttribute("href"),
    ).toBe("/pathogen_list");
  });
});
