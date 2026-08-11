// Branch coverage for:
// app/assets/src/components/views/SampleUploadFlow/components/
//   UploadProgressModal/components/LocalUploadProgressModal/
//   LocalUploadProgressModal.tsx
//
// The two existing specs cover the happy transfer path, the retry flows and the
// "wake lock unavailable" case. What they never reach are the conditionals that
// only fire when the upload is *interrupted* or when the API hands back a
// degenerate payload:
//
//   line 145  visibilitychange re-acquires a wake lock that is still held
//   line 279  a created sample that came back with no input_files
//   line 290  the user paused while a sample's files were still in flight
//   line 324  credentials without an `expiration` (-> undefined, not a Date)
//   line 390  a file that starts *after* the user already hit Pause
//   line 519  handleSampleUploadError invoked without an error argument
//   line 577  completeLocalUpload refusing to finalize while paused
//   line 597  Pause clearing a live heartbeat interval
//   line 598  Pause releasing a held wake lock
//   line 613  Resume with created-sample records still in memory
//   line 626  Resume actually re-driving those samples
//
// Everything the component talks to is mocked, so nothing here touches the
// network or real timers.

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

// Scriptable ResumableUpload double: `mockDone.impl` decides what `done()` does
// for a given instance, which is what makes the pause / interrupt branches
// reachable at all.
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
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { LocalUploadProgressModal } from "~/components/views/SampleUploadFlow/components/UploadProgressModal/components/LocalUploadProgressModal/LocalUploadProgressModal";

// This box runs several jest workers in parallel, so the async upload chain can
// take far longer than RTL's 1s default to settle. Wait generously.
jest.setTimeout(60000);
const WAIT = { timeout: 30000 } as const;

const PROJECT = { id: 77, name: "Ocean" } as $TSFixMe;

const CREDENTIALS = {
  access_key_id: "AKIA",
  aws_region: "us-west-2",
  expiration: "2030-01-01T00:00:00Z",
  secret_access_key: "secret",
  session_token: "token",
};

const inputFile = (key: string, size = 100) => ({
  file_to_upload: { size } as $TSFixMe,
  s3_bucket: "bucket",
  s3_file_path: key,
});

const createdSample = (
  name: string,
  id: number,
  files: $TSFixMe = [{ ...inputFile(`${name}/R1.fastq`) }],
) => ({ id, name, input_files: files });

const propSample = (name: string) => ({ name, files: [{ size: 100 } as File] });

const deferred = () => {
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

// Let queued promise callbacks run WITHOUT giving React's scheduler (which uses
// a macrotask) a chance to commit a new render. Used by the pause-closure test.
const drainMicrotasks = async (ticks = 200) => {
  for (let i = 0; i < ticks; i++) {
    await Promise.resolve();
  }
};

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

afterEach(() => {
  delete (navigator as $TSFixMe).wakeLock;
  jest.restoreAllMocks();
});

// NOTE: this block is deliberately declared FIRST. The component registers a
// `visibilitychange` listener on `document` that it never removes, so listeners
// from earlier tests in this file would also respond to a dispatched event.
describe("LocalUploadProgressModal visibilitychange wake-lock re-acquisition", () => {
  it("does not re-request the screen lock when no lock was ever acquired", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    // The initial request fails, so the component holds no lock.
    const request = jest.fn().mockRejectedValue(new Error("battery low"));
    (navigator as $TSFixMe).wakeLock = { request };

    const gate = deferred();
    mockDone.impl = () => gate.promise;
    mockInitiateBulkUpload.mockResolvedValue([createdSample("alpha", 5)]);

    renderModal();

    await waitFor(() => expect(request).toHaveBeenCalledTimes(1), WAIT);

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // wakeLock is still null, so the handler short-circuits instead of asking
    // for another one.
    expect(request).toHaveBeenCalledTimes(1);

    gate.resolve();
  });

  it("re-requests the screen lock when the tab becomes visible again mid-upload", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const sentinel = {
      addEventListener: jest.fn(),
      release: jest.fn().mockResolvedValue(undefined),
    };
    const request = jest.fn().mockResolvedValue(sentinel);
    (navigator as $TSFixMe).wakeLock = { request };

    // Hang the transfer so the wake lock is still held (non-null) when the
    // visibilitychange fires -- uploadSamples nulls it out once everything is
    // uploaded, which is exactly why the guard was never seen as true before.
    const gate = deferred();
    mockDone.impl = () => gate.promise;
    mockInitiateBulkUpload.mockResolvedValue([createdSample("alpha", 5)]);

    renderModal();

    await waitFor(() => expect(request).toHaveBeenCalledTimes(1), WAIT);

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // wakeLock !== null AND visibilityState === "visible" -> re-acquire.
    expect(document.visibilityState).toBe("visible");
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2), WAIT);
    expect(request).toHaveBeenLastCalledWith("screen");

    gate.resolve();
  });
});

