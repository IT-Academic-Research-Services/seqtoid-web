// Coverage: app/assets/src/components/views/DiscoveryView/components/SamplesView/
//   components/MetadataUploadModal/UploadPage.tsx
//
// UploadPage is the metadata step of the sample-upload wizard. On mount it wires
// the wizard's Continue-disable + on-continue-validation hooks. verifyMetadata
// validates manual metadata against the project (short-circuiting when the last
// entry was CSV, not manual) and reports whether Continue may proceed.
// handleMetadataChange mirrors state, notifies the parent and re-computes the
// Continue-enabled flag; showInstructions pushes an overlay. MetadataUpload and
// Instructions are stubbed and the validate API is mocked so the assertions land
// on this component's own wiring + validity logic.
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const _React: typeof React = React;

const mockValidate = jest.fn();
jest.mock("~/api/metadata", () => ({
  validateManualMetadataForProject: (...args: $TSFixMe[]) =>
    mockValidate(...args),
}));

// Capture MetadataUpload's props so we can drive its onMetadataChange /
// onShowCSVInstructions callbacks directly.
let lastMetadataUploadProps: $TSFixMe = null;
jest.mock("~/components/common/Metadata/MetadataUpload", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => {
    lastMetadataUploadProps = props;
    const ReactLib = require("react");
    return ReactLib.createElement("div", {
      "data-testid": "metadata-upload",
      "data-issues": JSON.stringify(props.issues),
    });
  },
}));

jest.mock(
  "~/components/views/DiscoveryView/components/SamplesView/components/MetadataUploadModal/Instructions",
  () => ({
    __esModule: true,
    default: (props: $TSFixMe) => {
      const ReactLib = require("react");
      return ReactLib.createElement(
        "button",
        { "data-testid": "instructions", onClick: props.onClose },
        "instructions",
      );
    },
  }),
);

import UploadPage from "~/components/views/DiscoveryView/components/SamplesView/components/MetadataUploadModal/UploadPage";

const baseProps = () => ({
  onMetadataChange: jest.fn(),
  project: { id: "7", name: "Proj" } as $TSFixMe,
  wizardEnableContinue: jest.fn(),
  wizardSetOnContinueValidation: jest.fn(),
  wizardSetOverlay: jest.fn(),
  samples: [],
  workflow: "short-read-mngs",
});

beforeEach(() => {
  lastMetadataUploadProps = null;
  mockValidate.mockReset();
});

describe("UploadPage mount wiring", () => {
  it("disables Continue and registers on-continue validation on mount", () => {
    const props = baseProps();
    render(<UploadPage {...props} />);
    expect(props.wizardEnableContinue).toHaveBeenCalledWith(false);
    expect(props.wizardSetOnContinueValidation).toHaveBeenCalledTimes(1);
    expect(typeof props.wizardSetOnContinueValidation.mock.calls[0][0]).toBe(
      "function",
    );
    expect(screen.getByTestId("metadata-upload")).toBeTruthy();
  });

  it("skips the wizard hooks when they are not provided", () => {
    render(
      <UploadPage
        onMetadataChange={jest.fn()}
        project={{ id: "1", name: "P" } as $TSFixMe}
        samples={[]}
        workflow="amr"
      />,
    );
    // No throw + component still renders.
    expect(screen.getByTestId("metadata-upload")).toBeTruthy();
  });
});

