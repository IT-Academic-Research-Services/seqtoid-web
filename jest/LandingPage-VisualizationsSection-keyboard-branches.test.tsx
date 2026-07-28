// BRANCH coverage: app/assets/src/components/views/LandingPage/components/Content/components/VisualizationsSection.tsx
//
// Every one of the eight selector tiles (four desktop, four mobile) carries its
// own inline `onKeyDown` handler with an `if (e.key === "Enter")` guard. The
// companion suite only exercises two of them, so the remaining six guards had
// neither outcome taken. Each tile is driven here with a non-Enter key (which
// must change nothing) and then with Enter (which must select that section).
import { fireEvent, render } from "@testing-library/react";
import VisualizationsSection from "~/components/views/LandingPage/components/Content/components/VisualizationsSection";

jest.mock(
  "~/images/landing_page/cov-visualization.png",
  () => "cov-visualization.png",
);
jest.mock("~/images/landing_page/heatmap.png", () => "heatmap.png");
jest.mock("~/images/landing_page/phylotree.png", () => "phylotree.png");
jest.mock(
  "~/images/landing_page/taxonomic-tree.png",
  () => "taxonomic-tree.png",
);

// Eight <img> elements: the four desktop previews followed by the four mobile
// accordion previews. Exactly one of each group is opaque at a time.
const opacities = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("img")).map(
    img => (img as HTMLImageElement).style.opacity,
  );

const desktopItems = (container: HTMLElement) =>
  Array.from(
    container
      .querySelectorAll("section > div")[0]
      .querySelectorAll('[role="button"]'),
  );

const mobileItems = (container: HTMLElement) =>
  Array.from(
    container
      .querySelectorAll("section > div")[1]
      .querySelectorAll('[role="button"]'),
  );

// Section index -> the expected opacity pair (desktop image, mobile image).
const expectSelected = (container: HTMLElement, index: number) => {
  const values = opacities(container);
  expect(values.slice(0, 4)).toEqual(
    ["0", "0", "0", "0"].map((_, i) => (i === index ? "1" : "0")),
  );
  expect(values.slice(4)).toEqual(
    ["0", "0", "0", "0"].map((_, i) => (i === index ? "1" : "0")),
  );
};

describe("VisualizationsSection -- desktop tile keyboard guards", () => {
  it.each([
    ["Coverage Visualization", 1],
    ["Taxonomic Tree", 2],
  ])("selects %s on Enter and ignores other keys", (_label, index) => {
    const { container } = render(<VisualizationsSection />);
    const tile = desktopItems(container)[index];

    fireEvent.keyDown(tile, { key: "Tab" });
    expectSelected(container, 0);

    fireEvent.keyDown(tile, { key: "Enter" });
    expectSelected(container, index);
  });

  it("re-selects the heatmap tile from the keyboard", () => {
    const { container } = render(<VisualizationsSection />);
    // Move off the heatmap first so the Enter press has something to undo.
    fireEvent.click(desktopItems(container)[3]);
    expectSelected(container, 3);

    fireEvent.keyDown(desktopItems(container)[0], { key: "ArrowDown" });
    expectSelected(container, 3);

    fireEvent.keyDown(desktopItems(container)[0], { key: "Enter" });
    expectSelected(container, 0);
  });
});

describe("VisualizationsSection -- mobile accordion keyboard guards", () => {
  it.each([
    ["Coverage Visualization", 1],
    ["Phylogenetic Tree", 3],
  ])("opens %s on Enter and ignores other keys", (_label, index) => {
    const { container } = render(<VisualizationsSection />);
    const row = mobileItems(container)[index];

    fireEvent.keyDown(row, { key: "Shift" });
    expectSelected(container, 0);

    fireEvent.keyDown(row, { key: "Enter" });
    expectSelected(container, index);
  });

  it("re-opens the heatmap row from the keyboard", () => {
    const { container } = render(<VisualizationsSection />);
    fireEvent.click(mobileItems(container)[2]);
    expectSelected(container, 2);

    fireEvent.keyDown(mobileItems(container)[0], { key: " " });
    expectSelected(container, 2);

    fireEvent.keyDown(mobileItems(container)[0], { key: "Enter" });
    expectSelected(container, 0);
  });
});
