// SMP-1900 frontend coverage: SampleViewMessage is the report page's status
// derivation (get_pipeline_status -> reportMetadata + sampleErrorInfo), which
// had zero tests. The project table and the report page disagreed for exactly
// one input combination -- a sample with no pipeline run and no upload_error:
// the table showed QUEUED FOR PROCESSING while the report page fell through to
// sampleErrorInfo's default and showed SAMPLE FAILED. These tests pin the fix
// (that case now reads IN PROGRESS) and guard the three neighbouring cases that
// must not move: a genuinely failed run, a stalled upload, and a WAITING run.
//
// SampleViewMessage and its real dependency sampleErrorInfo transitively import
// .scss (via SampleMessage, the icons barrel, and TableRenderers). Under jest
// the "~" alias out-ranks the scss styleMock, so those style imports are stubbed
// here. sampleErrorInfo itself is left REAL so the SAMPLE FAILED / UPLOADING
// status mapping is exercised end to end.
import { render } from "@testing-library/react";
import React from "react";
import { WORKFLOW_TABS } from "~/components/utils/workflows";
import { PipelineRunStatus } from "~/interface/reportMetaData";
import { SampleStatus } from "~/interface/sample";
import { SampleViewMessage } from "~/components/views/SampleView/components/SampleViewMessage/SampleViewMessage";

// Capture the props SampleViewMessage hands to SampleMessage so we can assert on
// the derived status without rendering the (scss-heavy) presentational shell.
const mockSampleMessageProps: Array<{ status?: string; message?: string }> = [];
jest.mock("~/components/common/SampleMessage", () => ({
  SampleMessage: (props: { status?: string; message?: string }) => {
    mockSampleMessageProps.push(props);
    return null;
  },
}));
jest.mock(
  "~/components/common/SampleMessage/sample_message.scss",
  () => ({}),
  { virtual: true },
);
jest.mock("~/components/ui/icons", () => ({
  IconAlert: () => null,
  IconLoading: () => null,
}));
// sampleErrorInfo imports STATUS_TYPE from TableRenderers, which pulls scss.
jest.mock("~/components/common/TableRenderers/TableRenderers", () => ({
  STATUS_TYPE: {},
}));

// SampleViewMessage takes richly-typed props (Sample, PipelineRun, ReportMetadata,
// CurrentTabSample). The derivation only reads a handful of fields, so build
// minimal fixtures and cast rather than constructing full records.
const renderMessage = (overrides: Record<string, unknown> = {}) =>
  render(
    React.createElement(SampleViewMessage, {
      currentTab: WORKFLOW_TABS.SHORT_READ_MNGS,
      loadingReport: false,
      hasZeroTaxons: false,
      pipelineRun: undefined,
      reportMetadata: {},
      sample: { id: 1, upload_error: null },
      snapshotShareId: undefined,
      ...overrides,
    } as any),
  );

const lastStatus = () => mockSampleMessageProps.at(-1)?.status;

describe("SampleViewMessage", () => {
  beforeEach(() => {
    mockSampleMessageProps.length = 0;
  });

  it("shows IN PROGRESS for a queued sample with no pipeline run and no upload error (SMP-1900)", () => {
    // The disagreement case: no run has started, nothing has errored. The report
    // page must NOT call this failed -- it mirrors the table's QUEUED FOR PROCESSING.
    renderMessage({ pipelineRun: undefined, reportMetadata: {} });
    expect(lastStatus()).toBe(SampleStatus.IN_PROGRESS);
  });

  it("still shows SAMPLE FAILED for a genuinely failed pipeline run", () => {
    // A run exists and failed, with no upload error and no known_user_error:
    // sampleErrorInfo's default path. Must remain SAMPLE FAILED.
    renderMessage({
      pipelineRun: { id: 2 },
      reportMetadata: { pipelineRunStatus: PipelineRunStatus.FAILED },
      sample: { id: 2, upload_error: null },
    });
    expect(lastStatus()).toBe(SampleStatus.SAMPLE_FAILED);
  });

  it("still shows UPLOADING for a stalled local upload (upload_error routes first)", () => {
    // upload_error is present, so the in-progress gate is skipped and
    // sampleErrorInfo maps LOCAL_UPLOAD_STALLED -> UPLOADING. The broadened gate
    // (no pipeline run) must not swallow a sample whose upload has errored.
    renderMessage({
      pipelineRun: undefined,
      reportMetadata: {},
      sample: { id: 3, upload_error: "LOCAL_UPLOAD_STALLED" },
    });
    expect(lastStatus()).toBe(SampleStatus.UPLOADING);
  });

  it("leaves the WAITING branch unchanged for an in-progress run", () => {
    // A run exists and the results monitor is still loading outputs. This is the
    // pre-existing WAITING arm: IN PROGRESS with the run's jobStatus message.
    renderMessage({
      pipelineRun: { id: 4, pipeline_version: "8.0" },
      reportMetadata: {
        pipelineRunStatus: PipelineRunStatus.WAITING,
        jobStatus: "Running host filtering",
      },
      sample: { id: 4, upload_error: null },
    });
    expect(lastStatus()).toBe(SampleStatus.IN_PROGRESS);
    expect(mockSampleMessageProps.at(-1)?.message).toBe("Running host filtering");
  });
});
