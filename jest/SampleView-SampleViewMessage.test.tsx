// Coverage: app/assets/src/components/views/SampleView/components/SampleViewMessage/SampleViewMessage.tsx
//
// SampleViewMessage is a pure branch-picker: from a handful of booleans and the
// report/pipeline metadata it decides which status, message, icon, link and
// link text to hand to the presentational <SampleMessage>. Every mutually
// exclusive branch is exercised here (loading -> zero-taxons -> pipeline still
// WAITING -> the sampleErrorInfo failure fallback), plus the two cross-cutting
// tweaks (Nanopore running message, snapshot link stripping). SampleMessage is
// stubbed so the assertions land on exactly what this component computed.
import { render, screen } from "@testing-library/react";
import { WORKFLOW_TABS } from "~/components/utils/workflows";
import { SampleViewMessage } from "~/components/views/SampleView/components/SampleViewMessage/SampleViewMessage";
import { PipelineRunStatus } from "~/interface/reportMetaData";

// The source imports this stylesheet via an absolute (~) alias, which the jest
// scss->styleMock rule does not catch; mock it to an empty module.
jest.mock("~/components/common/SampleMessage/sample_message.scss", () => ({}), {
  virtual: true,
});

// Stub the presentational component so we can read the computed props directly.
jest.mock("~/components/common/SampleMessage", () => ({
  SampleMessage: (props: $TSFixMe) => (
    <div data-testid="sample-message">
      <span data-testid="status">{props.status}</span>
      <span data-testid="message">{props.message}</span>
      <span data-testid="type">{props.type}</span>
      <span data-testid="link">{props.link}</span>
      <span data-testid="linkText">{props.linkText}</span>
      <span data-testid="subtitle">{props.subtitle}</span>
      <span data-testid="hasIcon">{props.icon ? "yes" : "no"}</span>
    </div>
  ),
}));

// Keep the ONT running-status string real without pulling in the heavy utils barrel.
jest.mock("~/components/views/SampleView/utils", () => ({
  ONT_PIPELINE_RUNNING_STATUS_MESSAGE: "Running Pipeline Steps",
}));

const baseReportMetadata = {
  pipelineRunStatus: undefined,
  jobStatus: "Analyzing reads",
} as $TSFixMe;

const renderMessage = (overrides: $TSFixMe = {}) =>
  render(
    <SampleViewMessage
      currentTab={WORKFLOW_TABS.SHORT_READ_MNGS as $TSFixMe}
      loadingReport={false}
      hasZeroTaxons={false}
      pipelineRun={null as $TSFixMe}
      reportMetadata={baseReportMetadata}
      sample={null}
      {...overrides}
    />,
  );

describe("SampleViewMessage", () => {
  it("shows the loading state while the report data is loading", () => {
    renderMessage({ loadingReport: true });
    expect(screen.getByTestId("status").textContent).toContain("Loading");
    expect(screen.getByTestId("message").textContent).toContain(
      "Loading report data.",
    );
    expect(screen.getByTestId("type").textContent).toContain("inProgress");
    expect(screen.getByTestId("hasIcon").textContent).toContain("yes");
  });

  it("shows the no-matching-reads warning when there are zero taxons", () => {
    renderMessage({ hasZeroTaxons: true });
    expect(screen.getByTestId("status").textContent).toContain(
      "COMPLETE - ISSUE",
    );
    expect(screen.getByTestId("message").textContent).toContain(
      "did not match the database",
    );
    expect(screen.getByTestId("type").textContent).toContain("warning");
    expect(screen.getByTestId("link").textContent).toContain("/samples/upload");
    expect(screen.getByTestId("linkText").textContent).toContain(
      "Upload new sample",
    );
  });

  it("shows in-progress job status (with viz link) when the pipeline is WAITING", () => {
    renderMessage({
      reportMetadata: {
        pipelineRunStatus: PipelineRunStatus.WAITING,
        jobStatus: "Analyzing reads",
      },
      sample: { id: 42, upload_error: null } as $TSFixMe,
      pipelineRun: { pipeline_version: "7.1" } as $TSFixMe,
    });
    expect(screen.getByTestId("status").textContent).toContain("IN PROGRESS");
    expect(screen.getByTestId("message").textContent).toContain(
      "Analyzing reads",
    );
    expect(screen.getByTestId("type").textContent).toContain("inProgress");
    expect(screen.getByTestId("linkText").textContent).toContain(
      "View Pipeline Visualization",
    );
    expect(screen.getByTestId("link").textContent).toContain(
      "/samples/42/pipeline_viz/7.1",
    );
  });

  it("uses the Nanopore running message for the long-read tab while WAITING", () => {
    renderMessage({
      currentTab: WORKFLOW_TABS.LONG_READ_MNGS as $TSFixMe,
      reportMetadata: {
        pipelineRunStatus: PipelineRunStatus.WAITING,
        jobStatus: "Analyzing reads",
      },
      sample: { id: 5, upload_error: null } as $TSFixMe,
      // no pipeline_version -> no viz link branch
      pipelineRun: {} as $TSFixMe,
    });
    expect(screen.getByTestId("message").textContent).toContain(
      "Running Pipeline Steps",
    );
    // With no pipeline_version there is no visualization link.
    expect(screen.getByTestId("linkText").textContent).toBe("");
  });

  it("falls back to the sampleErrorInfo failure message for a completed-with-error sample", () => {
    renderMessage({
      reportMetadata: {
        pipelineRunStatus: PipelineRunStatus.SUCCEEDED,
        jobStatus: "Complete",
      },
      sample: { id: 9, upload_error: null } as $TSFixMe,
      pipelineRun: { pipeline_version: "8.0" } as $TSFixMe,
    });
    expect(screen.getByTestId("status").textContent).toContain("SAMPLE FAILED");
    expect(screen.getByTestId("message").textContent).toContain(
      "There was an issue processing your sample",
    );
    expect(screen.getByTestId("type").textContent).toContain("error");
    expect(screen.getByTestId("hasIcon").textContent).toContain("yes");
  });

  it("strips the link and link text on snapshot pages", () => {
    renderMessage({
      hasZeroTaxons: true,
      snapshotShareId: "share-abc",
    });
    // hasZeroTaxons would normally set link + linkText; snapshot clears them.
    expect(screen.getByTestId("link").textContent).toBe("");
    expect(screen.getByTestId("linkText").textContent).toBe("");
  });
});
