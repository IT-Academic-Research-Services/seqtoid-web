// Coverage for the project-level Quality Control view. Its real logic is
// extractData -- bucketing the samples the GraphQL query returned into
// valid / running / failed -- plus the empty-state fallback and the chart
// hover tooltip lifecycle.
//
// react-relay is stubbed so the query result can be supplied directly, and the
// two D3 chart panels are stubbed so their callbacks (hover, exit, tooltip
// data, sidebar) can be driven without a canvas.
let mockQueryData: $TSFixMe = { samplesList: { samples: [] } };

jest.mock("react-relay", () => ({
  graphql: () => ({}),
  useLazyLoadQuery: (...args: unknown[]) => {
    mockLastQueryVariables = args[1];
    return mockQueryData;
  },
}));

let mockLastQueryVariables: $TSFixMe = null;

jest.mock(
  "~/components/views/DiscoveryView/components/SamplesView/components/QualityControl/components/Histograms",
  () => ({
    __esModule: true,
    Histograms: (props: $TSFixMe) => (
      <div>
        <span data-testid="histograms-valid-count">
          {props.validSamples.length}
        </span>
        <span data-testid="histograms-dict-keys">
          {Object.keys(props.samplesDict).join(",")}
        </span>
        <button
          data-testid="hover-with-coords"
          onClick={() => {
            props.setChartTooltipData([
              { name: "Total Reads", data: [["Reads", "1,000"]] },
            ]);
            props.handleChartElementHover(120, 240);
          }}
        />
        <button
          data-testid="hover-without-coords"
          onClick={() => {
            props.setChartTooltipData([
              { name: "Total Reads", data: [["Reads", "1,000"]] },
            ]);
            props.handleChartElementHover(0, 0);
          }}
        />
        <button
          data-testid="chart-exit"
          onClick={() => props.handleChartElementExit()}
        />
      </div>
    ),
  }),
);

jest.mock(
  "~/components/views/DiscoveryView/components/SamplesView/components/QualityControl/components/ReadsLostChart",
  () => ({
    __esModule: true,
    ReadsLostChart: (props: $TSFixMe) => (
      <button
        data-testid="open-sidebar"
        onClick={() => {
          props.setSidebarParams({ sampleId: 77 });
          props.setSidebarVisible(true);
        }}
      />
    ),
  }),
);

jest.mock("~/components/common/DetailsSidebar/DetailsSidebar", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => (
    <div data-testid="details-sidebar" data-visible={String(props.visible)}>
      {String(props.params?.sampleId)}
    </div>
  ),
}));

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import QualityControl from "~/components/views/DiscoveryView/components/SamplesView/components/QualityControl/QualityControl";

// Keeps prettier's organize-imports from dropping the React import that the
// classic JSX runtime needs in scope.
const _React: typeof React = React;

const validSample = (id: string, name = `sample-${id}`) => ({
  id,
  name,
  details: {
    dbSample: { uploadError: null },
    derivedSampleOutput: {
      pipelineRun: { totalReads: 1000 },
      summaryStats: { compressionRatio: 2, qcPercent: 90, insertSizeMean: 300 },
    },
    mngsRunInfo: {
      resultStatusDescription: "COMPLETE",
      reportReady: true,
      createdAt: "2021-01-01",
    },
  },
});

const failedSample = (id: string, status = "FAILED") => ({
  id,
  name: `failed-${id}`,
  details: {
    dbSample: { uploadError: null },
    derivedSampleOutput: null,
    mngsRunInfo: {
      resultStatusDescription: status,
      reportReady: false,
      createdAt: "2021-01-01",
    },
  },
});

const runningSample = (id: string) => ({
  id,
  name: `running-${id}`,
  details: {
    dbSample: { uploadError: null },
    derivedSampleOutput: null,
    mngsRunInfo: {
      resultStatusDescription: "RUNNING",
      reportReady: false,
      createdAt: "2021-01-01",
    },
  },
});

// A sample with no mNGS run at all -- PLQC ignores it entirely.
const nonMngsSample = (id: string) => ({
  id,
  name: `cg-${id}`,
  details: {
    dbSample: { uploadError: null },
    derivedSampleOutput: null,
    mngsRunInfo: { resultStatusDescription: null, reportReady: null },
  },
});

const renderQC = (props: $TSFixMe = {}) =>
  render(
    <QualityControl
      projectId="12"
      handleBarClick={jest.fn()}
      filters={{ host: [1] }}
      {...props}
    />,
  );

beforeEach(() => {
  mockQueryData = { samplesList: { samples: [] } };
  mockLastQueryVariables = null;
});

