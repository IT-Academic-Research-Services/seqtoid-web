// Coverage: app/assets/src/components/common/DetailsSidebar/SampleDetailsMode/components/PipelineTab/PipelineTab.tsx
//
// PipelineTab is a Relay fragment container. relay-test-utils is not installed
// in this repo, so useFragment is stubbed to hand back whatever fragment key it
// was given -- the component only ever reads plain fields off `data`, so the
// stub is behaviourally faithful. The pipeline-results API call is mocked so the
// reads-remaining table can be driven deterministically.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockGetSamplePipelineResults = jest.fn();

jest.mock("react-relay", () => ({
  // The real hook reads the store; here the "key" already IS the data.
  useFragment: (_fragment: unknown, key: unknown) => key,
}));

jest.mock("~/api", () => ({
  getSamplePipelineResults: (...args: unknown[]) =>
    mockGetSamplePipelineResults(...args),
}));

import { PipelineTab } from "~/components/common/DetailsSidebar/SampleDetailsMode/components/PipelineTab/PipelineTab";
import { WORKFLOW_TABS, WorkflowType } from "~/components/utils/workflows";

const illuminaData = {
  pipeline_run: {
    total_reads: 1000000,
    total_ercc_reads: 5000,
    technology: "Illumina",
    sample_id: 42,
    host_subtracted: "Human",
    pipeline_version: "8.0",
    version: { pipeline: "8.0", alignment_db: "2024-02-06" },
  },
  summary_stats: {
    adjusted_remaining_reads: 12345,
    percent_remaining: 12.5,
    unmapped_reads: 678,
    qc_percent: 98.7,
    compression_ratio: 3.5,
    last_processed_at: "2024-01-15",
    insert_size_mean: 300,
    insert_size_standard_deviation: 40,
  },
  ercc_comparison: null,
};

const renderTab = (props: Record<string, unknown> = {}) =>
  render(
    <PipelineTab
      sampleId={42}
      pipelineTabFragmentKey={illuminaData as $TSFixMe}
      {...(props as $TSFixMe)}
    />,
  );

