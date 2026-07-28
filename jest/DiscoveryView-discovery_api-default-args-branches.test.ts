// Remaining branch coverage for app/assets/src/components/views/DiscoveryView/discovery_api.ts.
//
// getDiscoverySamples / getDiscoveryProjects / getDiscoveryVisualizations each
// destructure an argument object that itself defaults to `{}`, with per-key
// defaults inside it (`limit = 100`, `offset = 0`, `listAllIds = false`).
// Existing tests always pass an argument object and always name listAllIds, so
// neither the whole-argument default nor the per-key defaults were ever taken.
// These tests call each function with the keys omitted and with no argument at
// all, asserting that the defaults reach the underlying ~/api call and that the
// id-collection result flips to null (the `listAllIds ? ... : null` false arm the
// default drives).
import { getProjects, getSamples, getVisualizations } from "~/api";
import {
  getDiscoveryProjects,
  getDiscoverySamples,
  getDiscoveryVisualizations,
} from "~/components/views/DiscoveryView/discovery_api";

jest.mock("~/api", () => ({
  getProjectDimensions: jest.fn(),
  getProjects: jest.fn(),
  getSampleDimensions: jest.fn(),
  getSamples: jest.fn(),
  getSamplesLocations: jest.fn(),
  getSampleStats: jest.fn(),
  getVisualizations: jest.fn(),
  getWorkflowRuns: jest.fn(),
}));

const mocked = (fn: unknown) => fn as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("getDiscoverySamples default arguments", () => {
  it("defaults limit/offset/listAllIds when the caller omits them", async () => {
    mocked(getSamples).mockResolvedValue({
      samples: [],
      all_samples_ids: [1, 2, 3],
    });

    const result = await getDiscoverySamples({ domain: "my_data" });

    expect(mocked(getSamples)).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: "my_data",
        limit: 100,
        offset: 0,
        listAllIds: false,
      }),
    );
    // getDiscoverySamples passes the server's id list straight through.
    expect(result.sampleIds).toEqual([1, 2, 3]);
    expect(result.samples).toEqual([]);
  });

  it("forwards an explicit listAllIds instead of the default", async () => {
    mocked(getSamples).mockResolvedValue({ samples: [], all_samples_ids: [] });

    await getDiscoverySamples({
      domain: "my_data",
      listAllIds: true,
      limit: 5,
    });

    expect(mocked(getSamples)).toHaveBeenCalledWith(
      expect.objectContaining({ listAllIds: true, limit: 5, offset: 0 }),
    );
  });

  it("tolerates being called with no argument object at all", async () => {
    mocked(getSamples).mockResolvedValue({ samples: [], all_samples_ids: [] });

    // The parameter itself defaults to {}, so destructuring must not throw.
    const result = await getDiscoverySamples();

    expect(mocked(getSamples)).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: undefined,
        limit: 100,
        offset: 0,
        listAllIds: false,
      }),
    );
    expect(result.samples).toEqual([]);
  });
});

describe("getDiscoveryProjects default arguments", () => {
  it("defaults limit/offset/listAllIds when the caller omits them", async () => {
    mocked(getProjects).mockResolvedValue({
      projects: [{ id: 7 }],
      all_projects_ids: [7],
    });

    const result = await getDiscoveryProjects({ domain: "public" });

    expect(mocked(getProjects)).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: "public",
        limit: 100,
        offset: 0,
        listAllIds: false,
      }),
    );
    expect(result.projects).toEqual([{ id: 7 }]);
    expect(result.projectIds).toEqual([7]);
  });

  it("tolerates being called with no argument object at all", async () => {
    mocked(getProjects).mockResolvedValue({
      projects: [],
      all_projects_ids: [],
    });

    await getDiscoveryProjects();

    expect(mocked(getProjects)).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 100, offset: 0, listAllIds: false }),
    );
  });
});

describe("getDiscoveryVisualizations default arguments", () => {
  it("defaults listAllIds to false, so no visualization ids are collected", async () => {
    mocked(getVisualizations).mockResolvedValue([{ id: 11 }, { id: 12 }]);

    const result = await getDiscoveryVisualizations({ domain: "public" });

    expect(mocked(getVisualizations)).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 100, offset: 0, listAllIds: false }),
    );
    expect(result.visualizations).toHaveLength(2);
    // listAllIds defaulted to false -> the id list is null, not an array.
    expect(result.visualizationIds).toBeNull();
  });

  it("collects visualization ids once listAllIds is passed explicitly", async () => {
    mocked(getVisualizations).mockResolvedValue([{ id: 11 }, { id: 12 }]);

    const result = await getDiscoveryVisualizations({
      domain: "public",
      listAllIds: true,
    });

    expect(result.visualizationIds).toEqual([11, 12]);
  });

  it("tolerates being called with no argument object at all", async () => {
    mocked(getVisualizations).mockResolvedValue([]);

    const result = await getDiscoveryVisualizations();

    expect(mocked(getVisualizations)).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 100, offset: 0, listAllIds: false }),
    );
    expect(result.visualizationIds).toBeNull();
  });
});
