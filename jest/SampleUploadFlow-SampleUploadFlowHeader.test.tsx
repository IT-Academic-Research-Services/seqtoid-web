// Coverage: app/assets/src/components/views/SampleUploadFlow/components/SampleUploadFlowHeader/SampleUploadFlowHeader.tsx
//
// SampleUploadFlowHeader renders the three-step upload wizard header. It picks a
// title/subtitle from the current step, gates step clicks behind the
// stepsEnabled map, and applies active/enabled classes to the step menu. The
// child UI (NarrowContainer, ExternalLink, Label) is stubbed so the assertions
// land on this component's own title/subtitle branching and click gating.
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { SampleUploadFlowHeader } from "~/components/views/SampleUploadFlow/components/SampleUploadFlowHeader/SampleUploadFlowHeader";
import { UploadStepType } from "~/interface/upload";

jest.mock("~/components/layout/NarrowContainer", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: ({ children }: { children: React.ReactNode }) =>
      ReactLib.createElement("div", null, children),
  };
});

jest.mock("~/components/ui/controls/ExternalLink", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: ({
      href,
      children,
    }: {
      href: string;
      children: React.ReactNode;
    }) => ReactLib.createElement("a", { href }, children),
  };
});

jest.mock("~ui/labels/Label", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: ({ text }: { text: React.ReactNode }) =>
      ReactLib.createElement("span", { "data-testid": "label" }, text),
  };
});

const ALL_ENABLED = {
  [UploadStepType.SampleStep]: true,
  [UploadStepType.MetadataStep]: true,
  [UploadStepType.ReviewStep]: true,
} as Record<UploadStepType, boolean>;

const renderHeader = (overrides: Record<string, unknown> = {}) =>
  render(
    <SampleUploadFlowHeader
      currentStep={UploadStepType.SampleStep}
      samples={null}
      onStepSelect={jest.fn()}
      stepsEnabled={ALL_ENABLED}
      {...(overrides as any)}
    />,
  );

describe("SampleUploadFlowHeader titles per step", () => {
  it("shows the Samples title and the CLI-instructions subtitle on the sample step", () => {
    renderHeader({ currentStep: UploadStepType.SampleStep });

    expect(screen.getByText("Select Samples")).toBeTruthy();
    expect(
      screen.getByText(/Rather use our command-line interface/),
    ).toBeTruthy();
    const cliLink = screen.getByText(
      "View CLI Instructions.",
    ) as HTMLAnchorElement;
    expect(cliLink.getAttribute("href")).toBe("/cli_user_instructions");
  });

  it("shows the Metadata title and its subtitle on the metadata step", () => {
    renderHeader({ currentStep: UploadStepType.MetadataStep });

    expect(screen.getByText("Upload Metadata")).toBeTruthy();
    expect(screen.getByText(/This metadata will provide context/)).toBeTruthy();
    // The sample-step CLI subtitle is not present on this step.
    expect(screen.queryByText("View CLI Instructions.")).toBeNull();
  });

  it("shows the Review title and an upload summary on the review step", () => {
    renderHeader({
      currentStep: UploadStepType.ReviewStep,
      samples: [{ name: "s1" }, { name: "s2" }, { name: "s3" }],
      project: { name: "Ocean" },
    });

    // "Review" appears both as the title and as the menu option.
    expect(screen.getAllByText("Review").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Uploading/)).toBeTruthy();
    expect(screen.getByText(/3 samples to/)).toBeTruthy();
    expect(screen.getByText(/Ocean/)).toBeTruthy();
  });
});

describe("SampleUploadFlowHeader step navigation", () => {
  it("fires onStepSelect when a click targets an enabled step", () => {
    const onStepSelect = jest.fn();
    renderHeader({ onStepSelect, stepsEnabled: ALL_ENABLED });

    fireEvent.click(screen.getByText("Metadata"));

    expect(onStepSelect).toHaveBeenCalledWith(UploadStepType.MetadataStep);
  });

  it("does not fire onStepSelect when the target step is disabled", () => {
    const onStepSelect = jest.fn();
    renderHeader({
      onStepSelect,
      stepsEnabled: {
        [UploadStepType.SampleStep]: true,
        [UploadStepType.MetadataStep]: false,
        [UploadStepType.ReviewStep]: false,
      } as Record<UploadStepType, boolean>,
    });

    fireEvent.click(screen.getByText("Review"));

    expect(onStepSelect).not.toHaveBeenCalled();
  });

  it("renders every menu option with its 1-based index label", () => {
    renderHeader();

    expect(screen.getByText("Samples")).toBeTruthy();
    expect(screen.getByText("Metadata")).toBeTruthy();
    expect(screen.getByText("Review")).toBeTruthy();
    const labels = screen.getAllByTestId("label").map(n => n.textContent);
    expect(labels).toEqual(["1", "2", "3"]);
  });
});
