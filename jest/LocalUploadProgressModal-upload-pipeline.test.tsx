// Coverage:
// app/assets/src/components/views/SampleUploadFlow/components/
//   UploadProgressModal/components/LocalUploadProgressModal/
//   LocalUploadProgressModal.tsx
//
// The existing LocalUploadProgressModal spec covers mount / pause-toggle /
// "nothing to upload" completion. This one drives the actual transfer machinery
// that sits underneath: credential fetch -> S3Client construction -> one
// ResumableUpload per input file -> progress + multipart-id bookkeeping ->
// per-file cache/handle cleanup -> completeSampleUpload -> failure, retry and
// "leave with failed uploads" paths.
//
// ResumableUpload is replaced by a scriptable fake whose `done()` behaviour the
// individual tests set, which is what makes the success / pause-error / hard-
// error branches reachable. Everything else the component talks to (AWS SDK,
// upload API, the three persistence stores, the flag helpers) is mocked too, so
// nothing here touches the network.

jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: jest.fn().mockImplementation((config: $TSFixMe) => ({ config })),
  ChecksumAlgorithm: { SHA256: "SHA256" },
}));

const mockTrackEvent = jest.fn();
jest.mock("~/api/analytics", () => ({
  useTrackEvent: () => mockTrackEvent,
  ANALYTICS_EVENT_NAMES: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

const mockInitiateBulkUpload = jest.fn();
const mockStartHeartbeat = jest.fn();
const mockGetUploadCredentials = jest.fn();
const mockCompleteSampleUpload = jest.fn();
jest.mock("~/api/upload", () => ({
  completeSampleUpload: (...args: $TSFixMe[]) =>
    mockCompleteSampleUpload(...args),
  getUploadCredentials: (...args: $TSFixMe[]) =>
    mockGetUploadCredentials(...args),
  initiateBulkUploadLocalWithMetadata: (...args: $TSFixMe[]) =>
    mockInitiateBulkUpload(...args),
  startUploadHeartbeat: (...args: $TSFixMe[]) => mockStartHeartbeat(...args),
}));

const mockLogError = jest.fn();
jest.mock("~/components/utils/logUtil", () => ({
  logError: (...args: $TSFixMe[]) => mockLogError(...args),
}));

// Scriptable ResumableUpload double. Each construction is recorded so the test
// can inspect the params/uploadId the component computed and drive the progress
// + created-multipart callbacks it registered.
const mockUploads: $TSFixMe[] = [];
const mockDone: { impl: null | ((instance: $TSFixMe) => Promise<void>) } = {
  impl: null,
};
jest.mock(
  "~/components/views/SampleUploadFlow/components/UploadProgressModal/resumableUpload",
  () => ({
    ResumableUpload: class {
      params: $TSFixMe;
      uploadId: $TSFixMe;
      handlers: Record<string, $TSFixMe> = {};
      createdCallback: $TSFixMe = null;
      pause = jest.fn().mockResolvedValue(undefined);
      constructor(opts: $TSFixMe) {
        this.params = opts.params;
        this.uploadId = opts.uploadId;
        mockUploads.push(this);
      }
      on(event: string, cb: $TSFixMe) {
        this.handlers[event] = cb;
      }
      onCreatedMultipartUpload(cb: $TSFixMe) {
        this.createdCallback = cb;
      }
      async done() {
        if (mockDone.impl) await mockDone.impl(this);
      }
    },
  }),
);

const mockCacheUploadFile = jest.fn();
const mockCanCacheFile = jest.fn(() => false);
const mockClearCachedUploadFile = jest.fn();
const mockClearProjectByteCache = jest.fn().mockResolvedValue(undefined);
jest.mock(
  "~/components/views/SampleUploadFlow/components/UploadProgressModal/uploadByteCache",
  () => ({
    cacheUploadFile: (...args: $TSFixMe[]) => mockCacheUploadFile(...args),
    canCacheFile: (...args: $TSFixMe[]) => mockCanCacheFile(...args),
    clearCachedUploadFile: (...args: $TSFixMe[]) =>
      mockClearCachedUploadFile(...args),
    clearProjectByteCache: (...args: $TSFixMe[]) =>
      mockClearProjectByteCache(...args),
  }),
);

const mockClearFileHandle = jest.fn();
const mockClearProjectFileHandles = jest.fn().mockResolvedValue(undefined);
const mockHandlesSupported = jest.fn(() => false);
const mockPersistFileHandle = jest.fn();
jest.mock(
  "~/components/views/SampleUploadFlow/components/UploadProgressModal/uploadFileHandleStore",
  () => ({
    clearFileHandle: (...args: $TSFixMe[]) => mockClearFileHandle(...args),
    clearProjectFileHandles: (...args: $TSFixMe[]) =>
      mockClearProjectFileHandles(...args),
    isFileHandlePersistenceSupported: (...args: $TSFixMe[]) =>
      mockHandlesSupported(...args),
    persistFileHandle: (...args: $TSFixMe[]) => mockPersistFileHandle(...args),
  }),
);

const mockClearResumeState = jest.fn();
const mockLoadResumeState = jest.fn(() => null as $TSFixMe);
const mockSaveResumeState = jest.fn();
jest.mock(
  "~/components/views/SampleUploadFlow/components/UploadProgressModal/uploadResumeState",
  () => ({
    clearUploadResumeState: (...args: $TSFixMe[]) =>
      mockClearResumeState(...args),
    loadUploadResumeState: (...args: $TSFixMe[]) =>
      mockLoadResumeState(...args),
    saveUploadResumeState: (...args: $TSFixMe[]) =>
      mockSaveResumeState(...args),
  }),
);

const mockAddFlags = jest.fn();
const mockAddAdditionalInputFiles = jest.fn();
const mockRedirectToProject = jest.fn();
jest.mock(
  "~/components/views/SampleUploadFlow/components/UploadProgressModal/upload_progress_utils",
  () => ({
    addFlagsToSamples: (...args: $TSFixMe[]) => mockAddFlags(...args),
    addAdditionalInputFilesToSamples: (...args: $TSFixMe[]) =>
      mockAddAdditionalInputFiles(...args),
    redirectToProject: (...args: $TSFixMe[]) => mockRedirectToProject(...args),
  }),
);

jest.mock("~ui/containers/Modal", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: ({ children }: $TSFixMe) =>
      ReactLib.createElement("div", { "data-testid": "modal" }, children),
  };
});

const buttonStub = (props: $TSFixMe) => {
  const ReactLib = require("react");
  return ReactLib.createElement(
    "button",
    { onClick: props.onClick },
    props.text,
  );
};
jest.mock("~/components/ui/controls/buttons/PrimaryButton", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => buttonStub(props),
}));
jest.mock("~/components/ui/controls/buttons/SecondaryButton", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => buttonStub(props),
}));
jest.mock("~ui/controls/buttons", () => ({
  __esModule: true,
  PrimaryButton: (props: $TSFixMe) => buttonStub(props),
  SecondaryButton: (props: $TSFixMe) => buttonStub(props),
}));