describe("LocalUploadProgressModal degenerate payloads", () => {
  it("skips a created sample that came back without input_files", async () => {
    mockInitiateBulkUpload.mockResolvedValue([{ id: 5, name: "alpha" }]);

    renderModal();

    // It still fetched credentials for the sample (so we are past getS3Client)
    // and then bailed before constructing any ResumableUpload.
    await waitFor(
      () => expect(mockGetUploadCredentials).toHaveBeenCalledWith(5),
      WAIT,
    );
    await waitFor(() => expect(mockTrackEvent).toHaveBeenCalled(), WAIT);
    expect(mockUploads).toHaveLength(0);
    expect(mockCompleteSampleUpload).not.toHaveBeenCalled();
    // Never marked success or failure -> the sample stays in progress.
    expect(screen.queryByText("Sent to pipeline")).toBeNull();
    expect(screen.queryByText("Upload failed")).toBeNull();
  });

  it("passes undefined expiration to the SDK when credentials omit one", async () => {
    mockGetUploadCredentials.mockResolvedValue({
      ...CREDENTIALS,
      expiration: undefined,
    });
    mockInitiateBulkUpload.mockResolvedValue([createdSample("alpha", 5)]);

    renderModal();

    await waitFor(
      () => expect(S3Client as unknown as jest.Mock).toHaveBeenCalled(),
      WAIT,
    );
    const s3Config = (S3Client as unknown as jest.Mock).mock.calls[0][0];
    expect(s3Config.credentials.expiration).toBeUndefined();
    expect(s3Config.credentials.accessKeyId).toBe("AKIA");
  });

  it("defaults the logged error to null when the API reports a failure with no error", async () => {
    mockCompleteSampleUpload.mockImplementation(
      async ({ sample, onMarkSampleUploadedError }: $TSFixMe) => {
        // The API helper can invoke this callback with the sample only; the
        // component's `error = null` default has to fill in the second arg.
        onMarkSampleUploadedError(sample);
      },
    );
    mockInitiateBulkUpload.mockResolvedValue([createdSample("alpha", 5)]);

    renderModal();

    expect(await screen.findByText("Upload failed", {}, WAIT)).toBeTruthy();
    expect(mockLogError).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "UploadProgressModal: Local sample upload error to S3 occurred",
        details: expect.objectContaining({ error: null }),
      }),
    );
  });
});

