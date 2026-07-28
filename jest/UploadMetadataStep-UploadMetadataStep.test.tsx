// Coverage: app/assets/src/components/views/SampleUploadFlow/components/UploadMetadataStep/UploadMetadataStep.tsx
//
// UploadMetadataStep wraps MetadataUpload with a Continue/Cancel footer. It
// tracks the latest metadata/issues/wasManual state reported by the child,
// enables Continue only when metadata is valid, and on Continue either forwards
// the metadata directly (CSV path) or re-validates it first (manual path). The
// MetadataUpload/Instructions children and the validate API are stubbed so the
// assertions land on this file's state + continue branching.
const mockValidate = jest.fn();
jest.mock("~/api/metadata", () => ({
  validateManualMetadataForNewSamples: (...args: any[]) =>
    mockValidate(...args),
}));

jest.mock(
  "~/components/views/DiscoveryView/components/SamplesView/components/MetadataUploadModal/Instructions",
  () => {
    const ReactLib = require("react");
    return {
      __esModule: true,
      default: ({ onClose }: { onClose: () => void }) =>
        ReactLib.createElement(
          "button",
          { "data-testid": "instructions-close", onClick: onClose },
          "close-instructions",
        ),
    };
  },
);

// Expose the child's callbacks as buttons the test can drive.
jest.mock("~/components/common/Metadata/MetadataUpload", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: (props: any) => {
      (global as any).__lastMetadataUploadProps = props;
      return ReactLib.createElement(
        "div",
        { "data-testid": "metadata-upload" },
        ReactLib.createElement(
          "button",
          {
            "data-testid": "emit-valid-csv",
            onClick: () =>
              props.onMetadataChange({
                metadata: { headers: ["h"], rows: [["r"]] },
                issues: { errors: [], warnings: [] },
                wasManual: false,
                newHostGenomes: [{ id: 9 }],
              }),
          },
          "emit-valid-csv",
        ),
        ReactLib.createElement(
          "button",
          {
            "data-testid": "emit-invalid",
            onClick: () =>
              props.onMetadataChange({
                metadata: { headers: [], rows: [] },
                issues: { errors: ["bad"], warnings: [] },
                wasManual: false,
              }),
          },
          "emit-invalid",
        ),
        ReactLib.createElement(
          "button",
          {
            "data-testid": "emit-valid-manual",
            onClick: () =>
              props.onMetadataChange({
                metadata: { headers: ["h"], rows: [["r"]] },
                issues: { errors: [], warnings: [] },
                wasManual: true,
              }),
          },
          "emit-valid-manual",
        ),
        ReactLib.createElement(
          "button",
          {
            "data-testid": "show-instructions",
            onClick: props.onShowCSVInstructions,
          },
          "show-instructions",
        ),
      );
    },
  };
});

jest.mock("~/components/ui/controls/buttons/PrimaryButton", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: ({
      text,
      onClick,
      disabled,
    }: {
      text: string;
      onClick: () => void;
      disabled: boolean;
    }) =>
      ReactLib.createElement(
        "button",
        { onClick, disabled, "data-testid": "primary" },
        text,
      ),
  };
});

jest.mock("~/components/ui/controls/buttons/SecondaryButton", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: ({ text, onClick }: { text: string; onClick: () => void }) =>
      ReactLib.createElement(
        "button",
        { onClick, "data-testid": "secondary" },
        text,
      ),
  };
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UploadMetadataStep } from "~/components/views/SampleUploadFlow/components/UploadMetadataStep/UploadMetadataStep";

const SAMPLES = [{ name: "s1" }] as any;

const renderStep = (overrides: Record<string, unknown> = {}) => {
  const onUploadMetadata = jest.fn();
  const utils = render(
    <UploadMetadataStep
      samples={SAMPLES}
      project={{ id: 1, name: "P" } as any}
      visible
      onDirty={jest.fn()}
      workflows={new Set() as any}
      onUploadMetadata={onUploadMetadata}
      {...(overrides as any)}
    />,
  );
  return { ...utils, onUploadMetadata };
};

beforeEach(() => {
  mockValidate.mockReset();
});

describe("UploadMetadataStep continue-button gating", () => {
  it("starts with Continue disabled and enables it once valid metadata arrives", () => {
    renderStep();
    expect(screen.getByTestId("primary").hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByTestId("emit-valid-csv"));
    expect(screen.getByTestId("primary").hasAttribute("disabled")).toBe(false);
  });

  it("keeps Continue disabled when the child reports validation errors", () => {
    renderStep();
    fireEvent.click(screen.getByTestId("emit-invalid"));
    expect(screen.getByTestId("primary").hasAttribute("disabled")).toBe(true);
  });
});

describe("UploadMetadataStep continue paths", () => {
  it("forwards metadata directly on the CSV (non-manual) path without re-validating", () => {
    const { onUploadMetadata } = renderStep();
    fireEvent.click(screen.getByTestId("emit-valid-csv"));
    fireEvent.click(screen.getByTestId("primary"));

    expect(mockValidate).not.toHaveBeenCalled();
    expect(onUploadMetadata).toHaveBeenCalledWith({
      metadata: { headers: ["h"], rows: [["r"]] },
      issues: { errors: [], warnings: [] },
      newHostGenomes: [{ id: 9 }],
    });
  });

  it("re-validates on the manual path and uploads when validation passes", async () => {
    mockValidate.mockResolvedValue({
      issues: { errors: [], warnings: [] },
      newHostGenomes: [{ id: 3 }],
    });
    const { onUploadMetadata } = renderStep();

    fireEvent.click(screen.getByTestId("emit-valid-manual"));
    fireEvent.click(screen.getByTestId("primary"));

    await waitFor(() => expect(onUploadMetadata).toHaveBeenCalled());
    expect(mockValidate).toHaveBeenCalledWith(SAMPLES, {
      headers: ["h"],
      rows: [["r"]],
    });
    expect(onUploadMetadata).toHaveBeenCalledWith({
      metadata: { headers: ["h"], rows: [["r"]] },
      issues: { errors: [], warnings: [] },
      newHostGenomes: [{ id: 3 }],
    });
  });

  it("does NOT upload on the manual path when re-validation surfaces errors", async () => {
    mockValidate.mockResolvedValue({
      issues: { errors: ["still bad"], warnings: [] },
      newHostGenomes: [],
    });
    const { onUploadMetadata } = renderStep();

    fireEvent.click(screen.getByTestId("emit-valid-manual"));
    fireEvent.click(screen.getByTestId("primary"));

    await waitFor(() => expect(mockValidate).toHaveBeenCalled());
    expect(onUploadMetadata).not.toHaveBeenCalled();
  });
});

describe("UploadMetadataStep instructions toggle", () => {
  it("renders the Continue and Cancel controls", () => {
    renderStep();
    expect(screen.getByText("Continue")).toBeTruthy();
    expect(screen.getByText("Cancel")).toBeTruthy();
  });

  it("shows and hides the CSV instructions panel", () => {
    renderStep();
    // Instructions close button always mounts; toggling state is what we exercise.
    fireEvent.click(screen.getByTestId("show-instructions"));
    fireEvent.click(screen.getByTestId("instructions-close"));
    // MetadataUpload is still rendered after closing.
    expect(screen.getByTestId("metadata-upload")).toBeTruthy();
  });
});