import { S3Client } from "@aws-sdk/client-s3";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { formatFileSize } from "~/components/utils/format";
import { LocalUploadProgressModal } from "~/components/views/SampleUploadFlow/components/UploadProgressModal/components/LocalUploadProgressModal/LocalUploadProgressModal";

const PROJECT = { id: 77, name: "Ocean" } as $TSFixMe;

const CREDENTIALS = {
  access_key_id: "AKIA",
  aws_region: "us-west-2",
  expiration: "2030-01-01T00:00:00Z",
  secret_access_key: "secret",
  session_token: "token",
};

const inputFile = (key: string, size = 100, extra: $TSFixMe = {}) => ({
  file_to_upload: { size } as $TSFixMe,
  s3_bucket: "bucket",
  s3_file_path: key,
  ...extra,
});

const createdSample = (
  name: string,
  id: number,
  files: $TSFixMe[] = [inputFile(`${name}/R1.fastq`)],
) => ({ id, name, input_files: files });

const propSample = (name: string, size = 100) => ({
  name,
  files: [{ size } as File],
});

const renderModal = (overrides: Record<string, unknown> = {}) =>
  render(
    <LocalUploadProgressModal
      adminOptions={{}}
      bedFile={null}
      clearlabs={false}
      guppyBasecallerSetting=""
      medakaModel={null}
      metadata={{ headers: [], rows: [] } as $TSFixMe}
      onUploadComplete={jest.fn()}
      project={PROJECT}
      refSeqAccession={null}
      refSeqFile={null}
      refSeqTaxon={null}
      samples={[propSample("alpha")] as $TSFixMe}
      skipSampleProcessing={false}
      technology={null}
      uploadType="local"
      useStepFunctionPipeline={false}
      wetlabProtocol={null}
      workflows={new Set() as $TSFixMe}
      {...(overrides as $TSFixMe)}
    />,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockUploads.length = 0;
  mockDone.impl = null;
  mockAddFlags.mockImplementation(({ samples }: $TSFixMe) => samples ?? []);
  mockInitiateBulkUpload.mockResolvedValue([]);
  mockStartHeartbeat.mockResolvedValue(123 as $TSFixMe);
  mockGetUploadCredentials.mockResolvedValue(CREDENTIALS);
  mockCompleteSampleUpload.mockImplementation(
    async ({ sample, onSampleUploadSuccess }: $TSFixMe) => {
      onSampleUploadSuccess(sample);
    },
  );
  mockCanCacheFile.mockReturnValue(false);
  mockHandlesSupported.mockReturnValue(false);
  mockLoadResumeState.mockReturnValue(null);
});

