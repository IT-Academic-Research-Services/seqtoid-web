// Frontend coverage: SampleViewOverflowMenu reads the per-workflow config to
// decide visibility + delete affordances, then derives a bunch of props for the
// underlying OverflowMenu (redirect-on-single-run, run-finalized from either the
// run flag or a finalized upload error, the mNGS classification, and the support
// note string). The OverflowMenu leaf is stubbed to capture props so every
// derived branch is asserted directly; the real workflowTypeConfig is used.
import { render, screen } from "@testing-library/react";

let overflowProps: $TSFixMe;

jest.mock(
  "~/components/views/SampleView/components/SampleViewHeader/components/PrimaryHeaderControls/components/SampleViewOverflowMenu/components/OverflowMenu",
  () => ({
    OverflowMenu: (props: $TSFixMe) => {
      overflowProps = props;
      return <div data-testid="overflow-menu" />;
    },
  }),
);

import { WORKFLOWS, WorkflowType } from "~/components/utils/workflows";
import { SampleViewOverflowMenu } from "~/components/views/SampleView/components/SampleViewHeader/components/PrimaryHeaderControls/components/SampleViewOverflowMenu/SampleViewOverflowMenu";

const baseProps = {
  className: "menu",
  currentRun: { id: 500, run_finalized: true } as $TSFixMe,
  currentTab: "Consensus Genome" as $TSFixMe,
  onDeleteRunSuccess: jest.fn(),
  reportMetadata: { pipelineRunStatus: "SUCCEEDED" } as $TSFixMe,
  sample: {
    id: 300,
    name: "My Sample",
    user_id: 7,
    workflow_runs: [{ id: 500 }],
    pipeline_runs: [],
  } as $TSFixMe,
  workflow: WorkflowType.CONSENSUS_GENOME,
};

const renderMenu = (overrides: $TSFixMe = {}) =>
  render(
    <SampleViewOverflowMenu {...(baseProps as $TSFixMe)} {...overrides} />,
  );

beforeEach(() => {
  jest.clearAllMocks();
  overflowProps = undefined;
});

describe("SampleViewOverflowMenu", () => {
  it("renders nothing for the deprecated AMR workflow (isVisible false)", () => {
    const { container } = renderMenu({ workflow: WorkflowType.AMR_DEPRECATED });
    expect(container.textContent).toBe("");
    expect(screen.queryByTestId("overflow-menu")).toBeNull();
  });

  it("renders the OverflowMenu and forwards workflow labels for a visible workflow", () => {
    renderMenu();
    expect(screen.getByTestId("overflow-menu")).toBeTruthy();
    expect(overflowProps.workflowShorthand).toBe(
      WORKFLOWS[WorkflowType.CONSENSUS_GENOME].shorthand,
    );
    expect(overflowProps.workflowLabel).toBe(
      WORKFLOWS[WorkflowType.CONSENSUS_GENOME].label,
    );
    expect(overflowProps.sampleUserId).toBe(7);
    expect(overflowProps.sampleId).toBe(300);
    expect(overflowProps.workflowRunId).toBe(500);
  });

  it("uses the current run id as the deleteId and marks CG as ready-to-delete", () => {
    renderMenu();
    expect(overflowProps.deleteId).toBe(500);
    expect(overflowProps.readyToDelete).toBe(true);
  });

  it("classifies CG as non-mNGS", () => {
    renderMenu();
    expect(overflowProps.isMngs).toBe(false);
  });

  it("classifies short-read mNGS as mNGS and uses the sample id as deleteId", () => {
    renderMenu({
      workflow: WorkflowType.SHORT_READ_MNGS,
      currentTab: "Metagenomic" as $TSFixMe,
    });
    expect(overflowProps.isMngs).toBe(true);
    expect(overflowProps.deleteId).toBe(300);
    expect(overflowProps.isShortReadMngs).toBe(true);
  });

  it("sets redirectOnSuccess when the sample has exactly one run", () => {
    renderMenu();
    expect(overflowProps.redirectOnSuccess).toBe(true);
  });

  it("clears redirectOnSuccess when the sample has multiple runs", () => {
    renderMenu({
      sample: {
        id: 300,
        name: "My Sample",
        user_id: 7,
        workflow_runs: [{ id: 500 }, { id: 501 }],
        pipeline_runs: [],
      } as $TSFixMe,
    });
    expect(overflowProps.redirectOnSuccess).toBe(false);
  });

  it("marks the run finalized from the run flag", () => {
    renderMenu();
    expect(overflowProps.runFinalized).toBe(true);
  });

  it("marks the run finalized from a finalized upload error even when the run is not finalized", () => {
    renderMenu({
      currentRun: { id: 500, run_finalized: false } as $TSFixMe,
      sample: {
        id: 300,
        name: "My Sample",
        user_id: 7,
        upload_error: "S3_UPLOAD_FAILED",
        workflow_runs: [{ id: 500 }],
        pipeline_runs: [],
      } as $TSFixMe,
    });
    expect(overflowProps.runFinalized).toBe(true);
  });

  it("leaves the run un-finalized when neither the flag nor a finalized error is set", () => {
    renderMenu({
      currentRun: { id: 500, run_finalized: false } as $TSFixMe,
    });
    expect(overflowProps.runFinalized).toBeFalsy();
  });

  it("builds a support note that embeds the sample and run context", () => {
    renderMenu();
    expect(overflowProps.supportNote).toContain('Sample "My Sample" (id 300)');
    expect(overflowProps.supportNote).toContain("run 500");
    expect(overflowProps.supportNote).toContain(
      WORKFLOWS[WorkflowType.CONSENSUS_GENOME].label,
    );
  });

  it("omits the support note when there is no sample", () => {
    renderMenu({
      sample: null,
      workflow: WorkflowType.AMR,
      currentRun: { id: 12 } as $TSFixMe,
    });
    // AMR is always visible, and with no sample readyToDelete falls back to the run.
    expect(overflowProps.supportNote).toBeUndefined();
    expect(overflowProps.readyToDelete).toBe(true);
  });
});
