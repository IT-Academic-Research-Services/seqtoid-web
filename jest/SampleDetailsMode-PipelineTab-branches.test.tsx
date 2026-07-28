// Coverage: app/assets/src/components/common/DetailsSidebar/SampleDetailsMode/
//           components/PipelineTab/PipelineTab.tsx
//
// Companion to SampleDetailsMode-PipelineTab.test.tsx, aimed at the branches
// that file does not reach: the read-dedup special case (and its pipeline
// version guard), the sequencing-technology switch's default arm, the
// empty-results early return in getReadCounts, the two `readsPresent()` false
// paths, the ERCC loading/plot arms, and the pipeline-info section toggle.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockGetSamplePipelineResults = jest.fn();

jest.mock("react-relay", () => ({
  // The real hook reads the Relay store; here the "key" already IS the data.
  useFragment: (_fragment: unknown, key: unknown) => key,
}));

jest.mock("~/api", () => ({
  getSamplePipelineResults: (...args: unknown[]) =>
    mockGetSamplePipelineResults(...args),
}));

// The scatter plot is a d3 visualization; stub it so the ERCC branch can be
// asserted without dragging the chart into this suite.
jest.mock(
  "~/components/common/DetailsSidebar/SampleDetailsMode/components/PipelineTab/components/ERCCScatterPlot",
  () => {
    const ReactLib = require("react");
    return {
      ERCCScatterPlot: (props: Record<string, $TSFixMe>) =>
        ReactLib.createElement(
          "div",
          { "data-testid": "ercc-plot" },
          String((props.erccComparison as unknown[]).length),
        ),
    };
  },
);

import { PipelineTab } from "~/components/common/DetailsSidebar/SampleDetailsMode/components/PipelineTab/PipelineTab";

const makeData = (overrides: Record<string, $TSFixMe> = {}) => ({
  pipeline_run: {
    total_reads: 1000,
    technology: "Illumina",
    sample_id: 7,
    pipeline_version: "8.0",
    version: { pipeline: "8.0", alignment_db: "2024-02-06" },
    ...(overrides.pipeline_run || {}),
  },
  summary_stats: overrides.summary_stats ?? {},
  ercc_comparison: overrides.ercc_comparison ?? null,
});

const renderTab = (props: Record<string, unknown> = {}) =>
  render(
    <PipelineTab
      sampleId={7}
      pipelineTabFragmentKey={makeData() as $TSFixMe}
      {...(props as $TSFixMe)}
    />,
  );

const hostFilteringResults = (steps: Record<string, $TSFixMe>) => ({
  displayedData: {
    "Host Filtering": {
      stageDescription: "Filters out host reads.",
      steps,
    },
  },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSamplePipelineResults.mockResolvedValue(null);
});

describe("PipelineTab read-dedup special case", () => {
  const dedupSteps = {
    validateInput: { name: "Validate Input", readsAfter: 1000 },
    fastp: { name: "Fastp", readsAfter: 800 },
    czid_dedup_out: { name: "CZID Dedup", readsAfter: 400 },
  };

  it("reports the previous step's count plus a unique-read annotation for pipeline >= 4.0.0", async () => {
    mockGetSamplePipelineResults.mockResolvedValue(
      hostFilteringResults(dedupSteps),
    );
    renderTab();
    await waitFor(() =>
      expect(mockGetSamplePipelineResults).toHaveBeenCalled(),
    );
    fireEvent.click(screen.getByTestId("reads-remaining-header"));

    await waitFor(() => expect(screen.getByText("CZID Dedup")).toBeTruthy());
    // The dedup row borrows Fastp's 800 as its displayed count...
    expect(screen.getByText("(400 unique)")).toBeTruthy();
    expect(screen.getAllByText("800")).toHaveLength(2);
    // ...so it reads 80%, not 40%.
    expect(screen.getAllByText("80.00%")).toHaveLength(2);
    expect(screen.queryByText("40.00%")).toBeNull();
  });

  it("leaves the dedup row alone for pipeline versions before 4.0.0", async () => {
    mockGetSamplePipelineResults.mockResolvedValue(
      hostFilteringResults(dedupSteps),
    );
    renderTab({
      pipelineTabFragmentKey: makeData({
        pipeline_run: { pipeline_version: "3.9.0" },
      }) as $TSFixMe,
    });
    await waitFor(() =>
      expect(mockGetSamplePipelineResults).toHaveBeenCalled(),
    );
    fireEvent.click(screen.getByTestId("reads-remaining-header"));

    await waitFor(() => expect(screen.getByText("CZID Dedup")).toBeTruthy());
    expect(screen.queryByText("(400 unique)")).toBeNull();
    expect(screen.getByText("400")).toBeTruthy();
    expect(screen.getByText("40.00%")).toBeTruthy();
  });

  it("leaves a non-dedup step alone even on a modern pipeline", async () => {
    mockGetSamplePipelineResults.mockResolvedValue(
      hostFilteringResults({
        validateInput: { name: "Validate Input", readsAfter: 1000 },
        fastp: { name: "Fastp", readsAfter: 800 },
      }),
    );
    renderTab();
    await waitFor(() =>
      expect(mockGetSamplePipelineResults).toHaveBeenCalled(),
    );
    fireEvent.click(screen.getByTestId("reads-remaining-header"));

    await waitFor(() => expect(screen.getByText("Fastp")).toBeTruthy());
    expect(screen.queryByText(/unique/)).toBeNull();
    expect(screen.getByText("80.00%")).toBeTruthy();
  });
});

