/**
 * Remaining branch coverage for ResumableUpload's defensive guards.
 *
 *   * getUploadedParts' `if (!this.uploadId) return` -- the early return. Only the
 *     caller's own `if (this.uploadId)` normally reaches it, so this arm is
 *     exercised by calling the method directly.
 *   * createMultipartUpload's `this.uploadId ?? null` -- the null fallback, taken
 *     when S3 answers CreateMultipartUpload without an UploadId.
 *   * runWorker's `if (this.uploadedParts.length > MAX_PARTS)` -- the throw arm.
 *   * runWorker's post-create `if (this.abortController.signal.aborted)` -- an
 *     abort landing while CreateMultipartUpload was in flight.
 *   * doMultipartUpload's sort comparator `(a.PartNumber ?? 0)` / `(b.PartNumber ?? 0)`
 *     -- the fallbacks for CompletedPart records with no PartNumber (PartNumber is
 *     optional in the SDK type).
 *
 * The last two rely on seeding the recorded-parts list directly, because nothing on
 * the normal path can produce >10000 parts or a part without a number.
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
const MAX_PARTS = 10000;
const DIGEST_BYTES = new Uint8Array(32).fill(7);

beforeAll(() => {
  Object.defineProperty(global, "crypto", {
    configurable: true,
    value: {
      subtle: { digest: async () => DIGEST_BYTES.buffer.slice(0) },
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

/* eslint-disable @typescript-eslint/no-explicit-any */
type Handler = (input: any) => any;

