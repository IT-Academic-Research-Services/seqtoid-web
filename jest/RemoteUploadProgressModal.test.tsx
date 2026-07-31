/**
 * Coverage for RemoteUploadProgressModal: the remote/basespace/invalid upload-type fork, the
 * additional-input-file (bed / reference sequence) S3 side-upload, and every state the modal can
 * settle into (all succeeded, some failed, all failed).
 *
 * The AWS SDK, the upload API, the resumable uploader and the pure flag helpers are all mocked so
 * this is a test of the component's own orchestration and rendering.
 */
jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: jest
    .fn()
    .mockImplementation(function S3Client(config: Record<string, unknown>) {
      return { config };
    }),
  ChecksumAlgorithm: { SHA256: "SHA256" },
}));

jest.mock("~/api/upload", () => ({
  bulkUploadRemote: jest.fn(),
  bulkUploadBasespace: jest.fn(),
  getUploadCredentials: jest.fn(),
}));

jest.mock("~/components/utils/logUtil", () => ({ logError: jest.fn() }));

jest.mock(
  "~/components/views/SampleUploadFlow/components/UploadProgressModal/resumableUpload",
  () => ({
    ResumableUpload: jest.fn().mockImplementation(() => ({
      done: jest.fn().mockResolvedValue({ ETag: '"ok"' }),
    })),
  }),
);

jest.mock(
  "~/components/views/SampleUploadFlow/components/UploadProgressModal/upload_progress_utils",
  () => ({
    addFlagsToSamples: jest.fn(),
    addAdditionalInputFilesToSamples: jest.fn(),
    redirectToProject: jest.fn(),
  }),
);

// jest.config maps "*.scss" to a style mock, but the webpack "~/" alias pattern matches first for
// alias-form stylesheet imports, so the real SCSS would be handed to the JS transformer. Stub it.
jest.mock(
  "~/components/views/SampleUploadFlow/components/UploadProgressModal/upload_progress_modal.scss",
  () => ({}),
);

// Semantic UI's Modal renders through a portal and adds nothing this test cares about.
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

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import {
  bulkUploadBasespace,
  bulkUploadRemote,
  getUploadCredentials,
} from "~/api/upload";
import { logError } from "~/components/utils/logUtil";
import { RemoteUploadProgressModal } from "~/components/views/SampleUploadFlow/components/UploadProgressModal/components/RemoteUploadProgressModal/RemoteUploadProgressModal";
import { ResumableUpload } from "~/components/views/SampleUploadFlow/components/UploadProgressModal/resumableUpload";
import {
  addAdditionalInputFilesToSamples,
  addFlagsToSamples,
  redirectToProject,
} from "~/components/views/SampleUploadFlow/components/UploadProgressModal/upload_progress_utils";

/* eslint-disable @typescript-eslint/no-explicit-any */
const mockBulkUploadRemote = bulkUploadRemote as unknown as jest.Mock;
const mockBulkUploadBasespace = bulkUploadBasespace as unknown as jest.Mock;
const mockGetUploadCredentials = getUploadCredentials as unknown as jest.Mock;
const mockLogError = logError as unknown as jest.Mock;
const mockResumableUpload = ResumableUpload as unknown as jest.Mock;
const mockAddFlags = addFlagsToSamples as unknown as jest.Mock;
const mockAddAdditionalInputFiles =
  addAdditionalInputFilesToSamples as unknown as jest.Mock;
const mockRedirectToProject = redirectToProject as unknown as jest.Mock;

const PROJECT = { id: 55, name: "Ocean Project" } as any;

const SAMPLES = [
  {
    name: "sample_one",
    project_id: 55,
    host_genome_id: 1,
    basespace_access_token: "token",
    basespace_dataset_id: "ds-1",
    extra_field: "dropped for basespace",
  },
  {
    name: "sample_two",
    project_id: 55,
    host_genome_id: 1,
    basespace_access_token: "token",
    basespace_dataset_id: "ds-2",
    extra_field: "dropped for basespace",
  },
] as any;

