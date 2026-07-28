// Coverage:
// app/assets/src/components/common/DetailsSidebar/TaxonDetailsMode/TaxonDetailsMode.tsx
//
// TaxonDetailsMode fetches taxon (and optional parent) descriptions on mount,
// shows a Loading placeholder until the request settles, then lays out the
// title, an optional Taxonomy ID line (taxonId > 0), and four child panels.
// The children are stubbed so the assertions land on this container's own
// branches: loading vs loaded, with vs without a parent taxon, the taxonId
// guard, and the catch path when the API rejects.
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { getTaxonDescriptions } from "~/api";
import { TaxonDetailsMode } from "~/components/common/DetailsSidebar/TaxonDetailsMode/TaxonDetailsMode";

const _React: typeof React = React;

jest.mock("~/api", () => ({
  getTaxonDescriptions: jest.fn(),
}));

// Stub the four child panels: this suite only exercises the container.
jest.mock(
  "~/components/common/DetailsSidebar/TaxonDetailsMode/TaxonDescription",
  () => ({
    TaxonDescription: ({ subtitle, description }: $TSFixMe) => (
      <div data-testid="taxon-description">
        {subtitle}|{description}
      </div>
    ),
  }),
);
jest.mock(
  "~/components/common/DetailsSidebar/TaxonDetailsMode/TaxonHistogram",
  () => ({
    TaxonHistogram: () => <div data-testid="taxon-histogram" />,
  }),
);
jest.mock(
  "~/components/common/DetailsSidebar/TaxonDetailsMode/TaxonLinks",
  () => ({
    TaxonLinks: ({ taxonName }: $TSFixMe) => (
      <div data-testid="taxon-links">{taxonName}</div>
    ),
  }),
);

const mockedGet = getTaxonDescriptions as jest.MockedFunction<
  typeof getTaxonDescriptions
>;

const baseProps = {
  background: null,
  taxonId: 562,
  taxonName: "Escherichia coli",
};

describe("TaxonDetailsMode", () => {
  beforeEach(() => jest.clearAllMocks());

  it("shows the Loading placeholder before the request resolves", () => {
    // A never-resolving promise keeps isLoading true.
    mockedGet.mockReturnValue(new Promise(() => undefined) as $TSFixMe);
    render(<TaxonDetailsMode {...baseProps} />);
    expect(screen.getByText("Loading...")).toBeTruthy();
  });

  it("renders the title, taxonomy id and children once loaded", async () => {
    mockedGet.mockResolvedValue({
      562: {
        title: "Escherichia coli",
        summary: "A rod-shaped bacterium.",
        wiki_url: "https://en.wikipedia.org/wiki/Escherichia_coli",
      },
    } as $TSFixMe);

    render(<TaxonDetailsMode {...baseProps} />);

    await waitFor(() => expect(screen.getByTestId("taxon-name")).toBeTruthy());
    expect(screen.getByTestId("taxon-name").textContent).toBe(
      "Escherichia coli",
    );
    // taxonId > 0 -> Taxonomy ID line renders.
    expect(screen.getByTestId("taxon-id").textContent).toContain("562");
    // The first TaxonDescription receives the fetched summary.
    expect(screen.getAllByTestId("taxon-description")[0].textContent).toContain(
      "A rod-shaped bacterium.",
    );
    expect(mockedGet).toHaveBeenCalledWith([562]);
  });

  it("omits the Taxonomy ID line for non-positive taxon ids", async () => {
    mockedGet.mockResolvedValue({} as $TSFixMe);
    render(<TaxonDetailsMode {...baseProps} taxonId={-100} />);
    await waitFor(() => expect(screen.getByTestId("taxon-name")).toBeTruthy());
    expect(screen.queryByTestId("taxon-id")).toBeNull();
  });

  it("requests the parent taxon and passes its name through when present", async () => {
    mockedGet.mockResolvedValue({
      562: { title: "Escherichia coli", summary: "child", wiki_url: "u" },
      561: { title: "Escherichia", summary: "the genus", wiki_url: "p" },
    } as $TSFixMe);

    render(<TaxonDetailsMode {...baseProps} parentTaxonId={561} />);

    await waitFor(() => expect(screen.getByTestId("taxon-name")).toBeTruthy());
    // Both taxa were requested together.
    expect(mockedGet).toHaveBeenCalledWith([562, 561]);
    // The genus subtitle picks up the parent title.
    const descriptions = screen.getAllByTestId("taxon-description");
    expect(descriptions[1].textContent).toContain("Genus: Escherichia");
    expect(descriptions[1].textContent).toContain("the genus");
  });

  it("still renders (and logs) when the API rejects", async () => {
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockedGet.mockRejectedValue(new Error("network down"));

    render(<TaxonDetailsMode {...baseProps} />);

    // The catch path swallows the error and clears loading, so the title shows.
    await waitFor(() => expect(screen.getByTestId("taxon-name")).toBeTruthy());
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