describe("LocalUploadProgressModal pause semantics", () => {
  it("soft-pauses every in-flight sample and leaves them unfinalized when paused mid-transfer", async () => {
    // Samples upload with bounded concurrency: this 2-sample batch is under the pool size, so
    // both alpha and beta are in flight at once. Each is held open on `done()` until we release
    // the gate, so both are mid-transfer when the user pauses.
    const gate = deferred();
    mockDone.impl = () => gate.promise;
    mockInitiateBulkUpload.mockResolvedValue([
      createdSample("alpha", 5),
      createdSample("beta", 6),
    ]);

    renderModal({ samples: [propSample("alpha"), propSample("beta")] });

    // Both samples' files start together under the concurrency pool.
    await waitFor(() => expect(mockUploads).toHaveLength(2), WAIT);

    fireEvent.click(screen.getByText("Pause upload"));
    // The Pause handler soft-pauses every in-flight upload, not just the first.
    await waitFor(() => expect(mockUploads[0].pause).toHaveBeenCalled(), WAIT);
    await waitFor(() => expect(mockUploads[1].pause).toHaveBeenCalled(), WAIT);

    // Now let the files finish. Because the user paused, NO sample is finalized -- both stay
    // in progress for Resume to pick up.
    await act(async () => {
      gate.resolve();
      await gate.promise;
    });
    expect(mockCompleteSampleUpload).not.toHaveBeenCalled();
  });

  it("does not finalize the upload when a sample errors out while paused", async () => {
    const onUploadComplete = jest.fn();
    const gate = deferred();
    mockDone.impl = () => gate.promise;
    mockInitiateBulkUpload.mockResolvedValue([createdSample("alpha", 5)]);

    renderModal({ onUploadComplete });

    await waitFor(() => expect(mockUploads).toHaveLength(1), WAIT);
    fireEvent.click(screen.getByText("Pause upload"));
    await waitFor(() => expect(mockUploads[0].pause).toHaveBeenCalled(), WAIT);

    // Failing the file drives sampleUploadStatuses -> the completion effect runs
    // with nothing "in progress", but completeLocalUpload must bail out because
    // the user is paused.
    await act(async () => {
      gate.reject(new Error("network down"));
      await gate.promise.catch(() => undefined);
    });

    expect(await screen.findByText("Upload failed", {}, WAIT)).toBeTruthy();
    expect(onUploadComplete).not.toHaveBeenCalled();
    expect(mockClearResumeState).not.toHaveBeenCalled();
    expect(mockClearProjectByteCache).not.toHaveBeenCalled();
  });

  it("clears the live heartbeat and releases the held wake lock on pause", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const clearIntervalSpy = jest.spyOn(global, "clearInterval");
    const release = jest.fn().mockResolvedValue(undefined);
    const sentinel = { addEventListener: jest.fn(), release };
    const request = jest.fn().mockResolvedValue(sentinel);
    (navigator as $TSFixMe).wakeLock = { request };

    const gate = deferred();
    mockDone.impl = () => gate.promise;
    mockInitiateBulkUpload.mockResolvedValue([createdSample("alpha", 5)]);

    renderModal();

    // `heartbeatInterval` and `wakeLock` are plain `let`s in the component body,
    // so they are rebound on every render and only the FIRST render's Pause
    // handler ever sees them populated. Drain the promise queue (microtasks)
    // without letting React's scheduler commit a re-render, then dispatch the
    // click straight at the DOM node so the first render's handler runs.
    await drainMicrotasks();
    expect(mockStartHeartbeat).toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith("screen");

    const pauseButton = screen.getByText("Pause upload");
    clearIntervalSpy.mockClear();
    await act(async () => {
      pauseButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await drainMicrotasks(50);
    });

    expect(clearIntervalSpy).toHaveBeenCalledWith(123);
    expect(release).toHaveBeenCalled();
    expect(screen.getByText("Resume upload")).toBeTruthy();

    gate.resolve();
  });
});

describe("LocalUploadProgressModal resume semantics", () => {
  it("re-drives the in-memory created samples instead of recreating them", async () => {
    const gate = deferred();
    mockDone.impl = async instance => {
      if (mockUploads.indexOf(instance) === 0) {
        await gate.promise;
      }
    };
    mockInitiateBulkUpload.mockResolvedValue([createdSample("alpha", 5)]);

    renderModal();

    await waitFor(() => expect(mockUploads).toHaveLength(1), WAIT);
    expect(mockStartHeartbeat).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("Pause upload"));
    const resume = await screen.findByText("Resume upload", {}, WAIT);

    fireEvent.click(resume);

    // locallyCreatedSamples is non-empty, so Resume maps the still-in-progress
    // prop samples onto their created records and re-runs uploadSamples --
    // it must NOT fall back to re-creating the samples through the API.
    await waitFor(() => expect(mockUploads).toHaveLength(2), WAIT);
    await waitFor(
      () => expect(mockStartHeartbeat).toHaveBeenCalledTimes(2),
      WAIT,
    );
    expect(mockInitiateBulkUpload).toHaveBeenCalledTimes(1);
    expect(mockUploads[1].params.Key).toBe("alpha/R1.fastq");

    expect(await screen.findByText("Sent to pipeline", {}, WAIT)).toBeTruthy();

    gate.resolve();
  });
});
