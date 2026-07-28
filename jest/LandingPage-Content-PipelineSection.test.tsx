// Coverage: app/assets/src/components/views/LandingPage/components/Content/components/PipelineSection.tsx
// Three pipeline rows behave as a mutually-exclusive accordion driven by three
// independent booleans plus a separate `imageSelected` index for the desktop
// image stack. The interesting branches are: clicking an already-open row (the
// "if (!accordionNOpen)" guard is skipped), clicking a closed row (siblings get
// closed), and the keyboard path, which duplicates the whole click body.
import { fireEvent, render, screen } from "@testing-library/react";
import PipelineSection from "~/components/views/LandingPage/components/Content/components/PipelineSection";

// jest.config.js only maps css/scss; stub the raw .png imports.
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

// The last three <img> elements are the desktop image stack.
const desktopImageOpacities = (container: HTMLElement) => {
  const imgs = Array.from(container.querySelectorAll("img"));
  return imgs.slice(-3).map(img => (img as HTMLImageElement).style.opacity);
};

// Each accordion row contains exactly one inline image whose opacity tracks the
// row's open state.
const rowImageOpacities = (container: HTMLElement) =>
  rows(container).map(
    row => (row.querySelector("img") as HTMLImageElement).style.opacity,
  );

describe("PipelineSection", () => {
  it("renders the heading and one row per pipeline with its copy and table rows", () => {
    render(<PipelineSection />);
    expect(screen.getByText("Fast Pipelines, No-Code Platform")).toBeTruthy();
    expect(screen.getByText("Metagenomic Pipeline")).toBeTruthy();
    expect(screen.getByText("Antimicrobial Resistance Pipeline")).toBeTruthy();
    expect(screen.getByText("Viral Consensus Genome Pipeline")).toBeTruthy();

    // "Sequencing Platform:" is a shared table-row title used by all three rows.
    expect(screen.getAllByText("Sequencing Platform:")).toHaveLength(3);
    // Only the metagenomic pipeline advertises a Nanopore runtime.
    expect(screen.getAllByText("Nanopore Average Runtime:")).toHaveLength(1);
    expect(screen.getByText("26 mins")).toBeTruthy();
  });

  it("opens the first accordion by default and shows only its image", () => {
    const { container } = render(<PipelineSection />);
    expect(rowImageOpacities(container)).toEqual(["1", "0", "0"]);
    expect(desktopImageOpacities(container)).toEqual(["1", "0", "0"]);
  });

  it("clicking the second row opens it and closes the others", () => {
    const { container } = render(<PipelineSection />);
    fireEvent.click(rows(container)[1]);
    expect(rowImageOpacities(container)).toEqual(["0", "1", "0"]);
    expect(desktopImageOpacities(container)).toEqual(["0", "1", "0"]);
  });

  it("clicking the third row opens it and closes the others", () => {
    const { container } = render(<PipelineSection />);
    fireEvent.click(rows(container)[2]);
    expect(rowImageOpacities(container)).toEqual(["0", "0", "1"]);
    expect(desktopImageOpacities(container)).toEqual(["0", "0", "1"]);
  });

  it("clicking the already-open row is a no-op (it stays open, siblings stay closed)", () => {
    const { container } = render(<PipelineSection />);
    fireEvent.click(rows(container)[0]);
    expect(rowImageOpacities(container)).toEqual(["1", "0", "0"]);
    expect(desktopImageOpacities(container)).toEqual(["1", "0", "0"]);
  });

  it("re-clicking a row that was just opened keeps it open", () => {
    const { container } = render(<PipelineSection />);
    fireEvent.click(rows(container)[2]);
    fireEvent.click(rows(container)[2]);
    expect(rowImageOpacities(container)).toEqual(["0", "0", "1"]);
  });

  it("opens rows via the Enter key and ignores other keys", () => {
    const { container } = render(<PipelineSection />);

    fireEvent.keyDown(rows(container)[1], { key: " " });
    expect(rowImageOpacities(container)).toEqual(["1", "0", "0"]);

    fireEvent.keyDown(rows(container)[1], { key: "Enter" });
    expect(rowImageOpacities(container)).toEqual(["0", "1", "0"]);

    fireEvent.keyDown(rows(container)[2], { key: "Enter" });
    expect(rowImageOpacities(container)).toEqual(["0", "0", "1"]);

    fireEvent.keyDown(rows(container)[0], { key: "Enter" });
    expect(rowImageOpacities(container)).toEqual(["1", "0", "0"]);
  });

  it("shows a minus icon on the open row and plus icons on the closed rows", () => {
    const { container } = render(<PipelineSection />);
    // MinusIcon has a single <path>; PlusIcon has two.
    const accordionIconPaths = () =>
      rows(container).map(row => {
        const svgs = Array.from(row.querySelectorAll("svg"));
        // The accordion indicator is the last svg in the row's title container.
        const indicator = svgs[svgs.length - 1];
        return indicator.querySelectorAll("path").length;
      });

    expect(accordionIconPaths()).toEqual([1, 2, 2]);
    fireEvent.click(rows(container)[1]);
    expect(accordionIconPaths()).toEqual([2, 1, 2]);
  });
});
