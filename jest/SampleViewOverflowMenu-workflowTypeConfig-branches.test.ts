// Branch coverage for
// app/assets/src/components/views/SampleView/components/SampleViewHeader/components/PrimaryHeaderControls/components/SampleViewOverflowMenu/workflowTypeConfig.tsx
//
// Every entry is a pure selector built out of optional chains
// (`currentRun?.id`, `sample?.id`, `sample?.upload_error`) and `||`
// short circuits, so each needs both the present and the nullish shape.
import { WORKFLOW_TABS, WorkflowType } from "~/components/utils/workflows";
import { SampleViewOverflowMenuConfig } from "~/components/views/SampleView/components/SampleViewHeader/components/PrimaryHeaderControls/components/SampleViewOverflowMenu/workflowTypeConfig";

const runBackedWorkflows = [
  WorkflowType.AMR,
  WorkflowType.CONSENSUS_GENOME,
  WorkflowType.BENCHMARK,
];

describe("SampleViewOverflowMenuConfig run-backed workflows", () => {
  runBackedWorkflows.forEach(workflow => {
    describe(workflow, () => {
      const config = SampleViewOverflowMenuConfig[workflow];

      it("takes the deleteId from the current run and is ready to delete", () => {
        expect(
          config({
            currentRun: { id: 777 },
            sample: { id: 1 },
            currentTab: undefined,
            reportMetadata: undefined,
          }),
        ).toEqual({
          deleteId: 777,
          isVisible: true,
          readyToDelete: true,
        });
      });

      it("falls back to the sample upload_error when there is no run", () => {
        expect(
          config({
            currentRun: null,
            sample: { id: 1, upload_error: "boom" },
            currentTab: undefined,
            reportMetadata: undefined,
          }),
        ).toEqual({
          deleteId: undefined,
          isVisible: true,
          readyToDelete: true,
        });
      });

      it("is not ready to delete when neither a run nor an upload error exists", () => {
        expect(
          config({
            currentRun: null,
            sample: { id: 1 },
            currentTab: undefined,
            reportMetadata: undefined,
          }).readyToDelete,
        ).toBe(false);
      });

      it("survives a nullish sample entirely", () => {
        expect(
          config({
            currentRun: undefined,
            sample: null,
            currentTab: undefined,
            reportMetadata: undefined,
          }),
        ).toEqual({
          deleteId: undefined,
          isVisible: true,
          readyToDelete: false,
        });
      });
    });
  });
});

describe("SampleViewOverflowMenuConfig SHORT_READ_MNGS", () => {
  const config = SampleViewOverflowMenuConfig[WorkflowType.SHORT_READ_MNGS];

  it("is visible with a populated report on a non-deprecated tab", () => {
    expect(
      config({
        currentRun: null,
        currentTab: WORKFLOW_TABS.SHORT_READ_MNGS,
        reportMetadata: { pipelineRunStatus: "SUCCEEDED" },
        sample: { id: 55 },
      }),
    ).toEqual({
      deleteId: 55,
      isVisible: true,
      readyToDelete: true,
      isShortReadMngs: true,
    });
  });

  it("is hidden on the deprecated AMR tab and not ready with an empty report", () => {
    expect(
      config({
        currentRun: null,
        currentTab: WORKFLOW_TABS.AMR_DEPRECATED,
        reportMetadata: {},
        sample: null,
      }),
    ).toEqual({
      deleteId: undefined,
      isVisible: false,
      readyToDelete: false,
      isShortReadMngs: true,
    });
  });
});

describe("SampleViewOverflowMenuConfig LONG_READ_MNGS", () => {
  const config = SampleViewOverflowMenuConfig[WorkflowType.LONG_READ_MNGS];

  it("is ready to delete when the report metadata is populated", () => {
    expect(
      config({
        currentRun: null,
        currentTab: undefined,
        reportMetadata: { pipelineRunStatus: "SUCCEEDED" },
        sample: { id: 88 },
      }),
    ).toEqual({
      deleteId: 88,
      isVisible: true,
      readyToDelete: true,
    });
  });

  it("is not ready to delete with an empty report and a nullish sample", () => {
    expect(
      config({
        currentRun: null,
        currentTab: undefined,
        reportMetadata: {},
        sample: undefined,
      }),
    ).toEqual({
      deleteId: undefined,
      isVisible: true,
      readyToDelete: false,
    });
  });
});

describe("SampleViewOverflowMenuConfig AMR_DEPRECATED", () => {
  it("is never visible and exposes no delete target", () => {
    expect(
      SampleViewOverflowMenuConfig[WorkflowType.AMR_DEPRECATED]({
        currentRun: { id: 1 },
        currentTab: WORKFLOW_TABS.AMR_DEPRECATED,
        reportMetadata: { pipelineRunStatus: "SUCCEEDED" },
        sample: { id: 1 },
      }),
    ).toEqual({ isVisible: false });
  });
});
