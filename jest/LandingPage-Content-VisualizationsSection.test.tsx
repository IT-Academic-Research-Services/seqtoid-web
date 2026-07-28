// Coverage: app/assets/src/components/views/LandingPage/components/Content/components/VisualizationsSection.tsx
// The section is a controlled image switcher: exactly one of four preview
// images is opaque at a time, the desktop selector row and the mobile accordion
// both drive the same `selectedSection` state, and the container's border
// radius is computed from which section is active. Both mouse and keyboard
// (Enter vs any other key) paths are exercised.
import { fireEvent, render, screen } from "@testing-library/react";
import VisualizationsSection from "~/components/views/LandingPage/components/Content/components/VisualizationsSection";

// jest.config.js only maps css/scss to a stub, so raw .png imports would be
// parsed as JavaScript. Stub each one with its filename (jest.mock is hoisted
// above the component import).
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

const opacities = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("img")).map(
    img => (img as HTMLImageElement).style.opacity,
  );

// The four desktop selector tiles, in DOM order, are the first four
// role=button elements inside the desktop block.
const desktopItems = (container: HTMLElement) => {
  const desktop = container.querySelectorAll("section > div")[0];
  return Array.from(desktop.querySelectorAll('[role="button"]'));
};

const mobileItems = (container: HTMLElement) => {
  const mobile = container.querySelectorAll("section > div")[1];
  return Array.from(mobile.querySelectorAll('[role="button"]'));
};

describe("VisualizationsSection", () => {
  it("renders the heading and all four visualization titles twice (desktop + mobile)", () => {
    render(<VisualizationsSection />);
    expect(
      screen.getByText("Powerful, Customizable Data Visualizations"),
    ).toBeTruthy();
    // Each title appears once in the desktop selector and once in the mobile
    // accordion.
    expect(screen.getAllByText("Heatmap")).toHaveLength(2);
    expect(screen.getAllByText("Coverage Visualization")).toHaveLength(2);
    expect(screen.getAllByText("Taxonomic Tree")).toHaveLength(2);
    expect(screen.getAllByText("Phylogenetic Tree")).toHaveLength(2);
  });

  it("defaults to the heatmap: only the first desktop and first mobile image are opaque", () => {
    const { container } = render(<VisualizationsSection />);
    // 4 desktop images followed by 4 mobile images.
    expect(opacities(container)).toEqual([
      "1",
      "0",
      "0",
      "0",
      "1",
      "0",
      "0",
      "0",
    ]);
  });

  it("clicking a desktop selector switches which image is opaque", () => {
    const { container } = render(<VisualizationsSection />);
    fireEvent.click(desktopItems(container)[2]); // Taxonomic Tree
    expect(opacities(container)).toEqual([
      "0",
      "0",
      "1",
      "0",
      "0",
      "0",
      "1",
      "0",
    ]);
  });

  it("responds to Enter on a desktop selector but ignores other keys", () => {
    const { container } = render(<VisualizationsSection />);
    const phylo = desktopItems(container)[3];

    fireEvent.keyDown(phylo, { key: "Escape" });
    expect(opacities(container)[0]).toBe("1"); // still heatmap

    fireEvent.keyDown(phylo, { key: "Enter" });
    expect(opacities(container)).toEqual([
      "0",
      "0",
      "0",
      "1",
      "0",
      "0",
      "0",
      "1",
    ]);
  });

  it("computes the wrapper border radius from the active section", () => {
    const { container } = render(<VisualizationsSection />);
    const wrapper = container.querySelector(
      "section > div > div",
    ) as HTMLElement;

    // Heatmap (first) -> square top-left corner tail.
    expect(wrapper.style.borderRadius).toBe("5px 5px 5px 0px");

    // Phylogenetic tree (last) -> mirrored radius.
    fireEvent.click(desktopItems(container)[3]);
    expect(wrapper.style.borderRadius).toBe("5px 5px 0px 5px");

    // Anything in between -> uniform radius.
    fireEvent.click(desktopItems(container)[1]);
    expect(wrapper.style.borderRadius).toBe("5px");
  });

  it("swaps the mobile accordion icon between minus (open) and plus (closed)", () => {
    const { container } = render(<VisualizationsSection />);
    const items = mobileItems(container);

    // The open item shows the filled MinusIcon (a single <path>), closed items
    // show the PlusIcon (two <path> elements).
    const pathCount = (el: Element) => el.querySelectorAll("svg > path").length;
    expect(pathCount(items[0])).toBe(1);
    expect(pathCount(items[1])).toBe(2);

    fireEvent.click(items[1]);
    expect(pathCount(items[0])).toBe(2);
    expect(pathCount(items[1])).toBe(1);
  });

  it("responds to Enter on a mobile accordion row but ignores other keys", () => {
    const { container } = render(<VisualizationsSection />);
    const items = mobileItems(container);

    fireEvent.keyDown(items[2], { key: "a" });
    expect(opacities(container)[4]).toBe("1"); // mobile heatmap still open

    fireEvent.keyDown(items[2], { key: "Enter" });
    expect(opacities(container)[4]).toBe("0");
    expect(opacities(container)[6]).toBe("1");
  });
});
