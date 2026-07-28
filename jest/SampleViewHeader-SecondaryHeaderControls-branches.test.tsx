// Branch coverage for
// app/assets/src/components/views/SampleView/components/SampleViewHeader/components/SecondaryHeaderControls/SecondaryHeaderControls.tsx
//
// Four conditionals: `currentRun &&` around PipelineVersionSelect, the
// `getAllRuns && getAllRuns()` guard it passes down, `sample &&` around
// PipelineRunsButton, and `disabled={!sample}` on the Sample Details button.
// The two children are stubbed so the assertions land on the routed props.
import { fireEvent, render, screen } from "@testing-library/react";

const capturedVersionSelectProps: $TSFixMe[] = [];
const capturedRunsButtonProps: $TSFixMe[] = [];

jest.mock("~/components/common/PipelineVersionSelect", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    PipelineVersionSelect: (props: $TSFixMe) => {
      capturedVersionSelectProps.push(props);
      return ReactLib.createElement("div", {
        "data-testid": "version-select",
      });
    },
  };
});

jest.mock(
  "~/components/views/SampleView/components/SampleViewHeader/components/SecondaryHeaderControls/components/PipelineRunsButton",
  () => {
    const ReactLib = require("react");
    return {
      __esModule: true,
      PipelineRunsButton: (props: $TSFixMe) => {
        capturedRunsButtonProps.push(props);
        return ReactLib.createElement("div", { "data-testid": "runs-button" });
      },
    };
  },
);

import { WorkflowType } from "~/components/utils/workflows";
import { SecondaryHeaderControls } from "~/components/views/SampleView/components/SampleViewHeader/components/SecondaryHeaderControls/SecondaryHeaderControls";

const sample = { id: 12, name: "sample-12" } as $TSFixMe;
const currentRun = { id: 99, pipeline_version: "8.3" } as $TSFixMe;

beforeEach(() => {
  capturedVersionSelectProps.length = 0;
  capturedRunsButtonProps.length = 0;
});

describe("SecondaryHeaderControls", () => {
  it("renders both children and invokes getAllRuns when everything is present", () => {
    const allRuns = [currentRun];
    const getAllRuns = jest.fn(() => allRuns);
    const onPipelineVersionChange = jest.fn();
    const onDetailsClick = jest.fn();

    render(
      <SecondaryHeaderControls
        sample={sample}
        currentRun={currentRun}
        getAllRuns={getAllRuns}
        workflow={WorkflowType.SHORT_READ_MNGS}
        onPipelineVersionChange={onPipelineVersionChange}
        onDetailsClick={onDetailsClick}
      />,
    );

    expect(getAllRuns).toHaveBeenCalledTimes(1);
    expect(capturedVersionSelectProps).toHaveLength(1);
    expect(capturedVersionSelectProps[0].currentRun).toBe(currentRun);
    expect(capturedVersionSelectProps[0].allRuns).toBe(allRuns);
    expect(capturedVersionSelectProps[0].workflowType).toBe(
      WorkflowType.SHORT_READ_MNGS,
    );
    expect(capturedVersionSelectProps[0].onVersionChange).toBe(
      onPipelineVersionChange,
    );

    expect(capturedRunsButtonProps).toHaveLength(1);
    expect(capturedRunsButtonProps[0].sample).toBe(sample);

    const detailsButton = screen.getByTestId("sample-details");
    expect(detailsButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(detailsButton);
    expect(onDetailsClick).toHaveBeenCalledTimes(1);
  });

  it("passes an undefined allRuns when getAllRuns itself is missing", () => {
    render(
      <SecondaryHeaderControls
        sample={sample}
        currentRun={currentRun}
        getAllRuns={undefined as $TSFixMe}
        workflow={WorkflowType.AMR}
        onPipelineVersionChange={jest.fn()}
        onDetailsClick={jest.fn()}
      />,
    );

    expect(capturedVersionSelectProps).toHaveLength(1);
    expect(capturedVersionSelectProps[0].allRuns).toBeUndefined();
  });

  it("omits PipelineVersionSelect when there is no current run", () => {
    const getAllRuns = jest.fn(() => []);
    render(
      <SecondaryHeaderControls
        sample={sample}
        currentRun={null}
        getAllRuns={getAllRuns}
        workflow={WorkflowType.CONSENSUS_GENOME}
        onPipelineVersionChange={jest.fn()}
        onDetailsClick={jest.fn()}
      />,
    );

    expect(screen.queryByTestId("version-select")).toBeNull();
    expect(getAllRuns).not.toHaveBeenCalled();
    expect(screen.getByTestId("runs-button")).toBeTruthy();
  });

  it("omits PipelineRunsButton and disables Sample Details when there is no sample", () => {
    const onDetailsClick = jest.fn();
    render(
      <SecondaryHeaderControls
        sample={null}
        currentRun={currentRun}
        getAllRuns={jest.fn(() => [])}
        workflow={WorkflowType.SHORT_READ_MNGS}
        onPipelineVersionChange={jest.fn()}
        onDetailsClick={onDetailsClick}
      />,
    );

    expect(screen.queryByTestId("runs-button")).toBeNull();
    expect(screen.getByTestId("version-select")).toBeTruthy();

    const detailsButton = screen.getByTestId("sample-details");
    expect(detailsButton.hasAttribute("disabled")).toBe(true);
    fireEvent.click(detailsButton);
    expect(onDetailsClick).not.toHaveBeenCalled();
  });
});
