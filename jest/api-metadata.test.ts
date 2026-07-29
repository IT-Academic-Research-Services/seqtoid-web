// Coverage: app/assets/src/api/metadata.ts
// Every function here is a thin wrapper around api/core's get/postWithCSRF.
// The branches worth driving are the snapshotShareId prefixing (public
// "/pub/<id>" routes vs the authenticated routes) and the manual-metadata ->
// CSV row flattening, which must substitute "" for missing/falsy cells.
import { get, postWithCSRF } from "~/api/core";
import {
  getOfficialMetadataFields,
  getProjectMetadataFields,
  getSampleMetadata,
  getSampleMetadataFields,
  getWorkflowRunMetadataFields,
  saveSampleMetadata,
  uploadMetadataForProject,
  validateManualMetadataForNewSamples,
  validateManualMetadataForProject,
  validateMetadataCSVForNewSamples,
  validateMetadataCSVForProject,
} from "~/api/metadata";

jest.mock("~/api/core", () => ({
  get: jest.fn(),
  postWithCSRF: jest.fn(),
}));

const mockedGet = get as jest.Mock;
const mockedPost = postWithCSRF as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockedGet.mockResolvedValue({ ok: true });
  mockedPost.mockResolvedValue({ ok: true });
});

describe("getSampleMetadata", () => {
  it("uses the authenticated route with a pipeline_version param when there is no snapshot", async () => {
    await expect(
      getSampleMetadata({ id: 42, pipelineVersion: "7.1" }),
    ).resolves.toEqual({ ok: true });

    expect(mockedGet).toHaveBeenCalledWith("/samples/42/metadata", {
      params: { pipeline_version: "7.1" },
    });
  });

  it("defaults pipelineVersion to null when omitted", async () => {
    await getSampleMetadata({ id: 1 });
    expect(mockedGet).toHaveBeenCalledWith("/samples/1/metadata", {
      params: { pipeline_version: null },
    });
  });

  it("uses the public /pub snapshot route when a snapshotShareId is given", async () => {
    await getSampleMetadata({
      id: 42,
      pipelineVersion: "7.1",
      snapshotShareId: "abc123",
    });

    expect(mockedGet).toHaveBeenCalledWith(
      "/pub/abc123/samples/42/metadata?pipeline_version=7.1",
    );
    // The snapshot branch passes no axios config at all.
    expect(mockedGet.mock.calls[0]).toHaveLength(1);
  });
});

describe("getSampleMetadataFields", () => {
  it("wraps a single id into an array and posts to the unprefixed route", async () => {
    await getSampleMetadataFields(7);
    expect(mockedPost).toHaveBeenCalledWith("/samples/metadata_fields", {
      sampleIds: [7],
    });
  });

  it("flattens an array of ids and prefixes /pub for snapshots", async () => {
    await getSampleMetadataFields([1, 2, 3], "share-1");
    expect(mockedPost).toHaveBeenCalledWith(
      "/pub/share-1/samples/metadata_fields",
      { sampleIds: [1, 2, 3] },
    );
  });
});

describe("getProjectMetadataFields", () => {
  it("sends projectIds as a flattened array for a single id", async () => {
    await getProjectMetadataFields("9");
    expect(mockedGet).toHaveBeenCalledWith("/projects/metadata_fields", {
      params: { projectIds: ["9"] },
    });
  });

  it("passes an array of ids straight through", async () => {
    await getProjectMetadataFields(["9", "10"]);
    expect(mockedGet).toHaveBeenCalledWith("/projects/metadata_fields", {
      params: { projectIds: ["9", "10"] },
    });
  });
});

describe("getWorkflowRunMetadataFields", () => {
  it("posts workflowRunIds to the unprefixed route without a snapshot", async () => {
    await getWorkflowRunMetadataFields([11]);
    expect(mockedPost).toHaveBeenCalledWith("/workflow_runs/metadata_fields", {
      workflowRunIds: [11],
    });
  });

  it("prefixes /pub when a snapshotShareId is given", async () => {
    await getWorkflowRunMetadataFields(11, "snap");
    expect(mockedPost).toHaveBeenCalledWith(
      "/pub/snap/workflow_runs/metadata_fields",
      { workflowRunIds: [11] },
    );
  });
});

