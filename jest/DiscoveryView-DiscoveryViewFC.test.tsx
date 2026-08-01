// Coverage: app/assets/src/components/views/DiscoveryView/DiscoveryViewFC.tsx
//
// DiscoveryViewFC is the NextGen/Relay data layer for <DiscoveryView>: it owns
// the workflowRuns / sequencingReads / consensusGenomes query builders, the
// join+sort logic between those three responses, the row transforms, the
// aggregate + total-count parsers and the CG page cache. <DiscoveryView>
// itself is stubbed so the callbacks it is handed can be invoked directly, and
// relay's fetchQuery is stubbed with a per-query-name response table so every
// filter/sort/error branch can be driven from the test.
import { render, waitFor } from "@testing-library/react";
import { UserContext } from "~/components/common/UserContext";
import { ActionType, GlobalContext } from "~/globalContext/reducer";

const mockFetchQuery = jest.fn();
const mockGetProjects = jest.fn();
const mockLogError = jest.fn();
const capturedProps: $TSFixMe[] = [];

jest.mock("relay-runtime", () => ({
  __esModule: true,
  fetchQuery: (...args: $TSFixMe[]) => mockFetchQuery(...args),
  graphql: (strings: $TSFixMe) => strings,
}));

jest.mock("react-relay", () => ({
  __esModule: true,
  useRelayEnvironment: () => "TEST_ENVIRONMENT",
}));

jest.mock("~/api", () => ({
  __esModule: true,
  getProjects: (...args: $TSFixMe[]) => mockGetProjects(...args),
}));

jest.mock("~/components/utils/logUtil", () => ({
  __esModule: true,
  logError: (...args: $TSFixMe[]) => mockLogError(...args),
  // integration added isTransientNetworkError (DiscoveryViewFC error handling calls it); stub non-transient so error paths still log.
  isTransientNetworkError: () => false,
}));

jest.mock("~/components/views/DiscoveryView/DiscoveryView", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    DiscoveryView: (props: $TSFixMe) => {
      capturedProps.push(props);
      return ReactLib.createElement("div", { "data-testid": "discovery-view" });
    },
  };
});

import { DiscoveryViewFC } from "~/components/views/DiscoveryView/DiscoveryViewFC";

// ---------------------------------------------------------------------------
// fetchQuery plumbing
// ---------------------------------------------------------------------------

// Responses keyed by the generated relay operation name.
let responses: Record<string, $TSFixMe> = {};

const queryName = (taggedNode: $TSFixMe): string => {
  const node = typeof taggedNode === "function" ? taggedNode() : taggedNode;
  const inner = node?.default ?? node;
  return inner?.params?.name ?? inner?.operation?.name ?? "UNKNOWN";
};

const callsFor = (name: string) =>
  mockFetchQuery.mock.calls.filter(call => queryName(call[1]) === name);

const inputFor = (name: string, index = 0) => callsFor(name)[index]?.[2]?.input;

const WORKFLOWS = "DiscoveryViewFCWorkflowsQuery";
const SEQ_READ_IDS = "DiscoveryViewFCSequencingReadIdsQuery";
const CG_IDS = "DiscoveryViewFCConsensusGenomeIdsQuery";
const SEQ_READS = "DiscoveryViewFCSequencingReadsQuery";
const AGGREGATE = "DiscoveryViewFCFedWorkflowRunsAggregateQuery";
const TOTAL_COUNT = "DiscoveryViewFCFedWorkflowsTotalCountQuery";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const workflowRun = (overrides: $TSFixMe = {}) => ({
  id: "wr1",
  startedAt: "2024-01-01",
  status: "SUCCEEDED",
  errorLabel: null,
  rawInputsJson: JSON.stringify({ creation_source: "SARS-CoV-2 Upload" }),
  workflowVersion: { version: "1.2.3", workflow: { name: "consensus-genome" } },
  entityInputs: {
    edges: [{ node: { inputEntityId: "sr1", entityType: "sequencing_read" } }],
  },
  ...overrides,
});

const sequencingRead = (overrides: $TSFixMe = {}) => ({
  id: "sr1",
  nucleicAcid: "DNA",
  protocol: "artic_v4",
  medakaModel: "r941",
  technology: "Illumina",
  taxon: { name: "Betacoronavirus" },
  sample: {
    railsSampleId: 55,
    name: "Sample A",
    notes: "a note",
    collectionLocation: "California",
    sampleType: "Nasal",
    waterControl: false,
    uploadError: null,
    hostOrganism: { name: "Human" },
    collection: { name: "Project X", public: true },
    ownerUserId: 3,
    ownerUserName: "Ada",
    metadatas: { edges: [{ node: { fieldName: "sex", value: "Female" } }] },
  },
  consensusGenomes: { edges: [] },
  ...overrides,
});

const emptyFilters = {} as $TSFixMe;

const conditions = (overrides: $TSFixMe = {}) =>
  ({
    projectId: undefined,
    search: undefined,
    orderBy: undefined,
    orderDir: undefined,
    filters: emptyFilters,
    nextGenFilters: { taxonNames: [] },
    ...overrides,
  } as $TSFixMe);

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const globalContextDispatch = jest.fn();

