// CZID-462 coverage: app/assets/src/components/views/DiscoveryView/components/SamplesView/utils.ts
// getStatusCounts normalizes per-object status into Complete / Failed / upload_failed buckets.
import { WORKFLOW_ENTITIES } from "../app/assets/src/components/utils/workflows";
import { getStatusCounts } from "../app/assets/src/components/views/DiscoveryView/components/SamplesView/utils";

describe("SamplesView/utils getStatusCounts", () => {
  it("reads status directly off the object for WORKFLOW_RUNS entities", () => {
    const objects = [
      { status: "complete" },
      { status: "complete" },
      { status: "running" },
      { status: "" },
    ] as $TSFixMe;

    // "complete" stays Complete, any other non-empty status collapses to Failed,
    // and an empty string maps to upload_failed.
    expect(getStatusCounts(objects, WORKFLOW_ENTITIES.WORKFLOW_RUNS)).toEqual({
      complete: 2,
      failed: 1,
      upload_failed: 1,
    });
  });

  it("reads the nested sample.pipelineRunStatus for SAMPLES entities", () => {
    const objects = [
      { sample: { pipelineRunStatus: "complete" } },
      { sample: { pipelineRunStatus: "error" } },
    ] as $TSFixMe;

    expect(getStatusCounts(objects, WORKFLOW_ENTITIES.SAMPLES)).toEqual({
      complete: 1,
      failed: 1,
    });
  });

  it("returns an empty tally for no objects", () => {
    expect(getStatusCounts([], WORKFLOW_ENTITIES.SAMPLES)).toEqual({});
  });
});
