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
  CreateMultipartUploadCommandOutput,
  ListPartsCommand,
  ListPartsCommandOutput,
  PutObjectCommand,
  PutObjectCommandInput,
  PutObjectCommandOutput,
  S3Client,
  UploadPartCommand,
  UploadPartCommandOutput,
} from "@aws-sdk/client-s3";
import { ConcurrencyLimiter } from "./uploadConcurrencyLimiter";

// S3 multipart minimum part size (5 MiB) and hard cap on parts.
const MIN_PART_SIZE = 1024 * 1024 * 5;
const DEFAULT_QUEUE_SIZE = 4;
const MAX_PARTS = 10000;

// Per-request timeout for a single S3 API call. Without it a stalled socket -- e.g. the browser
// connection pool saturating while a whole batch of samples uploads at once -- leaves client.send()
// pending forever, which silently hangs the entire batch with no surfaced error (samples sit at
// status=created and are swept to LOCAL_UPLOAD_STALLED; SMP-1747). The timeout converts a hung
// request into a rejection so it can be retried and, if it keeps failing, surfaced.
// Sized for a 5 MiB part on a slow or shared uplink (~17 KiB/s floor): at the previous 60s, a batch
// uploading many parts at once on an ordinary connection timed parts out that were still sending,
// failing whole samples and prompting the user to retry.
const DEFAULT_REQUEST_TIMEOUT_MS = 300_000;
// Bounded retry for a single request. After this many attempts the error propagates so a genuine
// failure surfaces (and, with leavePartsOnError, the multipart parts are left on S3 to resume)
// rather than retrying forever.
const DEFAULT_MAX_ATTEMPTS = 3;
// Base for the linear backoff between retries (attempt 1 -> base, attempt 2 -> 2*base, ...).
const DEFAULT_RETRY_BASE_DELAY_MS = 500;

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
  // Per-request timeout / bounded-retry knobs (exposed mainly so tests can drive them fast).
  requestTimeoutMs?: number;
  maxAttempts?: number;
  retryBaseDelayMs?: number;
  // Optional limiter shared across uploads to cap total concurrent part uploads (see above).
  limiter?: ConcurrencyLimiter;
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
  private readonly requestTimeoutMs: number;
  private readonly maxAttempts: number;
  private readonly retryBaseDelayMs: number;
  private readonly limiter?: ConcurrencyLimiter;
  private readonly abortController = new AbortController();
  // Set when one worker hits an unrecoverable error (leavePartsOnError). The sibling workers stop
  // taking parts and their in-flight requests are aborted, so a failed attempt stops using the
  // uplink instead of competing with the retry that follows it.
  private failure?: unknown;
  private readonly inFlightRequests = new Set<AbortController>();
  // True once an UploadPart request failed/timed out and was retried, or when resuming an existing
  // upload. Only then can S3 hold a different copy (ETag) of a part than the one recorded here, so
  // only then is the part list reconciled against ListParts before completing.
  private partEtagsMayBeStale = false;

  private uploadId?: string;
  private paused = false;
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
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.retryBaseDelayMs =
      options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
    this.limiter = options.limiter;
    if (this.partSize < MIN_PART_SIZE) {
      throw new Error(
        `EntityTooSmall: partSize ${this.partSize} is smaller than the 5MB minimum.`,
      );
    }
    if (this.queueSize < 1) {
      throw new Error("Queue size: must have at least one uploading queue.");
    }
    if (this.maxAttempts < 1) {
      throw new Error("maxAttempts: must allow at least one attempt.");
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

  // Soft-pause: stop queuing/finishing new parts but leave the multipart upload (and its already
  // uploaded parts) intact on S3, so a later ResumableUpload constructed with the emitted uploadId
  // resumes via ListParts. Mechanically this trips the same AbortController as abort(), but done()
  // rejects with a distinguishable PauseError so the caller can treat it as "paused" not "failed".
  // The emitted uploadId (see onCreatedMultipartUpload) is what the caller persists to resume.
  async pause(): Promise<void> {
    this.paused = true;
    this.abortController.abort();
  }

  isPaused(): boolean {
    return this.paused;
  }

  async done(): Promise<
    CompleteMultipartUploadCommandOutput | PutObjectCommandOutput
  > {
    return Promise.race([this.doMultipartUpload(), this.abortPromise()]);
  }

  // AbortError for a hard abort, PauseError for a soft pause — same signal, different intent so the
  // caller can keep the persisted uploadId on pause and discard it on abort.
  private interruptError(): Error {
    const error = new Error(this.paused ? "Upload paused." : "Upload aborted.");
    error.name = this.paused ? "PauseError" : "AbortError";
    return error;
  }

  private abortPromise(): Promise<never> {
    // eslint-disable-next-line promise/param-names -- this promise only rejects (on abort); resolve is intentionally unused
    return new Promise((_resolve, reject) => {
      this.abortController.signal.addEventListener("abort", () => {
        reject(this.interruptError());
      });
    });
  }

  private notifyProgress(progress: Progress): void {
    this.progressListener?.(progress);
  }

  // Send a single S3 command with a bounded timeout + retry so it ALWAYS settles. A stalled socket
  // otherwise leaves client.send() pending forever, silently hanging the whole batch upload with no
  // surfaced error (LOCAL_UPLOAD_STALLED, SMP-1747). On timeout the in-flight request is aborted and
  // the call is retried up to maxAttempts; after the last attempt the error propagates so the failure
  // surfaces (and, with leavePartsOnError, the multipart parts are left on S3 for a later resume).
  // Commands are immutable input holders, so the same instance is safely re-sent across retries.
  private async sendWithRetry<T>(
    command: Parameters<S3Client["send"]>[0],
  ): Promise<T> {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    for (;;) {
      attempt++;
      // A user pause/abort short-circuits before spending another attempt.
      if (this.abortController.signal.aborted) {
        throw this.interruptError();
      }
      // A sibling worker already failed this upload: don't start (or retry) another request.
      if (this.failure !== undefined) {
        throw this.failure;
      }
      const timeoutController = new AbortController();
      this.inFlightRequests.add(timeoutController);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await new Promise<T>((resolve, reject) => {
          timer = setTimeout(() => {
            const error = new Error(
              `TimeoutError: S3 request exceeded ${this.requestTimeoutMs}ms.`,
            );
            error.name = "TimeoutError";
            // Abort the underlying fetch so a stalled request doesn't leak past the timeout.
            timeoutController.abort();
            reject(error);
          }, this.requestTimeoutMs);
          (
            this.client.send(command, {
              abortSignal: timeoutController.signal,
            }) as Promise<T>
          ).then(resolve, reject);
        });
      } catch (error) {
        // Never retry an intentional pause/abort -- surface it so the caller can persist/resume.
        if (this.abortController.signal.aborted) {
          throw this.interruptError();
        }
        // Aborted because a sibling worker failed: surface that original failure, don't retry.
        if (this.failure !== undefined) {
          throw this.failure;
        }
        if (command instanceof UploadPartCommand) {
          // The failed attempt may still land on S3 after its retry, replacing the part's ETag.
          this.partEtagsMayBeStale = true;
        }
        if (attempt >= this.maxAttempts) {
          throw error;
        }
        await this.retryDelay(attempt);
      } finally {
        if (timer) {
          clearTimeout(timer);
        }
        this.inFlightRequests.delete(timeoutController);
      }
    }
  }

  // Run fn while holding a slot from the shared limiter (when one is configured).
  private async withPartSlot<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.limiter) {
      return fn();
    }
    const release = await this.limiter.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  // First unrecoverable worker error: record it and abort every sibling's in-flight request.
  private failFast(error: unknown): void {
    if (this.failure === undefined) {
      this.failure = error;
      for (const controller of this.inFlightRequests) {
        controller.abort();
      }
    }
  }

  private retryDelay(attempt: number): Promise<void> {
    return new Promise(resolve =>
      setTimeout(resolve, this.retryBaseDelayMs * attempt),
    );
  }

  // CreateMultipartUpload / CompleteMultipartUpload inputs don't accept a Body; strip it from params.
  private paramsWithoutBody(): Omit<PutObjectCommandInput, "Body"> {
    const { Body, ...rest } = this.params;
    void Body;
    return rest;
  }

  // Page through ListParts, returning every part S3 currently holds for this upload by number.
  // Pages with S3's own NextPartNumberMarker: the marker is a part NUMBER, not a count, so a count
  // re-reads or skips parts when earlier parts are missing (common after a failed attempt).
  private async listUploadedParts(): Promise<Record<number, CompletedPart>> {
    const partsByNumber: Record<number, CompletedPart> = {};
    if (!this.uploadId) {
      return partsByNumber;
    }
    const { Bucket, Key } = this.params;
    let marker = "0";
    for (;;) {
      const response = await this.sendWithRetry<ListPartsCommandOutput>(
        new ListPartsCommand({
          Bucket,
          Key,
          UploadId: this.uploadId,
          PartNumberMarker: marker,
        }),
      );
      const parts = response.Parts ?? [];
      for (const part of parts) {
        const { ETag, PartNumber } = part;
        if (ETag && PartNumber) {
          partsByNumber[PartNumber] = {
            PartNumber,
            ETag,
            ...(part.ChecksumSHA256 && {
              ChecksumSHA256: part.ChecksumSHA256,
            }),
          };
        }
      }
      if (!response.IsTruncated) {
        return partsByNumber;
      }
      const next =
        response.NextPartNumberMarker ??
        parts[parts.length - 1]?.PartNumber?.toString();
      if (!next || next === marker) {
        // Defensive: a truncated page with no usable marker would loop forever.
        return partsByNumber;
      }
      marker = next;
    }
  }

  // Record already-uploaded parts for a resumed upload.
  private async getUploadedParts(): Promise<void> {
    this.previouslyUploadedPartsMap = await this.listUploadedParts();
  }

  private async uploadUsingPut(dataPart: DataPart): Promise<void> {
    this.isMultiPart = false;
    this.putResponse = await this.withPartSlot(async () =>
      this.sendWithRetry<PutObjectCommandOutput>(
        new PutObjectCommand({
          ...this.params,
          Body: await toBytes(dataPart.data),
        }),
      ),
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
      this.createMultipartPromise =
        this.sendWithRetry<CreateMultipartUploadCommandOutput>(
          new CreateMultipartUploadCommand(this.paramsWithoutBody()),
        ).then(result => {
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

  // Upload one part (bytes are read only once a limiter slot is held, bounding memory as well).
  private uploadPart(dataPart: DataPart): Promise<UploadPartCommandOutput> {
    return this.withPartSlot(async () =>
      this.sendWithRetry<UploadPartCommandOutput>(
        new UploadPartCommand({
          ...this.params,
          UploadId: this.uploadId,
          Body: await toBytes(dataPart.data),
          PartNumber: dataPart.partNumber,
        }),
      ),
    );
  }

  private async runWorker(feeder: AsyncGenerator<DataPart>): Promise<void> {
    for (;;) {
      // A sibling worker already failed this upload: stop taking parts.
      if (this.failure !== undefined) {
        return;
      }
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
          const partResult = await this.uploadPart(dataPart);
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
          this.failFast(error);
          throw this.failure;
        }
      }
    }
  }

  private async doMultipartUpload(): Promise<
    CompleteMultipartUploadCommandOutput | PutObjectCommandOutput
  > {
    const feeder = chunkBlob(this.params.Body as Blob, this.partSize);

    if (this.uploadId) {
      this.partEtagsMayBeStale = true;
      try {
        await this.getUploadedParts();
      } catch {
        // Couldn't enumerate prior parts — start a fresh upload and let the modal clear the stale id.
        this.uploadId = undefined;
        this.partEtagsMayBeStale = false;
        this.createdMultipartUploadListener?.(null);
      }
    }

    const workers: Promise<void>[] = [];
    for (let i = 0; i < this.queueSize; i++) {
      workers.push(this.runWorker(feeder));
    }
    await Promise.all(workers);

    if (this.abortController.signal.aborted) {
      throw this.interruptError();
    }

    if (!this.isMultiPart) {
      return this.putResponse as PutObjectCommandOutput;
    }

    this.uploadedParts.sort(
      (a, b) => (a.PartNumber ?? 0) - (b.PartNumber ?? 0),
    );
    let parts = this.uploadedParts;
    if (this.partEtagsMayBeStale) {
      try {
        parts = await this.reconcileWithS3(this.uploadedParts);
      } catch (error) {
        // Reconciling is a safety check. If it cannot run (ListParts failing), complete with the
        // recorded parts as before rather than failing an upload whose parts are all on S3.
        if (this.abortController.signal.aborted) {
          throw this.interruptError();
        }
        parts = this.uploadedParts;
      }
    }
    return this.sendWithRetry<CompleteMultipartUploadCommandOutput>(
      new CompleteMultipartUploadCommand({
        ...this.paramsWithoutBody(),
        UploadId: this.uploadId,
        MultipartUpload: { Parts: parts },
      }),
    );
  }

  // Build the CompleteMultipartUpload part list from what S3 actually holds, not from the ETags this
  // browser recorded. The samples buckets use SSE-KMS, where a part's ETag is NOT an MD5 of its bytes
  // and changes on every upload of that part. A request that times out here can still land on S3
  // AFTER its retry succeeded, replacing the part with a new ETag; completing with the recorded ETag
  // then fails with InvalidPart. The SHA256 checksum IS stable for identical bytes, so it proves S3's
  // copy is our data. A part that is missing, or whose checksum differs, is uploaded again.
  private async reconcileWithS3(
    recordedParts: CompletedPart[],
  ): Promise<CompletedPart[]> {
    const onS3 = await this.listUploadedParts();
    const reconciled: CompletedPart[] = [];
    for (const recorded of recordedParts) {
      const partNumber = recorded.PartNumber as number;
      const current = onS3[partNumber];
      const sameBytes =
        current &&
        (!recorded.ChecksumSHA256 ||
          !current.ChecksumSHA256 ||
          current.ChecksumSHA256 === recorded.ChecksumSHA256);
      if (current && sameBytes) {
        reconciled.push(current);
        continue;
      }
      // Missing or not our bytes: upload this part again from the local file.
      const start = (partNumber - 1) * this.partSize;
      const body = this.params.Body as Blob;
      const dataPart: DataPart = {
        partNumber,
        data: body.slice(start, Math.min(start + this.partSize, body.size)),
        lastPart: start + this.partSize >= body.size,
      };
      const result = await this.uploadPart(dataPart);
      reconciled.push({
        PartNumber: partNumber,
        ETag: result.ETag,
        ...(result.ChecksumSHA256 && { ChecksumSHA256: result.ChecksumSHA256 }),
      });
    }
    return reconciled;
  }
}
