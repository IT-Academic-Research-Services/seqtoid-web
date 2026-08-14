import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Icon,
  Menu,
  MenuItem,
  Tooltip,
} from "@czi-sds/components";
import { PrimaryButton, SecondaryButton } from "~/components/ui/controls/buttons";
import { cx } from "@emotion/css";
import { PopoverProps } from "@mui/material";
import React, { useContext, useState } from "react";
import { rerunPipeline, rerunWorkflowRun, retryPipelineRun } from "~/api";
import { UserContext } from "~/components/common/UserContext";
import { openSupportPortal } from "~/components/common/SupportPortal/openSupportPortal";
import { WorkflowLabelType } from "~/components/utils/workflows";
import BulkDeleteModal from "~/components/views/DiscoveryView/components/SamplesView/components/BulkDeleteModal";
import { SampleId } from "~/interface/shared";
import cs from "./overflow_menu.scss";

interface OverflowMenuProps {
  readyToDelete?: boolean;
  className: string;
  deleteId?: SampleId;
  onDeleteRunSuccess: () => void;
  redirectOnSuccess?: boolean;
  runFinalized: boolean;
  sampleUserId: number;
  workflowShorthand: string;
  workflowLabel: WorkflowLabelType;
  isShortReadMngs?: boolean;
  // Self-service recovery (CZID-676 Phase C). sampleId drives the mNGS retry/re-run
  // endpoints; workflowRunId drives the CG/AMR re-run. isMngs gates the cheap retry
  // (only mNGS has the reconcile primitive). supportNote pre-populates the support
  // popup so a genuinely-failed run can be escalated to the team with context.
  sampleId?: SampleId;
  workflowRunId?: number | string | null;
  isMngs?: boolean;
  supportNote?: string;
  onRecoverySuccess?: () => void;
}