describe("PipelineTab", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSamplePipelineResults.mockResolvedValue(null);
  });

  it("renders the short-read mNGS pipeline info fields from the fragment data", async () => {
    renderTab();

    expect(screen.getByTestId("pipeline-info-header")).toBeTruthy();
    expect(screen.getByTestId("analysis-type-value").textContent).toBe(
      "Metagenomic",
    );
    expect(screen.getByTestId("sequencing-platform-value").textContent).toBe(
      "Illumina",
    );
    expect(screen.getByTestId("total-reads-value").textContent).toBe(
      "1,000,000",
    );
    expect(screen.getByTestId("passed-filters-value").textContent).toBe(
      "12,345 (12.50%)",
    );
    expect(screen.getByTestId("ncbi-index-date-value").textContent).toBe(
      "2024-02-06",
    );
    // Short-read-only field.
    expect(screen.getByTestId("mean-insert-size-value").textContent).toBe(
      "300±40",
    );

    await waitFor(() =>
      expect(mockGetSamplePipelineResults).toHaveBeenCalled(),
    );
    expect(mockGetSamplePipelineResults).toHaveBeenCalledWith(42, "8.0");
  });

  it("renders the pipeline version as a visualization link", async () => {
    renderTab();
    const versionCell = screen.getByTestId("pipeline-version-value");
    expect(versionCell.textContent).toContain("v8.0");
    const link = versionCell.querySelector("a");
    expect(link).toBeTruthy();
    expect(link?.getAttribute("href")).toBe("/samples/42/pipeline_viz/8.0");
    expect(link?.textContent).toBe("View Pipeline Visualization");
    await waitFor(() =>
      expect(mockGetSamplePipelineResults).toHaveBeenCalled(),
    );
  });

  it("renders an em-dash placeholder for empty field values", async () => {
    renderTab({
      pipelineTabFragmentKey: {
        pipeline_run: { total_reads: 10, technology: "Illumina" },
      },
    });
    // No summary stats -> qcPercent is absent -> placeholder.
    expect(screen.getByTestId("passed-quality-control-value").textContent).toBe(
      "--",
    );
    await waitFor(() =>
      expect(mockGetSamplePipelineResults).toHaveBeenCalled(),
    );
  });

  it("suppresses the visualization link and the mNGS-only sections for snapshot links", () => {
    renderTab({ snapshotShareId: "snapshot-abc" });

    // Link is hidden for snapshot viewers, but the version text remains.
    const versionCell = screen.getByTestId("pipeline-version-value");
    expect(versionCell.textContent).toContain("v8.0");
    expect(versionCell.querySelector("a")).toBeNull();

    expect(screen.queryByTestId("reads-remaining-header")).toBeNull();
    expect(screen.queryByTestId("ercc-spike-in-counts-header")).toBeNull();
    expect(screen.queryByTestId("downloads-header")).toBeNull();
    // Read counts are never fetched for snapshots.
    expect(mockGetSamplePipelineResults).not.toHaveBeenCalled();
  });

  it("titles the read table 'Bases Remaining' for Nanopore runs", async () => {
    renderTab({
      pipelineTabFragmentKey: {
        pipeline_run: {
          total_reads: 100,
          total_bases: 5000,
          technology: "ONT",
          guppy_basecaller_setting: "hac",
        },
      },
    });

    expect(screen.getByTestId("bases-remaining-header")).toBeTruthy();
    expect(screen.queryByTestId("reads-remaining-header")).toBeNull();
    // Long-read-only field is present, short-read-only field is not.
    expect(
      screen.getByTestId("guppy-basecaller-version-value").textContent,
    ).toBe("hac");
    expect(screen.queryByTestId("mean-insert-size-value")).toBeNull();
    await waitFor(() =>
      expect(mockGetSamplePipelineResults).toHaveBeenCalled(),
    );
  });

  it("uses the consensus-genome fields and hides the mNGS sections on the CG tab", () => {
    renderTab({
      currentWorkflowTab: WORKFLOW_TABS.CONSENSUS_GENOME,
      currentRun: {
        workflow: WorkflowType.CONSENSUS_GENOME,
        executed_at: "2024-03-01",
        wdl_version: "3.5.0",
        inputs: { technology: "ONT", medaka_model: "r941" },
        parsed_cached_results: {
          quality_metrics: { mapped_reads: 3400, total_reads: 5600 },
        },
      },
    });

    expect(screen.getByTestId("mapped-reads-value").textContent).toBe("3,400");
    expect(screen.getByTestId("medaka-model-value").textContent).toBe("r941");
    expect(screen.getByTestId("sequencing-platform-value").textContent).toBe(
      "Nanopore",
    );
    // CG is not an mNGS workflow -> no reads/ERCC/downloads sections.
    expect(screen.queryByTestId("reads-remaining-header")).toBeNull();
    expect(screen.queryByTestId("downloads-header")).toBeNull();
    expect(mockGetSamplePipelineResults).not.toHaveBeenCalled();
  });

  it("uses the AMR fields on the AMR tab", () => {
    renderTab({
      currentWorkflowTab: WORKFLOW_TABS.AMR,
      currentRun: {
        workflow: WorkflowType.AMR,
        executed_at: "2024-02-02",
        wdl_version: "1.2.3",
        inputs: { card_version: "3.2.5", wildcard_version: "4.0.0" },
        parsed_cached_results: {
          quality_metrics: { total_reads: 1000, qc_percent: 95 },
        },
      },
    });

    expect(screen.getByTestId("card-database-version-value").textContent).toBe(
      "3.2.5",
    );
    expect(
      screen.getByTestId("wildcard-database-version-value").textContent,
    ).toBe("4.0.0");
    expect(screen.getByTestId("passed-quality-control-value").textContent).toBe(
      "95.00%",
    );
    expect(screen.queryByTestId("reads-remaining-header")).toBeNull();
  });

  it("shows 'No data' for the reads table when the pipeline results are empty", async () => {
    renderTab();
    await waitFor(() =>
      expect(mockGetSamplePipelineResults).toHaveBeenCalled(),
    );

    // Open the (collapsed) reads-remaining section.
    fireEvent.click(screen.getByTestId("reads-remaining-header"));
    // Read counts never arrived, so the section is still in its loading state.
    expect(screen.getByText("Loading")).toBeTruthy();
  });

  it("renders a row per host-filtering step once read counts load", async () => {
    mockGetSamplePipelineResults.mockResolvedValue({
      displayedData: {
        "Host Filtering": {
          stageDescription: "Filters out host reads.",
          steps: {
            validateInput: {
              name: "Validate Input",
              stepDescription: "Validates the input files.",
              readsAfter: 900000,
            },
            fastp: {
              name: "Fastp",
              stepDescription: "Quality filtering.",
              readsAfter: 500000,
            },
            emptyStep: {
              name: "Skipped Step",
              stepDescription: "Not run for this sample.",
              readsAfter: null,
            },
          },
        },
      },
    });

    renderTab();
    await waitFor(() =>
      expect(mockGetSamplePipelineResults).toHaveBeenCalled(),
    );

    fireEvent.click(screen.getByTestId("reads-remaining-header"));

    await waitFor(() =>
      expect(screen.getByText("Validate Input")).toBeTruthy(),
    );
    expect(screen.getByText("Fastp")).toBeTruthy();
    // Steps with readsAfter === null are dropped before rendering.
    expect(screen.queryByText("Skipped Step")).toBeNull();
    // 900,000 of 1,000,000 total reads == 90.00%
    expect(screen.getByText("900,000")).toBeTruthy();
    expect(screen.getByText("90.00%")).toBeTruthy();
    expect(screen.getByText("50.00%")).toBeTruthy();
  });

  it("shows 'No data' for the ERCC plot when there is no comparison data", async () => {
    renderTab();
    await waitFor(() =>
      expect(mockGetSamplePipelineResults).toHaveBeenCalled(),
    );

    fireEvent.click(screen.getByTestId("ercc-spike-in-counts-header"));
    expect(screen.getAllByText("No data").length).toBeGreaterThan(0);
  });

  it("renders download links derived from the pipeline run", async () => {
    renderTab();
    await waitFor(() =>
      expect(mockGetSamplePipelineResults).toHaveBeenCalled(),
    );

    fireEvent.click(screen.getByTestId("downloads-header"));
    const links = Array.from(document.querySelectorAll("a")).filter(a =>
      (a.getAttribute("href") || "").includes("/samples/42/"),
    );
    expect(links.length).toBeGreaterThan(0);
  });
});
