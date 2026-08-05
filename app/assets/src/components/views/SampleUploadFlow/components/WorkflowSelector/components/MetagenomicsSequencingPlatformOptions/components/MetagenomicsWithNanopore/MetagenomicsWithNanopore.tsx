import React from "react";
import { ANALYTICS_EVENT_NAMES } from "~/api/analytics";
import ExternalLink from "~/components/ui/controls/ExternalLink";
import {
  CONCAT_FILES_HELP_LINK_ONT,
  MNGS_NANOPORE_PIPELINE_GITHUB_LINK,
} from "~/components/utils/documentationLinks";
import { WorkflowType } from "~/components/utils/workflows";
import { CatalogedWorkflowVersion } from "~/interface/shared";
import { SEQUENCING_TECHNOLOGY_OPTIONS } from "../../../../../../constants";
import { WorkflowLinksConfig } from "../../../../workflowTypeConfig";
import { SequencingPlatformOption } from "../../../SequencingPlatformOption";
import { MetagenomicsNanoporeSettings } from "./components/MetagenomicsNanoporeSettings";

interface MetagenomicsWithNanoporeProps {
  indexVersion?: string;
  isDisabled: boolean;
  isSelected: boolean;
  onClick(): void;
  selectedGuppyBasecallerSetting: string;
  onChangeGuppyBasecallerSetting(selected: string): void;
  pipelineVersion?: string;
  // CZID-975 -- version selection for this workflow. Optional: without a catalog and a handler
  // the indicator renders read-only exactly as before.
  availableVersions?: CatalogedWorkflowVersion[];
  onVersionChange?: (selected: string) => void;
  selectedVersion?: string;
  latestMajorPipelineVersion?: string;
  latestMajorIndexVersion?: string;
}

const MetagenomicsWithNanopore = ({
  indexVersion,
  isDisabled,
  isSelected,
  onClick,
  selectedGuppyBasecallerSetting,
  onChangeGuppyBasecallerSetting,
  pipelineVersion,
  availableVersions,
  onVersionChange,
  selectedVersion,
  latestMajorPipelineVersion,
  latestMajorIndexVersion,
}: MetagenomicsWithNanoporeProps) => {
  const tooltipText = "This pipeline only supports upload from your computer.";
  const { pipelineVersionLink, warningLink } =
    WorkflowLinksConfig[WorkflowType.LONG_READ_MNGS];
  return (
    <SequencingPlatformOption
      analyticsEventName={
        ANALYTICS_EVENT_NAMES.UPLOAD_SAMPLE_STEP_MNGS_NANOPORE_PIPELINE_LINK_CLICKED
      }
      customDescription={
        <React.Fragment>
          <span>You can check out the Nanopore pipeline on Github </span>
          <ExternalLink
            href={MNGS_NANOPORE_PIPELINE_GITHUB_LINK}
            disabled={isDisabled}
          >
            here
          </ExternalLink>
          .{" "}
          <span>
            Learn about the auto-concatenation of Nanopore FASTQ files{" "}
          </span>
        </React.Fragment>
      }
      githubLink={CONCAT_FILES_HELP_LINK_ONT}
      isDisabled={isDisabled}
      isSelected={isSelected}
      onClick={onClick}
      indexVersion={indexVersion}
      showIndexVersion={true}
      technologyName="Nanopore"
      technologyDetails={
        <MetagenomicsNanoporeSettings
          selectedGuppyBasecallerSetting={selectedGuppyBasecallerSetting}
          onChangeGuppyBasecallerSetting={onChangeGuppyBasecallerSetting}
        />
      }
      testId={SEQUENCING_TECHNOLOGY_OPTIONS.NANOPORE}
      tooltipText={tooltipText}
      pipelineVersion={pipelineVersion}
      availableVersions={availableVersions}
      onVersionChange={onVersionChange}
      selectedVersion={selectedVersion}
      latestMajorPipelineVersion={latestMajorPipelineVersion}
      latestMajorIndexVersion={latestMajorIndexVersion}
      versionHelpLink={pipelineVersionLink}
      warningHelpLink={warningLink}
    />
  );
};

export { MetagenomicsWithNanopore };
