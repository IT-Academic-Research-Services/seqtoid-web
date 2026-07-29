/**
 * Branch coverage for ResumableUpload beyond the happy paths: constructor validation, the
 * abort/pause distinction, the zero-byte fast path, the ListParts resume algorithm (pagination,
 * checksum match vs mismatch, unusable records), the leavePartsOnError fork, and the fatal-error
 * boundary before a multipart upload exists.
 *
 * The AWS SDK is mocked (as in resumableUpload.test.ts) so this stays a pure orchestration unit
 * test, and crypto.subtle / Blob.prototype.arrayBuffer are stubbed because jsdom ships neither.
 */
jest.mock("@aws-sdk/client-s3", () => {
  class Command {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }
  return {
    PutObjectCommand: class PutObjectCommand extends Command {},
    CreateMultipartUploadCommand: class CreateMultipartUploadCommand extends Command {},
    ListPartsCommand: class ListPartsCommand extends Command {},
    UploadPartCommand: class UploadPartCommand extends Command {},
    CompleteMultipartUploadCommand: class CompleteMultipartUploadCommand extends Command {},
    S3Client: class S3Client {},
  };
});

import { ResumableUpload } from "../app/assets/src/components/views/SampleUploadFlow/components/UploadProgressModal/resumableUpload";

const PART_SIZE = 1024 * 1024 * 5;

// A fixed 32-byte "digest" so the local checksum of any part is deterministic and comparable to a
// value we put in a fake ListParts response.
const DIGEST_BYTES = new Uint8Array(32).fill(7);
const MATCHING_CHECKSUM = Buffer.from(DIGEST_BYTES).toString("base64");
let digestThrows = false;

beforeAll(() => {
  Object.defineProperty(global, "crypto", {
    configurable: true,
    value: {
      subtle: {
        digest: async () => {
          if (digestThrows) throw new Error("crypto unavailable");
          return DIGEST_BYTES.buffer.slice(0);
        },
      },
    },
  });
  if (typeof Blob.prototype.arrayBuffer !== "function") {
    // eslint-disable-next-line no-extend-native, @typescript-eslint/no-explicit-any
    (Blob.prototype as any).arrayBuffer = function (
      this: Blob,
    ): Promise<ArrayBuffer> {
      return Promise.resolve(new ArrayBuffer(this.size));
    };
  }
});

beforeEach(() => {
  digestThrows = false;
});

/* eslint-disable @typescript-eslint/no-explicit-any */
type SentCommand = { name: string; input: any };
type Handler = (input: any, callIndex: number) => any;

