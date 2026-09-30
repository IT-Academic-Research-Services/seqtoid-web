/**
 * ResumableUpload reliability behaviour added for slow/shared uplinks:
 *   - a ConcurrencyLimiter shared across uploads caps total concurrent part uploads,
 *   - one worker's unrecoverable failure stops its sibling workers (no orphaned uploads),
 *   - before completing an upload whose part ETags may be stale (a part request was retried, or the
 *     upload was resumed), the part list is reconciled against ListParts: S3's copy is adopted when
 *     its SHA256 matches, and a missing or mismatched part is uploaded again (the SSE-KMS
 *     InvalidPart case),
 *   - ListParts pages with S3's NextPartNumberMarker.
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
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { ResumableUpload } from "../app/assets/src/components/views/SampleUploadFlow/components/UploadProgressModal/resumableUpload";
import { ConcurrencyLimiter } from "../app/assets/src/components/views/SampleUploadFlow/components/UploadProgressModal/uploadConcurrencyLimiter";

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

const blobOf = (parts: number): Blob =>
  new Blob([new Uint8Array(PART_SIZE * parts)]);

const params = (body: Blob) => ({
  Bucket: "bucket",
  Key: "samples/9/fastqs/x_R1.fastq.gz",
  Body: body,
  ChecksumAlgorithm: "SHA256" as const,
});

type Send = (command: $TSFixMe, options?: $TSFixMe) => Promise<$TSFixMe>;

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const partNumbers = (send: jest.Mock) =>
  send.mock.calls
    .filter(([c]) => c instanceof UploadPartCommand)
    .map(([c]) => c.input.PartNumber as number);

const completeParts = (send: jest.Mock) =>
  send.mock.calls.find(
    ([c]) => c instanceof CompleteMultipartUploadCommand,
  )?.[0].input.MultipartUpload.Parts;

describe("shared part limiter", () => {
  it("caps concurrent part uploads across every upload sharing the limiter", async () => {
    let running = 0;
    let peak = 0;
    const gates: Array<() => void> = [];
    const send = jest.fn<Promise<$TSFixMe>, Parameters<Send>>(async command => {
      if (command instanceof CreateMultipartUploadCommand) {
        return { UploadId: "u" };
      }
      if (command instanceof UploadPartCommand) {
        running++;
        peak = Math.max(peak, running);
        await new Promise<void>(resolve => gates.push(resolve));
        running--;
        return { ETag: `"e${command.input.PartNumber}"` };
      }
      return {};
    });
    const limiter = new ConcurrencyLimiter(2);
    const uploads = [0, 1].map(
      () =>
        new ResumableUpload({
          client: { send } as never,
          params: params(blobOf(4)),
          queueSize: 4,
          limiter,
        }),
    );
    const done = Promise.all(uploads.map(u => u.done()));

    // Drain: keep releasing whichever requests are waiting until both uploads finish.
    let finished = false;
    void done.then(() => {
      finished = true;
    });
    while (!finished) {
      await flush();
      gates.splice(0).forEach(open => open());
    }
    await done;

    expect(partNumbers(send)).toHaveLength(8);
    expect(peak).toBe(2);
  });
});

describe("fail fast", () => {
  it("stops sibling workers and aborts their in-flight parts when one part fails for good", async () => {
    const aborted: number[] = [];
    const send = jest.fn<Promise<$TSFixMe>, Parameters<Send>>(
      async (command, options) => {
        if (command instanceof CreateMultipartUploadCommand) {
          return { UploadId: "u" };
        }
        if (command instanceof UploadPartCommand) {
          const n = command.input.PartNumber as number;
          if (n === 1) {
            await flush();
            throw new Error("part 1 failed");
          }
          // Other parts hang until aborted.
          return new Promise((_resolve, reject) => {
            options?.abortSignal?.addEventListener("abort", () => {
              aborted.push(n);
              reject(new Error("aborted"));
            });
          });
        }
        return {};
      },
    );
    const upload = new ResumableUpload({
      client: { send } as never,
      params: params(blobOf(6)),
      queueSize: 3,
      maxAttempts: 1,
      leavePartsOnError: true,
    });

    await expect(upload.done()).rejects.toThrow("part 1 failed");
    await flush();

    // Only the 3 parts in flight when part 1 failed were ever sent; the two hung ones were aborted.
    expect(partNumbers(send).sort()).toEqual([1, 2, 3]);
    expect(aborted.sort()).toEqual([2, 3]);
  });
});

describe("reconcile against ListParts before completing", () => {
  // Part 2's first attempt fails (a timeout), so its ETag may be stale and the upload reconciles.
  const retriedPart2Client = (listParts: () => $TSFixMe) => {
    let part2Attempts = 0;
    return jest.fn<Promise<$TSFixMe>, Parameters<Send>>(async command => {
      if (command instanceof CreateMultipartUploadCommand) {
        return { UploadId: "u" };
      }
      if (command instanceof UploadPartCommand) {
        const n = command.input.PartNumber as number;
        if (n === 2 && ++part2Attempts === 1) {
          throw new Error("TimeoutError: S3 request exceeded 300000ms.");
        }
        return { ETag: `"e${n}-retry"`, ChecksumSHA256: `c${n}` };
      }
      if (command instanceof ListPartsCommand) {
        return listParts();
      }
      if (command instanceof CompleteMultipartUploadCommand) {
        return { Location: "done" };
      }
      return {};
    });
  };

  it("adopts S3's ETag for a part whose late first attempt replaced the retried copy", async () => {
    const send = retriedPart2Client(() => ({
      IsTruncated: false,
      Parts: [
        { PartNumber: 1, ETag: '"e1-retry"', ChecksumSHA256: "c1" },
        // The timed-out first attempt landed after the retry: same bytes, different SSE-KMS ETag.
        { PartNumber: 2, ETag: '"e2-late"', ChecksumSHA256: "c2" },
      ],
    }));
    const upload = new ResumableUpload({
      client: { send } as never,
      params: params(blobOf(2)),
      queueSize: 1,
      retryBaseDelayMs: 0,
    });

    await upload.done();

    expect(completeParts(send).map((p: $TSFixMe) => p.ETag)).toEqual([
      '"e1-retry"',
      '"e2-late"',
    ]);
  });

  it("re-uploads a part that S3 does not have before completing", async () => {
    const send = retriedPart2Client(() => ({
      IsTruncated: false,
      Parts: [{ PartNumber: 2, ETag: '"e2-retry"', ChecksumSHA256: "c2" }],
    }));
    const upload = new ResumableUpload({
      client: { send } as never,
      params: params(blobOf(2)),
      queueSize: 1,
      retryBaseDelayMs: 0,
    });

    await upload.done();

    // Part 1 was sent once normally and once more by the reconcile pass.
    expect(partNumbers(send).filter(n => n === 1)).toHaveLength(2);
    expect(completeParts(send).map((p: $TSFixMe) => p.PartNumber)).toEqual([
      1, 2,
    ]);
  });

  it("re-uploads a part whose checksum on S3 does not match the bytes sent", async () => {
    const send = retriedPart2Client(() => ({
      IsTruncated: false,
      Parts: [
        { PartNumber: 1, ETag: '"e1-retry"', ChecksumSHA256: "c1" },
        { PartNumber: 2, ETag: '"e2-other"', ChecksumSHA256: "not-ours" },
      ],
    }));
    const upload = new ResumableUpload({
      client: { send } as never,
      params: params(blobOf(2)),
      queueSize: 1,
      retryBaseDelayMs: 0,
    });

    await upload.done();

    expect(completeParts(send)[1].ETag).toBe('"e2-retry"');
    expect(partNumbers(send).filter(n => n === 2)).toHaveLength(3);
  });

  it("completes with the recorded parts when the reconcile ListParts fails", async () => {
    const send = retriedPart2Client(() => {
      throw new Error("ListParts unavailable");
    });
    const upload = new ResumableUpload({
      client: { send } as never,
      params: params(blobOf(2)),
      queueSize: 1,
      retryBaseDelayMs: 0,
    });

    await upload.done();

    expect(completeParts(send).map((p: $TSFixMe) => p.ETag)).toEqual([
      '"e1-retry"',
      '"e2-retry"',
    ]);
  });

  it("does not list parts before completing a clean first-try upload", async () => {
    const send = jest.fn<Promise<$TSFixMe>, Parameters<Send>>(async command => {
      if (command instanceof CreateMultipartUploadCommand) {
        return { UploadId: "u" };
      }
      if (command instanceof UploadPartCommand) {
        return { ETag: `"e${command.input.PartNumber}"` };
      }
      return { Location: "done" };
    });
    const upload = new ResumableUpload({
      client: { send } as never,
      params: params(blobOf(2)),
    });

    await upload.done();

    expect(
      send.mock.calls.filter(([c]) => c instanceof ListPartsCommand),
    ).toHaveLength(0);
  });
});

describe("ListParts paging", () => {
  it("continues from S3's NextPartNumberMarker", async () => {
    const markers: string[] = [];
    const send = jest.fn<Promise<$TSFixMe>, Parameters<Send>>(async command => {
      if (command instanceof ListPartsCommand) {
        markers.push(command.input.PartNumberMarker as string);
        return markers.length === 1
          ? { IsTruncated: true, NextPartNumberMarker: "7", Parts: [] }
          : { IsTruncated: false, Parts: [] };
      }
      if (command instanceof UploadPartCommand) {
        return { ETag: `"e${command.input.PartNumber}"` };
      }
      return { Location: "done" };
    });
    const upload = new ResumableUpload({
      client: { send } as never,
      params: params(blobOf(2)),
      uploadId: "resume-me",
    });

    await upload.done();

    expect(markers.slice(0, 2)).toEqual(["0", "7"]);
  });
});
