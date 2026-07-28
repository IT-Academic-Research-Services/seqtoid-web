// Coverage: app/assets/src/components/views/LandingPage/components/Content/components/Accordion.tsx
// Five FAQ rows behave as a single-open accordion driven by an `openAccordion`
// index. Each row gets its own click closure (clickHandler(0..4)), and a
// useEffect reaches into the DOM to collapse every panel and then expand the
// open one -- so the effect body runs again on every selection change.
import { fireEvent, render, screen } from "@testing-library/react";
import Accordion from "~/components/views/LandingPage/components/Content/components/Accordion";

const rows = (container: HTMLElement) =>
  Array.from(container.querySelectorAll(".accordionItem")) as HTMLElement[];

const panelHeights = (container: HTMLElement) =>
  rows(container).map(row => (row.children[2] as HTMLElement).style.maxHeight);

// MinusIcon (open) draws one <path>; PlusIcon (closed) draws two.
const iconPaths = (container: HTMLElement) =>
  rows(container).map(row => row.querySelectorAll("svg path").length);

describe("Accordion", () => {
  it("renders all five FAQ questions and their answers", () => {
    render(<Accordion />);
    expect(screen.getByText("How much data can I upload?")).toBeTruthy();
    expect(screen.getByText("Will SeqtoID remain free to use?")).toBeTruthy();
    expect(
      screen.getByText("Will my raw data ever become public?"),
    ).toBeTruthy();
    expect(
      screen.getByText("How is human genomic data protected?"),
    ).toBeTruthy();
    expect(screen.getByText("Will my account last indefinitely?")).toBeTruthy();

    expect(
      screen.getByText(
        "There is no limit on the amount of data that you can upload to SeqtoID.",
      ),
    ).toBeTruthy();
  });

  it("opens the first row by default and leaves the rest closed", () => {
    const { container } = render(<Accordion />);
    expect(rows(container)).toHaveLength(5);
    expect(iconPaths(container)).toEqual([1, 2, 2, 2, 2]);
  });

  it("expands only the open panel and collapses the others", () => {
    const { container } = render(<Accordion />);
    // jsdom reports scrollHeight 0, so the open panel is explicitly sized while
    // the closed ones are reset to the empty string by `maxHeight = null`.
    expect(panelHeights(container)).toEqual(["0px", "", "", "", ""]);

    fireEvent.click(rows(container)[3]);
    expect(panelHeights(container)).toEqual(["", "", "", "0px", ""]);
  });

  it("moves the open state to whichever row is clicked", () => {
    const { container } = render(<Accordion />);

    fireEvent.click(rows(container)[2]);
    expect(iconPaths(container)).toEqual([2, 2, 1, 2, 2]);

    fireEvent.click(rows(container)[4]);
    expect(iconPaths(container)).toEqual([2, 2, 2, 2, 1]);

    fireEvent.click(rows(container)[1]);
    expect(iconPaths(container)).toEqual([2, 1, 2, 2, 2]);
  });

  it("keeps a row open when it is clicked again", () => {
    const { container } = render(<Accordion />);
    fireEvent.click(rows(container)[0]);
    expect(iconPaths(container)).toEqual([1, 2, 2, 2, 2]);
    expect(panelHeights(container)).toEqual(["0px", "", "", "", ""]);
  });

  it("also toggles from the keyboard (onKeyDown mirrors onClick)", () => {
    const { container } = render(<Accordion />);
    fireEvent.keyDown(rows(container)[3], { key: "Enter" });
    expect(iconPaths(container)).toEqual([2, 2, 2, 1, 2]);
  });

  it("links the privacy, terms and contact resources from the answer copy", () => {
    const { container } = render(<Accordion />);
    const hrefs = Array.from(container.querySelectorAll("a")).map(a =>
      a.getAttribute("href"),
    );
    expect(hrefs.filter(h => h === "/privacy")).toHaveLength(2);
    expect(hrefs).toContain("/terms");
    // The contact link is external and must open safely in a new tab.
    const contact = Array.from(container.querySelectorAll("a")).find(
      a => a.textContent === "contacting our team",
    ) as HTMLAnchorElement;
    expect(contact.target).toBe("_blank");
    expect(contact.rel).toBe("noopener noreferrer");
  });
});
