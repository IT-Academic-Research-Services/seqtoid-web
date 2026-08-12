import {
  Icon,
  IconNameToSizes,
  InputCheckbox,
  Tooltip,
} from "@czi-sds/components";
import cx from "classnames";
import React, { ReactNode } from "react";
import commonStyles from "~/components/views/SampleUploadFlow/components/WorkflowSelector/workflow_selector.scss";
import { UploadWorkflows } from "~/components/views/SampleUploadFlow/constants";
import cs from "./analysis_type.scss";

interface AnalysisTypeProps {
  description: ReactNode;
  customIcon?: ReactNode;
  isDisabled: boolean;
  isSelected: boolean;
  onClick(): void;
  sequencingPlatformOptions?: ReactNode | null;
  sdsIcon?: keyof IconNameToSizes;
  testKey: UploadWorkflows;
  title: string;
}

const AnalysisType = ({
  description,
  customIcon,
  isDisabled,
  isSelected,
  onClick,
  sequencingPlatformOptions = null,
  sdsIcon,
  testKey,
  title,
}: AnalysisTypeProps) => {
  const radioOption = (
    <InputCheckbox
      disabled={isDisabled}
      className={commonStyles.checkbox}
      stage={isSelected ? "checked" : "unchecked"}
    />
  );

  const tooltipText =
    "This is disabled because this pipeline cannot be run with the current selection.";

  return (
    <div
      // re:role, typically, we would want an actual button, but this is a container that holds
      // buttons, and you can't have a button be a descendant of a button
      role="checkbox"
      aria-checked={isSelected}
      className={cx(
        commonStyles.selectableOption,
        isSelected && commonStyles.selected,
        isDisabled && commonStyles.disabled,
      )}
      onClick={() => (isDisabled ? null : onClick())}
      key={title}
      data-testid={`analysis-type-${testKey}`}
    >
      <Tooltip
        classes={{ arrow: cs.tooltipArrow }}
        arrow
        placement="top-start"
        title={tooltipText}
        disableHoverListener={!isDisabled}
      >
        <span>{radioOption}</span>
      </Tooltip>
      <div className={cs.iconSample}>
        {/* use a custom icon if one is given, otherwise generate an SDS icon */}
        {customIcon ?? (
          <Icon
            // @ts-expect-error CZID-8698 expect strictNullCheck error: error TS2322
            sdsIcon={sdsIcon}
            sdsSize="xl"
            sdsType="static"
            className={isDisabled && cs.disabledIcon}
          />
        )}
      </div>
      <div className={commonStyles.optionText}>
        <div className={cx(commonStyles.title)}>
          <span>{title}</span>
        </div>
        <div className={cs.description}>{description}</div>
        {isSelected && (
          // The whole tile toggles workflow selection on click. The sub-options panel holds its
          // own interactive controls (the pipeline-version dropdown, platform radios), and a click
          // on any of them bubbles up to the tile's onClick and DESELECTS the workflow -- which
          // unmounts this panel. For AMR that made the version un-selectable: opening the dropdown
          // collapsed the panel before a choice could register. Stop the panel's clicks at its
          // boundary; selecting the tile still works via the checkbox/title/icon above.
          <div onClick={e => e.stopPropagation()}>{sequencingPlatformOptions}</div>
        )}
      </div>
    </div>
  );
};

export { AnalysisType };
