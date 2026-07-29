// Frontend coverage: app/assets/src/components/views/DiscoveryView/DiscoveryDataLayer.ts
// ObjectCollectionView is the paging/caching brain behind every Discovery
// table: it must not re-fetch rows it already holds, must de-duplicate
// in-flight requests for the same index window, and must know when it is still
// loading. Those are the branches driven below, against a mocked discovery_api.
import {
  getDiscoveryProjects,
  getDiscoverySamples,
  getDiscoveryVisualizations,
  getDiscoveryWorkflowRuns,
} from "~/components/views/DiscoveryView/discovery_api";
import {
  DiscoveryDataLayer,
  ObjectCollectionView,
} from "~/components/views/DiscoveryView/DiscoveryDataLayer";

jest.mock("~/components/views/DiscoveryView/discovery_api", () => ({
  getDiscoveryProjects: jest.fn(),
  getDiscoverySamples: jest.fn(),
  getDiscoveryVisualizations: jest.fn(),
  getDiscoveryWorkflowRuns: jest.fn(),
}));

const mocked = (fn: unknown) => fn as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

/**
 * Build a DiscoveryDataLayer whose sample fetch returns `total` sequential
 * objects, honouring the limit/offset it is asked for. Returns the layer plus
 * the raw jest mock so call arguments can be asserted.
 */
const makeLayer = (total = 5) => {
  const allIds = Array.from({ length: total }, (_, i) => i + 1);
  mocked(getDiscoverySamples).mockImplementation(
    async ({ limit, offset, listAllIds }) => ({
      samples: allIds
        .slice(offset, offset + limit)
        .map(id => ({ id, name: `Sample ${id}` })),
      sampleIds: listAllIds ? allIds : null,
    }),
  );
  return new DiscoveryDataLayer("my_data");
};

describe("DiscoveryDataLayer", () => {
  it("creates one collection per entity type, all sharing the layer domain", () => {
    const layer = makeLayer();
    [
      layer.projects,
      layer.samples,
      layer.longReadMngsSamples,
      layer.visualizations,
      layer.amrWorkflowRuns,
      layer.benchmarkWorkflowRuns,
    ].forEach(collection => {
      expect(collection.domain).toBe("my_data");
      expect(collection.entries.size).toBe(0);
    });
    expect(layer.domain).toBe("my_data");
  });

  it("normalizes each fetcher's response into fetchedObjects/fetchedObjectIds", async () => {
    const layer = new DiscoveryDataLayer("public");

    mocked(getDiscoverySamples).mockResolvedValue({
      samples: [{ id: 1 }],
      sampleIds: [1, 2],
    });
    await expect(layer.fetchSamples({ limit: 1 })).resolves.toEqual({
      fetchedObjects: [{ id: 1 }],
      fetchedObjectIds: [1, 2],
    });

    mocked(getDiscoveryProjects).mockResolvedValue({
      projects: [{ id: 3 }],
      projectIds: [3],
    });
    await expect(layer.fetchProjects({})).resolves.toEqual({
      fetchedObjects: [{ id: 3 }],
      fetchedObjectIds: [3],
    });

    mocked(getDiscoveryVisualizations).mockResolvedValue({
      visualizations: [{ id: 4 }],
      visualizationIds: null,
    });
    await expect(layer.fetchVisualizations({})).resolves.toEqual({
      fetchedObjects: [{ id: 4 }],
      fetchedObjectIds: null,
    });

    mocked(getDiscoveryWorkflowRuns).mockResolvedValue({
      workflowRuns: [{ id: 5 }],
      workflowRunIds: [5],
    });
    await expect(layer.fetchWorkflowRuns({})).resolves.toEqual({
      fetchedObjects: [{ id: 5 }],
      fetchedObjectIds: [5],
    });
  });

  it("lets a collection be updated directly and read back through a view", () => {
    const layer = makeLayer();
    layer.samples.update({ id: 99, name: "Manually cached" });
    expect(layer.samples.entries.size).toBe(1);

    const view = layer.samples.createView({ conditions: {} } as $TSFixMe);
    expect(view).toBeInstanceOf(ObjectCollectionView);
    expect(view.get(99)).toEqual({ id: 99, name: "Manually cached" });
    // Nothing has been fetched, so the ordered id list is still empty.
    expect(view.getIds()).toEqual([]);
    expect(view.length).toBe(0);
    expect(view.loaded).toEqual([]);
    expect(view.isLoading()).toBe(true);
  });
});

