// Coverage: app/assets/src/components/common/DetailsSidebar/TaxonDetailsMode/
//           TaxonLinks/TaxonLinks.tsx
//
// TaxonLinks builds four external links from a switch over a `source` string.
// The tests assert the exact href each case produces (NCBI, Google, Pubmed,
// Wikipedia), drive both sides of the `wikiUrl &&` guard that decides whether
// the Wikipedia entry is rendered at all, and assert the analytics payload that
// the shared Link component fires on click.
import { fireEvent, render, screen } from "@testing-library/react";

const mockTrackEvent = jest.fn();

jest.mock("~/api/analytics", () => ({
  useTrackEvent: () => mockTrackEvent,
}));

// jest.config resolves the webpack "~ui" alias before its blanket scss ->
// styleMock rule, so the Link stylesheet has to be stubbed explicitly.
jest.mock("~ui/controls/link.scss", () => ({}), { virtual: true });

import { TaxonLinks } from "~/components/common/DetailsSidebar/TaxonDetailsMode/TaxonLinks/TaxonLinks";

const baseProps = {
  taxonId: 573,
  taxonName: "Klebsiella pneumoniae",
  parentTaxonId: 570,
  wikiUrl: "https://en.wikipedia.org/wiki/Klebsiella_pneumoniae",
};

const renderLinks = (props: Record<string, unknown> = {}) =>
  render(<TaxonLinks {...baseProps} {...(props as $TSFixMe)} />);

// The shared Link component does not forward arbitrary DOM props, so the
// component's data-testid never reaches the anchor -- count anchors instead.
const anchors = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("a"));

const hrefFor = (label: string) =>
  screen.getByText(label).closest("a")?.getAttribute("href");

describe("TaxonLinks rendering", () => {
  beforeEach(() => jest.clearAllMocks());

  it("renders the Links heading and all four sources when a wiki url exists", () => {
    const { container } = renderLinks();
    expect(screen.getByText("Links")).toBeTruthy();
    expect(anchors(container)).toHaveLength(4);
    expect(screen.getByText("NCBI")).toBeTruthy();
    expect(screen.getByText("Google")).toBeTruthy();
    expect(screen.getByText("Wikipedia")).toBeTruthy();
    expect(screen.getByText("Pubmed")).toBeTruthy();
  });

  it("builds the NCBI taxonomy browser url from the taxon id", () => {
    renderLinks();
    expect(hrefFor("NCBI")).toBe(
      "https://www.ncbi.nlm.nih.gov/Taxonomy/Browser/wwwtax.cgi?mode=Info&id=573",
    );
  });

  it("builds the Google and Pubmed urls from the taxon name", () => {
    renderLinks();
    expect(hrefFor("Google")).toBe(
      "http://www.google.com/search?q=Klebsiella pneumoniae",
    );
    expect(hrefFor("Pubmed")).toBe(
      "https://www.ncbi.nlm.nih.gov/pubmed/?term=Klebsiella pneumoniae",
    );
  });

  it("uses the supplied wikiUrl verbatim for the Wikipedia link", () => {
    renderLinks();
    expect(hrefFor("Wikipedia")).toBe(baseProps.wikiUrl);
  });

  it("opens every link in a new tab", () => {
    const { container } = renderLinks();
    const links = anchors(container);
    expect(links).toHaveLength(4);
    links.forEach(link => {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    });
  });
});

describe("TaxonLinks wikiUrl guard", () => {
  beforeEach(() => jest.clearAllMocks());

  it("omits the Wikipedia entry when wikiUrl is an empty string", () => {
    const { container } = renderLinks({ wikiUrl: "" });
    expect(screen.queryByText("Wikipedia")).toBeNull();
    expect(anchors(container)).toHaveLength(3);
    // The other three sources are unaffected.
    expect(screen.getByText("Pubmed")).toBeTruthy();
  });

  it("omits the Wikipedia entry when wikiUrl is null", () => {
    const { container } = renderLinks({ wikiUrl: null });
    expect(screen.queryByText("Wikipedia")).toBeNull();
    expect(anchors(container)).toHaveLength(3);
  });
});

describe("TaxonLinks analytics", () => {
  beforeEach(() => jest.clearAllMocks());

  it("reports the source, url and taxon ids when a link is clicked", () => {
    renderLinks();
    fireEvent.click(screen.getByText("NCBI"));

    expect(mockTrackEvent).toHaveBeenCalledTimes(1);
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "TaxonDetailsMode_external-link_clicked",
      {
        source: "ncbi",
        url: "https://www.ncbi.nlm.nih.gov/Taxonomy/Browser/wwwtax.cgi?mode=Info&id=573",
        taxonId: 573,
        taxonName: "Klebsiella pneumoniae",
        parentTaxonId: 570,
      },
    );
  });

  it("reports the wikipedia source with the wiki url", () => {
    renderLinks();
    fireEvent.click(screen.getByText("Wikipedia"));
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "TaxonDetailsMode_external-link_clicked",
      expect.objectContaining({ source: "wikipedia", url: baseProps.wikiUrl }),
    );
  });
});