const renderFC = (props: $TSFixMe = {}, withGlobalContext = true) => {
  const element = (
    <UserContext.Provider
      value={{ admin: true, allowedFeatures: ["cool"] } as $TSFixMe}
    >
      <DiscoveryViewFC domain="my_data" {...props} />
    </UserContext.Provider>
  );
  render(
    withGlobalContext ? (
      <GlobalContext.Provider
        value={{ globalContextState: {}, globalContextDispatch } as $TSFixMe}
      >
        {element}
      </GlobalContext.Provider>
    ) : (
      element
    ),
  );
  return () => capturedProps[capturedProps.length - 1];
};

beforeEach(() => {
  jest.clearAllMocks();
  capturedProps.length = 0;
  responses = {};
  mockGetProjects.mockResolvedValue({ all_projects_ids: [1, 2] });
  mockFetchQuery.mockImplementation((_env, node) => ({
    toPromise: () => Promise.resolve(responses[queryName(node)]),
  }));
});

describe("DiscoveryViewFC prop plumbing", () => {
  it("passes user context and its own callbacks down to DiscoveryView", () => {
    const props = renderFC()();
    expect(props.isAdmin).toBe(true);
    expect(props.allowedFeatures).toEqual(["cool"]);
    expect(props.domain).toBe("my_data");
    expect(props.cgWorkflowIds).toBeUndefined();
    expect(props.cgRows).toEqual([]);
    expect(props.workflowRunsProjectAggregates).toBeUndefined();
    expect(typeof props.fetchCgPage).toBe("function");
    expect(typeof props.fetchNextGenWorkflowRuns).toBe("function");
    expect(typeof props.fetchTotalWorkflowCounts).toBe("function");
  });
});

describe("DiscoveryViewFC updateDiscoveryProjectId", () => {
  it("dispatches the parsed project id", () => {
    renderFC()().updateDiscoveryProjectId("42");
    expect(globalContextDispatch).toHaveBeenCalledWith({
      type: ActionType.UPDATE_DISCOVERY_PROJECT_IDS,
      payload: 42,
    });
  });

  it("dispatches null when the project is cleared", () => {
    renderFC()().updateDiscoveryProjectId(null);
    expect(globalContextDispatch).toHaveBeenCalledWith({
      type: ActionType.UPDATE_DISCOVERY_PROJECT_IDS,
      payload: null,
    });
  });

  it("is a no-op without a global context provider", () => {
    const latest = renderFC({}, false);
    expect(() => latest().updateDiscoveryProjectId("42")).not.toThrow();
    expect(globalContextDispatch).not.toHaveBeenCalled();
  });
});

