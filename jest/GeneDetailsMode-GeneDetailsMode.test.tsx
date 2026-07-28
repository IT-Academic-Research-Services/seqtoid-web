// Coverage: app/assets/src/components/common/DetailsSidebar/GeneDetailsMode/GeneDetailsMode.tsx
//
// GeneDetailsMode fetches CARD ontology for a gene and has three distinct
// render states driven by two pieces of state: the loading placeholder, the
// "ontology found" branch (renders the Ontology block) and the "not found"
// branch (falls back to a CARD search prompt). It also refetches whenever the
// geneName prop changes. Only the network call (`~/api/amr`) is stubbed; the
// Ontology / FooterLinks subtrees render for real so the branch assertions are
// about real output.
import { render, screen, waitFor } from "@testing-library/react";

const mockGetOntology = jest.fn();
jest.mock("~/api/amr", () => ({
  __esModule: true,
  getOntology: (...args: $TSFixMe[]) => mockGetOntology(...args),
}));

import GeneDetailsMode from "~/components/common/DetailsSidebar/GeneDetailsMode/GeneDetailsMode";

const foundOntology = {
  accession: "ARO:3000123",
  label: "tetA",
  synonyms: ["tetA(A)", "tet-A"],
  description: "Tetracycline efflux pump.",
  geneFamily: [
    { label: "major facilitator superfamily", description: "MFS family" },
  ],
  error: "",
  dnaAccession: "NC_000001",
  proteinAccession: "WP_000001",
};

const missingOntology = {
  accession: "",
  label: "",
  synonyms: [],
  description: "",
  geneFamily: [],
  error: "No data for gene",
};

beforeEach(() => {
  mockGetOntology.mockReset();
});

describe("GeneDetailsMode", () => {
  it("shows the loading message until the ontology request settles", async () => {
    let resolveFn: $TSFixMe;
    mockGetOntology.mockReturnValue(
      new Promise(resolve => {
        resolveFn = resolve;
      }),
    );

    render(<GeneDetailsMode geneName="tetA" />);
    expect(screen.getByText("Loading...")).toBeTruthy();
    // Title is not rendered while loading.
    expect(screen.queryByText("Tetracycline efflux pump.")).toBeNull();

    resolveFn(missingOntology);
    await waitFor(() => expect(screen.queryByText("Loading...")).toBeNull());
  });

  it("renders the ontology block when the lookup succeeds (error === '')", async () => {
    mockGetOntology.mockResolvedValue(foundOntology);

    render(<GeneDetailsMode geneName="tetA" />);

    await waitFor(() =>
      expect(screen.getByText("Tetracycline efflux pump.")).toBeTruthy(),
    );
    // Ontology-only content: synonyms and the gene family section.
    expect(screen.getByText(/tetA\(A\), tet-A/)).toBeTruthy();
    expect(screen.getByText("AMR Gene Family")).toBeTruthy();
    // The not-found fallback copy is absent on this branch.
    expect(screen.queryByText(/Learn more about/)).toBeNull();
    // Quick Links footer renders on both branches.
    expect(screen.getByText("Quick Links")).toBeTruthy();
    expect(mockGetOntology).toHaveBeenCalledWith("tetA");
  });

  it("falls back to the CARD search prompt when the lookup reports an error", async () => {
    mockGetOntology.mockResolvedValue(missingOntology);

    render(<GeneDetailsMode geneName="mysteryGene" />);

    await waitFor(() =>
      expect(screen.getByText(/Learn more about/)).toBeTruthy(),
    );
    expect(screen.getByText("CARD").getAttribute("href")).toBe(
      "https://card.mcmaster.ca/browse",
    );
    // No ontology description/gene-family block on this branch.
    expect(screen.queryByText("AMR Gene Family")).toBeNull();
    expect(screen.getByText("Quick Links")).toBeTruthy();
  });

  it("omits the synonym line when the ontology has no synonyms", async () => {
    mockGetOntology.mockResolvedValue({
      ...foundOntology,
      synonyms: [],
      geneFamily: [],
    });

    render(<GeneDetailsMode geneName="tetA" />);

    await waitFor(() =>
      expect(screen.getByText("Tetracycline efflux pump.")).toBeTruthy(),
    );
    expect(screen.queryByText(/Synonym\(s\)/)).toBeNull();
    expect(screen.queryByText("AMR Gene Family")).toBeNull();
  });

  it("refetches and re-renders when the geneName prop changes", async () => {
    mockGetOntology.mockResolvedValueOnce(foundOntology);
    const { rerender } = render(<GeneDetailsMode geneName="tetA" />);
    await waitFor(() =>
      expect(screen.getByText("Tetracycline efflux pump.")).toBeTruthy(),
    );

    mockGetOntology.mockResolvedValueOnce({
      ...missingOntology,
      error: "not found",
    });
    rerender(<GeneDetailsMode geneName="blaKPC" />);

    await waitFor(() =>
      expect(screen.getByText(/Learn more about/)).toBeTruthy(),
    );
    expect(mockGetOntology).toHaveBeenCalledTimes(2);
    expect(mockGetOntology).toHaveBeenLastCalledWith("blaKPC");
  });
});
