import { Icon, Menu, MenuItem, Tooltip } from "@czi-sds/components";
import { PopoverProps } from "@mui/material";
import cx from "classnames";
import React, { useContext, useState } from "react";
import { UserContext } from "~/components/common/UserContext";
import { BENCHMARKING_FEATURE } from "~/components/utils/features";
import cs from "../../samples_view.scss";
import { BenchmarkSamplesMenuItem } from "../BenchmarkSamplesMenuItem";
import ToolbarButtonIcon from "../ToolbarButtonIcon/ToolbarButtonIcon";

interface BulkSamplesActionsMenuProps {
  noObjectsSelected: boolean;
  handleBulkKickoffAmr: () => void;
  handleClickBenchmark: () => void;
  handleClickPhyloTree: () => void;
  // Retry Upload: enabled only when a selected sample's upload failed. For a local
  // upload the browser no longer has the file after leaving the upload session, so
  // this routes the user back into the upload flow to re-select (Options C/B will
  // later recover the file automatically — see docs/upload-recovery.md).
  canRetryUpload: boolean;
  onRetryUpload: () => void;
  popupPosition?: "top left" | "top center";
}

const BulkSamplesActionsMenu = ({
  noObjectsSelected,
  handleBulkKickoffAmr,
  handleClickPhyloTree,
  handleClickBenchmark,
  canRetryUpload,
  onRetryUpload,
  popupPosition,
}: BulkSamplesActionsMenuProps) => {
  const { admin, allowedFeatures = [] } = useContext(UserContext) || {};
  const [menuAnchorEl, setMenuAnchorEl] =
    useState<PopoverProps["anchorEl"]>(null);

  const openActionsMenu = (event: React.MouseEvent<HTMLElement>) => {
    setMenuAnchorEl(event.currentTarget);
  };

  const closeActionsMenu = () => {
    setMenuAnchorEl(null);
  };

  const renderBulkKickoffAmr = () => {
    let bulkKickoffAmrMenuItem = (
      <MenuItem
        className={cs.dropdownItem}
        // TODO: Disabled until we fix AMR workflows to use post-human-filtered data
        disabled={true} // {noObjectsSelected}
        onClick={() => {
          closeActionsMenu();
          handleBulkKickoffAmr();
        }}
      >
        <div className={cs.itemWrapper}>
          <div
            className={cx(
              cs.bulkActionsIcon,
              noObjectsSelected && cs.iconDisabled,
            )}
          >
            <Icon sdsIcon={"bacteria"} sdsSize="xs" sdsType="static" />
          </div>
          {"Run Antimicrobial Resistance Pipeline"}
        </div>
      </MenuItem>
    );

    // TODO: Disabled until we fix AMR workflows to use post-human-filtered data
    // if (noObjectsSelected) {
    //   bulkKickoffAmrMenuItem = (
    //     <Tooltip
    //       arrow
    //       placement="top"
    //       title={"Select at least 1 mNGS run to perform this action."}
    //     >
    //       <span>{bulkKickoffAmrMenuItem}</span>
    //     </Tooltip>
    //   );
    // }
    bulkKickoffAmrMenuItem = (
      <Tooltip arrow placement="top" title={"Temporarily Disabled."}>
        <span>{bulkKickoffAmrMenuItem}</span>
      </Tooltip>
    );

    return bulkKickoffAmrMenuItem;
  };

  const renderKickoffPhyloTree = () => {
    return (
      <MenuItem
        onClick={() => {
          closeActionsMenu();
          handleClickPhyloTree();
        }}
      >
        <div data-testid="create-phylogenetic-tree" className={cs.itemWrapper}>
          <div className={cs.bulkActionsIcon}>
            <Icon sdsIcon={"treeHorizontal"} sdsSize="xs" sdsType="static" />
          </div>
          {"Create Phylogenetic Tree"}
        </div>
      </MenuItem>
    );
  };

  const renderRetryUpload = () => {
    let retryUploadMenuItem = (
      <MenuItem
        className={cs.dropdownItem}
        disabled={!canRetryUpload}
        onClick={() => {
          closeActionsMenu();
          onRetryUpload();
        }}
      >
        <div className={cs.itemWrapper}>
          <div
            className={cx(
              cs.bulkActionsIcon,
              !canRetryUpload && cs.iconDisabled,
            )}
          >
            <Icon sdsIcon={"refresh"} sdsSize="xs" sdsType="static" />
          </div>
          {"Retry Upload"}
        </div>
      </MenuItem>
    );

    if (!canRetryUpload) {
      retryUploadMenuItem = (
        <Tooltip
          arrow
          placement="top"
          title={"Select a sample whose upload failed to retry it."}
        >
          <span>{retryUploadMenuItem}</span>
        </Tooltip>
      );
    }

    return retryUploadMenuItem;
  };

  const hasAccessToBenchmark =
    admin && allowedFeatures.includes(BENCHMARKING_FEATURE);

  return (
    <>
      <ToolbarButtonIcon
        testId="dots-horizontal"
        className={cs.action}
        icon="dotsHorizontal"
        popupText={"More Actions"}
        popupSubtitle={noObjectsSelected ? "Select at least 1 sample" : ""}
        popupPosition={popupPosition}
        disabled={noObjectsSelected}
        onClick={openActionsMenu}
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
        {renderRetryUpload()}
        {renderKickoffPhyloTree()}
        {/* @ts-expect-error CZID-8698 expect strictNullCheck error: error TS2774 */}
        {handleBulkKickoffAmr && renderBulkKickoffAmr()}
        {hasAccessToBenchmark && (
          <BenchmarkSamplesMenuItem
            disabled={noObjectsSelected}
            onClick={() => {
              closeActionsMenu();
              handleClickBenchmark();
            }}
          />
        )}
      </Menu>
    </>
  );
};

export default BulkSamplesActionsMenu;
