// Coverage for
// app/assets/src/components/views/SampleView/components/SampleViewHeader/components/
//   PrimaryHeaderControls/components/SampleViewOverflowMenu/components/OverflowMenu/OverflowMenu.tsx
//
// The overflow menu is a permission + run-state machine: which items appear is
// driven by readyToDelete / isMngs / sampleId / workflowRunId, and whether they
// are enabled is driven by run ownership. On top of that sit the self-service
// recovery actions (retry, re-run behind a confirm dialog, report to support)
// each with a success and a failure path. Every one of those arms is driven
// through the rendered DOM below.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { UserContext } from "~/components/common/UserContext";
import { OverflowMenu } from "~/components/views/SampleView/components/SampleViewHeader/components/PrimaryHeaderControls/components/SampleViewOverflowMenu/components/OverflowMenu/OverflowMenu";

const mockRerunPipeline = jest.fn();
const mockRerunWorkflowRun = jest.fn();
const mockRetryPipelineRun = jest.fn();
jest.mock("~/api", () => ({
  rerunPipeline: (...a: unknown[]) => mockRerunPipeline(...a),
  rerunWorkflowRun: (...a: unknown[]) => mockRerunWorkflowRun(...a),
  retryPipelineRun: (...a: unknown[]) => mockRetryPipelineRun(...a),
}));

const mockOpenSupportPortal = jest.fn();
jest.mock("~/components/common/SupportPortal/openSupportPortal", () => ({
  openSupportPortal: (...a: unknown[]) => mockOpenSupportPortal(...a),
}));

// The real modal drags in the whole bulk-delete API surface; only its props matter here.
jest.mock(
  "~/components/views/DiscoveryView/components/SamplesView/components/BulkDeleteModal",
  () => ({
    __esModule: true,
    default: (props: $TSFixMe) => (
      <div
        data-testid="bulk-delete-modal"
        data-open={String(props.isOpen)}
        data-ids={JSON.stringify(props.selectedIds)}
      />
    ),
  }),
);

// Keeps organize-imports from dropping the React import the classic JSX runtime needs.
const _React: typeof React = React;

const OWNER_ID = 7;

const renderMenu = (props: Partial<$TSFixMe> = {}, userId = OWNER_ID) => {
  const onDeleteRunSuccess = jest.fn();
  const utils = render(
    <UserContext.Provider value={{ userId } as $TSFixMe}>
      <OverflowMenu
        className="overflow"
        deleteId={1}
        onDeleteRunSuccess={onDeleteRunSuccess}
        runFinalized={true}
        sampleUserId={OWNER_ID}
        workflowShorthand="mNGS"
        workflowLabel={"Metagenomic" as $TSFixMe}
        readyToDelete
        {...props}
      />
    </UserContext.Provider>,
  );
  return { ...utils, onDeleteRunSuccess };
};

const openMenu = () => fireEvent.click(screen.getByTestId("overflow-btn"));

// The confirm dialog's actions are rendered through the app's semantic-ui
// Button wrapper, which puts its copy in a `text` prop rather than children --
// so they are addressed by their primary/secondary class instead of by label.
const dialogButton = (kind: "primary" | "secondary") =>
  document.querySelector(`button.ui.${kind}`) as HTMLElement;

