// Coverage for the async / IO-shaped helpers in
// app/assets/src/components/views/DiscoveryView/components/SamplesView/components/BulkDownloadModal/utils.ts
// The synchronous parsers are pinned by bulkDownloadUtils.test.ts and
// bulkDownloadUtilsPure.test.ts; what is left uncovered here is the code that
// talks to the Rails API / Relay (fetchBackgrounds, the collaborator check, the
// two validation fetchers) plus the owner-check branch matrix.
import {
  checkUserIsCollaboratorOnAllSamples,
  DEFAULT_CREATION_ERROR,
  fetchBackgrounds,
  fetchRailsValidationInfo,
  fetchValidationInfo,
  parseIsUserOwnerOfAllObjects,
  parseRailsIsUserOwnerOfAllObjects,
  parseValidationInfo,
} from "../app/assets/src/components/views/DiscoveryView/components/SamplesView/components/BulkDownloadModal/utils";

const mockGetBackgrounds = jest.fn();
const mockUserIsCollaborator = jest.fn();
const mockValidateSampleIds = jest.fn();
const mockValidateWorkflowRunIds = jest.fn();
const mockFetchQuery = jest.fn();

jest.mock("~/api", () => ({
  getBackgrounds: (...args: unknown[]) => mockGetBackgrounds(...args),
  userIsCollaboratorOnAllSamples: (...args: unknown[]) =>
    mockUserIsCollaborator(...args),
}));

jest.mock("~/api/access_control", () => ({
  validateSampleIds: (...args: unknown[]) => mockValidateSampleIds(...args),
  validateWorkflowRunIds: (...args: unknown[]) =>
    mockValidateWorkflowRunIds(...args),
}));