function makeClient(handlers: Record<string, Handler> = {}) {
  const sent: SentCommand[] = [];
  const counts: Record<string, number> = {};
  const send = jest.fn(async (command: any) => {
    const name = command.constructor.name;
    counts[name] = (counts[name] ?? 0) + 1;
    sent.push({ name, input: command.input });
    const handler = handlers[name];
    if (handler) return handler(command.input, counts[name] - 1);
    switch (name) {
      case "PutObjectCommand":
        return { ETag: '"put-etag"' };
      case "CreateMultipartUploadCommand":
        return { UploadId: "new-upload-id" };
      case "ListPartsCommand":
        return { IsTruncated: false, Parts: [] };
      case "UploadPartCommand":
        return { ETag: `"part-${command.input.PartNumber}"` };
      case "CompleteMultipartUploadCommand":
        return { Location: "https://s3/done" };
      default:
        throw new Error(`Unexpected command: ${name}`);
    }
  });
  const names = () => sent.map(s => s.name);
  const inputsFor = (name: string) =>
    sent.filter(s => s.name === name).map(s => s.input);
  return { client: { send } as any, sent, names, inputsFor, send };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const blobOf = (bytes: number): Blob => new Blob([new Uint8Array(bytes)]);

const baseParams = (body: Blob) => ({
  Bucket: "bucket",
  Key: "samples/1/2/fastqs/x_R1.fastq.gz",
  Body: body,
  ChecksumAlgorithm: "SHA256" as const,
});

describe("ResumableUpload constructor validation", () => {
  it("rejects a missing params object", () => {
    const { client } = makeClient();
    expect(
      () =>
        new ResumableUpload({
          client,
          params: undefined as never,
        }),
    ).toThrow("InputError: ResumableUpload requires params.");
  });

  it("rejects a missing S3 client", () => {
    expect(
      () =>
        new ResumableUpload({
          client: undefined as never,
          params: baseParams(blobOf(1)),
        }),
    ).toThrow("InputError: ResumableUpload requires an S3 client.");
  });

  it("rejects a part size below the 5MB S3 minimum", () => {
    const { client } = makeClient();
    expect(
      () =>
        new ResumableUpload({
          client,
          params: baseParams(blobOf(1)),
          partSize: 1024,
        }),
    ).toThrow(/EntityTooSmall/);
  });

  it("rejects a queue size below one", () => {
    const { client } = makeClient();
    expect(
      () =>
        new ResumableUpload({
          client,
          params: baseParams(blobOf(1)),
          queueSize: 0,
        }),
    ).toThrow("Queue size: must have at least one uploading queue.");
  });
});

describe("ResumableUpload abort and pause", () => {
  it("rejects with AbortError and sends nothing after abort()", async () => {
    const { client, names } = makeClient();
    const upload = new ResumableUpload({
      client,
      params: baseParams(blobOf(PART_SIZE * 2)),
    });

    await upload.abort();
    expect(upload.isPaused()).toBe(false);

    await expect(upload.done()).rejects.toMatchObject({
      name: "AbortError",
      message: "Upload aborted.",
    });
    expect(names()).toEqual([]);
  });

  it("rejects with a distinguishable PauseError after pause()", async () => {
    const { client } = makeClient();
    const upload = new ResumableUpload({
      client,
      params: baseParams(blobOf(PART_SIZE * 2)),
    });

    await upload.pause();
    expect(upload.isPaused()).toBe(true);

    await expect(upload.done()).rejects.toMatchObject({
      name: "PauseError",
      message: "Upload paused.",
    });
  });

  it("interrupts an in-flight upload when pause() lands mid-part, leaving it incomplete", async () => {
    let upload: ResumableUpload;
    const { client, names } = makeClient({
      UploadPartCommand: async (input: { PartNumber: number }) => {
        await upload.pause();
        return { ETag: `"part-${input.PartNumber}"` };
      },
    });
    upload = new ResumableUpload({
      client,
      params: baseParams(blobOf(PART_SIZE * 2)),
      queueSize: 1,
    });

    await expect(upload.done()).rejects.toMatchObject({ name: "PauseError" });
    // The multipart upload was created but never completed, so its parts survive on S3 for a resume.
    expect(names()).toContain("CreateMultipartUploadCommand");
    expect(names()).not.toContain("CompleteMultipartUploadCommand");
  });
});

describe("ResumableUpload single-request paths", () => {
  it("uploads a zero-byte file as a single PutObject and reports full progress", async () => {
    const { client, names } = makeClient();
    const progress: Array<{ loaded?: number; total?: number; part?: number }> =
      [];
    const upload = new ResumableUpload({
      client,
      params: baseParams(blobOf(0)),
    });
    upload.on("httpUploadProgress", p => progress.push(p));

    const result = await upload.done();

    expect(names()).toEqual(["PutObjectCommand"]);
    expect((result as { ETag?: string }).ETag).toBe('"put-etag"');
    expect(progress).toEqual([
      {
        loaded: 0,
        total: 0,
        part: 1,
        Key: "samples/1/2/fastqs/x_R1.fastq.gz",
        Bucket: "bucket",
      },
    ]);
  });

  it("ignores listeners registered for an unknown event name", async () => {
    const { client } = makeClient();
    const listener = jest.fn();
    const upload = new ResumableUpload({
      client,
      params: baseParams(blobOf(1024)),
    });
    upload.on("somethingElse" as "httpUploadProgress", listener);

    await upload.done();

    expect(listener).not.toHaveBeenCalled();
  });
});

describe("ResumableUpload resume via ListParts", () => {
  it("pages through ListParts, skips a checksum-matching part, and re-uploads the rest", async () => {
    const { client, names, inputsFor } = makeClient({
      ListPartsCommand: (_input: unknown, callIndex: number) =>
        callIndex === 0
          ? {
              IsTruncated: true,
              Parts: [
                {
                  PartNumber: 1,
                  ETag: '"already-1"',
                  ChecksumSHA256: MATCHING_CHECKSUM,
                },
                // No ETag -> unusable, so this part must be re-uploaded.
                { PartNumber: 2, ChecksumSHA256: MATCHING_CHECKSUM },
              ],
            }
          : {
              IsTruncated: false,
              Parts: [
                { PartNumber: 3, ETag: '"already-3"', ChecksumSHA256: "stale" },
              ],
            },
    });
    const progress: number[] = [];
    const upload = new ResumableUpload({
      client,
      params: baseParams(blobOf(PART_SIZE * 2 + 1024)), // 3 parts
      uploadId: "resume-me",
    });
    upload.on("httpUploadProgress", p => progress.push(p.loaded ?? 0));

    await upload.done();

    // Two pages were fetched, the second continuing from the first page's part count.
    const listCalls = inputsFor("ListPartsCommand");
    expect(listCalls).toHaveLength(2);
    expect(listCalls[0].PartNumberMarker).toBe("0");
    expect(listCalls[1].PartNumberMarker).toBe("2");
    // Resume never re-creates the multipart upload.
    expect(names()).not.toContain("CreateMultipartUploadCommand");
    // Part 1 matched its checksum and was skipped; parts 2 and 3 were re-sent.
    expect(
      inputsFor("UploadPartCommand")
        .map(i => i.PartNumber)
        .sort(),
    ).toEqual([2, 3]);

    const complete = inputsFor("CompleteMultipartUploadCommand")[0];
    expect(complete.UploadId).toBe("resume-me");
    expect(
      complete.MultipartUpload.Parts.map(
        (p: { PartNumber: number }) => p.PartNumber,
      ),
    ).toEqual([1, 2, 3]);
    expect(complete.MultipartUpload.Parts[0]).toEqual({
      PartNumber: 1,
      ETag: '"already-1"',
      ChecksumSHA256: MATCHING_CHECKSUM,
    });
    // Skipped bytes still count toward progress, so the bar reaches the full size.
    expect(Math.max(...progress)).toBe(PART_SIZE * 2 + 1024);
  });

  it("re-uploads a previously uploaded part when its checksum cannot be computed", async () => {
    digestThrows = true;
    const { client, inputsFor } = makeClient({
      ListPartsCommand: () => ({
        IsTruncated: false,
        Parts: [
          {
            PartNumber: 1,
            ETag: '"already-1"',
            ChecksumSHA256: MATCHING_CHECKSUM,
          },
        ],
      }),
    });
    const upload = new ResumableUpload({
      client,
      params: baseParams(blobOf(PART_SIZE * 2)), // 2 parts
      uploadId: "resume-me",
    });

    await upload.done();

    expect(
      inputsFor("UploadPartCommand")
        .map(i => i.PartNumber)
        .sort(),
    ).toEqual([1, 2]);
  });

  it("re-uploads a previously uploaded part that has no recorded checksum", async () => {
    const { client, inputsFor } = makeClient({
      ListPartsCommand: () => ({
        IsTruncated: false,
        Parts: [{ PartNumber: 1, ETag: '"already-1"' }],
      }),
    });
    const upload = new ResumableUpload({
      client,
      params: baseParams(blobOf(PART_SIZE * 2)),
      uploadId: "resume-me",
    });

    await upload.done();

    expect(
      inputsFor("UploadPartCommand")
        .map(i => i.PartNumber)
        .sort(),
    ).toEqual([1, 2]);
  });

  it("starts a fresh upload and clears the stale id when ListParts fails", async () => {
    const { client, names } = makeClient({
      ListPartsCommand: () => {
        throw new Error("NoSuchUpload");
      },
    });
    const created: (string | null)[] = [];
    const upload = new ResumableUpload({
      client,
      params: baseParams(blobOf(PART_SIZE * 2)),
      uploadId: "gone-from-s3",
    });
    upload.onCreatedMultipartUpload(id => created.push(id));

    await upload.done();

    // null tells the modal to drop the unusable persisted uploadId; the new id replaces it.
    expect(created).toEqual([null, "new-upload-id"]);
    expect(names()).toContain("CreateMultipartUploadCommand");
    expect(names()).toContain("CompleteMultipartUploadCommand");
  });
});

describe("ResumableUpload error handling", () => {
  it("swallows part failures and still completes when leavePartsOnError is false", async () => {
    const { client, inputsFor, names } = makeClient({
      UploadPartCommand: () => {
        throw new Error("network blip");
      },
    });
    const upload = new ResumableUpload({
      client,
      params: baseParams(blobOf(PART_SIZE * 2 + 1024)),
    });

    await upload.done();

    expect(names()).toContain("CompleteMultipartUploadCommand");
    // Every part failed, so the completion carries no parts at all.
    expect(
      inputsFor("CompleteMultipartUploadCommand")[0].MultipartUpload.Parts,
    ).toEqual([]);
  });

  it("propagates an error raised before any multipart upload exists", async () => {
    const { client, names } = makeClient({
      CreateMultipartUploadCommand: () => {
        throw new Error("AccessDenied");
      },
    });
    const upload = new ResumableUpload({
      client,
      params: baseParams(blobOf(PART_SIZE * 2)),
    });

    await expect(upload.done()).rejects.toThrow("AccessDenied");
    expect(names()).not.toContain("CompleteMultipartUploadCommand");
  });
});

describe("ResumableUpload explicit part and queue sizing", () => {
  it("honours a custom partSize and a single-worker queue", async () => {
    const { client, inputsFor } = makeClient({
      UploadPartCommand: (input: { PartNumber: number }) => ({
        ETag: `"part-${input.PartNumber}"`,
        ChecksumSHA256: MATCHING_CHECKSUM,
      }),
    });
    const upload = new ResumableUpload({
      client,
      params: baseParams(blobOf(PART_SIZE * 3)), // 15MB / 10MB parts -> 2 parts
      partSize: PART_SIZE * 2,
      queueSize: 1,
    });

    await upload.done();

    const parts = inputsFor("UploadPartCommand");
    expect(parts.map(p => p.PartNumber)).toEqual([1, 2]);
    expect(parts[0].Body).toBeInstanceOf(Uint8Array);
    expect(parts[0].Body.length).toBe(PART_SIZE * 2);
    expect(parts[1].Body.length).toBe(PART_SIZE);
    // The per-part checksum returned by S3 is carried into the completion request.
    expect(
      inputsFor("CompleteMultipartUploadCommand")[0].MultipartUpload.Parts,
    ).toEqual([
      { PartNumber: 1, ETag: '"part-1"', ChecksumSHA256: MATCHING_CHECKSUM },
      { PartNumber: 2, ETag: '"part-2"', ChecksumSHA256: MATCHING_CHECKSUM },
    ]);
  });
});