describe("LocalUploadProgressModal happy-path transfer", () => {
  it("fetches credentials, builds the S3 client and uploads each input file", async () => {
    mockInitiateBulkUpload.mockResolvedValue([
      createdSample("alpha", 5, [
        inputFile("alpha/R1.fastq", 100),
        inputFile("alpha/R2.fastq", 200),
      ]),
    ]);

    renderModal();

    await waitFor(() => expect(mockUploads).toHaveLength(2));
    expect(mockGetUploadCredentials).toHaveBeenCalledWith(5);

    const s3Config = (S3Client as unknown as jest.Mock).mock.calls[0][0];
    expect(s3Config.region).toBe("us-west-2");
    expect(s3Config.credentials.accessKeyId).toBe("AKIA");
    expect(s3Config.credentials.sessionToken).toBe("token");
    // The ISO expiration string is converted to a Date for the SDK v3 provider.
    expect(s3Config.credentials.expiration).toBeInstanceOf(Date);
    expect(s3Config.useAccelerateEndpoint).toBe(true);

    expect(mockUploads[0].params).toEqual({
      Bucket: "bucket",
      Key: "alpha/R1.fastq",
      Body: { size: 100 },
      ChecksumAlgorithm: "SHA256",
      Tagging: "type=sample&id=5",
    });
    // No persisted uploadId for a fresh upload.
    expect(mockUploads[0].uploadId).toBeUndefined();

    // Per-file recovery artefacts are dropped once the file is fully on S3.
    await waitFor(() =>
      expect(mockClearCachedUploadFile).toHaveBeenCalledWith(
        77,
        "alpha/R1.fastq",
      ),
    );
    expect(mockClearFileHandle).toHaveBeenCalledWith(77, "alpha/R2.fastq");

    // Sample finished -> success row, completed modal, resume state cleared.
    expect(await screen.findByText("Sent to pipeline")).toBeTruthy();
    expect(screen.getByText("Uploads completed!")).toBeTruthy();
    expect(mockClearResumeState).toHaveBeenCalledWith(77);
    expect(mockClearProjectByteCache).toHaveBeenCalledWith(77);
    expect(mockClearProjectFileHandles).toHaveBeenCalledWith(77);
    expect(mockTrackEvent).toHaveBeenCalled();
  });

  it("skips a file that a previous session already finished", async () => {
    mockLoadResumeState.mockReturnValue({
      sampleFileUploadIds: {},
      sampleFileCompleted: { "alpha/R1.fastq": true },
    });
    mockInitiateBulkUpload.mockResolvedValue([
      createdSample("alpha", 5, [
        inputFile("alpha/R1.fastq"),
        inputFile("alpha/R2.fastq"),
      ]),
    ]);

    renderModal();

    await waitFor(() => expect(mockCompleteSampleUpload).toHaveBeenCalled());
    // Only the unfinished file gets a ResumableUpload.
    expect(mockUploads).toHaveLength(1);
    expect(mockUploads[0].params.Key).toBe("alpha/R2.fastq");
  });

  it("reuses a persisted multipart uploadId when resuming a file", async () => {
    mockLoadResumeState.mockReturnValue({
      sampleFileUploadIds: { "alpha/R1.fastq": "upload-abc" },
      sampleFileCompleted: {},
    });
    mockInitiateBulkUpload.mockResolvedValue([createdSample("alpha", 5)]);

    renderModal();

    await waitFor(() => expect(mockUploads).toHaveLength(1));
    expect(mockUploads[0].uploadId).toBe("upload-abc");
  });

  it("caches bytes and persists the file handle when both are available", async () => {
    mockCanCacheFile.mockReturnValue(true);
    mockHandlesSupported.mockReturnValue(true);
    const handle = { name: "handle" };
    mockInitiateBulkUpload.mockResolvedValue([
      createdSample("alpha", 5, [inputFile("alpha/R1.fastq", 42, { handle })]),
    ]);

    renderModal();

    await waitFor(() => expect(mockUploads).toHaveLength(1));
    expect(mockCanCacheFile).toHaveBeenCalledWith(42);
    expect(mockCacheUploadFile).toHaveBeenCalledWith(77, "alpha/R1.fastq", {
      size: 42,
    });
    expect(mockPersistFileHandle).toHaveBeenCalledWith(
      77,
      "alpha/R1.fastq",
      handle,
    );
  });

  it("does not cache bytes or a handle when neither is supported", async () => {
    mockInitiateBulkUpload.mockResolvedValue([
      createdSample("alpha", 5, [
        inputFile("alpha/R1.fastq", 42, { handle: { name: "handle" } }),
      ]),
    ]);

    renderModal();

    await waitFor(() => expect(mockUploads).toHaveLength(1));
    expect(mockCacheUploadFile).not.toHaveBeenCalled();
    expect(mockPersistFileHandle).not.toHaveBeenCalled();
  });
});

