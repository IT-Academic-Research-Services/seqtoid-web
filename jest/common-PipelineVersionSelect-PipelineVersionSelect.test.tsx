// Coverage: app/assets/src/components/common/PipelineVersionSelect/PipelineVersionSelect.tsx
//
// PipelineVersionSelect picks between a plain single-version text header and a
// multi-version dropdown header, or renders nothing at all when the run never
// finished. Its branches: bail out when lastProcessedAt/currentPipelineVersion
// are missing; read allRuns either as a pre-computed string[] or as run objects
// (dedup by version key); filter out the current version for the "other
// versions" list; and choose the single vs multiple header. The two header
// subcomponents and the workflow config are stubbed so the assertions land on
// this file's selection logic and the strings it assembles.
import { render, screen } from "@testing-library/react";
import React from "react";
import { PipelineVersionSelect } from "~/components/common/PipelineVersionSelect/PipelineVersionSelect";
import { WorkflowType } from "~/components/utils/workflows";

const _React: typeof React = React;

let mockSingleProps: $TSFixMe = null;
let mockMultiProps: $TSFixMe = null;

jest.mock(
  "~/components/common/PipelineVersionSelect/components/SingleVersionTextHeader",
  () => ({
    SingleVersionTextHeader: (props: $TSFixMe) => {
      mockSingleProps = props;
      return (
        <div data-testid="single-header">
          {props.currentPipelineString}
          {props.versionInfoString}
        </div>
      );
    },
  }),
);

jest.mock(
  "~/components/common/PipelineVersionSelect/components/MultipleVersionsDropdownHeader",
  () => ({
    MultipleVersionsDropdownHeader: (props: $TSFixMe) => {
      mockMultiProps = props;
      return (
        <div
          data-testid="multi-header"
          data-others={props.otherPipelineVersions.join(",")}
        >
          {props.currentPipelineString}
          {props.versionInfoString}
        </div>
      );
    },
  }),
);

// The real workflow config is used: for SHORT_READ_MNGS the time key is
// created_at, the version key is pipeline_version, the workflow name is
// "Illumina mNGS" and the database version string is derived from
// alignment_config_name.

describe("PipelineVersionSelect -- unfinished runs", () => {
  it("renders nothing when there is no lastProcessedAt", () => {
    const { container } = render(
      <PipelineVersionSelect
        currentRun={{ pipeline_version: "8.0" } as $TSFixMe}
        allRuns={[]}
        workflowType={WorkflowType.SHORT_READ_MNGS}
        onVersionChange={jest.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when there is no current pipeline version", () => {
    const { container } = render(
      <PipelineVersionSelect
        currentRun={{ created_at: "2024-01-01" } as $TSFixMe}
        allRuns={[]}
        workflowType={WorkflowType.SHORT_READ_MNGS}
        onVersionChange={jest.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("PipelineVersionSelect -- single version header", () => {
  beforeEach(() => {
    mockSingleProps = null;
    mockMultiProps = null;
  });

  it("renders the text header when allRuns is empty", () => {
    render(
      <PipelineVersionSelect
        currentRun={
          {
            created_at: "2024-01-01",
            pipeline_version: "8.0",
            alignment_config_name: "2024-02-06",
          } as $TSFixMe
        }
        allRuns={[]}
        workflowType={WorkflowType.SHORT_READ_MNGS}
        onVersionChange={jest.fn()}
      />,
    );
    expect(screen.getByTestId("single-header")).toBeTruthy();
    expect(mockSingleProps.currentPipelineString).toBe(
      "Illumina mNGS Pipeline v8.0",
    );
    expect(mockSingleProps.versionInfoString).toContain(
      "NCBI Index Date: 2024-02-06",
    );
    expect(mockSingleProps.versionInfoString).toContain("processed");
  });

  it("renders the text header when the only version is the current one", () => {
    render(
      <PipelineVersionSelect
        currentRun={
          {
            created_at: "2024-01-01",
            pipeline_version: "8.0",
            alignment_config_name: "2024-02-06",
          } as $TSFixMe
        }
        allRuns={
          [{ pipeline_version: "8.0" }, { pipeline_version: "8.0" }] as $TSFixMe
        }
        workflowType={WorkflowType.SHORT_READ_MNGS}
        onVersionChange={jest.fn()}
      />,
    );
    expect(screen.getByTestId("single-header")).toBeTruthy();
  });
});

describe("PipelineVersionSelect -- multiple version header", () => {
  beforeEach(() => {
    mockSingleProps = null;
    mockMultiProps = null;
  });

  it("renders the dropdown header and lists the other versions from run objects", () => {
    render(
      <PipelineVersionSelect
        currentRun={
          {
            created_at: "2024-01-01",
            pipeline_version: "8.0",
            alignment_config_name: "2024-02-06",
          } as $TSFixMe
        }
        allRuns={
          [
            { pipeline_version: "8.0" },
            { pipeline_version: "7.1" },
            { pipeline_version: "7.1" },
          ] as $TSFixMe
        }
        workflowType={WorkflowType.SHORT_READ_MNGS}
        onVersionChange={jest.fn()}
      />,
    );
    expect(screen.getByTestId("multi-header")).toBeTruthy();
    // Deduped by version key, current version (8.0) filtered out.
    expect(mockMultiProps.otherPipelineVersions).toEqual(["7.1"]);
  });

  it("drops null/blank versions so they never appear as options", () => {
    render(
      <PipelineVersionSelect
        currentRun={
          {
            created_at: "2024-01-01",
            pipeline_version: "8.0",
            alignment_config_name: "2024-02-06",
          } as $TSFixMe
        }
        allRuns={
          [
            { pipeline_version: "8.0" },
            { pipeline_version: "7.1" },
            { pipeline_version: null },
            { pipeline_version: undefined },
            { pipeline_version: "" },
          ] as $TSFixMe
        }
        workflowType={WorkflowType.SHORT_READ_MNGS}
        onVersionChange={jest.fn()}
      />,
    );
    expect(screen.getByTestId("multi-header")).toBeTruthy();
    // Only the real other version (7.1) survives; no null/blank entries.
    expect(mockMultiProps.otherPipelineVersions).toEqual(["7.1"]);
  });

  it("reads allRuns as a pre-computed string array", () => {
    render(
      <PipelineVersionSelect
        currentRun={
          {
            created_at: "2024-01-01",
            pipeline_version: "8.0",
            alignment_config_name: "2024-02-06",
          } as $TSFixMe
        }
        allRuns={["8.0", "7.1", "6.0"]}
        workflowType={WorkflowType.SHORT_READ_MNGS}
        onVersionChange={jest.fn()}
      />,
    );
    expect(screen.getByTestId("multi-header")).toBeTruthy();
    expect(mockMultiProps.otherPipelineVersions).toEqual(["7.1", "6.0"]);
  });

  it("forwards version selection to onVersionChange", () => {
    const onVersionChange = jest.fn();
    render(
      <PipelineVersionSelect
        currentRun={
          {
            created_at: "2024-01-01",
            pipeline_version: "8.0",
            alignment_config_name: "2024-02-06",
          } as $TSFixMe
        }
        allRuns={["8.0", "7.1"]}
        workflowType={WorkflowType.SHORT_READ_MNGS}
        onVersionChange={onVersionChange}
      />,
    );
    mockMultiProps.onPipelineVersionSelect("7.1");
    expect(onVersionChange).toHaveBeenCalledWith("7.1");
  });
});
