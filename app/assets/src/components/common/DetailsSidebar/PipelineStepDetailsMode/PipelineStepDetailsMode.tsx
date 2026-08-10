import cx from "classnames";
import Linkify from "linkify-react";
import moment from "moment";
import React, { ReactNode } from "react";
import ReactMarkdown, { Components } from "react-markdown";
import { Accordion } from "~/components/layout";
import { sampleErrorInfo } from "~/components/utils/sample";
import PipelineVizStatusIcon from "~/components/views/PipelineViz/PipelineVizStatusIcon";
import Sample from "~/interface/sample";
import { FileList, InputFile, NameUrl, PipelineRun } from "~/interface/shared";
import cs from "./pipeline_step_details_mode.scss";

// linkify-react walks the React tree it is given and, for every element whose
// type is not a plain tag name, clones it with its string children replaced by
// an ARRAY of nodes. react-markdown requires `children` to be a single string,
// so wrapping <ReactMarkdown> in <Linkify> destroys the markdown: development
// builds throw, production builds render nothing at all. Linkify therefore has
// to run INSIDE the markdown renderer, over already-parsed paragraph content,
// rather than around it.
// ignoreTags keeps linkify out of anchors the markdown itself produced (which
// would otherwise nest <a> inside <a>) and out of code spans.
const LINKIFY_OPTIONS = { ignoreTags: ["a", "code", "pre"] };

const MARKDOWN_COMPONENTS: Components = {
  p: ({ children }) => (
    <Linkify as="p" options={LINKIFY_OPTIONS}>
      {children}
    </Linkify>
  ),
};

export interface PSDProps {
  status: string;
  startTime: number;
  endTime: number;
  sample: Sample;
  pipelineRun: PipelineRun;
  description: string;
  inputFiles: InputFile[];
  stepName: string;
  outputFiles: FileList;
  resources: NameUrl[];
}

const PipelineStepDetailsMode = ({
  status,
  startTime,
  endTime,
  sample,
  pipelineRun,
  description,
  inputFiles,
  stepName,
  outputFiles,
  resources,
}: PSDProps) => {
  const renderStatusBox = () => {
    let statusTitle: string, statusDescription: ReactNode;
    switch (status) {
      case "inProgress":
        statusTitle = "Current step";
        statusDescription = `Running for ${moment(
          Math.floor(startTime * 1000), // Convert seconds to milliseconds
        ).fromNow(true)}`;
        break;
      case "userErrored":
      case "pipelineErrored": {
        const { message, linkText, link } = sampleErrorInfo({
          sampleId: sample.id,
          sampleUploadError: sample.upload_error,
          pipelineRun,
        });
        statusTitle = "Sample failed at this step.";
        statusDescription = (
          <span>
            {message} <a href={link}>{linkText}</a>
          </span>
        );
        break;
      }
      case "finished":
        statusTitle = "Step completed";
        statusDescription =
          endTime &&
          `Finished in ${moment(Math.floor(startTime * 1000)).from(
            endTime * 1000,
            true,
          )}.`;
        break;
      default:
        return;
    }

    return (
      <div className={cx(cs.statusBox, cs[status])}>
        <PipelineVizStatusIcon type={status} className={cs.statusIcon} />
        <div className={cs.statusText}>
          <div className={cs.statusTitle}>{statusTitle}</div>
          <div className={cs.statusDescription}>{statusDescription}</div>
        </div>
      </div>
    );
  };

  const renderStepInfo = () => {
    if (description) {
      const header = <div className={cs.title}>Step Info</div>;
      const descriptionWithoutIndentation = description.replace(/( {4})/gi, "");
      return (
        <Accordion header={header} className={cs.accordion} open={true}>
          <div className={cx(cs.description, cs.accordionContent)}>
            <div className={cs.description}>
              <ReactMarkdown components={MARKDOWN_COMPONENTS}>
                {descriptionWithoutIndentation}
              </ReactMarkdown>
            </div>
          </div>
        </Accordion>
      );
    }
  };

  const renderInputFiles = () => {
    if (!inputFiles || !inputFiles.length) {
      return null;
    }

    const fileGroupList = inputFiles.map((inputFileGroup, i) => {
      return (
        <div className={cs.fileGroup} key={`inputFileGroup.fromStepName-${i}`}>
          <div className={cs.fileGroupHeader}>{`From ${
            inputFileGroup.fromStepName || "Sample"
          } Step:`}</div>
          {renderFileList(inputFileGroup.files)}
        </div>
      );
    });

    const fileGroupHeader = <div className={cs.title}>Input Files</div>;
    return (
      <Accordion
        className={cs.accordion}
        header={fileGroupHeader}
        open={true}
        data-testid={"input-files"}
      >
        <div className={cs.accordionContent}>{fileGroupList}</div>
      </Accordion>
    );
  };

  const renderOutputFiles = () => {
    if (outputFiles && outputFiles.length) {
      const outputFilesHeader = <div className={cs.title}>Output Files</div>;
      return (
        <Accordion
          className={cs.accordion}
          header={outputFilesHeader}
          open={true}
          data-testid={"output-files"}
        >
          <div className={cx(cs.accordionContent, cs.fileGroup)}>
            <div className={cs.fileGroupHeader}>{`From ${stepName} Step:`}</div>
            {renderFileList(outputFiles)}
          </div>
        </Accordion>
      );
    }
  };

  const renderFileList = (fileList: FileList) => {
    return fileList.map((file, i) => {
      const cssClass = file.url ? cs.fileLink : cs.disabledFileLink;
      const content = file.url ? (
        <a href={file.url}>{file.fileName}</a>
      ) : (
        file.fileName
      );

      return (
        <div className={cssClass} key={`${file.fileName}-${i}`}>
          {content}
        </div>
      );
    });
  };

  const renderResources = () => {
    if (resources && resources.length) {
      const resourcesHeader = <div className={cs.title}>Resources</div>;
      const resourceLinks = resources.map(linkInfo => {
        return (
          <span key={linkInfo.url}>
            <a
              href={linkInfo.url}
              target="_blank"
              rel="noopener noreferrer"
              // this is broken, but alldoami found it while working on something unrelated
              // eslint-disable-next-line @typescript-eslint/no-empty-function
              onClick={() => {}}
            >
              {linkInfo.name}
            </a>
          </span>
        );
      });

      return (
        <Accordion
          className={cs.accordion}
          header={resourcesHeader}
          open={true}
        >
          <div className={cx(cs.resourcesContainer, cs.accordionContent)}>
            {resourceLinks}
          </div>
        </Accordion>
      );
    }
  };

  return (
    <div className={cs.content}>
      <div className={cs.stepName} data-testid={"stepName"}>
        {stepName}
      </div>
      {renderStatusBox()}
      {renderStepInfo()}
      {renderInputFiles()}
      {renderOutputFiles()}
      {renderResources()}
    </div>
  );
};

export default PipelineStepDetailsMode;
