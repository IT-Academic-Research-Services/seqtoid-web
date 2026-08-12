import { Icon, Tooltip } from "@czi-sds/components";
import cx from "classnames";
import React from "react";
import { Dropdown } from "~/components/ui/controls/dropdowns";
import ExternalLink from "~/components/ui/controls/ExternalLink";
import { CatalogedWorkflowVersion } from "~/interface/shared";
import commonStyles from "../../workflow_selector.scss";
import cs from "./pipeline_version_indicator.scss";

// CZID-975 -- a deprecated version still runs, it is just no longer patched, so it is offered with a
// marker rather than hidden. Hoisted out of the JSX: nesting template literals trips
// sonarjs/no-nested-template-literals.
const versionOptionLabel = ({
  version,
  deprecated,
  notes,
}: CatalogedWorkflowVersion): string => {
  if (!deprecated) return version;
  const reason = notes ? `: ${notes}` : "";
  return `${version} (deprecated${reason})`;
};

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

  // The DEFAULT selection is whatever the project already runs, so opening the dropdown shows
  // today's behaviour and every other version is an opt-in departure from it.
  //
  // That only holds if the current version is actually one of the options. The catalog endpoint
  // lists runnable versions, and a project can be pinned to one that has since been marked
  // non-runnable or deprecated -- in which case `value` matches no <option> and the browser renders
  // the select BLANK, silently misreporting what the run will use. Prepending it keeps the default
  // truthful; it is marked so nobody reads it as a normal choice.
  const versionOptions =
    isSelectable && version && !availableVersions.some(entry => entry.version === version)
      ? [{ version, deprecated: false, notes: "current version for this project" }, ...availableVersions]
      : (availableVersions ?? []);
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
        // Use the platform-standard Dropdown (same control the rest of the upload flow uses, e.g.
        // WetlabSelector) so this matches every other dropdown on the platform, rather than a bare
        // native <select>. onChange hands back the option value, which is the exact catalogued
        // version string -- that is what gets submitted and, per VersionRetrievalService, run
        // verbatim.
        <Dropdown
          className={cs.version}
          value={version ?? undefined}
          options={versionOptions.map(entry => ({
            text: versionOptionLabel(entry),
            value: entry.version,
          }))}
          onChange={(value: string) => onVersionChange(value)}
        />
      ) : (
        version && <p className={cs.version}>{version}</p>
      )}
      <p className={cs.subText}>{versionSubtext}</p>
    </div>
  );
};