describe("PipelineTab sequencing-technology switch", () => {
  it("uses total_bases for a Nanopore run", async () => {
    mockGetSamplePipelineResults.mockResolvedValue(
      hostFilteringResults({
        validateInput: { name: "Validate Input", readsAfter: 250 },
      }),
    );
    renderTab({
      pipelineTabFragmentKey: makeData({
        pipeline_run: { technology: "ONT", total_reads: 1, total_bases: 1000 },
      }) as $TSFixMe,
    });
    await waitFor(() =>
      expect(mockGetSamplePipelineResults).toHaveBeenCalled(),
    );
    fireEvent.click(screen.getByTestId("bases-remaining-header"));

    // 250 / total_bases(1000) == 25%, i.e. total_reads was NOT the denominator.
    await waitFor(() => expect(screen.getByText("25.00%")).toBeTruthy());
  });

  it("has no denominator at all for an unrecognised technology", async () => {
    mockGetSamplePipelineResults.mockResolvedValue(
      hostFilteringResults({
        validateInput: { name: "Validate Input", readsAfter: 250 },
      }),
    );
    renderTab({
      pipelineTabFragmentKey: makeData({
        pipeline_run: { technology: "PacBio", total_reads: 1000 },
      }) as $TSFixMe,
    });
    await waitFor(() =>
      expect(mockGetSamplePipelineResults).toHaveBeenCalled(),
    );
    fireEvent.click(screen.getByTestId("reads-remaining-header"));

    await waitFor(() => expect(screen.getByText("250")).toBeTruthy());
    // The switch's default arm returns undefined, so the percentage is NaN.
    expect(screen.getByText("NaN%")).toBeTruthy();
  });
});

describe("PipelineTab reads-remaining empty states", () => {
  it("stays in the loading state when the results folder has no stages", async () => {
    mockGetSamplePipelineResults.mockResolvedValue({ displayedData: {} });
    renderTab();
    await waitFor(() =>
      expect(mockGetSamplePipelineResults).toHaveBeenCalled(),
    );
    fireEvent.click(screen.getByTestId("reads-remaining-header"));

    // getReadCounts bails before clearing the loading flag.
    expect(screen.getByText("Loading")).toBeTruthy();
    expect(screen.queryByText("No data")).toBeNull();
  });

  it("shows 'No data' when every host-filtering step has zero reads remaining", async () => {
    mockGetSamplePipelineResults.mockResolvedValue(
      hostFilteringResults({
        bowtie2: { name: "Bowtie2", readsAfter: 0 },
        hisat2: { name: "Hisat2", readsAfter: null },
      }),
    );
    renderTab();
    await waitFor(() =>
      expect(mockGetSamplePipelineResults).toHaveBeenCalled(),
    );
    fireEvent.click(screen.getByTestId("reads-remaining-header"));

    await waitFor(() =>
      expect(screen.getAllByText("No data").length).toBeGreaterThan(0),
    );
    expect(screen.queryByText("Bowtie2")).toBeNull();
  });

  it("shows 'No data' when the run reports neither total reads nor total bases", async () => {
    mockGetSamplePipelineResults.mockResolvedValue(
      hostFilteringResults({
        validateInput: { name: "Validate Input", readsAfter: 250 },
      }),
    );
    renderTab({
      pipelineTabFragmentKey: makeData({
        pipeline_run: { total_reads: 0, total_bases: 0 },
      }) as $TSFixMe,
    });
    await waitFor(() =>
      expect(mockGetSamplePipelineResults).toHaveBeenCalled(),
    );
    fireEvent.click(screen.getByTestId("reads-remaining-header"));

    await waitFor(() =>
      expect(screen.getAllByText("No data").length).toBeGreaterThan(0),
    );
    expect(screen.queryByText("Validate Input")).toBeNull();
  });
});

describe("PipelineTab ERCC section", () => {
  it("shows the loading message when there is no pipeline run yet", async () => {
    renderTab({
      pipelineTabFragmentKey: { summary_stats: {}, ercc_comparison: null },
    });
    fireEvent.click(screen.getByTestId("ercc-spike-in-counts-header"));
    expect(screen.getAllByText("Loading").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("ercc-plot")).toBeNull();
    await waitFor(() =>
      expect(mockGetSamplePipelineResults).toHaveBeenCalled(),
    );
  });

  it("renders the scatter plot once comparison data is present", async () => {
    renderTab({
      pipelineTabFragmentKey: makeData({
        ercc_comparison: [
          { name: "ERCC-1", actual: 10, expected: 12 },
          { name: "ERCC-2", actual: 4, expected: 5 },
        ],
      }) as $TSFixMe,
    });
    await waitFor(() =>
      expect(mockGetSamplePipelineResults).toHaveBeenCalled(),
    );
    fireEvent.click(screen.getByTestId("ercc-spike-in-counts-header"));

    const plot = screen.getByTestId("ercc-plot");
    expect(plot.textContent).toBe("2");
  });
});

describe("PipelineTab pipeline-info section toggle", () => {
  it("collapses and re-expands the pipeline info fields", async () => {
    renderTab();
    await waitFor(() =>
      expect(mockGetSamplePipelineResults).toHaveBeenCalled(),
    );

    expect(screen.getByTestId("total-reads-value").textContent).toBe("1,000");

    fireEvent.click(screen.getByTestId("pipeline-info-header"));
    await waitFor(() =>
      expect(screen.queryByTestId("total-reads-value")).toBeNull(),
    );

    fireEvent.click(screen.getByTestId("pipeline-info-header"));
    await waitFor(() =>
      expect(screen.getByTestId("total-reads-value")).toBeTruthy(),
    );
  });
});
