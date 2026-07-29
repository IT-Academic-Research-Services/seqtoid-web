// Coverage: app/assets/src/components/views/SampleView/components/
//   BenchmarkView/BenchmarkView.tsx
//
// BenchmarkView only fetches when the workflow run has actually SUCCEEDED --
// a missing run, or a run in any other state, must short-circuit the effect and
// leave the report empty. On success it camelizes the API payload, renders the
// additional-info table (only when additionalInfo is truthy) and injects the
// Jupyter HTML report through DOMPurify. The API module, DOMPurify and the two
// child components are stubbed so the effect's guard, the loading handoff to
// SampleReportContent and the sanitize call can be asserted directly.
import { render, screen, waitFor } from "@testing-library/react";

const mockGetWorkflowRunResults = jest.fn();
jest.mock("~/api", () => ({
  getWorkflowRunResults: (id: $TSFixMe) => mockGetWorkflowRunResults(id),
}));

const mockSanitize = jest.fn((html: string) => html);
jest.mock("dompurify", () => ({
  __esModule: true,
  default: {
    sanitize: (html: string) => mockSanitize(html),
  },
}));

let lastReportContentProps: $TSFixMe = null;
jest.mock(
  "~/components/views/SampleView/components/SampleReportConent",
  () => ({
    SampleReportContent: (props: $TSFixMe) => {
      lastReportContentProps = props;
      const ReactLib = require("react");
      return ReactLib.createElement(
        "div",
        { "data-testid": "report-content" },
        props.loadingResults ? null : props.children,
      );
    },
  }),
);

let lastInfoProps: $TSFixMe = null;
jest.mock(
  "~/components/views/SampleView/components/BenchmarkView/components/BenchmarkSampleReportInfo",
  () => ({
    BenchmarkSampleReportInfo: (props: $TSFixMe) => {
      lastInfoProps = props;
      const ReactLib = require("react");
      return ReactLib.createElement("div", { "data-testid": "report-info" });
    },
  }),
);

import { BenchmarkView } from "~/components/views/SampleView/components/BenchmarkView/BenchmarkView";
import { SUCCEEDED_STATE } from "~/components/views/SampleView/utils";

const SAMPLE = { id: 7, name: "benchmark sample" } as $TSFixMe;

const renderView = (workflowRun?: $TSFixMe) =>
  render(<BenchmarkView sample={SAMPLE} workflowRun={workflowRun} />);

const succeededRun = { id: 42, status: SUCCEEDED_STATE } as $TSFixMe;

beforeEach(() => {
  jest.clearAllMocks();
  lastReportContentProps = null;
  lastInfoProps = null;
});

describe("BenchmarkView fetch guard", () => {
  it("does not fetch when there is no workflow run", () => {
    renderView(undefined);
    expect(mockGetWorkflowRunResults).not.toHaveBeenCalled();
    expect(lastReportContentProps.loadingResults).toBe(false);
    expect(lastReportContentProps.workflowRun).toBeUndefined();
  });

  it("does not fetch while the run is still going", () => {
    renderView({ id: 42, status: "RUNNING" });
    expect(mockGetWorkflowRunResults).not.toHaveBeenCalled();
  });

  it("does not fetch for a failed run", () => {
    renderView({ id: 42, status: "FAILED" });
    expect(mockGetWorkflowRunResults).not.toHaveBeenCalled();
    expect(screen.queryByTestId("report-info")).toBeNull();
  });

  it("fetches results for a succeeded run", async () => {
    mockGetWorkflowRunResults.mockResolvedValue({
      benchmark_html_report: "<p>report</p>",
      additional_info: {},
    });
    renderView(succeededRun);
    await waitFor(() =>
      expect(mockGetWorkflowRunResults).toHaveBeenCalledWith(42),
    );
  });
});

describe("BenchmarkView results rendering", () => {
  it("camelizes the payload and renders the additional-info table", async () => {
    mockGetWorkflowRunResults.mockResolvedValue({
      benchmark_html_report: "<h1>Benchmark</h1>",
      additional_info: { 1: { sample_name: "sample-a" } },
    });
    renderView(succeededRun);

    await waitFor(() => expect(screen.getByTestId("report-info")).toBeTruthy());
    expect(lastInfoProps.info).toEqual({ 1: { sampleName: "sample-a" } });
  });

  it("sanitizes the html report before injecting it", async () => {
    mockGetWorkflowRunResults.mockResolvedValue({
      benchmark_html_report: "<h1>Benchmark</h1>",
      additional_info: null,
    });
    const { container } = renderView(succeededRun);

    await waitFor(() =>
      expect(mockSanitize).toHaveBeenCalledWith("<h1>Benchmark</h1>"),
    );
    expect(container.querySelector("h1")?.textContent).toBe("Benchmark");
  });

  it("omits the additional-info table when the payload has none", async () => {
    mockGetWorkflowRunResults.mockResolvedValue({
      benchmark_html_report: "<p>x</p>",
      additional_info: null,
    });
    renderView(succeededRun);

    await waitFor(() => expect(mockSanitize).toHaveBeenCalled());
    expect(screen.queryByTestId("report-info")).toBeNull();
  });

  it("sanitizes the empty string before any fetch resolves", () => {
    mockGetWorkflowRunResults.mockReturnValue(new Promise(() => undefined));
    renderView(succeededRun);
    expect(mockSanitize).toHaveBeenCalledWith("");
  });

  it("hands the loading state and loading copy to SampleReportContent", async () => {
    let resolveResults: (value: $TSFixMe) => void = () => undefined;
    mockGetWorkflowRunResults.mockReturnValue(
      new Promise(resolve => {
        resolveResults = resolve;
      }),
    );
    renderView(succeededRun);

    await waitFor(() =>
      expect(lastReportContentProps.loadingResults).toBe(true),
    );
    expect(lastReportContentProps.loadingInfo).toEqual({
      message: "Your benchmarking results are being generated!",
    });
    expect(lastReportContentProps.sample).toBe(SAMPLE);

    resolveResults({
      benchmark_html_report: "<p>done</p>",
      additional_info: null,
    });
    await waitFor(() =>
      expect(lastReportContentProps.loadingResults).toBe(false),
    );
  });
});