const itemButton = (testId: string) => {
  const el = screen.getByTestId(testId);
  return el.tagName === "LI" ? el : (el.querySelector("li") as HTMLElement);
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("OverflowMenu rendering", () => {
  it("renders nothing when there is no run to act on", () => {
    const { container } = render(
      <UserContext.Provider value={{ userId: OWNER_ID } as $TSFixMe}>
        <OverflowMenu
          className="overflow"
          deleteId={undefined}
          onDeleteRunSuccess={jest.fn()}
          runFinalized={true}
          sampleUserId={OWNER_ID}
          workflowShorthand="mNGS"
          workflowLabel={"Metagenomic" as $TSFixMe}
        />
      </UserContext.Provider>,
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("overflow-btn")).toBeNull();
  });

  it("shows the delete item only when the run is ready to delete", () => {
    renderMenu({ readyToDelete: true, sampleId: 5, isMngs: true });
    openMenu();
    expect(screen.getByTestId("delete-run-menuitem")).toBeTruthy();
    expect(screen.getByText("Delete mNGS Run")).toBeTruthy();
  });

  it("hides the delete item when the run is not ready to delete", () => {
    renderMenu({ readyToDelete: false, sampleId: 5, isMngs: true });
    openMenu();
    expect(screen.queryByTestId("delete-run-menuitem")).toBeNull();
    // Recovery items are still offered on a failed / unfinished run.
    expect(screen.getByTestId("retry-run-menuitem")).toBeTruthy();
    expect(screen.getByTestId("report-run-menuitem")).toBeTruthy();
  });

  it("offers Retry only for mNGS runs", () => {
    renderMenu({ sampleId: 5, isMngs: false, workflowRunId: 12 });
    openMenu();
    expect(screen.queryByTestId("retry-run-menuitem")).toBeNull();
    expect(screen.getByTestId("rerun-run-menuitem")).toBeTruthy();
  });

  it("omits Re-run when there is neither a sample nor a workflow run", () => {
    renderMenu({ sampleId: undefined, workflowRunId: undefined });
    openMenu();
    expect(screen.queryByTestId("rerun-run-menuitem")).toBeNull();
    expect(screen.queryByTestId("retry-run-menuitem")).toBeNull();
    // Report to support is unconditional.
    expect(screen.getByTestId("report-run-menuitem")).toBeTruthy();
  });

  it("labels the recovery items with the workflow shorthand", () => {
    renderMenu({ sampleId: 5, isMngs: true, workflowShorthand: "CG" });
    openMenu();
    expect(screen.getByText("Retry CG Analysis")).toBeTruthy();
    expect(screen.getByText("Re-run CG Analysis")).toBeTruthy();
  });

  it("passes the run id through to the bulk delete modal, closed by default", () => {
    renderMenu({ deleteId: 42 });
    const modal = screen.getByTestId("bulk-delete-modal");
    expect(modal.getAttribute("data-open")).toBe("false");
    expect(modal.getAttribute("data-ids")).toBe("[42]");
  });

  it("opens the bulk delete modal when Delete is clicked", () => {
    renderMenu({ deleteId: 42 });
    openMenu();
    fireEvent.click(itemButton("delete-run-menuitem"));
    expect(
      screen.getByTestId("bulk-delete-modal").getAttribute("data-open"),
    ).toBe("true");
  });
});

describe("OverflowMenu permissions", () => {
  it("enables delete and recovery for the run owner on a finalized run", () => {
    renderMenu({ sampleId: 5, isMngs: true });
    openMenu();
    expect(
      itemButton("delete-run-menuitem").getAttribute("aria-disabled"),
    ).toBeNull();
    expect(
      itemButton("retry-run-menuitem").getAttribute("aria-disabled"),
    ).toBeNull();
  });

  it("disables delete and recovery for a non-owner and explains why", () => {
    renderMenu({ sampleId: 5, isMngs: true }, OWNER_ID + 1);
    openMenu();
    expect(
      itemButton("delete-run-menuitem").getAttribute("aria-disabled"),
    ).toBe("true");
    expect(itemButton("retry-run-menuitem").getAttribute("aria-disabled")).toBe(
      "true",
    );
    // Disabled recovery items are wrapped in an explanatory tooltip.
    expect(
      screen.getByTestId("retry-run-menuitem").closest("span"),
    ).not.toBeNull();
  });

  it("disables delete (but not recovery) for the owner of an unfinished run", () => {
    renderMenu({ sampleId: 5, isMngs: true, runFinalized: false });
    openMenu();
    expect(
      itemButton("delete-run-menuitem").getAttribute("aria-disabled"),
    ).toBe("true");
    expect(
      itemButton("retry-run-menuitem").getAttribute("aria-disabled"),
    ).toBeNull();
  });

  it("leaves recovery items untooltipped when they are enabled", () => {
    renderMenu({ sampleId: 5, isMngs: true });
    openMenu();
    // The owner sees no ownership tooltip, so the item is not wrapped.
    const retry = screen.getByTestId("retry-run-menuitem");
    expect(retry.parentElement?.tagName).not.toBe("SPAN");
  });
});

describe("OverflowMenu retry", () => {
  it("calls retryPipelineRun and reports success to the caller", async () => {
    mockRetryPipelineRun.mockResolvedValue({ status: "ok" });
    const onRecoverySuccess = jest.fn();
    renderMenu({ sampleId: "5", isMngs: true, onRecoverySuccess });
    openMenu();
    fireEvent.click(itemButton("retry-run-menuitem"));
    await waitFor(() => expect(onRecoverySuccess).toHaveBeenCalled());
    expect(mockRetryPipelineRun).toHaveBeenCalledWith(5);
    expect(mockOpenSupportPortal).not.toHaveBeenCalled();
  });

  it("falls back to the support portal when retry fails", async () => {
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mockRetryPipelineRun.mockRejectedValue(new Error("boom"));
    const onRecoverySuccess = jest.fn();
    renderMenu({
      sampleId: 5,
      isMngs: true,
      onRecoverySuccess,
      supportNote: "mNGS run 5 failed",
    });
    openMenu();
    fireEvent.click(itemButton("retry-run-menuitem"));
    await waitFor(() =>
      expect(mockOpenSupportPortal).toHaveBeenCalledWith({
        note: "mNGS run 5 failed",
      }),
    );
    expect(onRecoverySuccess).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("reloads the page when no success callback was supplied", async () => {
    const reload = jest.fn();
    const original = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...original, reload },
    });
    mockRetryPipelineRun.mockResolvedValue({});
    renderMenu({ sampleId: 5, isMngs: true });
    openMenu();
    fireEvent.click(itemButton("retry-run-menuitem"));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    Object.defineProperty(window, "location", {
      configurable: true,
      value: original,
    });
  });
});

