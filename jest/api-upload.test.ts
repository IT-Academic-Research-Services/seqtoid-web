// Coverage: app/assets/src/api/upload.ts
// This is the local/remote bulk-upload orchestration layer. The branches that
// matter are (a) the field whitelist + alignment_scalability -> dag_vars
// rewrite, (b) the three failure modes of initiateBulkUploadLocalWithMetadata
// (request throws, partial `errors` in the response, clean success), (c) the
// retry loop in completeSampleUpload up to MAX_MARK_SAMPLE_RETRIES, and (d) the
// errored_sample_names diffing inside bulkUploadWithMetadata.
//
// The retry loop sleeps for minutes at a time via exponentialDelayWithJitter,
// so setTimeout is stubbed to fire synchronously; the requested delay is still
// asserted separately so the backoff itself stays covered.
import { markSampleUploaded } from "~/api";
import { get as httpGet, postWithCSRF } from "~/api/core";
import {
  bulkUploadBasespace,
  bulkUploadRemote,
  completeSampleUpload,
  exponentialDelayWithJitter,
  getUploadCredentials,
  initiateBulkUploadLocalWithMetadata,
  MAX_MARK_SAMPLE_RETRIES,
  startUploadHeartbeat,
} from "~/api/upload";

jest.mock("~/api", () => ({
  markSampleUploaded: jest.fn(),
}));

jest.mock("~/api/core", () => ({
  get: jest.fn(),
  postWithCSRF: jest.fn(),
}));

const mockedPost = postWithCSRF as jest.Mock;
const mockedGet = httpGet as jest.Mock;
const mockedMarkUploaded = markSampleUploaded as jest.Mock;