describe("DiscoveryViewFC fetchTotalWorkflowCounts", () => {
  const totalCountResponse = (aggregate: $TSFixMe) => ({
    fedWorkflowRunsAggregateTotalCount: { aggregate },
  });

  it("scopes the count to a single project without hitting Rails", async () => {
    responses[TOTAL_COUNT] = totalCountResponse([
      {
        count: 3,
        groupBy: {
          workflowVersion: { workflow: { name: "consensus-genome" } },
        },
      },
    ]);
    const counts = await renderFC()().fetchTotalWorkflowCounts("5");

    expect(mockGetProjects).not.toHaveBeenCalled();
    expect(counts).toEqual({ "consensus-genome": 3 });
    const input = inputFor(TOTAL_COUNT);
    expect(input.where.collectionId).toEqual({ _in: [5] });
    expect(input.where.deprecatedById).toEqual({ _is_null: true });
    expect(input.todoRemove).toEqual({ domain: "my_data", projectId: "5" });
  });

  it("falls back to the user's project ids when no project is selected", async () => {
    responses[TOTAL_COUNT] = totalCountResponse([]);
    const counts = await renderFC()().fetchTotalWorkflowCounts();

    expect(mockGetProjects).toHaveBeenCalledWith({
      domain: "my_data",
      filters: { visibility: undefined },
      limit: 0,
      offset: 0,
      listAllIds: true,
    });
    expect(inputFor(TOTAL_COUNT).where.collectionId).toEqual({ _in: [1, 2] });
    expect(counts).toEqual({});
  });

  it("skips aggregate rows with no workflow name", async () => {
    responses[TOTAL_COUNT] = totalCountResponse([
      { count: 1, groupBy: null },
      { count: 2, groupBy: { workflowVersion: null } },
      {
        count: 9,
        groupBy: {
          workflowVersion: { workflow: { name: "consensus-genome" } },
        },
      },
      null,
    ]);
    const counts = await renderFC()().fetchTotalWorkflowCounts("5");
    expect(counts).toEqual({ "consensus-genome": 9 });
  });

  // SMP-1619: a missing aggregate is benign (empty project / partial response),
  // so it must resolve to an empty result instead of throwing and crashing the
  // view. Fatal GraphQL errors are handled separately at the relay layer.
  it("returns empty counts when the total-count response has no aggregate", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    responses[TOTAL_COUNT] = { fedWorkflowRunsAggregateTotalCount: null };
    await expect(
      renderFC()().fetchTotalWorkflowCounts("5"),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("returns empty counts when the total-count response is empty", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    responses[TOTAL_COUNT] = {};
    await expect(
      renderFC()().fetchTotalWorkflowCounts("5"),
    ).resolves.toBeUndefined();
    warnSpy.mockRestore();
  });
});

describe("DiscoveryViewFC workflow-run fetching", () => {
  const waitForRunIds = async (latest: () => $TSFixMe) => {
    await waitFor(() => expect(latest().cgWorkflowIds).toBeDefined());
    return latest().cgWorkflowIds;
  };

  it("fetches project ids, then workflow runs, then the first CG page", async () => {
    responses[WORKFLOWS] = { fedWorkflowRuns: [workflowRun()] };
    responses[SEQ_READS] = { fedSequencingReads: [sequencingRead()] };

    const latest = renderFC();
    latest().fetchNextGenWorkflowRuns(conditions());

    expect(await waitForRunIds(latest)).toEqual(["wr1"]);
    expect(mockGetProjects).toHaveBeenCalledTimes(1);

    const input = inputFor(WORKFLOWS);
    expect(input.where.collectionId).toEqual({ _in: [1, 2] });
    expect(input.where.workflowVersion).toEqual({
      workflow: { name: { _in: ["consensus-genome"] } },
    });
    // No orderBy defaults to newest-first on startedAt.
    expect(input.orderByArray).toEqual([{ startedAt: "desc_nulls_last" }]);
    // No sample filters and no sequencing-read sort, so no ids query is sent.
    expect(callsFor(SEQ_READ_IDS)).toHaveLength(0);

    await waitFor(() => expect(latest().cgRows).toHaveLength(1));
    const row = latest().cgRows[0];
    expect(row.id).toBe("wr1");
    expect(row.status).toBe("complete");
    expect(row.wdl_version).toBe("1.2");
    expect(row.creation_source).toBe("SARS-CoV-2 Upload");
    expect(row.sample.name).toBe("Sample A");
    expect(row.sample.id).toBe("55");
    expect(row.host).toBe("Human");
    expect(row.water_control).toBe("No");
    expect(row.wetlabProtocol).toBe("ARTIC V4");
    expect(row.sex).toBe("Female");
    // No workflow accession input, so the entity taxon is used.
    expect(row.referenceAccession).toEqual({ taxonName: "Betacoronavirus" });
  });

  it("skips the Rails project lookup for a single project", async () => {
    responses[WORKFLOWS] = { fedWorkflowRuns: [] };
    responses[SEQ_READS] = { fedSequencingReads: [] };

    const latest = renderFC();
    latest().fetchNextGenWorkflowRuns(conditions({ projectId: "8" }));

    await waitForRunIds(latest);
    expect(mockGetProjects).not.toHaveBeenCalled();
    expect(inputFor(WORKFLOWS).where.collectionId).toEqual({ _in: [8] });
  });

  it("skips the Rails project lookup on the all-data domain", async () => {
    responses[WORKFLOWS] = { fedWorkflowRuns: [] };
    responses[SEQ_READS] = { fedSequencingReads: [] };

    const latest = renderFC({ domain: "all_data" });
    latest().fetchNextGenWorkflowRuns(conditions());

    await waitForRunIds(latest);
    expect(mockGetProjects).not.toHaveBeenCalled();
    expect(inputFor(WORKFLOWS).where.collectionId).toBeUndefined();
  });

  it("intersects the selected project with the visible project ids", async () => {
    responses[WORKFLOWS] = { fedWorkflowRuns: [] };
    responses[SEQ_READS] = { fedSequencingReads: [] };

    const latest = renderFC();
    latest().fetchNextGenWorkflowRuns(
      conditions({ projectId: "2", filters: { visibility: "private" } }),
    );

    await waitForRunIds(latest);
    // Visibility always forces the Rails lookup, even with a project selected.
    expect(mockGetProjects).toHaveBeenCalledWith(
      expect.objectContaining({ filters: { visibility: "private" } }),
    );
    expect(inputFor(WORKFLOWS).where.collectionId).toEqual({ _in: [2] });
  });

  it("produces an empty collection filter when the project is not visible", async () => {
    responses[WORKFLOWS] = { fedWorkflowRuns: [] };
    responses[SEQ_READS] = { fedSequencingReads: [] };

    const latest = renderFC();
    latest().fetchNextGenWorkflowRuns(
      conditions({ projectId: "99", filters: { visibility: "public" } }),
    );

    await waitForRunIds(latest);
    expect(inputFor(WORKFLOWS).where.collectionId).toEqual({ _in: [] });
  });

  it("applies the startedAt NextGen filter when given", async () => {
    responses[WORKFLOWS] = { fedWorkflowRuns: [] };
    responses[SEQ_READS] = { fedSequencingReads: [] };

    const latest = renderFC();
    latest().fetchNextGenWorkflowRuns(
      conditions({
        projectId: "8",
        nextGenFilters: { taxonNames: [], startedAtIso: "2024-05-01" },
      }),
    );

    await waitForRunIds(latest);
    expect(inputFor(WORKFLOWS).where.startedAt).toEqual({
      _gte: "2024-05-01",
    });
  });

  it("logs an error and leaves the ids unset when the workflows query fails", async () => {
    responses[WORKFLOWS] = { fedWorkflowRuns: null };

    const latest = renderFC();
    latest().fetchNextGenWorkflowRuns(conditions({ projectId: "8" }));

    await waitFor(() => expect(mockLogError).toHaveBeenCalled());
    expect(mockLogError.mock.calls[0][0].message).toContain(
      "fetchCgFilteredWorkflowRuns() failed",
    );
    expect(latest().cgWorkflowIds).toBeUndefined();
  });
});

describe("DiscoveryViewFC sample filters", () => {
  it("builds a regex name filter plus location/host/tissue filters", async () => {
    responses[WORKFLOWS] = { fedWorkflowRuns: [workflowRun()] };
    responses[SEQ_READ_IDS] = { fedSequencingReads: [{ id: "sr1" }] };
    responses[SEQ_READS] = { fedSequencingReads: [sequencingRead()] };

    const latest = renderFC();
    latest().fetchNextGenWorkflowRuns(
      conditions({
        projectId: "8",
        search: "  covid  swab ",
        filters: {
          locationV2: ["California"],
          host: [1, 2],
          tissue: ["Nasal"],
        },
      }),
    );

    await waitFor(() => expect(latest().cgWorkflowIds).toEqual(["wr1"]));
    const input = inputFor(SEQ_READ_IDS);
    expect(input.where.sample.name._iregex).toBe("(?=.*covid)(?=.*swab).*");
    expect(input.where.sample.collectionLocation).toEqual({
      _in: ["California"],
    });
    // Host ids are stringified for NextGen.
    expect(input.where.sample.hostOrganism).toEqual({
      name: { _in: ["1", "2"] },
    });
    expect(input.where.sample.sampleType).toEqual({ _in: ["Nasal"] });
    expect(input.orderByArray).toBeUndefined();
  });

  it("drops workflow runs whose sequencing read was filtered out", async () => {
    responses[WORKFLOWS] = {
      fedWorkflowRuns: [
        workflowRun(),
        workflowRun({
          id: "wr2",
          entityInputs: {
            edges: [{ node: { inputEntityId: "sr2" } }],
          },
        }),
      ],
    };
    responses[SEQ_READ_IDS] = { fedSequencingReads: [{ id: "sr2" }] };
    responses[SEQ_READS] = { fedSequencingReads: [] };

    const latest = renderFC();
    latest().fetchNextGenWorkflowRuns(
      conditions({ projectId: "8", search: "swab" }),
    );

    await waitFor(() => expect(latest().cgWorkflowIds).toEqual(["wr2"]));
  });

  it("unions both taxon queries when a taxon filter is applied", async () => {
    responses[WORKFLOWS] = { fedWorkflowRuns: [workflowRun()] };
    responses[SEQ_READ_IDS] = { fedSequencingReads: [{ id: "sr1" }] };
    responses[SEQ_READS] = { fedSequencingReads: [] };

    const latest = renderFC();
    latest().fetchNextGenWorkflowRuns(
      conditions({
        projectId: "8",
        nextGenFilters: { taxonNames: ["Betacoronavirus"] },
      }),
    );

    await waitFor(() => expect(latest().cgWorkflowIds).toEqual(["wr1"]));
    // Two sequencing-read id queries: by taxon, and by CG producing run.
    expect(callsFor(SEQ_READ_IDS)).toHaveLength(2);
    expect(inputFor(SEQ_READ_IDS, 0).where.taxon).toEqual({
      name: { _in: ["Betacoronavirus"] },
    });
    expect(inputFor(SEQ_READ_IDS, 1).where.consensusGenomes).toEqual({
      producingRunId: { _in: ["wr1"] },
      taxon: { name: { _in: ["Betacoronavirus"] } },
    });
  });

  it("logs an error when one of the taxon queries comes back empty", async () => {
    responses[WORKFLOWS] = { fedWorkflowRuns: [workflowRun()] };
    responses[SEQ_READ_IDS] = { fedSequencingReads: null };

    const latest = renderFC();
    latest().fetchNextGenWorkflowRuns(
      conditions({
        projectId: "8",
        nextGenFilters: { taxonNames: ["Betacoronavirus"] },
      }),
    );

    await waitFor(() => expect(mockLogError).toHaveBeenCalled());
    expect(latest().cgWorkflowIds).toBeUndefined();
  });
});

describe("DiscoveryViewFC sorting", () => {
  it("sorts by a workflow field", async () => {
    responses[WORKFLOWS] = { fedWorkflowRuns: [] };
    responses[SEQ_READS] = { fedSequencingReads: [] };

    const latest = renderFC();
    latest().fetchNextGenWorkflowRuns(
      conditions({ projectId: "8", orderBy: "wdl_version", orderDir: "ASC" }),
    );

    await waitFor(() => expect(latest().cgWorkflowIds).toEqual([]));
    expect(inputFor(WORKFLOWS).orderByArray).toEqual([
      { workflowVersion: { version: "asc_nulls_first" } },
    ]);
    expect(callsFor(SEQ_READ_IDS)).toHaveLength(0);
  });

  it("orders the runs by the sequencing-read response when sorting by sample", async () => {
    responses[WORKFLOWS] = {
      fedWorkflowRuns: [
        workflowRun({
          id: "wrA",
          entityInputs: { edges: [{ node: { inputEntityId: "srA" } }] },
        }),
        workflowRun({
          id: "wrB",
          entityInputs: { edges: [{ node: { inputEntityId: "srB" } }] },
        }),
        // No entity input at all: dropped from the sequencing-read index.
        workflowRun({ id: "wrC", entityInputs: { edges: [] } }),
      ],
    };
    responses[SEQ_READ_IDS] = {
      fedSequencingReads: [{ id: "srB" }, { id: "srA" }, { id: "srZ" }],
    };
    responses[SEQ_READS] = { fedSequencingReads: [] };

    const latest = renderFC();
    latest().fetchNextGenWorkflowRuns(
      conditions({ projectId: "8", orderBy: "sample", orderDir: "ASC" }),
    );

    await waitFor(() => expect(latest().cgWorkflowIds).toEqual(["wrB", "wrA"]));
    expect(inputFor(SEQ_READ_IDS).orderByArray).toEqual([
      { sample: { name: "asc_nulls_first" } },
    ]);
  });

  it("maps the remaining sequencing-read sort keys", async () => {
    responses[WORKFLOWS] = { fedWorkflowRuns: [] };
    responses[SEQ_READ_IDS] = { fedSequencingReads: [] };
    responses[SEQ_READS] = { fedSequencingReads: [] };

    const latest = renderFC();
    for (const orderBy of [
      "technology",
      "wetlabProtocol",
      "host",
      "collection_date",
    ]) {
      latest().fetchNextGenWorkflowRuns(
        conditions({ projectId: "8", orderBy, orderDir: "DESC" }),
      );
      // eslint-disable-next-line no-await-in-loop
      await waitFor(() => expect(latest().cgWorkflowIds).toEqual([]));
    }

    const orderBys = callsFor(SEQ_READ_IDS).map(
      call => call[2].input.orderByArray,
    );
    expect(orderBys[0]).toEqual([{ technology: "desc_nulls_last" }]);
    expect(orderBys[1]).toEqual([{ protocol: "desc_nulls_last" }]);
    expect(orderBys[2]).toEqual([
      { sample: { hostOrganism: { name: "desc_nulls_last" } } },
    ]);
    // Unknown keys are treated as custom metadata fields.
    expect(orderBys[3]).toEqual([
      {
        sample: {
          metadata: { fieldName: "collection_date", dir: "desc_nulls_last" },
        },
      },
    ]);
  });

  it("puts runs with a consensus genome last when sorting ascending by a CG metric", async () => {
    responses[WORKFLOWS] = {
      fedWorkflowRuns: [
        workflowRun({
          id: "wrA",
          entityInputs: { edges: [{ node: { inputEntityId: "srA" } }] },
        }),
        workflowRun({
          id: "wrB",
          entityInputs: { edges: [{ node: { inputEntityId: "srB" } }] },
        }),
      ],
    };
    responses[CG_IDS] = {
      fedConsensusGenomes: [
        { producingRunId: "wrB" },
        { producingRunId: null },
      ],
    };
    responses[SEQ_READS] = { fedSequencingReads: [] };

    const latest = renderFC();
    latest().fetchNextGenWorkflowRuns(
      conditions({ projectId: "8", orderBy: "coverageDepth", orderDir: "ASC" }),
    );

    await waitFor(() => expect(latest().cgWorkflowIds).toEqual(["wrA", "wrB"]));
    expect(inputFor(CG_IDS).orderBy).toEqual([
      { metrics: { coverageDepth: "asc_nulls_first" } },
    ]);
    expect(inputFor(CG_IDS).where).toEqual({ collectionId: { _in: [8] } });
  });

  it("puts runs with a consensus genome first when sorting descending", async () => {
    responses[WORKFLOWS] = {
      fedWorkflowRuns: [
        workflowRun({
          id: "wrA",
          entityInputs: { edges: [{ node: { inputEntityId: "srA" } }] },
        }),
        workflowRun({
          id: "wrB",
          entityInputs: { edges: [{ node: { inputEntityId: "srB" } }] },
        }),
      ],
    };
    responses[CG_IDS] = { fedConsensusGenomes: [{ producingRunId: "wrB" }] };
    responses[SEQ_READS] = { fedSequencingReads: [] };

    const latest = renderFC();
    latest().fetchNextGenWorkflowRuns(
      conditions({
        projectId: "8",
        orderBy: "referenceAccessionLength",
        orderDir: "DESC",
      }),
    );

    await waitFor(() => expect(latest().cgWorkflowIds).toEqual(["wrB", "wrA"]));
    expect(inputFor(CG_IDS).orderBy).toEqual([
      { metrics: { referenceGenomeLength: "desc_nulls_last" } },
    ]);
  });

  it("maps the accession and totalReads CG sort keys", async () => {
    responses[WORKFLOWS] = { fedWorkflowRuns: [] };
    responses[CG_IDS] = { fedConsensusGenomes: [] };
    responses[SEQ_READS] = { fedSequencingReads: [] };

    const latest = renderFC();
    latest().fetchNextGenWorkflowRuns(
      conditions({ orderBy: "referenceAccession", orderDir: "ASC" }),
    );
    await waitFor(() => expect(latest().cgWorkflowIds).toEqual([]));
    latest().fetchNextGenWorkflowRuns(
      conditions({ orderBy: "totalReadsCG", orderDir: "DESC" }),
    );
    await waitFor(() => expect(callsFor(CG_IDS)).toHaveLength(2));

    expect(inputFor(CG_IDS, 0).orderBy).toEqual([
      { accession: { accessionId: "asc_nulls_first" } },
    ]);
    expect(inputFor(CG_IDS, 1).orderBy).toEqual([
      { metrics: { totalReads: "desc_nulls_last" } },
    ]);
    // No project scoping at all leaves the CG where clause off entirely.
    expect(inputFor(CG_IDS, 0).where).toEqual({
      collectionId: { _in: [1, 2] },
    });
  });

  it("sorts client-side by creation source", async () => {
    responses[WORKFLOWS] = {
      fedWorkflowRuns: [
        workflowRun({
          id: "wrZ",
          rawInputsJson: JSON.stringify({ creation_source: "Zebra" }),
        }),
        workflowRun({
          id: "wrA",
          rawInputsJson: JSON.stringify({ creation_source: "Alpha" }),
        }),
        workflowRun({ id: "wrNone", rawInputsJson: "not json" }),
      ],
    };
    // creation_source is not a NextGen sort key, so it is treated as custom
    // sample metadata and a sequencing-read id query goes out too.
    responses[SEQ_READ_IDS] = { fedSequencingReads: [{ id: "sr1" }] };
    responses[SEQ_READS] = { fedSequencingReads: [] };

    const latest = renderFC();
    latest().fetchNextGenWorkflowRuns(
      conditions({
        projectId: "8",
        orderBy: "creation_source",
        orderDir: "ASC",
      }),
    );

    await waitFor(() =>
      expect(latest().cgWorkflowIds).toEqual(["wrNone", "wrA", "wrZ"]),
    );
  });
});

describe("DiscoveryViewFC row transforms", () => {
  it("maps a NextGen status onto the legacy pill status", async () => {
    responses[WORKFLOWS] = {
      fedWorkflowRuns: [workflowRun({ status: "CREATED" })],
    };
    responses[SEQ_READS] = { fedSequencingReads: [sequencingRead()] };
    const latest = renderFC();
    latest().fetchNextGenWorkflowRuns(conditions({ projectId: "8" }));

    await waitFor(() => expect(latest().cgRows).toHaveLength(1));
    expect(latest().cgRows[0].status).toBe("running");
  });

  it("emits an undefined row when no sequencing read matches the run", async () => {
    responses[WORKFLOWS] = { fedWorkflowRuns: [workflowRun()] };
    responses[SEQ_READS] = { fedSequencingReads: [] };
    const latest = renderFC();
    latest().fetchNextGenWorkflowRuns(conditions({ projectId: "8" }));

    await waitFor(() => expect(latest().cgRows).toHaveLength(1));
    expect(latest().cgRows).toEqual([undefined]);
  });

  it("uses the known-error pill status for a failed run with an error label", async () => {
    responses[WORKFLOWS] = {
      fedWorkflowRuns: [
        workflowRun({ status: "FAILED", errorLabel: "InsufficientReadsError" }),
      ],
    };
    responses[SEQ_READS] = { fedSequencingReads: [sequencingRead()] };
    const latest = renderFC();
    latest().fetchNextGenWorkflowRuns(conditions({ projectId: "8" }));

    await waitFor(() => expect(latest().cgRows).toHaveLength(1));
    expect(latest().cgRows[0].status).toBe("complete - issue");
  });

  it("passes unknown statuses through and tolerates missing version/inputs", async () => {
    responses[WORKFLOWS] = {
      fedWorkflowRuns: [
        workflowRun({
          status: "SOMETHING_NEW",
          rawInputsJson: null,
          workflowVersion: null,
          startedAt: null,
        }),
      ],
    };
    responses[SEQ_READS] = { fedSequencingReads: [sequencingRead()] };
    const latest = renderFC();
    latest().fetchNextGenWorkflowRuns(conditions({ projectId: "8" }));

    await waitFor(() => expect(latest().cgRows).toHaveLength(1));
    const row = latest().cgRows[0];
    expect(row.status).toBe("something_new");
    expect(row.wdl_version).toBeUndefined();
    expect(row.creation_source).toBeUndefined();
    expect(row.createdAt).toBeUndefined();
  });

  it("prefers the workflow input accession over the entity taxon", async () => {
    responses[WORKFLOWS] = {
      fedWorkflowRuns: [
        workflowRun({
          rawInputsJson: JSON.stringify({
            accession_id: "MN908947.3",
            accession_name: "Wuhan-Hu-1",
            taxon_name: "SARS-CoV-2",
          }),
        }),
      ],
    };
    responses[SEQ_READS] = { fedSequencingReads: [sequencingRead()] };
    const latest = renderFC();
    latest().fetchNextGenWorkflowRuns(conditions({ projectId: "8" }));

    await waitFor(() => expect(latest().cgRows).toHaveLength(1));
    expect(latest().cgRows[0].referenceAccession).toEqual({
      accessionName: "Wuhan-Hu-1",
      referenceAccessionId: "MN908947.3",
      taxonName: "SARS-CoV-2",
    });
  });

  it("expands consensus genomes into their own rows with metrics", async () => {
    responses[WORKFLOWS] = { fedWorkflowRuns: [workflowRun()] };
    responses[SEQ_READS] = {
      fedSequencingReads: [
        sequencingRead({
          consensusGenomes: {
            edges: [
              null,
              {
                node: {
                  producingRunId: "wr1",
                  taxon: { name: "SARS-CoV-2" },
                  accession: {
                    accessionId: "MN908947.3",
                    accessionName: "Wuhan-Hu-1",
                  },
                  metrics: {
                    coverageDepth: 12.5,
                    totalReads: 1000,
                    gcPercent: 40,
                    refSnps: 3,
                    percentIdentity: 99.5,
                    nActg: 29000,
                    percentGenomeCalled: 98,
                    nMissing: 10,
                    nAmbiguous: 1,
                    referenceGenomeLength: 29903,
                  },
                },
              },
            ],
          },
        }),
      ],
    };

    const latest = renderFC();
    latest().fetchNextGenWorkflowRuns(conditions({ projectId: "8" }));

    await waitFor(() => expect(latest().cgRows).toHaveLength(1));
    const row = latest().cgRows[0];
    // The CG-specific row wins over the bare sequencing-read row.
    expect(row.consensusGenomeProducingRunId).toBe("wr1");
    expect(row.coverageDepth).toBe(12.5);
    expect(row.totalReadsCG).toBe(1000);
    expect(row.referenceAccessionLength).toBe(29903);
    expect(row.referenceAccession).toEqual({
      accessionName: "Wuhan-Hu-1",
      referenceAccessionId: "MN908947.3",
      taxonName: "SARS-CoV-2",
    });
  });

  it("handles nullish sample fields and a missing taxon", async () => {
    responses[WORKFLOWS] = { fedWorkflowRuns: [workflowRun()] };
    responses[SEQ_READS] = {
      fedSequencingReads: [
        sequencingRead({
          taxon: null,
          protocol: null,
          medakaModel: null,
          sample: {
            railsSampleId: null,
            name: null,
            notes: null,
            collectionLocation: null,
            sampleType: null,
            waterControl: true,
            uploadError: "bad file",
            hostOrganism: null,
            collection: null,
            ownerUserId: null,
            ownerUserName: null,
            metadatas: { edges: [] },
          },
        }),
      ],
    };

    const latest = renderFC();
    latest().fetchNextGenWorkflowRuns(conditions({ projectId: "8" }));

    await waitFor(() => expect(latest().cgRows).toHaveLength(1));
    const row = latest().cgRows[0];
    expect(row.sample.id).toBe("");
    expect(row.sample.name).toBe("");
    expect(row.sample.uploadError).toBe("bad file");
    expect(row.water_control).toBe("Yes");
    expect(row.collection_location_v2).toBe("");
    expect(row.wetlabProtocol).toBeUndefined();
    expect(row.referenceAccession).toBeUndefined();
  });

  it("rejects when the sequencing-read objects query returns no data", async () => {
    responses[WORKFLOWS] = { fedWorkflowRuns: [workflowRun()] };
    responses[SEQ_READS] = { fedSequencingReads: [sequencingRead()] };

    const latest = renderFC();
    latest().fetchNextGenWorkflowRuns(conditions({ projectId: "8" }));
    await waitFor(() => expect(latest().cgRows).toHaveLength(1));

    // A later (uncached) page whose query comes back empty surfaces the error.
    responses[SEQ_READS] = { fedSequencingReads: null };
    await expect(latest().fetchCgPage(50)).rejects.toThrow(/Missing CG data/);
  });
});

describe("DiscoveryViewFC CG paging", () => {
  it("caches the first page and refetches for later offsets", async () => {
    responses[WORKFLOWS] = { fedWorkflowRuns: [workflowRun()] };
    responses[SEQ_READS] = { fedSequencingReads: [sequencingRead()] };

    const latest = renderFC();
    latest().fetchNextGenWorkflowRuns(conditions({ projectId: "8" }));
    await waitFor(() => expect(latest().cgRows).toHaveLength(1));

    const firstPageQueries = callsFor(SEQ_READS).length;
    const page = await latest().fetchCgPage(0);
    expect(page).toHaveLength(1);
    // The cached promise is reused, so no extra query goes out.
    expect(callsFor(SEQ_READS)).toHaveLength(firstPageQueries);

    await latest().fetchCgPage(50);
    expect(callsFor(SEQ_READS).length).toBe(firstPageQueries + 1);
    // The later page is past the end of the run list.
    expect(inputFor(SEQ_READS, firstPageQueries).where.id).toEqual({ _in: [] });
  });

  it("sends the workflow run ids and rails-numeric ids in the page query", async () => {
    responses[WORKFLOWS] = { fedWorkflowRuns: [workflowRun({ id: "12" })] };
    responses[SEQ_READS] = { fedSequencingReads: [sequencingRead()] };

    const latest = renderFC();
    latest().fetchNextGenWorkflowRuns(conditions({ projectId: "8" }));
    await waitFor(() => expect(latest().cgRows).toHaveLength(1));

    const input = inputFor(SEQ_READS);
    expect(input.where.id).toEqual({ _in: ["sr1"] });
    expect(input.consensusGenomesInput.where.producingRunId).toEqual({
      _in: ["12"],
    });
    expect(input.todoRemove.workflowRunIds).toEqual([12]);
  });
});

describe("DiscoveryViewFC project aggregates", () => {
  const setUpRuns = async () => {
    responses[WORKFLOWS] = { fedWorkflowRuns: [workflowRun()] };
    responses[SEQ_READS] = { fedSequencingReads: [sequencingRead()] };
    const latest = renderFC();
    latest().fetchNextGenWorkflowRuns(conditions({ projectId: "8" }));
    await waitFor(() => expect(latest().cgWorkflowIds).toEqual(["wr1"]));
    return latest;
  };

  it("parses and merges aggregate pages into per-project counts", async () => {
    const latest = await setUpRuns();

    responses[AGGREGATE] = {
      fedWorkflowRunsAggregate: {
        aggregate: [
          {
            count: 4,
            groupBy: {
              collectionId: 8,
              workflowVersion: { workflow: { name: "consensus-genome" } },
            },
          },
          // Rows missing either half of the key are ignored.
          { count: 1, groupBy: { collectionId: null } },
          null,
        ],
      },
    };
    await latest().fetchWorkflowRunsProjectAggregates(
      [8],
      conditions({
        projectId: "8",
        filters: emptyFilters,
      }),
    );

    await waitFor(() =>
      expect(latest().workflowRunsProjectAggregates).toEqual({
        8: { "consensus-genome": 4 },
      }),
    );
    const input = inputFor(AGGREGATE);
    expect(input.where.id).toEqual({ _in: ["wr1"] });
    expect(input.where.collectionId).toEqual({ _in: [8] });

    responses[AGGREGATE] = {
      fedWorkflowRunsAggregate: {
        aggregate: [
          {
            count: 2,
            groupBy: {
              collectionId: 9,
              workflowVersion: { workflow: { name: "consensus-genome" } },
            },
          },
        ],
      },
    };
    await latest().fetchWorkflowRunsProjectAggregates([9], conditions());
    await waitFor(() =>
      expect(latest().workflowRunsProjectAggregates).toEqual({
        8: { "consensus-genome": 4 },
        9: { "consensus-genome": 2 },
      }),
    );
  });

  it("throws when the aggregate response is missing", async () => {
    const latest = await setUpRuns();
    responses[AGGREGATE] = { fedWorkflowRunsAggregate: null };

    await expect(
      latest().fetchWorkflowRunsProjectAggregates([8], conditions()),
    ).rejects.toThrow(/Missing project workflows aggregate data/);
  });

  it("clears the aggregates on a full refetch but keeps them on a sort-only refetch", async () => {
    const latest = await setUpRuns();
    responses[AGGREGATE] = {
      fedWorkflowRunsAggregate: {
        aggregate: [
          {
            count: 4,
            groupBy: {
              collectionId: 8,
              workflowVersion: { workflow: { name: "consensus-genome" } },
            },
          },
        ],
      },
    };
    await latest().fetchWorkflowRunsProjectAggregates([8], conditions());
    await waitFor(() =>
      expect(latest().workflowRunsProjectAggregates).toBeDefined(),
    );

    latest().fetchNextGenWorkflowRuns(
      conditions({ projectId: "8" }),
      "consensus-genome",
    );
    expect(latest().workflowRunsProjectAggregates).toBeDefined();

    latest().fetchNextGenWorkflowRuns(conditions({ projectId: "8" }));
    await waitFor(() =>
      expect(latest().workflowRunsProjectAggregates).toBeUndefined(),
    );
  });
});