const renderModal = (overrides: Record<string, unknown> = {}) =>
  render(
    <RemoteUploadProgressModal
      adminOptions={{}}
      bedFile={null}
      clearlabs={false}
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
      uploadType="remote"
      useStepFunctionPipeline={false}
      wetlabProtocol={null}
      workflows={new Set() as any}
      {...(overrides as any)}
    />,
  );

beforeEach(() => {
  jest.clearAllMocks();
  // By default the flag helper is a pass-through so samplesToUpload mirrors the input samples.
  mockAddFlags.mockImplementation(({ samples }: any) => samples ?? []);
  mockBulkUploadRemote.mockResolvedValue({
    samples: [],
    errored_sample_names: [],
  });
  mockBulkUploadBasespace.mockResolvedValue({
    samples: [],
    errored_sample_names: [],
  });
});

describe("RemoteUploadProgressModal upload-type fork", () => {
  it("uses bulkUploadRemote and reports success for uploadType 'remote'", async () => {
    const onUploadComplete = jest.fn();
    renderModal({ onUploadComplete });

    await waitFor(() => expect(onUploadComplete).toHaveBeenCalled());

    expect(mockBulkUploadRemote).toHaveBeenCalledTimes(1);
    expect(mockBulkUploadBasespace).not.toHaveBeenCalled();
    expect(mockBulkUploadRemote.mock.calls[0][0].samples).toEqual(SAMPLES);
    expect(screen.getByText("2 samples successfully created")).toBeTruthy();
    // Success copy names S3 (not Basespace) for a remote upload.
    expect(screen.getByText(/from S3\./)).toBeTruthy();
    // No additional input files, so that helper is never invoked.
    expect(mockAddAdditionalInputFiles).not.toHaveBeenCalled();
  });

  it("uses bulkUploadBasespace and narrows samples to the basespace fields", async () => {
    const onUploadComplete = jest.fn();
    renderModal({ uploadType: "basespace", onUploadComplete });

    await waitFor(() => expect(onUploadComplete).toHaveBeenCalled());

    expect(mockBulkUploadBasespace).toHaveBeenCalledTimes(1);
    expect(mockBulkUploadRemote).not.toHaveBeenCalled();
    // Only the whitelisted Basespace fields survive the pick().
    expect(mockAddFlags.mock.calls[0][0].samples).toEqual([
      {
        name: "sample_one",
        project_id: 55,
        host_genome_id: 1,
        basespace_access_token: "token",
        basespace_dataset_id: "ds-1",
      },
      {
        name: "sample_two",
        project_id: 55,
        host_genome_id: 1,
        basespace_access_token: "token",
        basespace_dataset_id: "ds-2",
      },
    ]);
    expect(screen.getByText(/from Basespace\./)).toBeTruthy();
  });

  it("logs and fails every sample for an unsupported upload type", async () => {
    const onUploadComplete = jest.fn();
    renderModal({ uploadType: "local", onUploadComplete });

    // No samples are staged for an unknown type, and the missing bulk-upload function makes the
    // request path throw, so every input sample is reported as failed.
    await waitFor(() =>
      expect(screen.getByText("Uploads completed with 2 errors")).toBeTruthy(),
    );

    expect(mockLogError).toHaveBeenCalledWith({
      message: "Invalid upload type 'local' for remote upload modal",
    });
    expect(mockBulkUploadRemote).not.toHaveBeenCalled();
    expect(mockBulkUploadBasespace).not.toHaveBeenCalled();
    // onUploadComplete is deliberately not fired on the failure path.
    expect(onUploadComplete).not.toHaveBeenCalled();
    expect(
      screen.getByText(/sample_one, sample_two/, { exact: false }),
    ).toBeTruthy();
  });
});