describe("LocalUploadProgressModal progress and multipart bookkeeping", () => {
  it("turns httpUploadProgress into a per-sample percentage", async () => {
    // Leave the sample in progress (no success callback) so the percentage text
    // stays on screen instead of being replaced by "Sent to pipeline".
    mockCompleteSampleUpload.mockImplementation(async () => undefined);
    mockDone.impl = async instance => {
      instance.handlers.httpUploadProgress({ loaded: 50, total: 100 });
    };
    mockInitiateBulkUpload.mockResolvedValue([
      createdSample("alpha", 5, [inputFile("alpha/R1.fastq", 100)]),
    ]);

    renderModal();

    const expected = `Uploaded ${formatFileSize(50)} of ${formatFileSize(100)}`;
    expect(await screen.findByText(expected)).toBeTruthy();
    expect(screen.queryByText("Waiting to upload...")).toBeNull();
  });

  it("treats a progress event without a total as zero percent", async () => {
    mockCompleteSampleUpload.mockImplementation(async () => undefined);
    mockDone.impl = async instance => {
      instance.handlers.httpUploadProgress({ loaded: 50, total: undefined });
    };
    mockInitiateBulkUpload.mockResolvedValue([
      createdSample("alpha", 5, [inputFile("alpha/R1.fastq", 100)]),
    ]);

    renderModal();

    const expected = `Uploaded ${formatFileSize(0)} of ${formatFileSize(100)}`;
    expect(await screen.findByText(expected)).toBeTruthy();
  });

  it("persists a new multipart uploadId while the file is still unfinished", async () => {
    // The upload pauses right after the multipart upload is created, so the id
    // survives instead of being cleaned up by the post-`done()` bookkeeping.
    mockDone.impl = async instance => {
      instance.createdCallback("upload-xyz");
      const pauseError = new Error("paused");
      pauseError.name = "PauseError";
      throw pauseError;
    };
    mockInitiateBulkUpload.mockResolvedValue([createdSample("alpha", 5)]);

    renderModal();

    await waitFor(() =>
      expect(
        mockSaveResumeState.mock.calls.some(
          ([, state]: $TSFixMe) =>
            state.sampleFileUploadIds["alpha/R1.fastq"] === "upload-xyz",
        ),
      ).toBe(true),
    );
  });

  it("removes the s3 key from the uploadId map when no multipart id was created", async () => {
    mockLoadResumeState.mockReturnValue({
      sampleFileUploadIds: { "alpha/R1.fastq": "stale-id" },
      sampleFileCompleted: {},
    });
    mockDone.impl = async instance => {
      instance.createdCallback(undefined);
      const pauseError = new Error("paused");
      pauseError.name = "PauseError";
      throw pauseError;
    };
    mockInitiateBulkUpload.mockResolvedValue([createdSample("alpha", 5)]);

    renderModal();

    // The seeded stale id is dropped rather than retried.
    await waitFor(() => expect(mockSaveResumeState).toHaveBeenCalled());
    await waitFor(() => {
      const lastState = mockSaveResumeState.mock.calls.slice(-1)[0][1];
      expect("alpha/R1.fastq" in lastState.sampleFileUploadIds).toBe(false);
    });
  });
});

