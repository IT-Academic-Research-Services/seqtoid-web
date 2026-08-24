// Branch coverage: app/assets/src/components/views/DiscoveryView/DiscoveryViewFC.tsx
//
// Companion to DiscoveryView-DiscoveryViewFC.test.tsx. That suite drives the
// happy paths of the NextGen/Relay data layer; this one drives the conditional
// arms it leaves untaken: the "no search term" arm of the sample filter, the
// unscoped consensus-genome where clause, the two "response came back null"
// throws, the consensus-genome join's three skip conditions, the missing
// entity-input throw on the unsorted path, descending creation_source sorting,
// the nullish-sample throw, and the `?? undefined` fallbacks on every
// consensus-genome metric.
import { act, render, waitFor } from "@testing-library/react";
import { UserContext } from "~/components/common/UserContext";
import { GlobalContext } from "~/globalContext/reducer";

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

const sample = (overrides: $TSFixMe = {}) => ({
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
  metadatas: { edges: [] },
  ...overrides,
});

const sequencingRead = (overrides: $TSFixMe = {}) => ({
  id: "sr1",
  nucleicAcid: "DNA",
  protocol: "artic_v4",
  medakaModel: "r941",
  technology: "Illumina",
  taxon: { name: "Betacoronavirus" },
  sample: sample(),
  consensusGenomes: { edges: [] },
  ...overrides,
});

const conditions = (overrides: $TSFixMe = {}) =>
  ({
    projectId: undefined,
    search: undefined,
    orderBy: undefined,
    orderDir: undefined,
    filters: {} as $TSFixMe,
    nextGenFilters: { taxonNames: [] },
    ...overrides,
  } as $TSFixMe);

const globalContextDispatch = jest.fn();

const renderFC = (props: $TSFixMe = {}) => {
  render(
    <GlobalContext.Provider
      value={{ globalContextState: {}, globalContextDispatch } as $TSFixMe}
    >
      <UserContext.Provider value={{ admin: false } as $TSFixMe}>
        <DiscoveryViewFC domain="my_data" {...props} />
      </UserContext.Provider>
    </GlobalContext.Provider>,
  );
  return () => capturedProps[capturedProps.length - 1];
};

const loggedErrorMessage = () =>
  mockLogError.mock.calls[0][0].exception.message;

beforeEach(() => {
  jest.clearAllMocks();
  capturedProps.length = 0;
  responses = {};
  mockGetProjects.mockResolvedValue({ all_projects_ids: [1, 2] });
  mockFetchQuery.mockImplementation((_env, node) => ({
    toPromise: () => Promise.resolve(responses[queryName(node)]),
  }));
});

// ---------------------------------------------------------------------------

describe("DiscoveryViewFC query-input conditionals", () => {
  it("omits the name regex when filtering without a search term", async () => {
    responses[WORKFLOWS] = { fedWorkflowRuns: [] };
    responses[SEQ_READ_IDS] = { fedSequencingReads: [] };
    responses[SEQ_READS] = { fedSequencingReads: [] };

    const latest = renderFC();
    act(() =>
      latest().fetchNextGenWorkflowRuns(
        conditions({
          projectId: "8",
          filters: { locationV2: ["California"] },
        }),
      ),
    );

    await waitFor(() => expect(latest().cgWorkflowIds).toEqual([]));
    const where = inputFor(SEQ_READ_IDS).where;
    // The sample filter is still built (location is set) but the name arm of
    // the ternary resolves to undefined instead of an _iregex.
    expect(where.sample.name).toBeUndefined();
    expect(where.sample.collectionLocation).toEqual({ _in: ["California"] });
    expect(where.sample.hostOrganism).toBeUndefined();
    expect(where.sample.sampleType).toBeUndefined();
  });

  it("leaves the consensusGenomes where clause off when nothing scopes the collection", async () => {
    responses[WORKFLOWS] = { fedWorkflowRuns: [] };
    responses[CG_IDS] = { fedConsensusGenomes: [] };
    responses[SEQ_READS] = { fedSequencingReads: [] };

    const latest = renderFC({ domain: "all_data" });
    act(() =>
      latest().fetchNextGenWorkflowRuns(
        conditions({ orderBy: "nActg", orderDir: "ASC" }),
      ),
    );

    await waitFor(() => expect(latest().cgWorkflowIds).toEqual([]));
    expect(mockGetProjects).not.toHaveBeenCalled();
    expect(inputFor(CG_IDS).where).toBeUndefined();
    expect(inputFor(CG_IDS).orderBy).toEqual([
      { metrics: { nActg: "asc_nulls_first" } },
    ]);
  });

  it("treats an explicitly null orderBy as the default startedAt sort", async () => {
    responses[WORKFLOWS] = { fedWorkflowRuns: [] };
    responses[SEQ_READS] = { fedSequencingReads: [] };

    const latest = renderFC();
    act(() =>
      latest().fetchNextGenWorkflowRuns(
        conditions({ projectId: "8", orderBy: null }),
      ),
    );

    await waitFor(() => expect(latest().cgWorkflowIds).toEqual([]));
    expect(inputFor(WORKFLOWS).orderByArray).toEqual([
      { startedAt: "desc_nulls_last" },
    ]);
    // A null sort key belongs to neither the sequencingReads nor the CG family.
    expect(callsFor(SEQ_READ_IDS)).toHaveLength(0);
    expect(callsFor(CG_IDS)).toHaveLength(0);
  });
});