describe("OverflowMenu re-run confirmation", () => {
  it("asks for confirmation before starting a re-run", () => {
    renderMenu({ sampleId: 5, isMngs: true });
    openMenu();
    fireEvent.click(itemButton("rerun-run-menuitem"));
    expect(screen.getByText("Re-run mNGS analysis?")).toBeTruthy();
    expect(mockRerunPipeline).not.toHaveBeenCalled();
  });

  it("cancelling the dialog starts nothing", async () => {
    renderMenu({ sampleId: 5, isMngs: true });
    openMenu();
    fireEvent.click(itemButton("rerun-run-menuitem"));
    fireEvent.click(dialogButton("secondary"));
    await waitFor(() =>
      expect(screen.queryByText("Re-run mNGS analysis?")).toBeNull(),
    );
    expect(mockRerunPipeline).not.toHaveBeenCalled();
    expect(mockRerunWorkflowRun).not.toHaveBeenCalled();
  });

  it("confirming an mNGS re-run calls rerunPipeline with the sample id", async () => {
    mockRerunPipeline.mockResolvedValue({});
    const onRecoverySuccess = jest.fn();
    renderMenu({
      sampleId: 5,
      isMngs: true,
      workflowRunId: 99,
      onRecoverySuccess,
    });
    openMenu();
    fireEvent.click(itemButton("rerun-run-menuitem"));
    fireEvent.click(dialogButton("primary"));
    await waitFor(() => expect(mockRerunPipeline).toHaveBeenCalledWith(5));
    expect(mockRerunWorkflowRun).not.toHaveBeenCalled();
    expect(onRecoverySuccess).toHaveBeenCalled();
  });

  it("confirming a non-mNGS re-run calls rerunWorkflowRun with the run id", async () => {
    mockRerunWorkflowRun.mockResolvedValue({});
    const onRecoverySuccess = jest.fn();
    renderMenu({
      sampleId: undefined,
      isMngs: false,
      workflowRunId: 99,
      workflowShorthand: "CG",
      onRecoverySuccess,
    });
    openMenu();
    fireEvent.click(itemButton("rerun-run-menuitem"));
    fireEvent.click(dialogButton("primary"));
    await waitFor(() => expect(mockRerunWorkflowRun).toHaveBeenCalledWith(99));
    expect(mockRerunPipeline).not.toHaveBeenCalled();
  });
});

describe("OverflowMenu report to support", () => {
  it("is always enabled and opens the portal with the support note", () => {
    renderMenu({ sampleId: 5, isMngs: true, supportNote: "context" }, 999);
    openMenu();
    const report = itemButton("report-run-menuitem");
    expect(report.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(report);
    expect(mockOpenSupportPortal).toHaveBeenCalledWith({ note: "context" });
  });

  it("passes an undefined note when none was supplied", () => {
    renderMenu({ sampleId: 5, isMngs: true });
    openMenu();
    fireEvent.click(itemButton("report-run-menuitem"));
    expect(mockOpenSupportPortal).toHaveBeenCalledWith({ note: undefined });
  });
});