describe("LocalUploadProgressModal error handling", () => {
  it("swallows a PauseError without marking the file complete", async () => {
    const pauseError = new Error("paused");
    pauseError.name = "PauseError";
    mockDone.impl = async () => {
      throw pauseError;
    };
    mockInitiateBulkUpload.mockResolvedValue([createdSample("alpha", 5)]);

    renderModal();

    // The sample still gets finalized (no failure was recorded) but the file's
    // recovery artefacts are deliberately kept for the resume.
    await waitFor(() => expect(mockCompleteSampleUpload).toHaveBeenCalled());
    expect(mockClearCachedUploadFile).not.toHaveBeenCalled();
    expect(mockLogError).not.toHaveBeenCalled();
  });

  it("marks the sample failed and offers a single retry when the upload throws", async () => {
    mockDone.impl = async () => {
      throw new Error("network down");
    };
    mockInitiateBulkUpload.mockResolvedValue([createdSample("alpha", 5)]);

    renderModal();

    // Generous timeout: under parallel jest workers the async upload -> throw -> retry re-render can
    // exceed findBy's 1s default, so the suite flakes even though it passes in isolation.
    expect(
      await screen.findByText("Upload failed", undefined, { timeout: 5000 }),
    ).toBeTruthy();
    expect(screen.getByText("All uploads failed")).toBeTruthy();
    expect(screen.getByText(/1 upload has failed/)).toBeTruthy();
    expect(screen.getByText("Retry failed upload")).toBeTruthy();
    expect(mockLogError).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "UploadProgressModal: Local sample upload error to S3 occurred",
      }),
    );
  });

  it("pluralizes the retry action when several samples fail", async () => {
    mockDone.impl = async () => {
      throw new Error("network down");
    };
    mockInitiateBulkUpload.mockResolvedValue([
      createdSample("alpha", 5),
      createdSample("beta", 6),
    ]);

    renderModal({ samples: [propSample("alpha"), propSample("beta")] });

    expect(await screen.findByText("Retry 2 failed uploads")).toBeTruthy();
    expect(screen.getByText(/2 uploads have failed/)).toBeTruthy();
  });

  it("records an error status for samples the API failed to create", async () => {
    mockInitiateBulkUpload.mockImplementation(
      async ({ onCreateSamplesError }: $TSFixMe) => {
        onCreateSamplesError(new Error("bad request"), ["alpha"]);
        return [];
      },
    );

    renderModal();

    expect(await screen.findByText("Upload failed")).toBeTruthy();
    expect(mockLogError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "UploadProgressModal: onCreateSamplesError",
      }),
    );
  });
});