describe("DiscoveryViewFC missing-response guards", () => {
  it("reports the filtered sequencingReads response coming back null", async () => {
    responses[WORKFLOWS] = { fedWorkflowRuns: [] };
    responses[SEQ_READ_IDS] = { fedSequencingReads: null };

    const latest = renderFC();
    act(() =>
      latest().fetchNextGenWorkflowRuns(
        conditions({ projectId: "8", search: "swab" }),
      ),
    );

    await waitFor(() => expect(mockLogError).toHaveBeenCalled());
    expect(loggedErrorMessage()).toContain(
      "Missing filtered sequencingReads data",
    );
    expect(latest().cgWorkflowIds).toBeUndefined();
  });

  it("reports the sorted consensusGenomes response coming back null", async () => {
    responses[WORKFLOWS] = { fedWorkflowRuns: [] };
    responses[CG_IDS] = { fedConsensusGenomes: null };

    const latest = renderFC();
    act(() =>
      latest().fetchNextGenWorkflowRuns(
        conditions({ projectId: "8", orderBy: "gcPercent", orderDir: "ASC" }),
      ),
    );

    await waitFor(() => expect(mockLogError).toHaveBeenCalled());
    expect(loggedErrorMessage()).toContain(
      "Missing sorted consensusGenomes data",
    );
    expect(latest().cgWorkflowIds).toBeUndefined();
  });

  it("reports a workflow run with no entity input on the unsorted path", async () => {
    responses[WORKFLOWS] = {
      fedWorkflowRuns: [
        workflowRun({ id: "wrX", entityInputs: { edges: [] } }),
      ],
    };

    const latest = renderFC();
    act(() =>
      latest().fetchNextGenWorkflowRuns(conditions({ projectId: "8" })),
    );

    await waitFor(() => expect(mockLogError).toHaveBeenCalled());
    expect(loggedErrorMessage()).toContain("Couldn't find an entity input");
    expect(latest().cgWorkflowIds).toBeUndefined();
  });

  it("rejects when a sequencing read comes back without a sample", async () => {
    responses[WORKFLOWS] = { fedWorkflowRuns: [workflowRun()] };
    responses[SEQ_READS] = { fedSequencingReads: [sequencingRead()] };

    const latest = renderFC();
    act(() =>
      latest().fetchNextGenWorkflowRuns(conditions({ projectId: "8" })),
    );
    await waitFor(() => expect(latest().cgRows).toHaveLength(1));

    responses[SEQ_READS] = {
      fedSequencingReads: [sequencingRead({ sample: null })],
    };
    await expect(latest().fetchCgPage(50)).rejects.toThrow(
      /Sequencing read's sample was nullish/,
    );
  });
});

describe("DiscoveryViewFC consensus-genome sort join", () => {
  it("drops runs with no entity input and runs the sample filter excluded", async () => {
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
        workflowRun({ id: "wrC", entityInputs: { edges: [] } }),
      ],
    };
    // Only srA survives the sample filter, so wrB is joined out.
    responses[SEQ_READ_IDS] = { fedSequencingReads: [{ id: "srA" }] };
    responses[CG_IDS] = { fedConsensusGenomes: [{ producingRunId: "wrA" }] };
    responses[SEQ_READS] = { fedSequencingReads: [] };

    const latest = renderFC();
    act(() =>
      latest().fetchNextGenWorkflowRuns(
        conditions({
          projectId: "8",
          search: "swab",
          orderBy: "coverageDepth",
          orderDir: "DESC",
        }),
      ),
    );

    await waitFor(() => expect(latest().cgWorkflowIds).toEqual(["wrA"]));
    // A CG sort key is not a sequencingReads sort key, so the ids query that
    // applies the sample filter carries no ordering of its own.
    expect(inputFor(SEQ_READ_IDS).orderByArray).toBeUndefined();
  });
});