describe("ObjectCollectionView paging", () => {
  it("fetches the first page, records ids, and reports itself as loaded", async () => {
    const layer = makeLayer(5);
    const onViewChange = jest.fn();
    const view = layer.samples.createView({
      conditions: { filters: { host: [1] } },
      pageSize: 2,
      onViewChange,
    } as $TSFixMe);

    const rows = await view.loadPage(0);

    expect(rows).toEqual([
      { id: 1, name: "Sample 1" },
      { id: 2, name: "Sample 2" },
    ]);
    // Page 0 with pageSize 2 -> indices 0..1 -> limit 2, offset 0, and
    // listAllIds true because no id list is known yet.
    expect(mocked(getDiscoverySamples)).toHaveBeenCalledWith({
      domain: "my_data",
      filters: { host: [1] },
      limit: 2,
      offset: 0,
      listAllIds: true,
    });
    expect(view.getIds()).toEqual([1, 2, 3, 4, 5]);
    expect(view.length).toBe(5);
    expect(view.isLoading()).toBe(false);
    expect(onViewChange).toHaveBeenCalledTimes(1);
    // Only the two fetched rows are in the cache so far.
    expect(view.loaded).toEqual([
      { id: 1, name: "Sample 1" },
      { id: 2, name: "Sample 2" },
    ]);
  });

  it("uses DEFAULT_PAGE_SIZE when no pageSize is supplied", async () => {
    const layer = makeLayer(50);
    const view = layer.samples.createView({} as $TSFixMe);

    await view.loadPage(0);

    // DEFAULT_PAGE_SIZE is 20 -> indices 0..19.
    expect(mocked(getDiscoverySamples).mock.calls[0][0]).toMatchObject({
      limit: 20,
      offset: 0,
    });
  });

  it("does not re-fetch rows it already has cached", async () => {
    const layer = makeLayer(5);
    const view = layer.samples.createView({ pageSize: 2 } as $TSFixMe);

    await view.handleLoadObjectRows({ startIndex: 0, stopIndex: 1 });
    expect(mocked(getDiscoverySamples)).toHaveBeenCalledTimes(1);

    // Same window again: every index is already cached, so no network call.
    const rows = await view.handleLoadObjectRows({
      startIndex: 0,
      stopIndex: 1,
    });
    expect(mocked(getDiscoverySamples)).toHaveBeenCalledTimes(1);
    expect(rows).toEqual([
      { id: 1, name: "Sample 1" },
      { id: 2, name: "Sample 2" },
    ]);
  });

  it("clamps the requested window to the known number of ids", async () => {
    const layer = makeLayer(3);
    const view = layer.samples.createView({ pageSize: 3 } as $TSFixMe);

    await view.handleLoadObjectRows({ startIndex: 0, stopIndex: 2 });
    mocked(getDiscoverySamples).mockClear();

    // Ask well past the end: minStopIndex clamps to the last known index and
    // everything is already cached, so nothing is fetched.
    const rows = await view.handleLoadObjectRows({
      startIndex: 0,
      stopIndex: 99,
    });
    expect(mocked(getDiscoverySamples)).not.toHaveBeenCalled();
    expect(rows).toHaveLength(3);
  });

  it("de-duplicates concurrent requests for the identical index window", async () => {
    const layer = makeLayer(5);
    const view = layer.samples.createView({ pageSize: 2 } as $TSFixMe);

    const [a, b] = await Promise.all([
      view.handleLoadObjectRows({ startIndex: 0, stopIndex: 1 }),
      view.handleLoadObjectRows({ startIndex: 0, stopIndex: 1 }),
    ]);

    expect(mocked(getDiscoverySamples)).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  it("fetches only the missing rows on a subsequent overlapping page", async () => {
    const layer = makeLayer(5);
    const view = layer.samples.createView({ pageSize: 2 } as $TSFixMe);

    await view.handleLoadObjectRows({ startIndex: 0, stopIndex: 1 });
    mocked(getDiscoverySamples).mockClear();

    // Indices 1..3: index 1 is cached, so only 2..3 are requested.
    const rows = await view.handleLoadObjectRows({
      startIndex: 1,
      stopIndex: 3,
    });
    expect(mocked(getDiscoverySamples)).toHaveBeenCalledWith({
      domain: "my_data",
      limit: 2,
      offset: 2,
      // Ids are already known, so it no longer asks for the whole id list.
      listAllIds: false,
    });
    expect(rows.map((r: $TSFixMe) => r.id)).toEqual([2, 3, 4]);
  });

  // The very first fetch returning rows but no id list leaves `_orderedIds` null.
  // loadPage now handles that gracefully (getIds falls back to []) instead of
  // throwing -- the fix this test previously anticipated has since landed.
  it("clears the loading flag and resolves gracefully on the id-less first response", async () => {
    mocked(getDiscoverySamples).mockResolvedValue({
      samples: [{ id: 1 }],
      sampleIds: null,
    });
    const layer = new DiscoveryDataLayer("public");
    const onViewChange = jest.fn();
    const view = layer.samples.createView({
      pageSize: 1,
      onViewChange,
    } as $TSFixMe);

    await view.loadPage(0);

    expect(view.isLoading()).toBe(false);
    expect(view.getIds()).toEqual([]);
    // onViewChange only fires when a new id list arrives.
    expect(onViewChange).not.toHaveBeenCalled();
    // The row itself was still cached on the collection.
    expect(layer.samples.entries.get(1 as $TSFixMe)).toEqual({ id: 1 });
  });

  it("converts ids to strings when shouldConvertIdToString is set", async () => {
    const layer = makeLayer(3);
    const view = layer.samples.createView({
      pageSize: 3,
      shouldConvertIdToString: true,
    } as $TSFixMe);

    await view.loadPage(0);

    expect(view.getIds()).toEqual(["1", "2", "3"]);
    expect(view.get("1" as $TSFixMe)).toEqual({ id: "1", name: "Sample 1" });
    expect(view.get(1 as $TSFixMe)).toBeUndefined();
  });

  it("returns the inclusive id slice between two ids, in either order", async () => {
    const layer = makeLayer(5);
    const view = layer.samples.createView({ pageSize: 5 } as $TSFixMe);
    await view.loadPage(0);

    expect(view.getIntermediateIds({ id1: 2, id2: 4 })).toEqual([2, 3, 4]);
    // Order of the two anchors does not matter.
    expect(view.getIntermediateIds({ id1: 4, id2: 2 })).toEqual([2, 3, 4]);
    // Same id twice yields just that id.
    expect(view.getIntermediateIds({ id1: 3, id2: 3 })).toEqual([3]);
  });

  it("resets back to a loading, id-less state and can eagerly reload", async () => {
    const layer = makeLayer(5);
    const view = layer.samples.createView({ pageSize: 2 } as $TSFixMe);
    await view.loadPage(0);
    expect(view.isLoading()).toBe(false);
    mocked(getDiscoverySamples).mockClear();

    // Plain reset: no fetch, back to loading with no ids.
    view.reset();
    expect(view.isLoading()).toBe(true);
    expect(view.getIds()).toEqual([]);
    expect(view.length).toBe(0);
    expect(mocked(getDiscoverySamples)).not.toHaveBeenCalled();

    // Reset with loadFirstPage: new conditions are forwarded to the fetcher.
    view.reset({ conditions: { search: "abc" }, loadFirstPage: true });
    // Let the kicked-off load settle.
    await new Promise(resolve => setImmediate(resolve));

    expect(mocked(getDiscoverySamples)).toHaveBeenCalledWith(
      expect.objectContaining({ search: "abc", offset: 0, limit: 2 }),
    );
    expect(view.isLoading()).toBe(false);
  });

  it("clears the in-flight request tracker on reset so the same window refetches", async () => {
    const layer = makeLayer(5);
    const view = layer.samples.createView({ pageSize: 2 } as $TSFixMe);

    await view.handleLoadObjectRows({ startIndex: 0, stopIndex: 1 });
    expect(mocked(getDiscoverySamples)).toHaveBeenCalledTimes(1);

    view.reset({ conditions: {} });
    await view.handleLoadObjectRows({ startIndex: 0, stopIndex: 1 });

    // Cache of entries survives, but the id list was dropped, so it must
    // re-request the id list for the same window.
    expect(mocked(getDiscoverySamples)).toHaveBeenCalledTimes(2);
    expect(mocked(getDiscoverySamples).mock.calls[1][0]).toMatchObject({
      listAllIds: true,
    });
  });
});
