// Coverage: .../LocalUploadProgressModal/LocalUploadProgressModal.tsx
//
// LocalUploadProgressModal orchestrates the browser-side S3 upload of local
// samples. The AWS SDK, the upload API, the resumable uploader, the three
// persistence stores (byte cache / file-handle store / resume state) and the
// pure flag helpers are all mocked, so this exercises the component's own
// mount/complete/pause rendering and footer branching -- not the real transfer.
// The two real child components (header + sample list) are left un-mocked so
// they render through this test as well.
jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: jest.fn().mockImplementation(() => ({})),
  ChecksumAlgorithm: { SHA256: "SHA256" },
}));

const mockTrackEvent = jest.fn();
jest.mock("~/api/analytics", () => ({
  useTrackEvent: () => mockTrackEvent,
  ANALYTICS_EVENT_NAMES: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

const mockInitiateBulkUpload = jest.fn();
const mockStartHeartbeat = jest.fn();
jest.mock("~/api/upload", () => ({
  completeSampleUpload: jest.fn(),
  getUploadCredentials: jest.fn(),
  initiateBulkUploadLocalWithMetadata: (...args: any[]) =>
    mockInitiateBulkUpload(...args),
  startUploadHeartbeat: (...args: any[]) => mockStartHeartbeat(...args),
}));

jest.mock("~/components/utils/logUtil", () => ({ logError: jest.fn() }));

jest.mock(
  "~/components/views/SampleUploadFlow/components/UploadProgressModal/resumableUpload",
  () => ({ ResumableUpload: jest.fn() }),
);

jest.mock(
  "~/components/views/SampleUploadFlow/components/UploadProgressModal/uploadByteCache",
  () => ({
    cacheUploadFile: jest.fn(),
    canCacheFile: jest.fn(() => false),
    clearCachedUploadFile: jest.fn(),
    clearProjectByteCache: jest.fn().mockResolvedValue(undefined),
  }),
);

jest.mock(
  "~/components/views/SampleUploadFlow/components/UploadProgressModal/uploadFileHandleStore",
  () => ({
    clearFileHandle: jest.fn(),
    clearProjectFileHandles: jest.fn().mockResolvedValue(undefined),
    isFileHandlePersistenceSupported: jest.fn(() => false),
    persistFileHandle: jest.fn(),
  }),
);

const mockClearResumeState = jest.fn();
const mockSaveResumeState = jest.fn();
jest.mock(
  "~/components/views/SampleUploadFlow/components/UploadProgressModal/uploadResumeState",
  () => ({
    clearUploadResumeState: (...args: any[]) => mockClearResumeState(...args),
    loadUploadResumeState: jest.fn(() => null),
    saveUploadResumeState: (...args: any[]) => mockSaveResumeState(...args),
  }),
);

const mockAddFlags = jest.fn();
const mockAddAdditionalInputFiles = jest.fn();
const mockRedirectToProject = jest.fn();
jest.mock(
  "~/components/views/SampleUploadFlow/components/UploadProgressModal/upload_progress_utils",
  () => ({
    addFlagsToSamples: (...args: any[]) => mockAddFlags(...args),
    addAdditionalInputFilesToSamples: (...args: any[]) =>
      mockAddAdditionalInputFiles(...args),
    redirectToProject: (...args: any[]) => mockRedirectToProject(...args),
  }),
);

jest.mock("~ui/containers/Modal", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: ({ children }: { children: React.ReactNode }) =>
      ReactLib.createElement("div", { "data-testid": "modal" }, children),
  };
});

jest.mock("~/components/ui/controls/buttons/PrimaryButton", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: ({ text, onClick }: { text: string; onClick: () => void }) =>
      ReactLib.createElement("button", { onClick }, text),
  };
});

jest.mock("~/components/ui/controls/buttons/SecondaryButton", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: ({ text, onClick }: { text: string; onClick: () => void }) =>
      ReactLib.createElement("button", { onClick }, text),
  };
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { LocalUploadProgressModal } from "~/components/views/SampleUploadFlow/components/UploadProgressModal/components/LocalUploadProgressModal/LocalUploadProgressModal";

const PROJECT = { id: 77, name: "Ocean" } as any;

const SAMPLES = [
  { name: "alpha", files: [{ size: 100 } as File] },
  { name: "beta", files: [{ size: 200 } as File] },
] as any;

const renderModal = (overrides: Record<string, unknown> = {}) =>
  render(
    <LocalUploadProgressModal
      adminOptions={{}}
      bedFile={null}
      clearlabs={false}
      guppyBasecallerSetting=""
      medakaModel={null}
      metadata={{ headers: [], rows: [] } as any}
      onUploadComplete={jest.fn()}
      project={PROJECT}
      refSeqAccession={null}
      refSeqFile={null}
      refSeqTaxon={null}
      samples={SAMPLES}
      skipSampleProcessing={false}
      technology={null}
      uploadType="local"
      useStepFunctionPipeline={false}
      wetlabProtocol={null}
      workflows={new Set() as any}
      {...(overrides as any)}
    />,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockAddFlags.mockImplementation(({ samples }: any) => samples ?? []);
  mockInitiateBulkUpload.mockResolvedValue([]);
  mockStartHeartbeat.mockResolvedValue(null);
});

describe("LocalUploadProgressModal in-progress rendering", () => {
  it("renders the in-progress header and a waiting sample list on mount", async () => {
    renderModal();

    // Real LocalUploadModalHeader: all samples start with an undefined status,
    // so they count as in-progress.
    expect(
      await screen.findByText("Uploading 2 samples to Ocean"),
    ).toBeTruthy();
    // Real UploadProgressModalSampleList row per sample, each waiting.
    expect(screen.getByText("alpha")).toBeTruthy();
    expect(screen.getByText("beta")).toBeTruthy();
    expect(screen.getAllByText("Waiting to upload...")).toHaveLength(2);

    // The db-create + flag helpers ran off the mount effect.
    await waitFor(() => expect(mockInitiateBulkUpload).toHaveBeenCalled());
    expect(mockAddFlags).toHaveBeenCalled();
    expect(mockAddAdditionalInputFiles).toHaveBeenCalled();
  });

  it("toggles the footer between Pause and Resume", async () => {
    renderModal();

    const pause = await screen.findByText("Pause upload");
    fireEvent.click(pause);

    // handlePauseUpload flips paused -> Resume button replaces Pause.
    expect(await screen.findByText("Resume upload")).toBeTruthy();
    expect(screen.queryByText("Pause upload")).toBeNull();

    fireEvent.click(screen.getByText("Resume upload"));
    // Back to Pause once resumed.
    expect(await screen.findByText("Pause upload")).toBeTruthy();
  });
});

describe("LocalUploadProgressModal completion path", () => {
  it("fires onUploadComplete and offers Go to Project when there is nothing to upload", async () => {
    const onUploadComplete = jest.fn();
    // No samples -> initiateLocalUpload returns early, and with no in-progress
    // samples the completion effect finalizes the upload immediately.
    renderModal({ samples: null, onUploadComplete });

    await waitFor(() => expect(onUploadComplete).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Uploads completed!")).toBeTruthy();
    // Resume state is cleared on successful completion.
    expect(mockClearResumeState).toHaveBeenCalledWith(77);

    const goToProject = screen.getByText("Go to Project");
    fireEvent.click(goToProject);
    expect(mockRedirectToProject).toHaveBeenCalledWith(77);
  });
});
