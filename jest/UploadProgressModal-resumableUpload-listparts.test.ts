/**
 * Remaining branch coverage for ResumableUpload's ListParts bookkeeping and the
 * per-part checksum passthrough, which the existing resumableUpload specs do not
 * reach:
 *   - a ListParts page with no `Parts` key at all (the `if (parts)` guard),
 *   - part records missing an ETag or a PartNumber (the `if (ETag && PartNumber)`
 *     guard), which must be ignored rather than recorded as resumable,
 *   - an UploadPart response that carries a ChecksumSHA256, which must be echoed
 *     into the CompleteMultipartUpload part list (and omitted when absent),
 *   - a paginated ListParts walk whose PartNumberMarker advances by parts seen.
 *
 * The AWS SDK is mocked exactly as in the sibling specs so this stays a pure
 * orchestration unit test.
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

import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  ListPartsCommand,
  PutObjectCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { ResumableUpload } from "../app/assets/src/components/views/SampleUploadFlow/components/UploadProgressModal/resumableUpload";

const PART_SIZE = 1024 * 1024 * 5;

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
  Key: "samples/9/fastqs/x_R1.fastq.gz",
  Body: body,
  ChecksumAlgorithm: "SHA256" as const,
});

interface ClientOptions {
  listPartsPages?: Record<string, unknown>[];
  uploadPartResult?: (partNumber: number) => Record<string, unknown>;
}

function makeClient(options: ClientOptions = {}) {
  const listPartsMarkers: (string | undefined)[] = [];
  let listPage = 0;
  let completeInput: $TSFixMe = null;
  const send = jest.fn(async (command: $TSFixMe) => {
    if (command instanceof PutObjectCommand) return { ETag: '"put"' };
    if (command instanceof CreateMultipartUploadCommand) {
      return { UploadId: "upload-abc" };
    }
    if (command instanceof ListPartsCommand) {
      listPartsMarkers.push(command.input.PartNumberMarker as string);
      const pages = options.listPartsPages ?? [{ IsTruncated: false }];
      const page = pages[Math.min(listPage, pages.length - 1)];
      listPage += 1;
      return page;
    }
    if (command instanceof UploadPartCommand) {
      const partNumber = command.input.PartNumber as number;
      return options.uploadPartResult
        ? options.uploadPartResult(partNumber)
        : { ETag: `"etag-${partNumber}"` };
    }
    if (command instanceof CompleteMultipartUploadCommand) {
      completeInput = command.input;
      return { Location: "https://s3/done" };
    }
    throw new Error(`Unexpected command: ${command.constructor.name}`);
  });
  return {
    client: { send } as never,
    send,
    listPartsMarkers,
    getCompleteInput: () => completeInput,
  };
}

describe("ResumableUpload ListParts bookkeeping", () => {
  it("treats a page with no Parts key as nothing to resume", async () => {
    const harness = makeClient({
      listPartsPages: [{ IsTruncated: false }],
    });
    const upload = new ResumableUpload({
      client: harness.client,
      params: baseParams(blobOf(PART_SIZE * 2)),
      uploadId: "resume-me",
      queueSize: 1,
    });

    await upload.done();

    // Nothing was skipped: both parts were re-uploaded under the resumed id.
    expect(
      harness.send.mock.calls.filter(([c]) => c instanceof UploadPartCommand),
    ).toHaveLength(2);
    expect(
      harness.send.mock.calls.filter(
        ([c]) => c instanceof CreateMultipartUploadCommand,
      ),
    ).toHaveLength(0);
    expect(harness.getCompleteInput().UploadId).toBe("resume-me");
  });

  it("ignores part records that lack an ETag or a PartNumber", async () => {
    const harness = makeClient({
      listPartsPages: [
        {
          IsTruncated: false,
          Parts: [
            { PartNumber: 1, ChecksumSHA256: "abc" }, // no ETag
            { ETag: '"orphan"', ChecksumSHA256: "def" }, // no PartNumber
          ],
        },
      ],
    });
    const upload = new ResumableUpload({
      client: harness.client,
      params: baseParams(blobOf(PART_SIZE * 2)),
      uploadId: "resume-me",
      queueSize: 1,
    });

    await upload.done();

    // Both unusable records were discarded, so every part was uploaded fresh.
    expect(
      harness.send.mock.calls.filter(([c]) => c instanceof UploadPartCommand),
    ).toHaveLength(2);
    const parts = harness.getCompleteInput().MultipartUpload.Parts;
    expect(parts.map((p: $TSFixMe) => p.ETag)).toEqual([
      '"etag-1"',
      '"etag-2"',
    ]);
  });

  it("advances PartNumberMarker across truncated ListParts pages", async () => {
    const harness = makeClient({
      listPartsPages: [
        {
          IsTruncated: true,
          Parts: [
            { PartNumber: 1, ETag: '"e1"' },
            { PartNumber: 2, ETag: '"e2"' },
          ],
        },
        { IsTruncated: false, Parts: [{ PartNumber: 3, ETag: '"e3"' }] },
      ],
    });
    const upload = new ResumableUpload({
      client: harness.client,
      params: baseParams(blobOf(PART_SIZE * 2)),
      uploadId: "resume-me",
      queueSize: 1,
    });

    await upload.done();

    expect(harness.listPartsMarkers).toEqual(["0", "2"]);
  });
});

describe("ResumableUpload part checksum passthrough", () => {
  it("echoes a ChecksumSHA256 returned by UploadPart into the completed part list", async () => {
    const harness = makeClient({
      uploadPartResult: partNumber => ({
        ETag: `"etag-${partNumber}"`,
        ChecksumSHA256: `sum-${partNumber}`,
      }),
    });
    const upload = new ResumableUpload({
      client: harness.client,
      params: baseParams(blobOf(PART_SIZE * 2)),
      queueSize: 1,
    });

    await upload.done();

    expect(harness.getCompleteInput().MultipartUpload.Parts).toEqual([
      { PartNumber: 1, ETag: '"etag-1"', ChecksumSHA256: "sum-1" },
      { PartNumber: 2, ETag: '"etag-2"', ChecksumSHA256: "sum-2" },
    ]);
  });

  it("omits the checksum field when UploadPart does not return one", async () => {
    const harness = makeClient();
    const upload = new ResumableUpload({
      client: harness.client,
      params: baseParams(blobOf(PART_SIZE * 2)),
      queueSize: 1,
    });

    await upload.done();

    const parts = harness.getCompleteInput().MultipartUpload.Parts;
    expect(parts).toHaveLength(2);
    parts.forEach((part: $TSFixMe) => {
      expect("ChecksumSHA256" in part).toBe(false);
    });
  });

  it("returns parts sorted by part number even with a concurrent queue", async () => {
    const harness = makeClient();
    const upload = new ResumableUpload({
      client: harness.client,
      params: baseParams(blobOf(PART_SIZE * 3)),
      queueSize: 3,
    });

    await upload.done();

    const parts = harness.getCompleteInput().MultipartUpload.Parts;
    expect(parts.map((p: $TSFixMe) => p.PartNumber)).toEqual([1, 2, 3]);
  });
});
