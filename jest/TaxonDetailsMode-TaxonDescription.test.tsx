// Coverage:
// app/assets/src/components/common/DetailsSidebar/TaxonDetailsMode/TaxonDescription/TaxonDescription.tsx
//
// TaxonDescription renders a collapsible blurb. Its branch weight is: the
// early `!description` null-return, the isTall detection (clientHeight >
// COLLAPSED_HEIGHT) that decides whether the "Show More" button appears, and
// the withAnalytics-wrapped click that flips shouldCollapse off. jsdom reports
// clientHeight 0 by default, so the tall path is forced by overriding the
// prototype getter for the tall-case test.
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { TaxonDescription } from "~/components/common/DetailsSidebar/TaxonDetailsMode/TaxonDescription/TaxonDescription";

const _React: typeof React = React;

// useWithAnalytics returns a wrapper that, in prod, fires analytics then calls
// the handler. The identity mock keeps the handler callable in the test.
jest.mock("~/api/analytics", () => ({
  useWithAnalytics: () => (fn: $TSFixMe) => fn,
}));

// WikipediaLicense is a presentational leaf we do not want to pull in here.
jest.mock(
  "~/components/common/DetailsSidebar/TaxonDetailsMode/WikipediaLicense",
  () => ({
    WikipediaLicense: ({ taxonName }: $TSFixMe) => (
      <span data-testid="wiki-license">{taxonName}</span>
    ),
  }),
);

const baseProps = {
  subtitle: "Description",
  description: "A short blurb about the taxon.",
  name: "E. coli",
  wikiUrl: "https://en.wikipedia.org/wiki/E._coli",
  onExpandAnalyticsId: "TaxonDetailsMode_show-more-description-link_clicked",
  onExpandAnalyticsParams: {
    taxonId: 1,
    taxonName: "E. coli",
    parentTaxonId: 2,
  },
};

describe("TaxonDescription", () => {
  it("renders nothing when there is no description", () => {
    const { container } = render(
      <TaxonDescription {...baseProps} description="" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the subtitle, description and wiki license when short", () => {
    render(<TaxonDescription {...baseProps} />);
    expect(screen.getByText("Description")).toBeTruthy();
    expect(
      screen.getByText("A short blurb about the taxon.", { exact: false }),
    ).toBeTruthy();
    expect(screen.getByTestId("wiki-license").textContent).toBe("E. coli");
    // Short content -> isTall stays false -> no Show More button.
    expect(screen.queryByText("Show More")).toBeNull();
  });

  it("shows Show More for tall content and collapses on click", () => {
    // Force the collapsed-height overflow so isTall becomes true.
    const spy = jest
      .spyOn(HTMLElement.prototype, "clientHeight", "get")
      .mockReturnValue(400);

    render(<TaxonDescription {...baseProps} />);

    const button = screen.getByText("Show More");
    expect(button).toBeTruthy();

    // Clicking runs the withAnalytics-wrapped handler -> shouldCollapse=false,
    // which removes the button (shouldCollapse && isTall no longer both true).
    fireEvent.click(button);
    expect(screen.queryByText("Show More")).toBeNull();

    spy.mockRestore();
  });
});