// Make every setTimeout fire immediately so the exponential backoff does not
// actually make the test wait ~2 hours. The delay argument is still recorded.
const stubSetTimeout = () =>
  jest
    .spyOn(global, "setTimeout")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockImplementation(((cb: () => void) => {
      cb();
      return 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any);

beforeEach(() => {
  jest.clearAllMocks();
  mockedPost.mockResolvedValue({ samples: [], errors: [] });
  mockedGet.mockResolvedValue({});
  mockedMarkUploaded.mockResolvedValue({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("MAX_MARK_SAMPLE_RETRIES", () => {
  it("is the retry ceiling the upload modal relies on", () => {
    expect(MAX_MARK_SAMPLE_RETRIES).toBe(10);
  });
});

describe("exponentialDelayWithJitter", () => {
  it("schedules a delay of at least the 10s floor and grows with tryCount", async () => {
    const timeoutSpy = stubSetTimeout();
    jest.spyOn(Math, "random").mockReturnValue(0.5);

    await exponentialDelayWithJitter(0);
    await exponentialDelayWithJitter(1);

    const first = timeoutSpy.mock.calls[0][1] as number;
    const second = timeoutSpy.mock.calls[1][1] as number;

    // ((0 + 0.5) * 10) ** 3.5 + 10000
    expect(first).toBeCloseTo(5 ** 3.5 + 10000, 5);
    expect(second).toBeCloseTo(15 ** 3.5 + 10000, 5);
    expect(second).toBeGreaterThan(first);
    expect(first).toBeGreaterThan(10000);
  });

  it("resolves once the timer fires", async () => {
    stubSetTimeout();
    await expect(exponentialDelayWithJitter(2)).resolves.toBeUndefined();
  });
});

describe("bulkUploadWithMetadata (via bulkUploadBasespace / bulkUploadRemote)", () => {
  it("posts samples, metadata and the web client flag, returning the response as-is when there are no errors", async () => {
    const samples = [{ name: "s1" }];
    const metadata = { headers: ["a"], rows: [] };
    mockedPost.mockResolvedValueOnce({
      samples: [{ name: "s1", id: 1 }],
      errors: [],
    });

    const result = await bulkUploadBasespace({ samples, metadata });

    expect(mockedPost).toHaveBeenCalledWith(
      "/samples/bulk_upload_with_metadata.json",
      { samples, metadata, client: "web" },
    );
    expect(result).toEqual({ samples: [{ name: "s1", id: 1 }], errors: [] });
    expect("errored_sample_names" in result).toBe(false);
  });

  it("adds errored_sample_names for the samples missing from the response", async () => {
    const samples = [{ name: "s1" }, { name: "s2" }, { name: "s3" }];
    mockedPost.mockResolvedValueOnce({
      samples: [{ name: "s1" }],
      errors: ["s2 blew up", "s3 blew up"],
    });

    const result = await bulkUploadRemote({ samples, metadata: null });

    expect(result.errored_sample_names).toEqual(["s2", "s3"]);
    expect(result.errors).toHaveLength(2);
  });

  it("propagates a rejected request", async () => {
    mockedPost.mockRejectedValueOnce(new Error("422"));
    await expect(
      bulkUploadRemote({ samples: [], metadata: null }),
    ).rejects.toThrow("422");
  });
});

describe("initiateBulkUploadLocalWithMetadata", () => {
  const fileA = { name: "a_R1.fastq" };
  const fileB = { name: "a_R2.fastq" };

  const localSample = () => ({
    name: "sampleA",
    project_id: 12,
    host_genome_id: 1,
    // Not in the whitelist -- must be dropped before the request.
    finishedValidating: true,
    status: "in progress",
    files: { "a_R1.fastq": fileA, "a_R2.fastq": fileB },
    input_files_attributes: [
      { source: "a_R1.fastq", source_type: "local" },
      { source: "a_R2.fastq", source_type: "local" },
    ],
  });

  it("sends only whitelisted fields and attaches the local files to the created samples", async () => {
    mockedPost.mockResolvedValueOnce({
      errors: [],
      samples: [
        {
          id: 99,
          name: "sampleA",
          input_files: [{ source: "a_R1.fastq" }, { source: "a_R2.fastq" }],
        },
      ],
    });

    const onCreateSamplesError = jest.fn();
    const created = await initiateBulkUploadLocalWithMetadata({
      samples: [localSample()],
      metadata: { headers: [], rows: [] },
      onCreateSamplesError,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const sentSamples = mockedPost.mock.calls[0][1].samples;
    expect(sentSamples[0]).toEqual({
      name: "sampleA",
      project_id: 12,
      host_genome_id: 1,
      input_files_attributes: [
        { source: "a_R1.fastq", source_type: "local" },
        { source: "a_R2.fastq", source_type: "local" },
      ],
    });
    // Non-whitelisted keys are stripped.
    expect("finishedValidating" in sentSamples[0]).toBe(false);
    expect("files" in sentSamples[0]).toBe(false);

    // The created samples come back decorated with the File handles to upload.
    expect(created[0].input_files[0].file_to_upload).toBe(fileA);
    expect(created[0].input_files[1].file_to_upload).toBe(fileB);
    expect(onCreateSamplesError).not.toHaveBeenCalled();
  });

  it("rewrites alignment_scalability === 'true' into the dag_vars JSON blob", async () => {
    mockedPost.mockResolvedValueOnce({ errors: [], samples: [] });

    await initiateBulkUploadLocalWithMetadata({
      samples: [
        { name: "s1", alignment_scalability: "true" },
        { name: "s2", alignment_scalability: "false" },
      ],
      metadata: null,
      onCreateSamplesError: jest.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const sent = mockedPost.mock.calls[0][1].samples;
    expect(sent[0].dag_vars).toBe(
      JSON.stringify({ NonHostAlignment: { alignment_scalability: true } }),
    );
    // The non-"true" sample keeps its flag but gets no dag_vars.
    expect(sent[1].alignment_scalability).toBe("false");
    expect(sent[1].dag_vars).toBeUndefined();
  });

  it("reports the error and returns an empty list when the request throws", async () => {
    const failure = new Error("network down");
    mockedPost.mockRejectedValueOnce(failure);
    const onCreateSamplesError = jest.fn();

    const created = await initiateBulkUploadLocalWithMetadata({
      samples: [{ name: "s1" }, { name: "s2" }],
      metadata: null,
      onCreateSamplesError,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    expect(created).toEqual([]);
    expect(onCreateSamplesError).toHaveBeenCalledWith([failure], ["s1", "s2"]);
  });

  it("falls back to console.error when no onCreateSamplesError handler is given", async () => {
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mockedPost.mockRejectedValueOnce("boom");

    const created = await initiateBulkUploadLocalWithMetadata({
      samples: [{ name: "s1" }],
      metadata: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    expect(created).toEqual([]);
    expect(consoleError).toHaveBeenCalledWith(
      "CreateSamplesError",
      ["boom"],
      "erroredSamplesNames",
      ["s1"],
    );
  });

  it("reports partial errors but still returns the samples that were created", async () => {
    mockedPost.mockResolvedValueOnce({
      errors: ["s2 failed"],
      samples: [{ id: 1, name: "s1", input_files: [{ source: "f1" }] }],
    });
    const onCreateSamplesError = jest.fn();

    const created = await initiateBulkUploadLocalWithMetadata({
      samples: [
        { name: "s1", files: { f1: fileA } },
        { name: "s2", files: { f2: fileB } },
      ],
      metadata: null,
      onCreateSamplesError,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    expect(onCreateSamplesError).toHaveBeenCalledWith(["s2 failed"], ["s2"]);
    expect(created).toHaveLength(1);
    expect(created[0].input_files[0].file_to_upload).toBe(fileA);
  });

  it("skips the file-attachment step for created samples without input_files", async () => {
    mockedPost.mockResolvedValueOnce({
      errors: [],
      samples: [{ id: 1, name: "s1" }],
    });

    const created = await initiateBulkUploadLocalWithMetadata({
      samples: [{ name: "s1", files: {} }],
      metadata: null,
      onCreateSamplesError: jest.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    expect(created).toEqual([{ id: 1, name: "s1" }]);
  });
});

describe("completeSampleUpload", () => {
  it("marks the sample uploaded and calls the success callback on the first try", async () => {
    const onSampleUploadSuccess = jest.fn();
    const onMarkSampleUploadedError = jest.fn();
    const sample = { id: 7 };

    await completeSampleUpload({
      sample,
      onSampleUploadSuccess,
      onMarkSampleUploadedError,
    });

    expect(mockedMarkUploaded).toHaveBeenCalledTimes(1);
    expect(mockedMarkUploaded).toHaveBeenCalledWith(7);
    expect(onSampleUploadSuccess).toHaveBeenCalledWith(sample);
    expect(onMarkSampleUploadedError).not.toHaveBeenCalled();
  });

  it("succeeds without callbacks supplied", async () => {
    await completeSampleUpload({ sample: { id: 8 } });
    expect(mockedMarkUploaded).toHaveBeenCalledWith(8);
  });

  it("retries after transient failures and then reports success", async () => {
    stubSetTimeout();
    mockedMarkUploaded
      .mockRejectedValueOnce(new Error("503"))
      .mockRejectedValueOnce(new Error("503"))
      .mockResolvedValueOnce({});

    const onSampleUploadSuccess = jest.fn();
    const onMarkSampleUploadedError = jest.fn();

    await completeSampleUpload({
      sample: { id: 9 },
      onSampleUploadSuccess,
      onMarkSampleUploadedError,
    });

    expect(mockedMarkUploaded).toHaveBeenCalledTimes(3);
    expect(onSampleUploadSuccess).toHaveBeenCalledTimes(1);
    expect(onMarkSampleUploadedError).not.toHaveBeenCalled();
  });

  it("gives up after MAX_MARK_SAMPLE_RETRIES and reports the last error", async () => {
    stubSetTimeout();
    const lastError = new Error("still 503");
    mockedMarkUploaded.mockRejectedValue(lastError);

    const onSampleUploadSuccess = jest.fn();
    const onMarkSampleUploadedError = jest.fn();
    const sample = { id: 10 };

    await completeSampleUpload({
      sample,
      onSampleUploadSuccess,
      onMarkSampleUploadedError,
    });

    expect(mockedMarkUploaded).toHaveBeenCalledTimes(MAX_MARK_SAMPLE_RETRIES);
    expect(onSampleUploadSuccess).not.toHaveBeenCalled();
    expect(onMarkSampleUploadedError).toHaveBeenCalledWith(sample, lastError);
  });

  it("gives up quietly when no error callback was supplied", async () => {
    stubSetTimeout();
    mockedMarkUploaded.mockRejectedValue(new Error("nope"));

    await completeSampleUpload({ sample: { id: 11 } });

    expect(mockedMarkUploaded).toHaveBeenCalledTimes(MAX_MARK_SAMPLE_RETRIES);
  });
});

describe("startUploadHeartbeat", () => {
  it("schedules a 10 minute interval and returns its handle", async () => {
    const intervalSpy = jest
      .spyOn(global, "setInterval")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation((() => 1234) as any);

    const handle = await startUploadHeartbeat();

    expect(intervalSpy).toHaveBeenCalledTimes(1);
    expect(intervalSpy.mock.calls[0][1]).toBe(10 * 60 * 1000);
    expect(handle).toBe(1234);
  });

  it("registers a heartbeat callback that is a harmless no-op (#386 recursion fix)", async () => {
    const callbacks: Array<() => void> = [];
    jest
      .spyOn(global, "setInterval")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation(((cb: () => void) => {
        callbacks.push(cb);
        return 1;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any);

    await startUploadHeartbeat();

    expect(callbacks).toHaveLength(1);
    // Previously this self-recursed and crashed the tab; it must return void.
    expect(callbacks[0]()).toBeUndefined();
  });
});

describe("getUploadCredentials", () => {
  it("gets the presigned credentials for the sample", async () => {
    mockedGet.mockResolvedValueOnce({ access_key_id: "AKIA" });

    await expect(getUploadCredentials(31)).resolves.toEqual({
      access_key_id: "AKIA",
    });
    expect(mockedGet).toHaveBeenCalledWith(
      "/samples/31/upload_credentials.json",
    );
  });

  it("propagates a rejection", async () => {
    mockedGet.mockRejectedValueOnce(new Error("403"));
    await expect(getUploadCredentials(31)).rejects.toThrow("403");
  });
});