describe("LocalUploadProgressModal retry and leave flows", () => {
  it("re-drives the created samples when retrying in place", async () => {
    mockDone.impl = async () => {
      throw new Error("network down");
    };
    mockInitiateBulkUpload.mockResolvedValue([createdSample("alpha", 5)]);

    renderModal();

    await screen.findByText("Retry failed upload");
    expect(mockUploads).toHaveLength(1);

    // A retry that has created-sample records in memory goes straight back to
    // uploadSamples rather than re-creating the samples through the API.
    mockDone.impl = null;
    fireEvent.click(screen.getByText("Retry failed upload"));

    await waitFor(() => expect(mockUploads.length).toBeGreaterThan(1));
    expect(mockInitiateBulkUpload).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Sent to pipeline")).toBeTruthy();
  });

  it("restarts the whole flow when there are no created samples to retry", async () => {
    // The API reports the sample as failed to create, so locallyCreatedSamples
    // stays empty and Retry has to re-run initiateLocalUpload.
    mockInitiateBulkUpload.mockImplementation(
      async ({ onCreateSamplesError }: $TSFixMe) => {
        onCreateSamplesError(new Error("bad request"), ["alpha"]);
        return [];
      },
    );

    renderModal();

    fireEvent.click(await screen.findByText("Retry failed upload"));

    await waitFor(() =>
      expect(mockInitiateBulkUpload).toHaveBeenCalledTimes(2),
    );
  });

  it("retries a single sample from its row action", async () => {
    mockDone.impl = async () => {
      throw new Error("network down");
    };
    mockInitiateBulkUpload.mockResolvedValue([createdSample("alpha", 5)]);

    renderModal();

    const rowRetry = await screen.findByText("Retry");
    mockDone.impl = null;
    fireEvent.click(rowRetry);

    await waitFor(() => expect(mockUploads.length).toBeGreaterThan(1));
  });

  it("confirms before leaving a run that has failed samples", async () => {
    mockDone.impl = async () => {
      throw new Error("network down");
    };
    mockInitiateBulkUpload.mockResolvedValue([createdSample("alpha", 5)]);

    renderModal();

    fireEvent.click(await screen.findByText("Go to Project"));

    // Confirmation modal intercepts the navigation.
    expect(screen.getByText(/Are you sure you want to leave/)).toBeTruthy();
    expect(mockRedirectToProject).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Return to Upload"));
    expect(screen.queryByText(/Are you sure you want to leave/)).toBeNull();

    fireEvent.click(screen.getByText("Go to Project"));
    fireEvent.click(screen.getByText("Yes, leave Upload"));
    expect(mockRedirectToProject).toHaveBeenCalledWith(77);
  });
});

describe("LocalUploadProgressModal screen wake lock", () => {
  afterEach(() => {
    delete (navigator as $TSFixMe).wakeLock;
    jest.restoreAllMocks();
  });

  it("acquires and releases the wake lock around the transfer", async () => {
    const release = jest.fn().mockResolvedValue(undefined);
    const sentinel = { addEventListener: jest.fn(), release };
    const request = jest.fn().mockResolvedValue(sentinel);
    (navigator as $TSFixMe).wakeLock = { request };
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    mockInitiateBulkUpload.mockResolvedValue([createdSample("alpha", 5)]);

    renderModal();

    await waitFor(() => expect(request).toHaveBeenCalledWith("screen"));
    // The sentinel's release listener is wired up, and the lock is handed back
    // once every sample has been uploaded.
    expect(sentinel.addEventListener).toHaveBeenCalledWith(
      "release",
      expect.any(Function),
    );
    await waitFor(() => expect(release).toHaveBeenCalled());
  });

  it("logs and continues when the WakeLock API is unavailable", async () => {
    const errorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    mockInitiateBulkUpload.mockResolvedValue([createdSample("alpha", 5)]);

    renderModal();

    await waitFor(() =>
      expect(errorSpy).toHaveBeenCalledWith("Failed to acquire wake lock"),
    );
    // The upload still runs to completion without a wake lock.
    expect(await screen.findByText("Sent to pipeline")).toBeTruthy();
  });
});
