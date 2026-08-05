import { Icon, Tooltip } from "@czi-sds/components";
import cx from "classnames";
import React from "react";
import ExternalLink from "~/components/ui/controls/ExternalLink";
import { CatalogedWorkflowVersion } from "~/interface/shared";
import commonStyles from "../../workflow_selector.scss";
import cs from "./pipeline_version_indicator.scss";

interface PipelineVersionIndicatorProps {
  warningHelpLink?: string;
  version?: string;
  versionHelpLink: string;
  isPipelineVersion: boolean;
  isNewVersionAvailable?: boolean;
  // CZID-975 -- when a catalog is supplied AND this is the pipeline-version variant, the version
  // becomes selectable. Omitting these (as the NCBI index-date variant does) keeps the original
  // read-only rendering on exactly the code path it always used.
  availableVersions?: CatalogedWorkflowVersion[];
  onVersionChange?: (version: string) => void;
}

export const PipelineVersionIndicator = ({
  warningHelpLink,
  version,
  versionHelpLink,
  isPipelineVersion,
  isNewVersionAvailable,
  availableVersions,
  onVersionChange,
}: PipelineVersionIndicatorProps) => {
  // Selection is offered only for the pipeline-version variant, and only when the caller actually
  // supplied a catalog with something in it. Anything else renders exactly as before.
  const isSelectable =
    isPipelineVersion &&
    !!onVersionChange &&
    !!availableVersions &&
    availableVersions.length > 0;
  const newVersionAvailableText = (
    <div>
      A new {isPipelineVersion ? "major version" : "NCBI Index"} is available.
      Create a new project to run samples on the latest version.{" "}
      <ExternalLink href={warningHelpLink}>Learn More</ExternalLink>
    </div>
  );

  const header = isPipelineVersion ? "Pipeline Version:" : "NCBI Index Date:";

  const versionText = isPipelineVersion ? "version" : "NCBI Index";
  let versionSubtext: string | JSX.Element = "";
  if (version) {
    versionSubtext = (
      <span>
        <span>
          The selected project uses the above {versionText} to run your samples.{" "}
        </span>
        <ExternalLink href={versionHelpLink}>Learn More</ExternalLink>
      </span>
    );
  } else {
    versionSubtext = "Choose a project to view.";
  }

  return (
    <div className={cx(cs.wrapper, commonStyles.item)}>
      <div className={cs.headerRow}>
        <div className={commonStyles.subheader}>{header}</div>
        {isNewVersionAvailable && (
          <Tooltip
            className={cs.tooltip}
            arrow
            leaveDelay={1000}
            title={newVersionAvailableText}
            placement="top"
            data-test-id="pipeline-version-tooltip"
          >
            <div>
              <Icon
                className={cs.infoIcon}
                sdsIcon="infoCircle"
                sdsSize="s"
                sdsType="interactive"
              />
            </div>
          </Tooltip>
        )}
      </div>
      {isSelectable ? (
        <select
          className={cs.version}
          value={version ?? ""}
          aria-label={header}
          data-testid="pipeline-version-select"
          onChange={event => onVersionChange(event.target.value)}
        >
          {availableVersions.map(({ version: value, deprecated, notes }) => (
            <option key={value} value={value}>
              {/* Deprecated versions still run -- they are offered, but marked, and the server
                  never returns one as the default. */}
              {deprecated
                ? `${value} (deprecated${notes ? `: ${notes}` : ""})`
                : value}
            </option>
          ))}
        </select>
      ) : (
        version && <p className={cs.version}>{version}</p>
      )}
      <p className={cs.subText}>{versionSubtext}</p>
    </div>
  );
};