describe("DiscoveryViewFC creation_source sorting", () => {
  it("sorts descending and treats a missing creation source as empty", async () => {
    responses[WORKFLOWS] = {
      fedWorkflowRuns: [
        workflowRun({
          id: "wrZ",
          rawInputsJson: JSON.stringify({ creation_source: "Zebra" }),
        }),
        workflowRun({ id: "wrNone", rawInputsJson: "not json" }),
        workflowRun({
          id: "wrA",
          rawInputsJson: JSON.stringify({ creation_source: "Alpha" }),
        }),
      ],
    };
    responses[SEQ_READ_IDS] = { fedSequencingReads: [{ id: "sr1" }] };
    responses[SEQ_READS] = { fedSequencingReads: [] };

    const latest = renderFC();
    act(() =>
      latest().fetchNextGenWorkflowRuns(
        conditions({
          projectId: "8",
          orderBy: "creation_source",
          orderDir: "DESC",
        }),
      ),
    );

    await waitFor(() =>
      expect(latest().cgWorkflowIds).toEqual(["wrZ", "wrA", "wrNone"]),
    );
  });
});

describe("DiscoveryViewFC row nullish fallbacks", () => {
  it("leaves water_control undefined and keeps an unnamed taxon", async () => {
    responses[WORKFLOWS] = { fedWorkflowRuns: [workflowRun()] };
    responses[SEQ_READS] = {
      fedSequencingReads: [
        sequencingRead({
          taxon: { name: null },
          sample: sample({ waterControl: null }),
        }),
      ],
    };

    const latest = renderFC();
    act(() =>
      latest().fetchNextGenWorkflowRuns(conditions({ projectId: "8" })),
    );

    await waitFor(() => expect(latest().cgRows).toHaveLength(1));
    const row = latest().cgRows[0];
    expect(row.water_control).toBeUndefined();
    // The taxon object exists, so a referenceAccession is still emitted.
    expect(row.referenceAccession).toEqual({ taxonName: undefined });
  });

  it("falls back to undefined for every missing consensus-genome field", async () => {
    responses[WORKFLOWS] = { fedWorkflowRuns: [workflowRun()] };
    responses[SEQ_READS] = {
      fedSequencingReads: [
        sequencingRead({
          consensusGenomes: {
            edges: [
              {
                node: {
                  producingRunId: "wr1",
                  taxon: null,
                  accession: null,
                  metrics: null,
                },
              },
            ],
          },
        }),
      ],
    };

    const latest = renderFC();
    act(() =>
      latest().fetchNextGenWorkflowRuns(conditions({ projectId: "8" })),
    );

    await waitFor(() => expect(latest().cgRows).toHaveLength(1));
    const row = latest().cgRows[0];
    expect(row.consensusGenomeProducingRunId).toBe("wr1");
    expect(row.referenceAccession).toEqual({
      accessionName: undefined,
      referenceAccessionId: undefined,
      taxonName: undefined,
    });
    for (const metric of [
      "coverageDepth",
      "totalReadsCG",
      "gcPercent",
      "refSnps",
      "percentIdentity",
      "nActg",
      "percentGenomeCalled",
      "nMissing",
      "nAmbiguous",
      "referenceAccessionLength",
    ]) {
      expect(row[metric]).toBeUndefined();
    }
  });

  it("does not attach a consensus genome that has no producing run id", async () => {
    responses[WORKFLOWS] = { fedWorkflowRuns: [workflowRun()] };
    responses[SEQ_READS] = {
      fedSequencingReads: [
        sequencingRead({
          consensusGenomes: {
            edges: [
              {
                node: {
                  producingRunId: null,
                  taxon: { name: "SARS-CoV-2" },
                  accession: {
                    accessionId: "MN908947.3",
                    accessionName: "Wuhan-Hu-1",
                  },
                  metrics: { coverageDepth: 12.5 },
                },
              },
            ],
          },
        }),
      ],
    };

    const latest = renderFC();
    act(() =>
      latest().fetchNextGenWorkflowRuns(conditions({ projectId: "8" })),
    );

    await waitFor(() => expect(latest().cgRows).toHaveLength(1));
    const row = latest().cgRows[0];
    // The orphan CG row cannot be matched to the run, so the bare
    // sequencing-read row is used instead.
    expect(row.consensusGenomeProducingRunId).toBeUndefined();
    expect(row.coverageDepth).toBeUndefined();
    expect(row.referenceAccession).toEqual({ taxonName: "Betacoronavirus" });
  });
});
