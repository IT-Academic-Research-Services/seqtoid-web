// Branch coverage for
// app/assets/src/components/views/SampleView/components/SampleViewMessage/SampleViewMessage.tsx
//
// The existing SampleViewMessage spec walks the top-level if/else-if ladder but
// only ever enters the final `else` with a sample AND a pipeline run present.
// That leaves the two nested guards inside that else with their false arms
// unexercised:
//
//   if (sample) {            // <- else arm never taken
//     if (pipelineRun) { }   // <- else arm never taken
//     ({...} = sampleErrorInfo({...}));
//   }
//
// Both false arms are reachable and correspond to real states: a snapshot/
// permission-denied render where the sample never loaded, and an upload that
// failed before any pipeline run row existed.
import { render, screen } from "@testing-library/react";
import { WORKFLOW_TABS } from "~/components/utils/workflows";
import { SampleViewMessage } from "~/components/views/SampleView/components/SampleViewMessage/SampleViewMessage";
import { PipelineRunStatus } from "~/interface/reportMetaData";

// Absolute (~) scss import escapes the jest scss->styleMock rule.
jest.mock("~/components/common/SampleMessage/sample_message.scss", () => ({}), {
  virtual: true,
});

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

jest.mock("~/components/views/SampleView/utils", () => ({
  ONT_PIPELINE_RUNNING_STATUS_MESSAGE: "Running Pipeline Steps",
}));

// pipelineRunStatus that is neither WAITING nor loading nor zero-taxons, so the
// component drops into the trailing else where both nested guards live.
const finishedMetadata = {
  pipelineRunStatus: PipelineRunStatus.SUCCEEDED,
  jobStatus: "Complete",
} as $TSFixMe;

const renderMessage = (overrides: $TSFixMe = {}) =>
  render(
    <SampleViewMessage
      currentTab={WORKFLOW_TABS.SHORT_READ_MNGS as $TSFixMe}
      loadingReport={false}
      hasZeroTaxons={false}
      pipelineRun={null as $TSFixMe}
      reportMetadata={finishedMetadata}
      sample={null}
      {...overrides}
    />,
  );

const text = (id: string) => screen.getByTestId(id).textContent;

describe("SampleViewMessage error fallback with no sample", () => {
  it("renders an empty alert rather than calling sampleErrorInfo when the sample is missing", () => {
    renderMessage({ sample: null });

    // sampleErrorInfo is never consulted, so nothing it would have supplied
    // (status / message / type / link) makes it to SampleMessage...
    expect(text("status")).toBe("");
    expect(text("message")).toBe("");
    expect(text("type")).toBe("");
    expect(text("link")).toBe("");
    expect(text("linkText")).toBe("");
    // ...but the alert icon is still assigned unconditionally in that branch.
    expect(text("hasIcon")).toBe("yes");
  });

  it("does populate the failure copy once a sample is present", () => {
    // Contrast case for the guard above: same metadata, sample supplied.
    renderMessage({
      sample: { id: 9, upload_error: null } as $TSFixMe,
      pipelineRun: { pipeline_version: "8.0" } as $TSFixMe,
    });

    expect(text("status")).toBe("SAMPLE FAILED");
    expect(text("message")).toContain("There was an issue processing");
    expect(text("type")).toBe("error");
  });
});

describe("SampleViewMessage error fallback with no pipeline run", () => {
  it("still derives the upload-error copy when the pipeline run never started", () => {
    // An upload that failed validation has an upload_error but no pipeline run
    // row at all -- the `if (pipelineRun)` guard must fall through cleanly.
    renderMessage({
      sample: { id: 12, upload_error: "InvalidFileFormatError" } as $TSFixMe,
      pipelineRun: undefined as $TSFixMe,
    });

    expect(text("status")).toBe("INCOMPLETE - ISSUE");
    expect(text("type")).toBe("warning");
    expect(text("link")).toBe("/samples/upload");
    expect(text("linkText")).toBe(
      "Please check your file format and reupload your file.",
    );
    // No pipeline run -> no error_message to surface as the body/subtitle.
    expect(text("message")).toBe("");
    expect(text("subtitle")).toBe("");
  });

  it("prefers the pipeline run's error message when the run does exist", () => {
    // Same upload error, but now the run exists and carries detail -- proves the
    // previous case really was driven by the missing pipelineRun.
    renderMessage({
      sample: { id: 12, upload_error: "InvalidFileFormatError" } as $TSFixMe,
      pipelineRun: {
        pipeline_version: "8.0",
        error_message: "The input file sample.fastq is invalid.",
      } as $TSFixMe,
    });

    expect(text("status")).toBe("INCOMPLETE - ISSUE");
    expect(text("message")).toBe("The input file sample.fastq is invalid.");
    // A recognised error message yields a subtitle, and sampleErrorInfo then
    // blanks the generic link text.
    expect(text("subtitle")).toBe(
      "Please check that your .fastq file is valid and try again.",
    );
    expect(text("linkText")).toBe("");
  });
});
