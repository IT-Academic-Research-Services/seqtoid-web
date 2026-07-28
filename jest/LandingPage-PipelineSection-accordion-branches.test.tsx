// BRANCH coverage: app/assets/src/components/views/LandingPage/components/Content/components/PipelineSection.tsx
//
// Each accordion row's click handler (and its duplicated keydown twin) has two
// nested guards per row: "if (!accordionNOpen)" -- only close the siblings when
// this row was not already open -- and "if (imageSelected !== N)" -- only swap
// the desktop image when it is not already showing. The companion suite reaches
// one side of each; this suite drives the other by re-activating a row that is
// already open, and by re-opening row 0 after leaving it.
import { fireEvent, render } from "@testing-library/react";
import PipelineSection from "~/components/views/LandingPage/components/Content/components/PipelineSection";

jest.mock(
  "~/images/landing_page/pipeline-antimicrobial-img.png",
  () => "pipeline-antimicrobial-img.png",
);
jest.mock(
  "~/images/landing_page/pipeline-metagenomic-img.png",
  () => "pipeline-metagenomic-img.png",
);
jest.mock(
  "~/images/landing_page/pipeline-viral-img.png",
  () => "pipeline-viral-img.png",
);

const rows = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[role="button"]')) as HTMLElement[];

// The last three <img> elements are the desktop image stack driven by
// `imageSelected`; each row also carries one inline image tracking its own
// open state. The two must stay in lockstep.
const desktopImageOpacities = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("img"))
    .slice(-3)
    .map(img => (img as HTMLImageElement).style.opacity);

const rowImageOpacities = (container: HTMLElement) =>
  rows(container).map(
    row => (row.querySelector("img") as HTMLImageElement).style.opacity,
  );

const expectOpen = (container: HTMLElement, index: number) => {
  const expected = ["0", "0", "0"].map((_, i) => (i === index ? "1" : "0"));
  expect(rowImageOpacities(container)).toEqual(expected);
  expect(desktopImageOpacities(container)).toEqual(expected);
};

describe("PipelineSection -- click guards", () => {
  it("re-opens the first row after another row took over", () => {
    const { container } = render(<PipelineSection />);
    // Row 0 starts open; move to row 1 so row 0's "was it already open?" guard
    // takes its other branch on the way back.
    fireEvent.click(rows(container)[1]);
    expectOpen(container, 1);

    fireEvent.click(rows(container)[0]);
    expectOpen(container, 0);
  });

  it("clicking the second row twice leaves it open without re-selecting the image", () => {
    const { container } = render(<PipelineSection />);
    fireEvent.click(rows(container)[1]);
    expectOpen(container, 1);

    // Second click: accordion2Open is already true and imageSelected is already
    // 1, so both inner guards are skipped and nothing moves.
    fireEvent.click(rows(container)[1]);
    expectOpen(container, 1);
  });
});

describe("PipelineSection -- keyboard guards", () => {
  it("pressing Enter on the already-open first row changes nothing", () => {
    const { container } = render(<PipelineSection />);
    expectOpen(container, 0);

    fireEvent.keyDown(rows(container)[0], { key: "Enter" });

    expectOpen(container, 0);
  });

  it("pressing Enter twice on the second row leaves it open", () => {
    const { container } = render(<PipelineSection />);
    fireEvent.keyDown(rows(container)[1], { key: "Enter" });
    expectOpen(container, 1);

    fireEvent.keyDown(rows(container)[1], { key: "Enter" });
    expectOpen(container, 1);
  });

  it("pressing Enter twice on the third row leaves it open", () => {
    const { container } = render(<PipelineSection />);
    fireEvent.keyDown(rows(container)[2], { key: "Enter" });
    expectOpen(container, 2);

    fireEvent.keyDown(rows(container)[2], { key: "Enter" });
    expectOpen(container, 2);
  });
});
