// Coverage for
// app/assets/src/components/views/DiscoveryView/components/SamplesView/components/BulkDeleteTrigger/BulkDeleteTrigger.tsx
// The trigger is essentially one big permission predicate: it is enabled only
// when at least one selected object was uploaded by the current user AND is in
// a state the backend will actually let them delete (finished run, failed
// upload, or an orphaned "created" upload shell older than 3h). Every arm of
// that predicate is exercised below, plus the two disabled-copy branches.
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { UserContext } from "~/components/common/UserContext";
import { WORKFLOW_ENTITIES, WorkflowType } from "~/components/utils/workflows";
import { BulkDeleteTrigger } from "~/components/views/DiscoveryView/components/SamplesView/components/BulkDeleteTrigger/BulkDeleteTrigger";

// Keeps organize-imports from dropping the React import the classic JSX
// runtime needs in scope.
const _React: typeof React = React;

const CURRENT_USER_ID = 42;
const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

const renderTrigger = (props: {
  selectedObjects: any[];
  workflowEntity?: string;
  workflow?: WorkflowType;
  onClick?: () => void;
}) => {
  const onClick = props.onClick ?? jest.fn();
  const utils = render(
    <UserContext.Provider value={{ userId: CURRENT_USER_ID } as any}>
      <BulkDeleteTrigger
        onClick={onClick}
        selectedObjects={props.selectedObjects}
        workflow={props.workflow ?? WorkflowType.CONSENSUS_GENOME}
        workflowEntity={props.workflowEntity ?? WORKFLOW_ENTITIES.SAMPLES}
      />
    </UserContext.Provider>,
  );
  const button = screen
    .getByTestId("bulk-delete-trigger")
    .querySelector("button") as HTMLButtonElement;
  return { ...utils, button, onClick };
};

// A sample owned by the current user whose pipeline run finished.
const finishedOwnedSample = {
  id: "1",
  sample: { userId: CURRENT_USER_ID, pipelineRunFinalized: 1 },
};

