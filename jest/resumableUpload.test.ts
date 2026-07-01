// Mock the AWS SDK so this unit test exercises ResumableUpload's orchestration in isolation,
// without loading the real @aws-sdk/client-s3 (which pulls in node:crypto and is unnecessary here).
// Each command is a thin class that records its input; the fake client routes by command type.
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
    AbortMultipartUploadCommand: class AbortMultipartUploadCommand extends Command {},
    S3Client: class S3Client {},
  };
});

import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  ListPartsCommand,
  PutObjectCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { ResumableUpload } from "../app/assets/src/components/views/SampleUploadFlow/components/UploadProgressModal/resumableUpload";

const PART_SIZE = 1024 * 1024 * 5; // 5 MiB (the minimum multipart part size)

function makeClient(overrides: { uploadPart?: () => unknown } = {}) {
  const calls: string[] = [];
  let partCounter = 0;
  const send = jest.fn(async (command: { constructor: { name: string } }) => {
    calls.push(command.constructor.name);
    if (command instanceof PutObjectCommand) return { ETag: '"put-etag"' };
    if (command instanceof CreateMultipartUploadCommand) {
      return { UploadId: "upload-123" };
    }
    if (command instanceof ListPartsCommand) {
      return { IsTruncated: false, Parts: [] };
    }
    if (command instanceof UploadPartCommand) {
      if (overrides.uploadPart) return overrides.uploadPart();
      partCounter += 1;
      return { ETag: `"part-etag-${partCounter}"` };
    }
    if (command instanceof CompleteMultipartUploadCommand) {
      return { Location: "https://s3/done" };
    }
    throw new Error(`Unexpected command: ${command.constructor.name}`);
  });
  return { client: { send } as never, calls, send };
}

// jsdom's Blob in this Jest version has no Blob.prototype.arrayBuffer, which the Uint8Array
// body path (toBytes) relies on. Polyfill it on the prototype so sliced parts inherit it too.
// Content is irrelevant here (the tests assert on ETags/call counts/progress-by-size, not bytes),
// so a zeroed buffer of the correct length is sufficient and keeps size accounting honest.
beforeAll(() => {
  if (typeof Blob.prototype.arrayBuffer !== "function") {
    // eslint-disable-next-line no-extend-native, @typescript-eslint/no-explicit-any
    (Blob.prototype as any).arrayBuffer = function (
      this: Blob,
    ): Promise<ArrayBuffer> {
      return Promise.resolve(new ArrayBuffer(this.size));
    };
  }
});

const blobOf = (bytes: number): Blob => new Blob([new Uint8Array(bytes)]);

const baseParams = (body: Blob) => ({
  Bucket: "bucket",
  Key: "samples/1/2/fastqs/x_R1.fastq.gz",
  Body: body,
  ChecksumAlgorithm: "SHA256" as const,
});

describe("ResumableUpload", () => {
  it("uses a single PutObject for a file that fits in one part", async () => {
    const { client, calls, send } = makeClient();
    const upload = new ResumableUpload({
      client,
      params: baseParams(blobOf(1024)),
    });

    const result = await upload.done();

    expect(calls).toEqual(["PutObjectCommand"]);
    expect(send).toHaveBeenCalledTimes(1);
    expect((result as { ETag?: string }).ETag).toBe('"put-etag"');
  });

  it("creates, uploads every part, and completes a multipart upload for a large file", async () => {
    const { client, calls } = makeClient();
    const created: (string | null)[] = [];
    const progress: number[] = [];
    const upload = new ResumableUpload({
      client,
      params: baseParams(blobOf(PART_SIZE * 2 + 1024)), // -> 3 parts
    });
    upload.onCreatedMultipartUpload(id => created.push(id));
    upload.on("httpUploadProgress", p => progress.push(p.loaded ?? 0));

    await upload.done();

    expect(
      calls.filter(c => c === "CreateMultipartUploadCommand"),
    ).toHaveLength(1);
    expect(calls.filter(c => c === "UploadPartCommand")).toHaveLength(3);
    expect(
      calls.filter(c => c === "CompleteMultipartUploadCommand"),
    ).toHaveLength(1);
    // The created uploadId is surfaced exactly once for persistence.
    expect(created).toEqual(["upload-123"]);
    // Progress is cumulative and reaches the full file size.
    expect(Math.max(...progress)).toBe(PART_SIZE * 2 + 1024);
  });

  it("propagates a part error without completing when leavePartsOnError is true", async () => {
    const { client, calls } = makeClient({
      uploadPart: () => {
        throw new Error("network blip");
      },
    });
    const upload = new ResumableUpload({
      client,
      params: baseParams(blobOf(PART_SIZE * 2)),
      leavePartsOnError: true,
    });

    await expect(upload.done()).rejects.toThrow("network blip");
    // The multipart upload was created but never completed (parts left on S3 for resume).
    expect(calls).toContain("CreateMultipartUploadCommand");
    expect(calls).not.toContain("CompleteMultipartUploadCommand");
  });

  it("lists existing parts when resuming with an uploadId", async () => {
    const { client, calls } = makeClient();
    const upload = new ResumableUpload({
      client,
      params: baseParams(blobOf(PART_SIZE * 2)),
      uploadId: "resume-me",
    });

    await upload.done();

    // Resume path enumerates prior parts and does not re-create the upload.
    expect(calls).toContain("ListPartsCommand");
    expect(calls).not.toContain("CreateMultipartUploadCommand");
    expect(calls).toContain("CompleteMultipartUploadCommand");
  });
});