jest.mock("relay-runtime", () => ({
  ...jest.requireActual("relay-runtime"),
  fetchQuery: (...args: unknown[]) => mockFetchQuery(...args),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe("fetchBackgrounds", () => {
  it("maps the API backgrounds onto dropdown option shape", async () => {
    mockGetBackgrounds.mockResolvedValue({
      backgrounds: [
        { id: 1, name: "Background One", mass_normalized: true },
        { id: 2, name: "Background Two", mass_normalized: false },
      ],
    });

    await expect(fetchBackgrounds()).resolves.toEqual([
      { text: "Background One", value: 1, mass_normalized: true },
      { text: "Background Two", value: 2, mass_normalized: false },
    ]);
  });

  it("returns an empty list when the API returns no backgrounds", async () => {
    mockGetBackgrounds.mockResolvedValue({ backgrounds: undefined });
    await expect(fetchBackgrounds()).resolves.toEqual([]);

    mockGetBackgrounds.mockResolvedValue({ backgrounds: null });
    await expect(fetchBackgrounds()).resolves.toEqual([]);
  });

  it("propagates an API rejection", async () => {
    mockGetBackgrounds.mockRejectedValue(new Error("boom"));
    await expect(fetchBackgrounds()).rejects.toThrow("boom");
  });
});

describe("checkUserIsCollaboratorOnAllSamples", () => {
  it("returns false without calling the API when there are no entity ids", async () => {
    await expect(
      checkUserIsCollaboratorOnAllSamples({
        entityIds: undefined,
        workflowEntity: "Samples",
      }),
    ).resolves.toBe(false);
    expect(mockUserIsCollaborator).not.toHaveBeenCalled();
  });

  it("returns false for workflow-run entities without hitting the API", async () => {
    await expect(
      checkUserIsCollaboratorOnAllSamples({
        entityIds: new Set(["1", "2"]),
        workflowEntity: "WorkflowRuns",
      }),
    ).resolves.toBe(false);
    expect(mockUserIsCollaborator).not.toHaveBeenCalled();
  });

  it("delegates to the samples API for sample entities", async () => {
    mockUserIsCollaborator.mockResolvedValue(true);
    await expect(
      checkUserIsCollaboratorOnAllSamples({
        entityIds: new Set(["7", "8"]),
        workflowEntity: "Samples",
      }),
    ).resolves.toBe(true);
    expect(mockUserIsCollaborator).toHaveBeenCalledWith(["7", "8"]);
  });

  it("passes the API's negative answer through", async () => {
    mockUserIsCollaborator.mockResolvedValue(false);
    await expect(
      checkUserIsCollaboratorOnAllSamples({
        entityIds: new Set(["7"]),
        workflowEntity: undefined,
      }),
    ).resolves.toBe(false);
  });
});

describe("fetchRailsValidationInfo", () => {
  it("returns null when no entity ids are given", async () => {
    await expect(
      fetchRailsValidationInfo({
        entityIds: undefined,
        workflow: "consensus-genome",
        workflowEntity: "Samples",
      }),
    ).resolves.toBeNull();
    expect(mockValidateSampleIds).not.toHaveBeenCalled();
    expect(mockValidateWorkflowRunIds).not.toHaveBeenCalled();
  });

  it("validates workflow run ids for workflow-run entities", async () => {
    mockValidateWorkflowRunIds.mockResolvedValue({ validIds: [1] });
    const result = await fetchRailsValidationInfo({
      entityIds: new Set(["1", "2"]),
      workflow: "consensus-genome",
      workflowEntity: "WorkflowRuns",
    });
    expect(result).toEqual({ validIds: [1] });
    expect(mockValidateWorkflowRunIds).toHaveBeenCalledWith({
      workflowRunIds: ["1", "2"],
      workflow: "consensus-genome",
    });
    expect(mockValidateSampleIds).not.toHaveBeenCalled();
  });

  it("validates sample ids for sample entities", async () => {
    mockValidateSampleIds.mockResolvedValue({ validIds: [3] });
    const result = await fetchRailsValidationInfo({
      entityIds: new Set(["3"]),
      workflow: "amr",
      workflowEntity: "Samples",
    });
    expect(result).toEqual({ validIds: [3] });
    expect(mockValidateSampleIds).toHaveBeenCalledWith({
      sampleIds: ["3"],
      workflow: "amr",
    });
    expect(mockValidateWorkflowRunIds).not.toHaveBeenCalled();
  });
});

describe("fetchValidationInfo", () => {
  const environment = { fake: "environment" };
  const query = { fake: "query" };

  it("stringifies the entity ids and forwards the authenticity token", async () => {
    const toPromise = jest.fn().mockResolvedValue({ fedWorkflowRuns: [] });
    mockFetchQuery.mockReturnValue({ toPromise });

    const result = await fetchValidationInfo({
      environment,
      BulkDownloadModalValidConsensusGenomeWorkflowRunsQuery: query,
      entityIds: new Set([11, 12]),
      authenticityToken: "token-abc",
    });

    expect(result).toEqual({ fedWorkflowRuns: [] });
    expect(mockFetchQuery).toHaveBeenCalledWith(environment, query, {
      workflowRunIds: ["11", "12"],
      authenticityToken: "token-abc",
    });
  });

  it("sends an empty id list when entityIds is missing", async () => {
    const toPromise = jest.fn().mockResolvedValue(undefined);
    mockFetchQuery.mockReturnValue({ toPromise });

    await fetchValidationInfo({
      environment,
      BulkDownloadModalValidConsensusGenomeWorkflowRunsQuery: query,
      entityIds: undefined,
      authenticityToken: "t",
    });

    expect(mockFetchQuery.mock.calls[0][2]).toEqual({
      workflowRunIds: [],
      authenticityToken: "t",
    });
  });
});

describe("owner-check parsers", () => {
  it("parseRailsIsUserOwnerOfAllObjects passes the flag through and defaults null to false", () => {
    expect(parseRailsIsUserOwnerOfAllObjects(null, null, true)).toBe(true);
    expect(parseRailsIsUserOwnerOfAllObjects(null, null, false)).toBe(false);
    expect(parseRailsIsUserOwnerOfAllObjects(null, null, null)).toBe(false);
  });

  it("parseIsUserOwnerOfAllObjects is false without a current user id", () => {
    expect(
      parseIsUserOwnerOfAllObjects(
        { fedWorkflowRuns: [{ id: "1", ownerUserId: 5, status: "SUCCEEDED" }] },
        null,
      ),
    ).toBe(false);
  });

  it("parseIsUserOwnerOfAllObjects is false without workflow runs", () => {
    expect(parseIsUserOwnerOfAllObjects({}, 5)).toBe(false);
  });

  it("parseIsUserOwnerOfAllObjects requires every run to be owned by the user", () => {
    const runs = [
      { id: "1", ownerUserId: 5, status: "SUCCEEDED" },
      { id: "2", ownerUserId: 5, status: "SUCCEEDED" },
    ];
    expect(parseIsUserOwnerOfAllObjects({ fedWorkflowRuns: runs }, 5)).toBe(
      true,
    );
    expect(
      parseIsUserOwnerOfAllObjects(
        {
          fedWorkflowRuns: [
            ...runs,
            { id: "3", ownerUserId: 9, status: "SUCCEEDED" },
          ],
        },
        5,
      ),
    ).toBe(false);
  });
});

describe("parseValidationInfo", () => {
  it("splits succeeded from failed runs and resolves failed names", () => {
    const selectedObjects = [
      { id: 1, sample: { name: "Sample One" } },
      { id: 2, sample: { name: "Sample Two" } },
    ];
    const result = parseValidationInfo(
      {
        fedWorkflowRuns: [
          { id: "1", ownerUserId: 5, status: "SUCCEEDED" },
          { id: "2", ownerUserId: 5, status: "FAILED" },
        ],
      },
      selectedObjects,
    );
    expect(result.validIds).toEqual(["1"]);
    expect(result.invalidSampleNames).toEqual(["Sample Two"]);
    expect(result.validationError).toBeNull();
  });

  it("falls back to an empty name when the failed run is not in the selection", () => {
    const result = parseValidationInfo(
      {
        fedWorkflowRuns: [{ id: "99", ownerUserId: 5, status: "FAILED" }],
        error: "nope",
      },
      [],
    );
    expect(result.validIds).toEqual([]);
    expect(result.invalidSampleNames).toEqual([""]);
    expect(result.validationError).toBe("nope");
  });

  it("returns empty lists when no runs come back at all", () => {
    const result = parseValidationInfo({}, []);
    expect(result).toEqual({
      validIds: [],
      invalidSampleNames: [],
      validationError: null,
    });
  });
});

describe("DEFAULT_CREATION_ERROR", () => {
  it("is the user-facing fallback error copy", () => {
    expect(DEFAULT_CREATION_ERROR).toBe(
      "An unknown error occurred. Please contact us for help.",
    );
  });
});