describe("BulkDeleteTrigger disabled states", () => {
  it("is disabled with the 'select a sample' copy when nothing is selected", async () => {
    const { button } = renderTrigger({ selectedObjects: [] });
    expect(button.disabled).toBe(true);
    fireEvent.mouseEnter(button);
    expect(await screen.findByText("Select at least 1 sample")).toBeTruthy();
  });

  it("is disabled when every selected sample belongs to another user", async () => {
    const { button } = renderTrigger({
      selectedObjects: [
        { id: "1", sample: { userId: 7, pipelineRunFinalized: 1 } },
      ],
    });
    expect(button.disabled).toBe(true);
    fireEvent.mouseEnter(button);
    expect(
      await screen.findByText(/can’t be deleted because they were all run by/),
    ).toBeTruthy();
  });

  it("is disabled when the user's own samples are all still processing", () => {
    const { button } = renderTrigger({
      selectedObjects: [
        {
          id: "1",
          sample: { userId: CURRENT_USER_ID, pipelineRunFinalized: 0 },
        },
      ],
    });
    expect(button.disabled).toBe(true);
  });

  it("does not fire onClick while disabled", () => {
    const onClick = jest.fn();
    const { button } = renderTrigger({ selectedObjects: [], onClick });
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("BulkDeleteTrigger enabled states", () => {
  it("is enabled and shows the workflow shorthand when a finished run is selected", async () => {
    const onClick = jest.fn();
    const { button } = renderTrigger({
      selectedObjects: [finishedOwnedSample],
      onClick,
    });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    fireEvent.mouseEnter(button);
    expect(await screen.findByText("Delete CG Run")).toBeTruthy();
  });

  it("is enabled when one of the user's uploads failed", () => {
    const { button } = renderTrigger({
      selectedObjects: [
        {
          id: "1",
          sample: {
            userId: CURRENT_USER_ID,
            pipelineRunFinalized: 0,
            uploadError: "upload_failed",
          },
        },
      ],
    });
    expect(button.disabled).toBe(false);
  });

  it("is enabled for workflow-run entities once a run leaves running/created", () => {
    const { button } = renderTrigger({
      selectedObjects: [
        {
          id: "1",
          status: "complete",
          sample: { userId: CURRENT_USER_ID },
        },
      ],
      workflowEntity: WORKFLOW_ENTITIES.WORKFLOW_RUNS,
    });
    expect(button.disabled).toBe(false);
  });

  it("is disabled for workflow-run entities while every run is running/created", () => {
    const { button } = renderTrigger({
      selectedObjects: [
        { id: "1", status: "running", sample: { userId: CURRENT_USER_ID } },
        { id: "2", status: "created", sample: { userId: CURRENT_USER_ID } },
      ],
      workflowEntity: WORKFLOW_ENTITIES.WORKFLOW_RUNS,
    });
    expect(button.disabled).toBe(true);
  });

  it("ignores samples uploaded by other users when deciding", () => {
    // The other user's finished sample must not unlock deletion, but the
    // current user's failed upload must.
    const { button } = renderTrigger({
      selectedObjects: [
        { id: "1", sample: { userId: 7, pipelineRunFinalized: 1 } },
        {
          id: "2",
          sample: { userId: CURRENT_USER_ID, uploadError: "err" },
        },
      ],
    });
    expect(button.disabled).toBe(false);
  });
});

describe("BulkDeleteTrigger orphaned 'created' upload handling", () => {
  const orphanBase = (overrides: Record<string, unknown> = {}) => ({
    id: "1",
    status: "created",
    createdAt: new Date(Date.now() - THREE_HOURS_MS - 60_000).toISOString(),
    sample: { userId: CURRENT_USER_ID },
    ...overrides,
  });

  it("enables deletion for a stalled created upload older than 3 hours", () => {
    const { button } = renderTrigger({ selectedObjects: [orphanBase()] });
    expect(button.disabled).toBe(false);
  });

  it("keeps a recently created upload shell disabled", () => {
    const { button } = renderTrigger({
      selectedObjects: [
        orphanBase({ createdAt: new Date(Date.now() - 60_000).toISOString() }),
      ],
    });
    expect(button.disabled).toBe(true);
  });

  it("keeps it disabled when createdAt is missing", () => {
    const { button } = renderTrigger({
      selectedObjects: [orphanBase({ createdAt: undefined })],
    });
    expect(button.disabled).toBe(true);
  });

  it("keeps it disabled when createdAt is unparseable", () => {
    const { button } = renderTrigger({
      selectedObjects: [orphanBase({ createdAt: "not-a-date" })],
    });
    expect(button.disabled).toBe(true);
  });

  it("does not treat a finalized sample as an orphan", () => {
    const { button } = renderTrigger({
      selectedObjects: [
        orphanBase({
          status: "",
          sample: { userId: CURRENT_USER_ID, pipelineRunFinalized: 1 },
        }),
      ],
      // Sample entity so the finalized-only path decides; finalized === 1 also
      // makes this deletable, so assert the enabled outcome explicitly.
    });
    expect(button.disabled).toBe(false);
  });

  it("does not treat a sample with a pipeline run status as an orphan", () => {
    const { button } = renderTrigger({
      selectedObjects: [
        orphanBase({
          status: "",
          sample: {
            userId: CURRENT_USER_ID,
            pipelineRunStatus: "RUNNING",
            pipelineRunFinalized: 0,
          },
        }),
      ],
    });
    expect(button.disabled).toBe(true);
  });

  it("does not treat a run past 'created' as an orphan", () => {
    const { button } = renderTrigger({
      selectedObjects: [
        orphanBase({
          status: "running",
          sample: { userId: CURRENT_USER_ID, pipelineRunFinalized: 0 },
        }),
      ],
    });
    expect(button.disabled).toBe(true);
  });
});