export const OverflowMenu = ({
  readyToDelete,
  className,
  deleteId,
  onDeleteRunSuccess,
  redirectOnSuccess,
  runFinalized,
  sampleUserId,
  workflowShorthand,
  workflowLabel,
  isShortReadMngs,
  sampleId,
  workflowRunId,
  isMngs,
  supportNote,
  onRecoverySuccess,
}: OverflowMenuProps) => {
  // Render the menu whenever there is a run to act on. Delete is shown only when the
  // run is deletable (readyToDelete); the recovery items (Retry/Re-run/Report) are
  // ALWAYS shown -- disabled with a tooltip when they can't run -- so they appear on
  // failed samples too (some failures leave readyToDelete/runFinalized false). CZID-676.
  if (!deleteId) return null;
  const [menuAnchorEl, setMenuAnchorEl] =
    useState<PopoverProps["anchorEl"]>(null);
  const [isBulkDeleteModalOpen, setIsBulkDeleteModalOpen] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);
  const [isRerunConfirmOpen, setIsRerunConfirmOpen] = useState(false);

  const openActionsMenu = (event: React.MouseEvent<HTMLElement>) => {
    setMenuAnchorEl(event.currentTarget);
  };

  const closeActionsMenu = () => {
    setMenuAnchorEl(null);
  };

  const { userId } = useContext(UserContext) || {};
  const userOwnsRun = userId === sampleUserId;
  const deleteDisabled = !(userOwnsRun && runFinalized);

  // Self-service recovery (CZID-676 Phase C). Retry/Re-run are ALWAYS shown, enabled for
  // the run's creator and greyed (with a tooltip) for everyone else. Enablement is gated on
  // ownership only -- NOT runFinalized -- because some failures leave run_finalized false,
  // and the server already enforces run-state safety (retry no-ops unless the run failed;
  // re-run no-ops while a run is in progress) plus creator-or-admin + the daily cap.
  const recoveryDisabled = !userOwnsRun || isRecovering;
  const recoveryTooltip = !userOwnsRun
    ? "Only the user that initiated the run can perform this action."
    : undefined;

  const runRecovery = async (fn: () => Promise<unknown>) => {
    setIsRecovering(true);
    closeActionsMenu();
    try {
      await fn();
      if (onRecoverySuccess) {
        onRecoverySuccess();
      } else {
        window.location.reload();
      }
    } catch (error) {
      // Fall back to the support escalation so the user is never stuck.
      // eslint-disable-next-line no-console
      console.error("Recovery action failed", error);
      openSupportPortal({ note: supportNote });
    } finally {
      setIsRecovering(false);
    }
  };

  const handleRetry = () => {
    if (sampleId == null) return;
    runRecovery(() => retryPipelineRun(Number(sampleId)));
  };

  const handleRerun = () => {
    closeActionsMenu();
    setIsRerunConfirmOpen(true);
  };

  const confirmRerun = () => {
    setIsRerunConfirmOpen(false);
    if (isMngs && sampleId != null) {
      runRecovery(() => rerunPipeline(Number(sampleId)));
    } else if (workflowRunId != null) {
      runRecovery(() => rerunWorkflowRun(Number(workflowRunId)));
    }
  };

  const handleReportToSupport = () => {
    closeActionsMenu();
    openSupportPortal({ note: supportNote });
  };

  const renderRecoveryMenuItem = (
    key: string,
    label: string,
    iconNode: React.ReactNode,
    onClick: () => void,
    disabled: boolean,
  ) => {
    const item = (
      <MenuItem
        key={key}
        disabled={disabled}
        onClick={onClick}
        data-testid={`${key}-menuitem`}
      >
        <div className={cx(cs.dropdownItem, disabled && cs.iconDisabled)}>
          {iconNode}
          <span>{label}</span>
        </div>
      </MenuItem>
    );
    if (disabled && recoveryTooltip) {
      return (
        <Tooltip key={key} arrow placement="top" title={recoveryTooltip}>
          <span>{item}</span>
        </Tooltip>
      );
    }
    return item;
  };

  const recoveryIcon = (
    <Icon sdsIcon="flask" sdsSize="xs" sdsType="static" className={cs.icon} />
  );
  const supportIcon = (
    <Icon
      sdsIcon="infoSpeechBubble"
      sdsSize="xs"
      sdsType="static"
      className={cs.icon}
    />
  );

  const renderDeleteRunMenuItem = () => {
    let deleteRunMenuItem = (
      <MenuItem
        disabled={deleteDisabled}
        onClick={() => {
          closeActionsMenu();
          setIsBulkDeleteModalOpen(true);
        }}
        data-testid="delete-run-menuitem"
      >
        <div className={cx(cs.dropdownItem, deleteDisabled && cs.iconDisabled)}>
          <Icon
            sdsIcon="trashCan"
            sdsSize="xs"
            sdsType="static"
            className={cs.icon}
          />
          <span>{`Delete ${workflowShorthand} Run`}</span>
        </div>
      </MenuItem>
    );
    if (deleteDisabled) {
      const tooltipText = userOwnsRun
        ? !runFinalized && "You can only delete runs that are completed."
        : "Only the user that initiated the run can perform this action.";

      deleteRunMenuItem = (
        <Tooltip
          arrow
          placement="top"
          title={tooltipText}
          data-testid="delete-disabled-tooltip"
        >
          <span>{deleteRunMenuItem}</span>
        </Tooltip>
      );
    }
    return deleteRunMenuItem;
  };

  return (
    <>
      <Button
        className={cx(cs.helpButton, className)}
        sdsType="secondary"
        sdsStyle="rounded"
        startIcon={
          <Icon sdsIcon="dotsHorizontal" sdsSize="l" sdsType="button" />
        }
        onClick={openActionsMenu}
        data-testid="overflow-btn"
      />
      <Menu
        anchorEl={menuAnchorEl}
        anchorOrigin={{
          vertical: "bottom",
          horizontal: "right",
        }}
        transformOrigin={{
          vertical: "top",
          horizontal: "right",
        }}
        keepMounted
        open={Boolean(menuAnchorEl)}
        onClose={closeActionsMenu}
      >
        {readyToDelete && renderDeleteRunMenuItem()}
        {isMngs &&
          sampleId != null &&
          renderRecoveryMenuItem(
            "retry-run",
            `Retry ${workflowShorthand} Analysis`,
            recoveryIcon,
            handleRetry,
            recoveryDisabled,
          )}
        {(sampleId != null || workflowRunId != null) &&
          renderRecoveryMenuItem(
            "rerun-run",
            `Re-run ${workflowShorthand} Analysis`,
            recoveryIcon,
            handleRerun,
            recoveryDisabled,
          )}
        {renderRecoveryMenuItem(
          "report-run",
          "Report to our team",
          supportIcon,
          handleReportToSupport,
          false,
        )}
      </Menu>
      <BulkDeleteModal
        isOpen={isBulkDeleteModalOpen}
        onClose={() => setIsBulkDeleteModalOpen(false)}
        selectedIds={[deleteId]}
        onSuccess={onDeleteRunSuccess}
        redirectOnSuccess={redirectOnSuccess}
        workflowLabel={workflowLabel}
        isShortReadMngs={isShortReadMngs}
      />
      <Dialog
        open={isRerunConfirmOpen}
        onClose={() => setIsRerunConfirmOpen(false)}
        sdsSize="xs"
      >
        <DialogTitle title={`Re-run ${workflowShorthand} analysis?`} />
        <DialogContent>
          Re-running starts a fresh analysis and uses compute. This may take a
          while and counts toward the daily re-run limit. Continue?
        </DialogContent>
        <DialogActions>
          {/* These wrappers render their label from the `text` prop, not children
              (see Button.tsx); passing the label as children leaves the button blank. */}
          <SecondaryButton
            sdsStyle="rounded"
            text="Cancel"
            onClick={() => setIsRerunConfirmOpen(false)}
          />
          <PrimaryButton
            sdsStyle="rounded"
            text="Re-run"
            onClick={confirmRerun}
          />
        </DialogActions>
      </Dialog>
    </>
  );
};
