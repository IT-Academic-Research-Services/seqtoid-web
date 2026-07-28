// BRANCH coverage: app/assets/src/components/views/PhyloTree/PairwiseDistanceMatrixErrorModal.tsx
//
// The modal has exactly one piece of logic: which of two "your samples were too
// divergent" blurbs it shows. That is driven by `showLowCoverageWarning`, which
// is a defaulted prop -- so three branch outcomes exist (default taken, value
// supplied, and each side of the ternary). The blurb lives inside a collapsed
// AccordionNotification, so the accordion has to be expanded before the text is
// in the DOM at all.
import { fireEvent, render, screen } from "@testing-library/react";
import PairwiseDistanceMatrixErrorModal from "~/components/views/PhyloTree/PairwiseDistanceMatrixErrorModal";

const HEADER = "Sorry, we were unable to compute a phylogenetic tree.";

const LOW_COVERAGE =
  "Your samples were too divergent, possibly due to low coverage. To address this issue, try creating a new tree with samples that have coverage above 25%.";

const DEFAULT_WARNING =
  "Your samples were too divergent. To address this issue, try creating a new tree without the divergent samples.";

// The notification body is only mounted once the accordion is open.
const expandAccordion = () => {
  fireEvent.click(screen.getByText(HEADER));
};

// The warning text and the trailing "Learn more." link are siblings inside one
// fragment, so match on the container's text rather than an exact text node.
const bodyText = () =>
  (document.querySelector(".ui.modal") as HTMLElement).textContent ?? "";

describe("PairwiseDistanceMatrixErrorModal -- warning selection", () => {
  it("shows the plain divergence warning when showLowCoverageWarning is left to its default", () => {
    render(<PairwiseDistanceMatrixErrorModal onContinue={jest.fn()} open />);
    expandAccordion();

    expect(bodyText()).toContain(DEFAULT_WARNING);
    expect(bodyText()).not.toContain("possibly due to low coverage");
  });

  it("shows the plain divergence warning when showLowCoverageWarning is explicitly false", () => {
    render(
      <PairwiseDistanceMatrixErrorModal
        onContinue={jest.fn()}
        open
        showLowCoverageWarning={false}
      />,
    );
    expandAccordion();

    expect(bodyText()).toContain(DEFAULT_WARNING);
  });

  it("swaps in the low-coverage advice when showLowCoverageWarning is true", () => {
    render(
      <PairwiseDistanceMatrixErrorModal
        onContinue={jest.fn()}
        open
        showLowCoverageWarning={true}
      />,
    );
    expandAccordion();

    expect(bodyText()).toContain(LOW_COVERAGE);
    expect(bodyText()).not.toContain(DEFAULT_WARNING);
  });
});

describe("PairwiseDistanceMatrixErrorModal -- chrome", () => {
  it("keeps the warning collapsed until the accordion header is clicked", () => {
    render(<PairwiseDistanceMatrixErrorModal onContinue={jest.fn()} open />);

    expect(screen.getByText(HEADER)).toBeTruthy();
    expect(bodyText()).not.toContain(DEFAULT_WARNING);
  });

  it("always offers the pairwise-distance-matrix explanation and its link", () => {
    render(<PairwiseDistanceMatrixErrorModal onContinue={jest.fn()} open />);

    expect(bodyText()).toContain(
      "Instead, view genomic distances between samples in a pairwise distance matrix",
    );
    expect(document.querySelectorAll(".ui.modal a").length).toBeGreaterThan(0);
  });

  it("calls onContinue when the Continue button is pressed", () => {
    const onContinue = jest.fn();
    render(<PairwiseDistanceMatrixErrorModal onContinue={onContinue} open />);

    fireEvent.click(screen.getByText("Continue"));

    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("renders nothing while open is false", () => {
    render(
      <PairwiseDistanceMatrixErrorModal onContinue={jest.fn()} open={false} />,
    );

    expect(document.querySelector(".ui.modal")).toBeNull();
    expect(screen.queryByText(HEADER)).toBeNull();
  });
});