describe("RemoteUploadProgressModal in-progress and failure states", () => {
  it("shows the in-progress header until the bulk upload resolves", async () => {
    let resolveUpload: (value: unknown) => void = () => undefined;
    mockBulkUploadRemote.mockReturnValue(
      new Promise(resolve => {
        resolveUpload = resolve;
      }),
    );

    renderModal();

    expect(
      await screen.findByText(/Creating 2 samples in Ocean Project/),
    ).toBeTruthy();
    expect(
      screen.getByText("Stay on this page until upload completes."),
    ).toBeTruthy();

    resolveUpload({ samples: [], errored_sample_names: [] });
    await waitFor(() =>
      expect(screen.getByText("2 samples successfully created")).toBeTruthy(),
    );
  });

  it("uses the singular sample wording for a single sample", async () => {
    mockBulkUploadRemote.mockReturnValue(new Promise(() => undefined));
    renderModal({ samples: [SAMPLES[0]] });

    expect(
      await screen.findByText(/Creating 1 sample in Ocean Project/),
    ).toBeTruthy();
  });

  it("reports a partial failure and truncates the failed-sample list", async () => {
    mockBulkUploadRemote.mockResolvedValue({
      samples: [],
      errored_sample_names: ["a", "b", "c", "d", "e"],
    });
    const onUploadComplete = jest.fn();
    renderModal({ onUploadComplete });

    await waitFor(() => expect(onUploadComplete).toHaveBeenCalled());

    expect(screen.getByText("Uploads completed with 5 errors")).toBeTruthy();
    // Only the first three names are listed, with a count of the remainder.
    expect(screen.getByText(/a, b, c/)).toBeTruthy();
    expect(screen.getByText(/2 more\./)).toBeTruthy();
  });

  it("uses the singular 'error' and no overflow note for exactly one failure", async () => {
    mockBulkUploadRemote.mockResolvedValue({
      samples: [],
      errored_sample_names: ["only_one"],
    });
    renderModal();

    expect(
      await screen.findByText("Uploads completed with 1 error"),
    ).toBeTruthy();
    expect(screen.queryByText(/more\./)).toBeNull();
  });

  it("marks every sample failed and logs when the bulk upload request rejects", async () => {
    mockBulkUploadRemote.mockRejectedValue(new Error("500 from server"));
    const onUploadComplete = jest.fn();
    renderModal({ onUploadComplete });

    await waitFor(() =>
      expect(screen.getByText("All uploads failed")).toBeTruthy(),
    );

    expect(mockLogError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "UploadProgressModal: bulkUploadRemote error",
      }),
    );
    expect(onUploadComplete).not.toHaveBeenCalled();
    // The "contact us" escape hatch only appears when everything failed.
    expect(screen.getByText("Contact us for help")).toBeTruthy();
  });
});

