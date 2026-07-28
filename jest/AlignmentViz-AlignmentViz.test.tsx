// Frontend coverage:
// app/assets/src/components/views/AlignmentViz/AlignmentViz.tsx
//
// AlignmentViz is a class component that, on mount, fetches alignment data and
// sample metadata in parallel, then renders one of three states:
//   1. loading  -> "Loading alignment data ..."
//   2. array    -> "<N> unique accessions" + one AccessionViz per item
//   3. error    -> the error message string
// The tests below mock ~/api and ~/api/metadata to drive each state and to hit
// both sides of the assembly-feature Popup branch. AccessionViz and the
// pipeline-feature helper are stubbed so the assertions target AlignmentViz.
import { render, screen, waitFor } from "@testing-library/react";
import { getAlignmentData } from "~/api";
import { getSampleMetadata } from "~/api/metadata";
import { isPipelineFeatureAvailable } from "~/components/utils/pipeline_versions";
import { AlignmentViz } from "~/components/views/AlignmentViz/AlignmentViz";

jest.mock("~/api", () => ({
  getAlignmentData: jest.fn(),
}));

jest.mock("~/api/metadata", () => ({
  getSampleMetadata: jest.fn(),
}));

jest.mock("~/components/utils/pipeline_versions", () => ({
  ASSEMBLY_FEATURE: "assembly",
  isPipelineFeatureAvailable: jest.fn(() => false),
}));

// Stub AccessionViz -- it has its own suite and pulls in the analytics hook.
jest.mock("~/components/views/AlignmentViz/components/AccessionViz", () => ({
  AccessionViz: ({ accession }: { accession?: string }) => (
    <div data-testid="accession-viz">{accession}</div>
  ),
}));

const mockGetAlignmentData = getAlignmentData as jest.MockedFunction<
  typeof getAlignmentData
>;
const mockGetSampleMetadata = getSampleMetadata as jest.MockedFunction<
  typeof getSampleMetadata
>;
const mockIsPipelineFeatureAvailable =
  isPipelineFeatureAvailable as jest.MockedFunction<
    typeof isPipelineFeatureAvailable
  >;

const metadataWith = (pipelineVersion: string | null) =>
  ({
    additional_info: {
      pipeline_run: pipelineVersion
        ? { pipeline_version: pipelineVersion }
        : null,
    },
  } as $TSFixMe);

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSampleMetadata.mockResolvedValue(metadataWith("3.0"));
  mockIsPipelineFeatureAvailable.mockReturnValue(false);
});

describe("AlignmentViz", () => {
  it("shows the loading heading before the data resolves", () => {
    // Never resolves during this synchronous render.
    mockGetAlignmentData.mockReturnValue(new Promise(() => undefined));
    render(
      <AlignmentViz
        sampleId={7}
        taxName="Escherichia coli"
        taxLevel="species"
      />,
    );
    expect(screen.getByText(/Loading alignment data/).textContent).toContain(
      "Escherichia coli",
    );
    expect(screen.getByText(/Loading alignment data/).textContent).toContain(
      "species",
    );
  });

  it("renders one AccessionViz per accession with the unique count", async () => {
    mockGetAlignmentData.mockResolvedValue([
      { accession: "ACC1" },
      { accession: "ACC2" },
    ] as $TSFixMe);
    render(<AlignmentViz sampleId={7} taxName="E. coli" taxLevel="species" />);
    await waitFor(() =>
      expect(screen.getAllByTestId("accession-viz")).toHaveLength(2),
    );
    expect(screen.getByText(/unique accessions/).textContent).toContain(
      "2 unique accessions",
    );
    // Passes the sample id (as a string) into getAlignmentData.
    expect(mockGetAlignmentData).toHaveBeenCalledWith(
      "7",
      undefined,
      undefined,
    );
  });

  it("omits the taxon prefix when no taxName is provided", async () => {
    mockGetAlignmentData.mockResolvedValue([] as $TSFixMe);
    render(<AlignmentViz sampleId={1} />);
    await waitFor(() =>
      expect(screen.getByText(/unique accessions/)).toBeTruthy(),
    );
    // 0 accessions and no taxon name prefix.
    expect(screen.getByText(/unique accessions/).textContent).toContain(
      "0 unique accessions",
    );
    expect(screen.queryAllByTestId("accession-viz")).toHaveLength(0);
  });

  it("shows the assembly warning icon when the feature is available", async () => {
    mockGetAlignmentData.mockResolvedValue([{ accession: "ACC1" }] as $TSFixMe);
    mockIsPipelineFeatureAvailable.mockReturnValue(true);
    const { container } = render(
      <AlignmentViz sampleId={2} taxName="Org" taxLevel="genus" />,
    );
    await waitFor(() =>
      expect(screen.getByText(/unique accessions/)).toBeTruthy(),
    );
    // The warning Popup renders a fa-exclamation-circle trigger icon.
    expect(container.querySelector(".fa-exclamation-circle")).toBeTruthy();
    expect(mockIsPipelineFeatureAvailable).toHaveBeenCalledWith(
      "assembly",
      "3.0",
    );
  });

  it("does not show the assembly warning when the feature is unavailable", async () => {
    mockGetAlignmentData.mockResolvedValue([{ accession: "ACC1" }] as $TSFixMe);
    mockIsPipelineFeatureAvailable.mockReturnValue(false);
    const { container } = render(
      <AlignmentViz sampleId={2} taxName="Org" taxLevel="genus" />,
    );
    await waitFor(() =>
      expect(screen.getByText(/unique accessions/)).toBeTruthy(),
    );
    expect(container.querySelector(".fa-exclamation-circle")).toBeNull();
  });

  it("does not evaluate the assembly feature when there is no pipeline run", async () => {
    mockGetAlignmentData.mockResolvedValue([{ accession: "ACC1" }] as $TSFixMe);
    mockGetSampleMetadata.mockResolvedValue(metadataWith(null));
    const { container } = render(
      <AlignmentViz sampleId={2} taxName="Org" taxLevel="genus" />,
    );
    await waitFor(() =>
      expect(screen.getByText(/unique accessions/)).toBeTruthy(),
    );
    // pipelineRun is null, so the feature check short-circuits and no icon.
    expect(container.querySelector(".fa-exclamation-circle")).toBeNull();
    expect(mockIsPipelineFeatureAvailable).not.toHaveBeenCalled();
  });

  it("renders the error message when alignment data resolves to an error", async () => {
    mockGetAlignmentData.mockResolvedValue({
      error: "No alignment for this taxon",
    } as $TSFixMe);
    render(<AlignmentViz sampleId={3} taxName="Org" taxLevel="species" />);
    await waitFor(() =>
      expect(screen.getByText("No alignment for this taxon")).toBeTruthy(),
    );
    expect(screen.queryByText(/unique accessions/)).toBeNull();
  });
});