describe("saveSampleMetadata", () => {
  it("posts the field and value to the v2 save route", async () => {
    mockedPost.mockResolvedValueOnce({ status: "success" });
    await expect(
      saveSampleMetadata(5, "collection_date", "2021-01-01"),
    ).resolves.toEqual({ status: "success" });

    expect(mockedPost).toHaveBeenCalledWith("/samples/5/save_metadata_v2", {
      field: "collection_date",
      value: "2021-01-01",
    });
  });
});

describe("CSV validation endpoints", () => {
  it("validateMetadataCSVForProject posts to the project route", async () => {
    const metadata = { headers: ["a"], rows: [["1"]] };
    await validateMetadataCSVForProject(3, metadata);
    expect(mockedPost).toHaveBeenCalledWith(
      "/projects/3/validate_metadata_csv",
      { metadata },
    );
  });

  it("validateMetadataCSVForNewSamples posts samples alongside metadata", async () => {
    const metadata = { headers: ["a"], rows: [["1"]] };
    const samples = [{ name: "s1", host_genome_id: 1 }];
    await validateMetadataCSVForNewSamples(samples, metadata);
    expect(mockedPost).toHaveBeenCalledWith(
      "/metadata/validate_csv_for_new_samples",
      { metadata, samples },
    );
  });
});

describe("manual metadata -> CSV conversion", () => {
  const manual = {
    headers: ["Sample Name", "Host Organism", "Notes"],
    rows: [
      {
        "Sample Name": "s1",
        "Host Organism": "Human",
        Notes: "hello",
      },
      {
        // "Host Organism" is missing and Notes is falsy -> both become "".
        "Sample Name": "s2",
        Notes: "",
      },
    ],
  };

  it("validateManualMetadataForProject flattens rows into header order", async () => {
    await validateManualMetadataForProject(12, manual);

    expect(mockedPost).toHaveBeenCalledWith(
      "/projects/12/validate_metadata_csv",
      {
        metadata: {
          headers: ["Sample Name", "Host Organism", "Notes"],
          rows: [
            ["s1", "Human", "hello"],
            ["s2", "", ""],
          ],
        },
      },
    );
  });

  it("validateManualMetadataForProject does not mutate the caller's object", async () => {
    const original = JSON.parse(JSON.stringify(manual));
    await validateManualMetadataForProject(12, manual);
    expect(manual).toEqual(original);
  });

  it("validateManualMetadataForNewSamples flattens rows and forwards samples", async () => {
    const samples = [{ name: "s1", host_genome_id: 1 }];
    await validateManualMetadataForNewSamples(samples, manual);

    expect(mockedPost).toHaveBeenCalledWith(
      "/metadata/validate_csv_for_new_samples",
      {
        samples,
        metadata: {
          headers: ["Sample Name", "Host Organism", "Notes"],
          rows: [
            ["s1", "Human", "hello"],
            ["s2", "", ""],
          ],
        },
      },
    );
  });

  it("produces an empty rows array when there are no rows", async () => {
    await validateManualMetadataForNewSamples([], { headers: ["a"], rows: [] });
    expect(mockedPost).toHaveBeenCalledWith(
      "/metadata/validate_csv_for_new_samples",
      { samples: [], metadata: { headers: ["a"], rows: [] } },
    );
  });
});

describe("uploadMetadataForProject", () => {
  it("posts the metadata to the project upload route", async () => {
    const metadata = { headers: ["a"], rows: [["1"]] };
    await uploadMetadataForProject(77, metadata);
    expect(mockedPost).toHaveBeenCalledWith("/projects/77/upload_metadata", {
      metadata,
    });
  });
});

describe("getOfficialMetadataFields", () => {
  it("gets the official field list and returns the response", async () => {
    mockedGet.mockResolvedValueOnce([{ key: "sample_type" }]);
    await expect(getOfficialMetadataFields()).resolves.toEqual([
      { key: "sample_type" },
    ]);
    expect(mockedGet).toHaveBeenCalledWith(
      "/metadata/official_metadata_fields",
    );
  });

  it("propagates a rejection from the underlying request", async () => {
    mockedGet.mockRejectedValueOnce(new Error("boom"));
    await expect(getOfficialMetadataFields()).rejects.toThrow("boom");
  });
});