describe("RemoteUploadProgressModal additional input files", () => {
  const bedFile = new File([new Uint8Array(4)], "primers.bed");

  const withBedFile = (responseSamples: any[]) => {
    mockAddFlags.mockImplementation(({ samples }: any) =>
      (samples ?? []).map((s: any) => ({
        ...s,
        files: { "primers.bed": bedFile },
      })),
    );
    mockBulkUploadRemote.mockResolvedValue({
      samples: responseSamples,
      errored_sample_names: [],
    });
    mockGetUploadCredentials.mockResolvedValue({
      access_key_id: "AKIA",
      aws_region: "us-west-2",
      expiration: "2030-01-01T00:00:00Z",
      secret_access_key: "secret",
      session_token: "session",
    });
  };

  it("attaches the bed file to each created sample and uploads it to S3", async () => {
    withBedFile([
      {
        id: 101,
        name: "sample_one",
        input_files: [
          {
            source: "primers.bed",
            s3_bucket: "czid-bucket",
            s3_file_path: "samples/55/101/primers.bed",
          },
          // No matching entry in `files`, so this one is not uploaded here.
          {
            source: "fastq_from_s3",
            s3_bucket: "czid-bucket",
            s3_file_path: "x",
          },
        ],
      },
      // A sample with no input_files at all must not break the loop.
      { id: 102, name: "sample_two" },
    ]);
    const onUploadComplete = jest.fn();
    renderModal({ bedFile, onUploadComplete });

    await waitFor(() => expect(onUploadComplete).toHaveBeenCalled());

    expect(mockAddAdditionalInputFiles).toHaveBeenCalledTimes(1);
    expect(mockAddAdditionalInputFiles.mock.calls[0][0].bedFile).toBe(bedFile);
    // Credentials are fetched per sample that has input files.
    expect(mockGetUploadCredentials).toHaveBeenCalledWith(101);
    // Exactly one file (the bed file) is pushed to S3.
    expect(mockResumableUpload).toHaveBeenCalledTimes(1);

    const params = mockResumableUpload.mock.calls[0][0].params;
    expect(params.Bucket).toBe("czid-bucket");
    expect(params.Key).toBe("samples/55/101/primers.bed");
    expect(params.Body).toBe(bedFile);
    expect(params.ChecksumAlgorithm).toBe("SHA256");

    // The ISO expiration string is converted to a Date for the AWS credential provider.
    const s3Config = (
      jest.requireMock("@aws-sdk/client-s3").S3Client as jest.Mock
    ).mock.calls[0][0];
    expect(s3Config.credentials.expiration).toEqual(
      new Date("2030-01-01T00:00:00Z"),
    );
    expect(s3Config.useAccelerateEndpoint).toBe(true);
  });

  it("leaves the credential expiration undefined when the server omits it", async () => {
    withBedFile([
      {
        id: 101,
        name: "sample_one",
        input_files: [
          {
            source: "primers.bed",
            s3_bucket: "czid-bucket",
            s3_file_path: "samples/55/101/primers.bed",
          },
        ],
      },
    ]);
    mockGetUploadCredentials.mockResolvedValue({
      access_key_id: "AKIA",
      aws_region: "us-west-2",
      secret_access_key: "secret",
      session_token: "session",
    });
    const onUploadComplete = jest.fn();
    renderModal({ bedFile, onUploadComplete });

    await waitFor(() => expect(onUploadComplete).toHaveBeenCalled());

    const s3Config = (
      jest.requireMock("@aws-sdk/client-s3").S3Client as jest.Mock
    ).mock.calls[0][0];
    expect(s3Config.credentials.expiration).toBeUndefined();
  });

  it("logs, but does not fail the upload, when the S3 side-upload errors", async () => {
    withBedFile([
      {
        id: 101,
        name: "sample_one",
        input_files: [
          {
            source: "primers.bed",
            s3_bucket: "czid-bucket",
            s3_file_path: "samples/55/101/primers.bed",
          },
        ],
      },
    ]);
    mockGetUploadCredentials.mockRejectedValue(new Error("403 Forbidden"));
    const onUploadComplete = jest.fn();
    renderModal({ bedFile, onUploadComplete });

    await waitFor(() => expect(onUploadComplete).toHaveBeenCalled());

    expect(mockLogError).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "UploadProgressModal: Upload error to s3 occurred for additional input file of remote sample",
      }),
    );
    expect(mockResumableUpload).not.toHaveBeenCalled();
    // The samples were still created, so the modal reports success.
    expect(screen.getByText("2 samples successfully created")).toBeTruthy();
  });
});

describe("RemoteUploadProgressModal footer", () => {
  it("only offers 'Go to Project' once the upload completes, and it navigates", async () => {
    let resolveUpload: (value: unknown) => void = () => undefined;
    mockBulkUploadRemote.mockReturnValue(
      new Promise(resolve => {
        resolveUpload = resolve;
      }),
    );
    renderModal();

    await screen.findByText(/Creating 2 samples/);
    expect(screen.queryByText("Go to Project")).toBeNull();

    resolveUpload({ samples: [], errored_sample_names: [] });
    const button = await screen.findByText("Go to Project");
    fireEvent.click(button);

    expect(mockRedirectToProject).toHaveBeenCalledWith(55);
  });
});