describe("UploadPage handleMetadataChange", () => {
  it("enables Continue for valid manual metadata and notifies the parent", () => {
    const props = baseProps();
    render(<UploadPage {...props} />);
    act(() => {
      lastMetadataUploadProps.onMetadataChange({
        metadata: { rows: 1 },
        issues: { errors: [] },
        wasManual: true,
      });
    });
    expect(props.onMetadataChange).toHaveBeenCalledWith({
      metadata: { rows: 1 },
      issues: { errors: [] },
    });
    // First call (mount) is false; this change makes it valid -> true.
    expect(props.wizardEnableContinue).toHaveBeenLastCalledWith(true);
  });

  it("disables Continue when metadata has validation errors", () => {
    const props = baseProps();
    render(<UploadPage {...props} />);
    act(() => {
      lastMetadataUploadProps.onMetadataChange({
        metadata: { rows: 1 },
        issues: { errors: ["bad"] },
        wasManual: true,
      });
    });
    expect(props.wizardEnableContinue).toHaveBeenLastCalledWith(false);
  });

  it("disables Continue when metadata is absent", () => {
    const props = baseProps();
    render(<UploadPage {...props} />);
    act(() => {
      lastMetadataUploadProps.onMetadataChange({
        metadata: null,
        issues: null,
        wasManual: false,
      });
    });
    expect(props.wizardEnableContinue).toHaveBeenLastCalledWith(null);
  });
});

describe("UploadPage verifyMetadata", () => {
  it("returns true immediately for CSV (non-manual) entries", async () => {
    const props = baseProps();
    render(<UploadPage {...props} />);
    // wasManual defaults to false.
    const verify = props.wizardSetOnContinueValidation.mock.calls[0][0];
    await expect(verify()).resolves.toBe(true);
    expect(mockValidate).not.toHaveBeenCalled();
  });

  it("validates manual metadata and returns true when there are no errors", async () => {
    mockValidate.mockResolvedValue({ issues: { errors: [] } });
    const props = baseProps();
    render(<UploadPage {...props} />);
    // Make the last entry manual with metadata.
    act(() => {
      lastMetadataUploadProps.onMetadataChange({
        metadata: { rows: 2 },
        issues: { errors: [] },
        wasManual: true,
      });
    });
    const verify = props.wizardSetOnContinueValidation.mock.calls[0][0];
    let result: $TSFixMe;
    await act(async () => {
      result = await verify();
    });
    expect(mockValidate).toHaveBeenCalledWith("7", { rows: 2 });
    expect(result).toBeTruthy();
    // The resolved issues get surfaced to MetadataUpload on the manual path.
    expect(lastMetadataUploadProps.issues).toEqual({ errors: [] });
  });

  it("returns false when manual validation reports errors", async () => {
    mockValidate.mockResolvedValue({ issues: { errors: ["boom"] } });
    const props = baseProps();
    render(<UploadPage {...props} />);
    act(() => {
      lastMetadataUploadProps.onMetadataChange({
        metadata: { rows: 2 },
        issues: { errors: [] },
        wasManual: true,
      });
    });
    const verify = props.wizardSetOnContinueValidation.mock.calls[0][0];
    let result: $TSFixMe;
    await act(async () => {
      result = await verify();
    });
    expect(result).toBeFalsy();
  });
});

describe("UploadPage showInstructions", () => {
  it("pushes an Instructions overlay that can close itself", () => {
    const props = baseProps();
    render(<UploadPage {...props} />);
    act(() => {
      lastMetadataUploadProps.onShowCSVInstructions();
    });
    expect(props.wizardSetOverlay).toHaveBeenCalledTimes(1);
    const overlay = props.wizardSetOverlay.mock.calls[0][0];
    // Render the overlay and fire its onClose -> pushes null.
    render(<div>{overlay}</div>);
    fireEvent.click(screen.getByTestId("instructions"));
    expect(props.wizardSetOverlay).toHaveBeenLastCalledWith(null);
  });

  it("is a no-op when no wizardSetOverlay hook is provided", () => {
    render(
      <UploadPage
        onMetadataChange={jest.fn()}
        project={{ id: "1", name: "P" } as $TSFixMe}
        samples={[]}
        workflow="amr"
      />,
    );
    // Driving the CSV-instructions callback must not throw without the hook.
    expect(() => lastMetadataUploadProps.onShowCSVInstructions()).not.toThrow();
  });
});
