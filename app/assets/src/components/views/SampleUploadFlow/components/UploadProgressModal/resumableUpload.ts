/**
 * ResumableUpload — an app-owned, browser-only multipart S3 uploader with resume support.
 *
 * This replaces the vendored CZI fork of `@aws-sdk/lib-storage` (the fork existed solely to add
 * resumable uploads, and its ES5-compiled classes broke against the native-ES6 `@smithy` base
 * classes pulled from npm — `TypeError: Class constructor Client cannot be invoked without 'new'`).
 *
 * It uses only the stable command surface of the stock `@aws-sdk/client-s3` and the browser's
 * native `crypto.subtle` + `AbortController`, so it needs no Node polyfills. The body is always a
 * browser `File`/`Blob` (the only thing the upload flow ever passes), which lets the chunker reduce
 * to `Blob.prototype.slice()`.
 *
 * The resume algorithm (accept an existing `uploadId`, `ListParts`-skip already-uploaded parts after
 * validating their SHA256, and emit the created `uploadId`) is ported verbatim from the fork so the
 * server contract (`samples_controller#upload_credentials` returning a multipart upload id) and the
 * consuming modals are unchanged.
 */
import {
  CompletedPart,
  CompleteMultipartUploadCommand,
  CompleteMultipartUploadCommandOutput,
  CreateMultipartUploadCommand,
  ListPartsCommand,
  PutObjectCommand,
  PutObjectCommandInput,
  PutObjectCommandOutput,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";

// S3 multipart minimum part size (5 MiB) and hard cap on parts.
const MIN_PART_SIZE = 1024 * 1024 * 5;
const DEFAULT_QUEUE_SIZE = 4;
const MAX_PARTS = 10000;

export interface Progress {
  loaded?: number;
  total?: number;
  part?: number;
  Key?: string;
  Bucket?: string;
}

export interface ResumableUploadOptions {
  client: S3Client;
  // Body must be a browser File/Blob. ChecksumAlgorithm: SHA256 is expected in params.
  params: PutObjectCommandInput;
  // When true, a failed part is propagated and the multipart upload is left intact on S3 so the
  // persisted uploadId can resume it later. When false, a part error is swallowed (fork parity).
  leavePartsOnError?: boolean;
  // Resume an existing multipart upload.
  uploadId?: string;
  partSize?: number;
  queueSize?: number;
}

interface DataPart {
  partNumber: number;
  data: Blob;
  lastPart: boolean;
}

// Base64-encode a small byte array (a 32-byte SHA-256 digest) for comparison with S3's ChecksumSHA256.
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function sha256Base64(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toBase64(new Uint8Array(digest));
}

// Read a part fully into memory before sending. With ChecksumAlgorithm:SHA256, the AWS SDK v3
// checksums an in-memory body up front (as an x-amz-checksum-sha256 header), but for a Blob it
// takes the aws-chunked streaming path and calls .getReader() on the Blob — which throws in the
// browser. A Uint8Array avoids that path entirely.
async function toBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

// Lazily slice a Blob into ordered parts. Empty files yield a single empty part (PutObject path).
async function* chunkBlob(
  body: Blob,
  partSize: number,
): AsyncGenerator<DataPart> {
  const size = body.size;
  if (size === 0) {
    yield { partNumber: 1, data: body, lastPart: true };
    return;
  }
  let partNumber = 1;
  let start = 0;
  while (start < size) {
    const end = Math.min(start + partSize, size);
    yield { partNumber, data: body.slice(start, end), lastPart: end >= size };
    start = end;
    partNumber++;
  }
}

export class ResumableUpload {
  private readonly client: S3Client;
  private readonly params: PutObjectCommandInput;
  private readonly leavePartsOnError: boolean;
  private readonly partSize: number;
  private readonly queueSize: number;
  private readonly totalBytes: number;
  private readonly abortController = new AbortController();

  private uploadId?: string;
  private bytesUploadedSoFar = 0;
  private isMultiPart = true;
  private uploadedParts: CompletedPart[] = [];
  private previouslyUploadedPartsMap: Record<number, CompletedPart> = {};
  private createMultipartPromise?: Promise<void>;
  private putResponse?: PutObjectCommandOutput;
  private progressListener?: (progress: Progress) => void;
  private createdMultipartUploadListener?: (uploadId: string | null) => void;

  constructor(options: ResumableUploadOptions) {
    if (!options.params) {
      throw new Error("InputError: ResumableUpload requires params.");
    }
    if (!options.client) {
      throw new Error("InputError: ResumableUpload requires an S3 client.");
    }
    this.client = options.client;
    this.params = options.params;
    this.leavePartsOnError = options.leavePartsOnError ?? false;
    this.partSize = options.partSize ?? MIN_PART_SIZE;
    this.queueSize = options.queueSize ?? DEFAULT_QUEUE_SIZE;
    if (this.partSize < MIN_PART_SIZE) {
      throw new Error(
        `EntityTooSmall: partSize ${this.partSize} is smaller than the 5MB minimum.`,
      );
    }
    if (this.queueSize < 1) {
      throw new Error("Queue size: must have at least one uploading queue.");
    }
    this.uploadId = options.uploadId;
    this.totalBytes = (this.params.Body as Blob).size;
  }

  on(
    event: "httpUploadProgress",
    listener: (progress: Progress) => void,
  ): void {
    if (event === "httpUploadProgress") {
      this.progressListener = listener;
    }
  }

  onCreatedMultipartUpload(listener: (uploadId: string | null) => void): void {
    this.createdMultipartUploadListener = listener;
  }

  async abort(): Promise<void> {
    this.abortController.abort();
  }

  async done(): Promise<
    CompleteMultipartUploadCommandOutput | PutObjectCommandOutput
  > {
    return Promise.race([this.doMultipartUpload(), this.abortPromise()]);
  }

  private abortPromise(): Promise<never> {
    return new Promise((resolve, reject) => {
      this.abortController.signal.addEventListener("abort", () => {
        const abortError = new Error("Upload aborted.");
        abortError.name = "AbortError";
        reject(abortError);
      });
    });
  }

  private notifyProgress(progress: Progress): void {
    this.progressListener?.(progress);
  }

  // CreateMultipartUpload / CompleteMultipartUpload inputs don't accept a Body; strip it from params.
  private paramsWithoutBody(): Omit<PutObjectCommandInput, "Body"> {
    const { Body, ...rest } = this.params;
    void Body;
    return rest;
  }

  // Page through ListParts for a resumed upload, recording already-uploaded parts by number.
  private async getUploadedParts(): Promise<void> {
    if (!this.uploadId) {
      return;
    }
    const { Bucket, Key } = this.params;
    let moreResults = true;
    let numPartsRetrieved = 0;
    while (moreResults) {
      moreResults = false;
      const response = await this.client.send(
        new ListPartsCommand({
          Bucket,
          Key,
          UploadId: this.uploadId,
          PartNumberMarker: numPartsRetrieved.toString(),
        }),
      );
      moreResults = !!response.IsTruncated;
      const parts = response.Parts;
      if (parts) {
        numPartsRetrieved += parts.length;
        for (const part of parts) {
          const { ETag, PartNumber } = part;
          if (ETag && PartNumber) {
            this.previouslyUploadedPartsMap[PartNumber] = {
              PartNumber,
              ETag,
              ...(part.ChecksumSHA256 && {
                ChecksumSHA256: part.ChecksumSHA256,
              }),
            };
          }
        }
      }
    }
  }

  private async uploadUsingPut(dataPart: DataPart): Promise<void> {
    this.isMultiPart = false;
    this.putResponse = await this.client.send(
      new PutObjectCommand({
        ...this.params,
        Body: await toBytes(dataPart.data),
      }),
    );
    const totalSize = dataPart.data.size;
    this.notifyProgress({
      loaded: totalSize,
      total: totalSize,
      part: 1,
      Key: this.params.Key,
      Bucket: this.params.Bucket,
    });
  }

  // Guarded so concurrent workers create the multipart upload exactly once.
  private async createMultipartUpload(): Promise<void> {
    if (!this.createMultipartPromise) {
      this.createMultipartPromise = this.client
        .send(new CreateMultipartUploadCommand(this.paramsWithoutBody()))
        .then(result => {
          this.uploadId = result.UploadId;
          this.createdMultipartUploadListener?.(this.uploadId ?? null);
        });
    }
    await this.createMultipartPromise;
  }

  // True if a previously-uploaded part's bytes match the recorded SHA256, so we can skip re-uploading.
  private async uploadedPartChecksumValid(
    dataPart: DataPart,
    sha256Checksum: string,
  ): Promise<boolean> {
    try {
      const localChecksum = await sha256Base64(
        await dataPart.data.arrayBuffer(),
      );
      return localChecksum === sha256Checksum;
    } catch {
      // If the part can't be read/hashed, fall back to re-uploading it (no correctness risk).
      return false;
    }
  }

  private async runWorker(feeder: AsyncGenerator<DataPart>): Promise<void> {
    for (;;) {
      const { value: dataPart, done } = await feeder.next();
      if (done) {
        return;
      }
      if (this.uploadedParts.length > MAX_PARTS) {
        throw new Error(
          `Exceeded ${MAX_PARTS} parts uploading to ${this.params.Key} in ${this.params.Bucket}.`,
        );
      }
      try {
        if (this.abortController.signal.aborted) {
          return;
        }
        // Single-part fast path: a file that fits in one part is a plain PutObject (not resumable).
        if (dataPart.partNumber === 1 && dataPart.lastPart) {
          await this.uploadUsingPut(dataPart);
          return;
        }
        if (!this.uploadId) {
          await this.createMultipartUpload();
          if (this.abortController.signal.aborted) {
            return;
          }
        }

        const previouslyUploadedPart =
          this.previouslyUploadedPartsMap[dataPart.partNumber];
        const previouslyUploadedPartValid =
          previouslyUploadedPart && previouslyUploadedPart.ChecksumSHA256
            ? await this.uploadedPartChecksumValid(
                dataPart,
                previouslyUploadedPart.ChecksumSHA256,
              )
            : false;

        if (previouslyUploadedPartValid) {
          this.uploadedParts.push({
            PartNumber: previouslyUploadedPart.PartNumber,
            ETag: previouslyUploadedPart.ETag,
            ...(previouslyUploadedPart.ChecksumSHA256 && {
              ChecksumSHA256: previouslyUploadedPart.ChecksumSHA256,
            }),
          });
        } else {
          const partResult = await this.client.send(
            new UploadPartCommand({
              ...this.params,
              UploadId: this.uploadId,
              Body: await toBytes(dataPart.data),
              PartNumber: dataPart.partNumber,
            }),
          );
          if (this.abortController.signal.aborted) {
            return;
          }
          this.uploadedParts.push({
            PartNumber: dataPart.partNumber,
            ETag: partResult.ETag,
            ...(partResult.ChecksumSHA256 && {
              ChecksumSHA256: partResult.ChecksumSHA256,
            }),
          });
        }

        // Count skipped (resumed) parts toward progress too, so the bar reflects real completion.
        this.bytesUploadedSoFar += dataPart.data.size;
        this.notifyProgress({
          loaded: this.bytesUploadedSoFar,
          total: this.totalBytes,
          part: dataPart.partNumber,
          Key: this.params.Key,
          Bucket: this.params.Bucket,
        });
      } catch (error) {
        // Before a multipart upload exists, any error is fatal. Once it exists, leavePartsOnError
        // decides whether to propagate (and leave parts on S3 for a later resume) or swallow.
        if (!this.uploadId || this.leavePartsOnError) {
          throw error;
        }
      }
    }
  }

  private async doMultipartUpload(): Promise<
    CompleteMultipartUploadCommandOutput | PutObjectCommandOutput
  > {
    const feeder = chunkBlob(this.params.Body as Blob, this.partSize);

    if (this.uploadId) {
      try {
        await this.getUploadedParts();
      } catch {
        // Couldn't enumerate prior parts — start a fresh upload and let the modal clear the stale id.
        this.uploadId = undefined;
        this.createdMultipartUploadListener?.(null);
      }
    }

    const workers: Promise<void>[] = [];
    for (let i = 0; i < this.queueSize; i++) {
      workers.push(this.runWorker(feeder));
    }
    await Promise.all(workers);

    if (this.abortController.signal.aborted) {
      const abortError = new Error("Upload aborted.");
      abortError.name = "AbortError";
      throw abortError;
    }

    if (!this.isMultiPart) {
      return this.putResponse as PutObjectCommandOutput;
    }

    this.uploadedParts.sort(
      (a, b) => (a.PartNumber ?? 0) - (b.PartNumber ?? 0),
    );
    return this.client.send(
      new CompleteMultipartUploadCommand({
        ...this.paramsWithoutBody(),
        UploadId: this.uploadId,
        MultipartUpload: { Parts: this.uploadedParts },
      }),
    );
  }
}
