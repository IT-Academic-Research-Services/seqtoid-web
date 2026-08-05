import {
  ChecksumAlgorithm,
  PutObjectCommandInput,
  S3Client,
} from "@aws-sdk/client-s3";
import cx from "classnames";
import {
  constant,
  filter,
  isEmpty,
  map,
  omit,
  size,
  sum,
  times,
  zipObject,
} from "lodash/fp";
import React, { useEffect, useRef, useState } from "react";
import { ANALYTICS_EVENT_NAMES, useTrackEvent } from "~/api/analytics";
import {
  completeSampleUpload,
  getUploadCredentials,
  initiateBulkUploadLocalWithMetadata,
  startUploadHeartbeat,
} from "~/api/upload";
import { TaxonOption } from "~/components/common/filters/types";
import PrimaryButton from "~/components/ui/controls/buttons/PrimaryButton";
import SecondaryButton from "~/components/ui/controls/buttons/SecondaryButton";
import { logError } from "~/components/utils/logUtil";
import { ResumableUpload } from "~/components/views/SampleUploadFlow/components/UploadProgressModal/resumableUpload";
import {
  cacheUploadFile,
  canCacheFile,
  clearCachedUploadFile,
  clearProjectByteCache,
} from "~/components/views/SampleUploadFlow/components/UploadProgressModal/uploadByteCache";
import {
  clearFileHandle,
  clearProjectFileHandles,
  isFileHandlePersistenceSupported,
  PersistableFileHandle,
  persistFileHandle,
} from "~/components/views/SampleUploadFlow/components/UploadProgressModal/uploadFileHandleStore";
import {
  clearUploadResumeState,
  loadUploadResumeState,
  saveUploadResumeState,
} from "~/components/views/SampleUploadFlow/components/UploadProgressModal/uploadResumeState";
import {
  inputFileS3Tags,
  s3TagsToUrlParams,
} from "~/components/views/SampleUploadFlow/utils";
import { MetadataBasic, Project, SampleFromApi } from "~/interface/shared";
import Modal from "~ui/containers/Modal";
import { UploadWorkflows } from "../../../../constants";
import { RefSeqAccessionDataType } from "../../../UploadSampleStep/types";
import { PathToFile, SampleForUpload } from "../../types";
import cs from "../../upload_progress_modal.scss";
import {
  addAdditionalInputFilesToSamples,
  addFlagsToSamples,
  redirectToProject,
} from "../../upload_progress_utils";
import { LocalUploadModalHeader } from "./components/LocalUploadModalHeader";
import { UploadConfirmationModal } from "./components/UploadConfirmationModal";
import { UploadProgressModalSampleList } from "./components/UploadProgressModalSampleList";

interface LocalUploadProgressModalProps {
  adminOptions: Record<string, string>;
  bedFile: File | null;
  clearlabs: boolean;
  guppyBasecallerSetting: string;
  // CZID-975/CZID-976 -- user-selected pipeline version; undefined means use the project default.
  workflowVersion?: string;
  medakaModel: string | null;
  metadata: MetadataBasic | null;
  onUploadComplete: () => void;
  project: Project;
  refSeqAccession: RefSeqAccessionDataType | null;
  refSeqFile: File | null;
  refSeqTaxon: TaxonOption | null;
  samples: SampleFromApi[] | null;
  skipSampleProcessing: boolean;
  technology: string | null;
  uploadType: string;
  useStepFunctionPipeline: boolean;
  wetlabProtocol: string | null;
  workflows: Set<UploadWorkflows>;
}