describe("QualityControl empty states", () => {
  it("renders the no-data banner when the project has no samples", async () => {
    renderQC();
    expect(await screen.findByText("Sample QC Visualizations")).toBeTruthy();
    expect(document.body.textContent).toContain(
      "You can visually check your QC metrics after your samples have successfully processed.",
    );
    expect(screen.queryByTestId("details-sidebar")).toBeNull();
  });

  it("renders the no-data banner when every sample lacks an mNGS run", async () => {
    mockQueryData = {
      samplesList: { samples: [nonMngsSample("1"), nonMngsSample("2")] },
    };
    renderQC();
    expect(await screen.findByText("Sample QC Visualizations")).toBeTruthy();
  });

  it("renders the no-data banner when every mNGS run failed", async () => {
    mockQueryData = {
      samplesList: { samples: [failedSample("1"), failedSample("2")] },
    };
    renderQC();
    expect(await screen.findByText("Sample QC Visualizations")).toBeTruthy();
  });
});

describe("QualityControl sample bucketing", () => {
  it("passes the project id and mNGS workflow to the query", async () => {
    renderQC();
    await screen.findByText("Sample QC Visualizations");
    expect(mockLastQueryVariables.projectId).toBe(12);
    expect(mockLastQueryVariables.workflow).toBe("short-read-mngs");
    expect(mockLastQueryVariables.hostIds).toEqual([1]);
  });

  it("counts valid, running and failed samples separately", async () => {
    mockQueryData = {
      samplesList: {
        samples: [
          validSample("1"),
          runningSample("2"),
          failedSample("3"),
          nonMngsSample("4"),
        ],
      },
    };
    renderQC();
    // 3 of the 4 samples have an mNGS run, and one of those is valid.
    expect(await screen.findByText(/Showing 1 of 3 samples\./)).toBeTruthy();
    expect(screen.getByTestId("histograms-valid-count").textContent).toBe("1");
    expect(screen.getByTestId("histograms-dict-keys").textContent).toBe("1");
    expect(document.body.textContent).toContain(
      "1 sample is still being processed.",
    );
  });

  it("treats COMPLETE - ISSUE and COMPLETE* runs as failed", async () => {
    mockQueryData = {
      samplesList: {
        samples: [
          validSample("1"),
          failedSample("2", "COMPLETE - ISSUE"),
          failedSample("3", "COMPLETE*"),
        ],
      },
    };
    renderQC();
    expect(await screen.findByText(/Showing 1 of 3 samples\./)).toBeTruthy();
    // No running samples, so the "still being processed" notice is absent.
    expect(document.body.textContent).not.toContain("still being processed");
  });

  it("treats a report-ready run without summary stats as still running", async () => {
    const noStats = validSample("2");
    // @ts-expect-error deliberately dropping the stats the component checks for
    noStats.details.derivedSampleOutput.summaryStats = null;
    mockQueryData = {
      samplesList: { samples: [validSample("1"), noStats] },
    };
    renderQC();
    expect(await screen.findByText(/Showing 1 of 2 samples\./)).toBeTruthy();
    expect(document.body.textContent).toContain(
      "1 sample is still being processed.",
    );
  });

  it("keeps every valid sample in the samples dictionary", async () => {
    mockQueryData = {
      samplesList: { samples: [validSample("1"), validSample("5")] },
    };
    renderQC();
    await screen.findByText(/Showing 2 of 2 samples\./);
    expect(screen.getByTestId("histograms-dict-keys").textContent).toBe("1,5");
    expect(screen.getByTestId("histograms-valid-count").textContent).toBe("2");
    expect(document.body.textContent).not.toContain("still being processed");
  });
});

describe("QualityControl tooltip and sidebar", () => {
  beforeEach(() => {
    mockQueryData = { samplesList: { samples: [validSample("1")] } };
  });

  it("shows a hover tooltip only once both coordinates and data are set", async () => {
    renderQC();
    await screen.findByTestId("hover-with-coords");
    expect(screen.queryByTestId("hover-tooltip")).toBeNull();

    fireEvent.click(screen.getByTestId("hover-with-coords"));
    const tooltip = await screen.findByTestId("hover-tooltip");
    expect(tooltip.textContent).toContain("Total Reads");
    expect(tooltip.textContent).toContain("1,000");

    fireEvent.click(screen.getByTestId("chart-exit"));
    await waitFor(() =>
      expect(screen.queryByTestId("hover-tooltip")).toBeNull(),
    );
  });

  it("does not show a tooltip when the hover has no coordinates", async () => {
    renderQC();
    await screen.findByTestId("hover-without-coords");
    fireEvent.click(screen.getByTestId("hover-without-coords"));
    await waitFor(() =>
      expect(screen.queryByTestId("hover-tooltip")).toBeNull(),
    );
  });

  it("opens the details sidebar with the clicked sample", async () => {
    renderQC();
    const sidebar = await screen.findByTestId("details-sidebar");
    expect(sidebar.getAttribute("data-visible")).toBe("false");
    expect(sidebar.textContent).toBe("null");

    fireEvent.click(screen.getByTestId("open-sidebar"));
    await waitFor(() => {
      const updated = screen.getByTestId("details-sidebar");
      expect(updated.getAttribute("data-visible")).toBe("true");
      expect(updated.textContent).toBe("77");
    });
  });
});