function makeClient(handlers: Record<string, Handler> = {}) {
  const sent: { name: string; input: any }[] = [];
  const send = jest.fn(async (command: any) => {
    const name = command.constructor.name;
    sent.push({ name, input: command.input });
    const handler = handlers[name];
    if (handler) return handler(command.input);
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
  const inputFor = (name: string) => sent.find(s => s.name === name)?.input;
  return { client: { send } as any, sent, names, inputFor, send };
}

const blobOf = (bytes: number): Blob => new Blob([new Uint8Array(bytes)]);

const baseParams = (body: Blob) => ({
  Bucket: "bucket",
  Key: "samples/1/2/fastqs/x_R1.fastq.gz",
  Body: body,
  ChecksumAlgorithm: "SHA256" as const,
});

// Reach the private recorded-parts list / helpers. TypeScript's `private` is
// erased at runtime; these guards have no public entry point.
const internals = (upload: ResumableUpload) =>
  upload as unknown as {
    uploadedParts: { PartNumber?: number; ETag?: string }[];
    getUploadedParts: () => Promise<void>;
  };
/* eslint-enable @typescript-eslint/no-explicit-any */

describe("getUploadedParts without an uploadId", () => {
  it("returns immediately instead of issuing a ListParts call", async () => {
    const { client, send } = makeClient();
    const upload = new ResumableUpload({
      client,
      params: baseParams(blobOf(10)),
      partSize: PART_SIZE,
    });

    await internals(upload).getUploadedParts();

    expect(send).not.toHaveBeenCalled();
  });

  it("pages ListParts once an uploadId is present", async () => {
    const { client, names } = makeClient();
    const upload = new ResumableUpload({
      client,
      params: baseParams(blobOf(10)),
      partSize: PART_SIZE,
      uploadId: "resume-me",
    });

    await internals(upload).getUploadedParts();

    expect(names()).toEqual(["ListPartsCommand"]);
  });
});

describe("CreateMultipartUpload answering without an UploadId", () => {
  it("emits null to the created-upload listener", async () => {
    const { client } = makeClient({
      CreateMultipartUploadCommand: () => ({}),
    });
    const upload = new ResumableUpload({
      client,
      params: baseParams(blobOf(PART_SIZE * 2)),
      partSize: PART_SIZE,
      queueSize: 1,
    });
    const seen: (string | null)[] = [];
    upload.onCreatedMultipartUpload(id => seen.push(id));

    await upload.done();

    expect(seen).toEqual([null]);
  });

  it("emits the id when S3 does return one", async () => {
    const { client } = makeClient();
    const upload = new ResumableUpload({
      client,
      params: baseParams(blobOf(PART_SIZE * 2)),
      partSize: PART_SIZE,
      queueSize: 1,
    });
    const seen: (string | null)[] = [];
    upload.onCreatedMultipartUpload(id => seen.push(id));

    await upload.done();

    expect(seen).toEqual(["new-upload-id"]);
  });
});

describe("the S3 part-count ceiling", () => {
  it("throws before uploading once more than 10000 parts are recorded", async () => {
    const { client, names } = makeClient();
    const upload = new ResumableUpload({
      client,
      params: baseParams(blobOf(PART_SIZE * 2)),
      partSize: PART_SIZE,
      queueSize: 1,
    });
    // Simulate a resumed upload whose recorded parts already exceed the S3 cap.
    internals(upload).uploadedParts = Array.from(
      { length: MAX_PARTS + 1 },
      (_unused, i) => ({ PartNumber: i + 1, ETag: `"e${i}"` }),
    );

    await expect(upload.done()).rejects.toThrow(
      /Exceeded 10000 parts uploading to samples\/1\/2\/fastqs\/x_R1\.fastq\.gz in bucket\./,
    );
    // The ceiling is checked before any part work happens.
    expect(names()).not.toContain("UploadPartCommand");
  });

  it("uploads normally when the recorded parts only reach the ceiling", async () => {
    const { client, names } = makeClient();
    const upload = new ResumableUpload({
      client,
      params: baseParams(blobOf(PART_SIZE * 2)),
      partSize: PART_SIZE,
      queueSize: 1,
    });
    // 9999 recorded + 2 uploaded here: the second part is admitted at exactly
    // MAX_PARTS, so the comparison is `>` and not `>=`.
    internals(upload).uploadedParts = Array.from(
      { length: MAX_PARTS - 1 },
      (_unused, i) => ({ PartNumber: i + 1, ETag: `"e${i}"` }),
    );

    await upload.done();

    expect(names()).toContain("UploadPartCommand");
    expect(names()).toContain("CompleteMultipartUploadCommand");
  });
});

describe("an abort that lands while CreateMultipartUpload is in flight", () => {
  it("stops the worker before it uploads any part", async () => {
    let upload: ResumableUpload;
    const { client, names } = makeClient({
      CreateMultipartUploadCommand: () => {
        // The user hit cancel while the create round-trip was outstanding.
        upload.abort();
        return { UploadId: "new-upload-id" };
      },
    });
    upload = new ResumableUpload({
      client,
      params: baseParams(blobOf(PART_SIZE * 2)),
      partSize: PART_SIZE,
      queueSize: 1,
    });

    await expect(upload.done()).rejects.toMatchObject({
      name: "AbortError",
      message: "Upload aborted.",
    });
    expect(names()).toEqual(["CreateMultipartUploadCommand"]);
  });

  it("reports a pause rather than an abort when the interruption was a pause", async () => {
    let upload: ResumableUpload;
    const { client, names } = makeClient({
      CreateMultipartUploadCommand: () => {
        upload.pause();
        return { UploadId: "new-upload-id" };
      },
    });
    upload = new ResumableUpload({
      client,
      params: baseParams(blobOf(PART_SIZE * 2)),
      partSize: PART_SIZE,
      queueSize: 1,
    });

    await expect(upload.done()).rejects.toMatchObject({
      name: "PauseError",
    });
    expect(upload.isPaused()).toBe(true);
    expect(names()).toEqual(["CreateMultipartUploadCommand"]);
  });
});

describe("ordering recorded parts for CompleteMultipartUpload", () => {
  it("sorts numberless part records to the front instead of producing NaN", async () => {
    const { client, inputFor } = makeClient();
    const upload = new ResumableUpload({
      client,
      params: baseParams(blobOf(PART_SIZE * 2)),
      partSize: PART_SIZE,
      queueSize: 1,
    });
    // CompletedPart.PartNumber is optional in the SDK type; a record without one
    // must sort as 0 rather than poisoning the comparator with NaN.
    internals(upload).uploadedParts.push(
      { ETag: '"orphan-a"' },
      { ETag: '"orphan-b"' },
    );

    await upload.done();

    const parts = inputFor("CompleteMultipartUploadCommand").MultipartUpload
      .Parts as { PartNumber?: number; ETag?: string }[];
    expect(parts.map(p => p.PartNumber)).toEqual([undefined, undefined, 1, 2]);
    // A NaN comparator would have left the real parts in their original order
    // ahead of the orphans; assert the orphans really moved to the front.
    expect(parts.slice(0, 2).map(p => p.ETag)).toEqual([
      '"orphan-a"',
      '"orphan-b"',
    ]);
  });

  it("sorts fully-numbered parts ascending", async () => {
    const { client, inputFor } = makeClient();
    const upload = new ResumableUpload({
      client,
      params: baseParams(blobOf(PART_SIZE * 2)),
      partSize: PART_SIZE,
      queueSize: 1,
    });
    internals(upload).uploadedParts.push({ PartNumber: 9, ETag: '"nine"' });

    await upload.done();

    const parts = inputFor("CompleteMultipartUploadCommand").MultipartUpload
      .Parts as { PartNumber?: number }[];
    expect(parts.map(p => p.PartNumber)).toEqual([1, 2, 9]);
  });
});