export const LocalUploadProgressModal = ({
  adminOptions,
  bedFile,
  clearlabs,
  guppyBasecallerSetting,
  workflowVersion,
  medakaModel,
  metadata,
  onUploadComplete,
  project,
  refSeqAccession,
  refSeqFile,
  refSeqTaxon,
  samples,
  skipSampleProcessing,
  technology,
  useStepFunctionPipeline,
  wetlabProtocol,
  workflows,
}: LocalUploadProgressModalProps) => {
  const trackEvent = useTrackEvent();
  const [confirmationModalOpen, setConfirmationModalOpen] = useState(false);

  // State variables to manage download state
  const [retryingSampleUpload, setRetryingSampleUpload] = useState(false);
  const [uploadComplete, setUploadComplete] = useState(false);

  // Pause/resume state. `paused` drives the UI; `pausedRef` is read inside async upload loops
  // (which close over the initial render's state) so a pause takes effect immediately.
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  // Live ResumableUpload instances by s3Key, so Pause can soft-pause each in-flight upload.
  const activeUploadsRef = useRef<Record<string, ResumableUpload>>({});

  // Seed resume state from a prior (paused / interrupted) session so a page reload can pick up:
  // the persisted uploadIds let ResumableUpload skip already-uploaded parts via ListParts.
  const persistedResumeState = loadUploadResumeState(project.id);

  // Store samples created in API
  const [locallyCreatedSamples, setLocallyCreatedSamples] = useState<
    SampleForUpload[]
  >([]);

  // State to track download progress
  const [sampleFileUploadIds, setSampleFileUploadIds] = useState<
    Record<string, string>
  >(persistedResumeState?.sampleFileUploadIds ?? {});
  const [sampleUploadPercentages, setSampleUploadPercentages] = useState({});
  const [sampleUploadStatuses, setSampleUploadStatuses] = useState({});
  const [sampleFileCompleted, setSampleFileCompleted] = useState<
    Record<string, boolean>
  >(persistedResumeState?.sampleFileCompleted ?? {});

  let sampleFilePercentages = {};
  let wakeLock: WakeLockSentinel | null = null;
  let heartbeatInterval: NodeJS.Timer | null = null;

  const IN_PROGRESS_STATUS = "in progress";
  const ERROR_STATUS = "error";

  useEffect(() => {
    initiateLocalUpload();

    // If navigate back to tab, re-acquire wake lock
    document.addEventListener("visibilitychange", async () => {
      if (wakeLock !== null && document.visibilityState === "visible") {
        await acquireScreenLock();
      }
    });
  }, []);

  useEffect(() => {
    const uploadsInProgress = !isEmpty(getLocalSamplesInProgress());
    if (uploadComplete || uploadsInProgress) return;

    completeLocalUpload();
  }, [sampleUploadStatuses]);

  // Durably persist the per-file resume state (uploadIds + completed files) so a Resume can
  // re-drive ResumableUpload with the saved uploadId even after a page reload. Cleared on
  // successful completion (see completeLocalUpload).
  useEffect(() => {
    if (uploadComplete) return;
    saveUploadResumeState(project.id, {
      sampleFileUploadIds,
      sampleFileCompleted,
    });
  }, [sampleFileUploadIds, sampleFileCompleted, uploadComplete]);

  // Try to prevent the computer going to sleep during upload; this can be rejected e.g. if the battery is low
  const acquireScreenLock = async () => {
    try {
      if ("wakeLock" in navigator) {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => {
          console.warn("Wake lock was released");
        });
      } else {
        throw new Error("WakeLock API not supported in this browser");
      }
      console.warn("Acquired wake lock");
    } catch (err) {
      console.error("Failed to acquire wake lock");
      console.error(err);
    }
  };

  const initiateLocalUpload = async () => {
    if (!samples) return;
    const samplesToUpload = addFlagsToSamples({
      adminOptions,
      bedFileName: bedFile?.name,
      clearlabs,
      guppyBasecallerSetting,
      workflowVersion,
      medakaModel,
      samples,
      useStepFunctionPipeline,
      refSeqAccession,
      refSeqFileName: refSeqFile?.name,
      refSeqTaxon,
      skipSampleProcessing,
      technology,
      workflows,
      wetlabProtocol,
    });

    addAdditionalInputFilesToSamples({
      samples: samplesToUpload,
      bedFile,
      refSeqFile,
    });
    // Create the samples in the db; this does NOT upload files to s3
    const createdSamples = await initiateBulkUploadLocalWithMetadata({
      samples: samplesToUpload,
      metadata,
      onCreateSamplesError: (
        errors: $TSFixMeUnknown,
        erroredSampleNames: string[],
      ) => {
        logError({
          message: "UploadProgressModal: onCreateSamplesError",
          details: { errors },
        });

        const uploadStatuses = zipObject(
          erroredSampleNames,
          times(constant(ERROR_STATUS), erroredSampleNames.length),
        );

        setSampleUploadStatuses(prevState => ({
          ...prevState,
          ...uploadStatuses,
        }));
      },
    });

    setLocallyCreatedSamples(createdSamples);

    await acquireScreenLock();

    // For each sample, upload sample.input_files to s3
    // Also handles the upload progress bar for each sample
    await uploadSamples(createdSamples);
  };

  const uploadSamples = async (samples: SampleForUpload[]) => {
    // Ping a heartbeat periodically to say the browser is actively uploading the samples.
    heartbeatInterval = await startUploadHeartbeat();

    // Upload each sample in serial, but upload each sample's input files and parts in parallel.
    // if we upload samples in parallel, we fetch AWS credentials for many samples at once at
    // the beginning, so by the time we get to the last sample, the credentials could have expired.
    for (const sample of samples) {
      await uploadSample(sample);
    }

    // Once the upload is done, release the wake lock
    if (wakeLock !== null) {
      console.warn("Releasing wake lock since upload completed...");
      await wakeLock.release();
      wakeLock = null;
    }

    clearInterval(heartbeatInterval);
    trackEvent(
      ANALYTICS_EVENT_NAMES.LOCAL_UPLOAD_PROGRESS_MODAL_UPLOADS_BATCH_HEARTBEAT_COMPLETED,
      {
        sampleIds: JSON.stringify(map("id", samples)),
      },
    );
  };

  const uploadSample = async (sample: SampleForUpload) => {
    try {
      // Get the credentials for the sample
      const s3ClientForSample = await getS3Client(sample);
      // Set the upload percentage for the sample to 0
      updateSampleUploadPercentage(sample.name, 0);

      if (!sample.input_files) return;
      await Promise.all(
        sample.input_files.map(async inputFile => {
          // Upload the input file to s3
          // Also updates the upload percentage for the sample
          await uploadInputFileToS3(sample, inputFile, s3ClientForSample);
        }),
      );

      // If the user paused, the sample's files are not fully uploaded — leave the sample "in
      // progress" (uploadIds persisted) so Resume can finish it. Don't mark it complete.
      if (pausedRef.current) return;

      // Update the sample upload status (success or error)
      await completeSampleUpload({
        sample,
        onSampleUploadSuccess: (sample: SampleForUpload) => {
          updateSampleUploadStatus(sample.name, "success");
        },
        onMarkSampleUploadedError: handleSampleUploadError,
      });
    } catch (e) {
      handleSampleUploadError(sample, e);
      heartbeatInterval && clearInterval(heartbeatInterval);
    }
  };

  const getS3Client = async (sample: SampleForUpload) => {
    const credentials = await getUploadCredentials(sample.id);
    const {
      access_key_id: accessKeyId,
      aws_region: region,
      expiration,
      secret_access_key: secretAccessKey,
      session_token: sessionToken,
    } = credentials;

    return new S3Client({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
        sessionToken,
        // The backend returns expiration as an ISO string; the AWS SDK v3 credential
        // provider requires a Date (it calls expiration.getTime()).
        expiration: expiration ? new Date(expiration) : undefined,
      },
      useAccelerateEndpoint: true,
      // Only attach the checksum we explicitly request (SHA256 per part); don't let newer SDK
      // versions auto-inject a default CRC32 request checksum, which can break accelerate/CORS PUTs.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  };

  const uploadInputFileToS3 = async (
    sample: SampleForUpload,
    inputFile: PathToFile,
    s3Client: S3Client,
  ) => {
    const {
      file_to_upload: body,
      s3_bucket: s3Bucket,
      s3_file_path: s3Key,
    } = inputFile;

    if (sampleFileCompleted[s3Key]) {
      return;
    }

    // Recovery Option B: best-effort cache the file bytes in IndexedDB (size-gated) so a resume
    // after a page reload can recover the file where the File System Access API is unavailable
    // (Firefox/Safari). No-ops for oversized files and when unsupported; never blocks the upload.
    if (body && canCacheFile(body.size)) {
      void cacheUploadFile(project.id, s3Key, body);
    }

    // Recovery Option C (Chrome/Edge): if this input file was selected through the File System
    // Access picker it carries a FileSystemFileHandle; persist it (best-effort) so a resume after a
    // page reload can re-read the file with a one-click permission re-grant, without caching bytes.
    // No-ops when unsupported or when no handle is present (e.g. the drag-and-drop input path).
    const fileHandle = (inputFile as { handle?: PersistableFileHandle }).handle;
    if (fileHandle && isFileHandlePersistenceSupported()) {
      void persistFileHandle(project.id, s3Key, fileHandle);
    }

    const uploadParams: PutObjectCommandInput = {
      Bucket: s3Bucket,
      Key: s3Key,
      Body: body,
      ChecksumAlgorithm: ChecksumAlgorithm.SHA256,
      Tagging: s3TagsToUrlParams(inputFileS3Tags(sample.id)),
    };

    updateSampleFilePercentage({
      sampleName: sample.name,
      s3Key,
      fileSize: body?.size,
    });

    const fileUpload = new ResumableUpload({
      client: s3Client,
      leavePartsOnError: true, // configures lib to propagate errors
      params: uploadParams,
      ...(sampleFileUploadIds[s3Key] && {
        uploadId: sampleFileUploadIds[s3Key],
      }),
    });

    // Track this live upload so a Pause can soft-pause it. If the user already hit Pause before
    // this file started, don't start it — leave it for Resume to pick up.
    activeUploadsRef.current[s3Key] = fileUpload;
    if (pausedRef.current) {
      await fileUpload.pause();
    }

    const removeS3KeyFromUploadIds = (s3Key: string) => {
      setSampleFileUploadIds(prevState => omit(s3Key, prevState));
    };

    fileUpload.on("httpUploadProgress", progress => {
      const percentage =
        progress.loaded && progress.total
          ? progress.loaded / progress.total
          : 0;
      updateSampleFilePercentage({
        sampleName: sample.name,
        s3Key,
        percentage,
      });
    });

    fileUpload.onCreatedMultipartUpload(uploadId => {
      setSampleFileUploadIds(prevState =>
        uploadId
          ? { ...prevState, [s3Key]: uploadId }
          : // when there is no valid upload ID we could not create a multipart upload
            // for the file, so remove it from upload ID list to avoid retrying it
            omit(s3Key, prevState),
      );
    });

    try {
      await fileUpload.done();
    } catch (e) {
      // A PauseError means the user paused: the multipart upload (and its parts) are left on S3 and
      // the uploadId is already persisted, so Resume will continue it. Swallow it here so it isn't
      // surfaced as an upload failure; any other error propagates to be handled as a real failure.
      if (isPauseError(e)) {
        delete activeUploadsRef.current[s3Key];
        return;
      }
      throw e;
    } finally {
      delete activeUploadsRef.current[s3Key];
    }

    // prevent successfully uploaded files from being resumed if other files fail
    removeS3KeyFromUploadIds(s3Key);

    // This file is fully on S3 now, so drop its cached bytes (Option B) -- nothing left to recover.
    void clearCachedUploadFile(project.id, s3Key);
    // ... and drop any persisted handle (Option C) -- nothing to recover for this file either.
    void clearFileHandle(project.id, s3Key);

    setSampleFileCompleted(prevState => ({
      ...prevState,
      [s3Key]: true,
    }));
  };

  const isPauseError = (error: unknown): boolean =>
    error instanceof Error && error.name === "PauseError";

  const updateSampleUploadStatus = (sampleName: string, status: string) => {
    setSampleUploadStatuses(prevState => ({
      ...prevState,
      [sampleName]: status,
    }));
  };

  const updateSampleFilePercentage = ({
    sampleName,
    s3Key,
    percentage = 0,
    fileSize = null,
  }: {
    sampleName: string;
    percentage?: number;
    s3Key: string;
    fileSize?: number | null;
  }) => {
    const newSampleKeyState: { percentage: number; size?: number } = {
      percentage,
    };
    if (fileSize) {
      newSampleKeyState.size = fileSize;
    }

    const newSampleFileState = {
      ...sampleFilePercentages[sampleName],
      [s3Key]: {
        ...(sampleFilePercentages[sampleName] &&
          sampleFilePercentages[sampleName][s3Key]),
        ...newSampleKeyState,
      },
    };

    sampleFilePercentages = {
      ...sampleFilePercentages,
      [sampleName]: newSampleFileState,
    };

    updateSampleUploadPercentage(
      sampleName,
      calculatePercentageForSample(sampleFilePercentages[sampleName]),
    );
  };

  const updateSampleUploadPercentage = (
    sampleName: string,
    percentage: number,
  ) => {
    setSampleUploadPercentages(prevState => ({
      ...prevState,
      [sampleName]: percentage,
    }));
  };

  const calculatePercentageForSample = (sampleFilePercentage: {
    [key: string]: { percentage: number; size: number };
  }) => {
    const uploadedSize = sum(
      map(key => (key.percentage || 0) * key.size, sampleFilePercentage),
    );

    const totalSize = sum(map(progress => progress.size, sampleFilePercentage));

    return uploadedSize / totalSize;
  };

  const handleSampleUploadError = (sample: SampleForUpload, error = null) => {
    const message =
      "UploadProgressModal: Local sample upload error to S3 occurred";

    updateSampleUploadStatus(sample.name, ERROR_STATUS);

    logError({
      message,
      details: {
        sample,
        error,
      },
    });
  };

  const getLocalSamplesInProgress = () => {
    return filter(
      sample =>
        sampleUploadStatuses[sample.name] === undefined ||
        sampleUploadStatuses[sample.name] === IN_PROGRESS_STATUS,
      samples,
    );
  };

  const getLocalSamplesFailed = () => {
    return filter(
      sample => sampleUploadStatuses[sample.name] === ERROR_STATUS,
      samples,
    );
  };

  const retryFailedSampleUploads = async (failedSamples: SampleFromApi[]) => {
    setRetryingSampleUpload(true);
    setUploadComplete(false);
    failedSamples.forEach(failedSample =>
      updateSampleUploadStatus(failedSample.name, IN_PROGRESS_STATUS),
    );
    if (locallyCreatedSamples.length > 0) {
      const failedLocallyCreatedSamples = failedSamples
        .map(failedSample => {
          return locallyCreatedSamples.find(
            locallyCreatedSample =>
              locallyCreatedSample.name === failedSample.name,
          );
        })
        .filter(
          (locallyCreatedSample): locallyCreatedSample is SampleForUpload =>
            locallyCreatedSample !== undefined,
        );

      await uploadSamples(failedLocallyCreatedSamples);
    } else {
      initiateLocalUpload();
    }
  };

  const completeLocalUpload = () => {
    // Don't finalize while paused: samples are intentionally still "in progress" awaiting Resume.
    if (pausedRef.current) return;
    onUploadComplete();
    setUploadComplete(true);
    setRetryingSampleUpload(false);
    // Upload finished successfully: no resume state to keep around.
    clearUploadResumeState(project.id);
    // Drop any cached upload bytes for this project (Option B); recovery is no longer needed.
    void clearProjectByteCache(project.id);
    // Drop any persisted file handles for this project (Option C); recovery is no longer needed.
    void clearProjectFileHandles(project.id);
  };

  // Soft-pause every in-flight upload: parts already sent stay on S3 and the uploadIds are
  // persisted, so Resume continues from where it stopped rather than re-uploading.
  const handlePauseUpload = async () => {
    pausedRef.current = true;
    setPaused(true);
    await Promise.all(
      Object.values(activeUploadsRef.current).map(upload => upload.pause()),
    );
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    if (wakeLock !== null) {
      await wakeLock.release();
      wakeLock = null;
    }
  };

  // Resume: re-drive the still-in-progress samples. Their persisted uploadIds are in
  // sampleFileUploadIds, so ResumableUpload lists existing parts and only uploads what's missing.
  const handleResumeUpload = async () => {
    pausedRef.current = false;
    setPaused(false);
    activeUploadsRef.current = {};

    const inProgressSamples = getLocalSamplesInProgress();
    const samplesToResume =
      locallyCreatedSamples.length > 0
        ? inProgressSamples
            .map(inProgressSample =>
              locallyCreatedSamples.find(
                createdSample => createdSample.name === inProgressSample.name,
              ),
            )
            .filter(
              (createdSample): createdSample is SampleForUpload =>
                createdSample !== undefined,
            )
        : [];

    if (samplesToResume.length > 0) {
      // Re-acquire the screen wake lock we released on pause before resuming the transfers.
      await acquireScreenLock();
      await uploadSamples(samplesToResume);
    } else {
      // No created-sample records in memory (e.g. after a page reload) — restart the flow, which
      // re-creates/looks up samples and resumes files via their persisted uploadIds.
      await initiateLocalUpload();
    }
  };

  const hasFailedSamples = !isEmpty(getLocalSamplesFailed());
  const numberOfFailedSamples = size(getLocalSamplesFailed());
  const uploadsInProgress = !isEmpty(getLocalSamplesInProgress());

  return (
    <Modal
      open
      tall
      narrow
      className={cx(
        cs.uploadProgressModal,
        uploadComplete && cs.uploadComplete,
      )}
    >
      <LocalUploadModalHeader
        hasFailedSamples={hasFailedSamples}
        numberOfFailedSamples={numberOfFailedSamples}
        localSamplesFailed={getLocalSamplesFailed()}
        numLocalSamplesInProgress={size(getLocalSamplesInProgress())}
        retryFailedSampleUploads={retryFailedSampleUploads}
        retryingSampleUpload={retryingSampleUpload}
        sampleUploadStatuses={sampleUploadStatuses}
        numberOfSamples={size(samples)}
        projectName={project.name}
      />
      <UploadProgressModalSampleList
        samples={samples}
        sampleUploadPercentages={sampleUploadPercentages}
        sampleUploadStatuses={sampleUploadStatuses}
        onRetryUpload={retryFailedSampleUploads}
      />
      {!uploadComplete && uploadsInProgress && (
        <div className={cs.footer}>
          {paused ? (
            <PrimaryButton text="Resume upload" onClick={handleResumeUpload} />
          ) : (
            <SecondaryButton text="Pause upload" onClick={handlePauseUpload} />
          )}
        </div>
      )}
      {!retryingSampleUpload && uploadComplete && (
        <div className={cs.footer}>
          {hasFailedSamples ? (
            // Option A — retry-in-place. When uploads finish with failures, keep the
            // user in this session and make Retry the PRIMARY action instead of
            // nudging them to "Go to Project" (which drops the in-memory File objects
            // and forces re-doing the whole wizard). Retry re-uploads the failed
            // samples using the files already in memory, and any parts already sent
            // resume via their persisted uploadId (ResumableUpload), so it's a
            // one-click recovery. "Go to Project" stays available as a secondary path.
            <>
              <PrimaryButton
                text={
                  numberOfFailedSamples === 1
                    ? "Retry failed upload"
                    : `Retry ${numberOfFailedSamples} failed uploads`
                }
                onClick={() =>
                  retryFailedSampleUploads(getLocalSamplesFailed())
                }
              />
              <SecondaryButton
                text="Go to Project"
                onClick={() => setConfirmationModalOpen(true)}
              />
            </>
          ) : (
            <PrimaryButton
              text="Go to Project"
              onClick={() => redirectToProject(project.id)}
            />
          )}
        </div>
      )}
      {confirmationModalOpen && (
        <UploadConfirmationModal
          numberOfFailedSamples={numberOfFailedSamples}
          onCancel={() => {
            setConfirmationModalOpen(false);
          }}
          onConfirm={() => {
            redirectToProject(project.id);
          }}
          open
        />
      )}
    </Modal>
  );
};
