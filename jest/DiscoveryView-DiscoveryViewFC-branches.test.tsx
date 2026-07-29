// Branch coverage for app/assets/src/components/views/DiscoveryView/DiscoveryViewFC.tsx
//
// The existing DiscoveryViewFC suite covers the happy path of the Relay data
// layer. What it does not reach are the defensive `?? undefined` fallbacks in
// the consensus-genome row mapper (every metric can come back null), the
// `case null` / `case undefined` arms of the three orderBy builders, and the
// "impossible state" / missing-data throws that guard each query response.
//
// This suite reuses the same stubbed Relay environment - fetchQuery is keyed by
// generated operation name, and <DiscoveryView> is replaced by a probe that
// captures the props it is handed - and feeds it the null-heavy payloads those
// branches need.
import { render, waitFor } from "@testing-library/react";
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

const globalContextDispatch = jest.fn();

const renderFC = (props: $TSFixMe = {}) => {
  render(
    <GlobalContext.Provider
      value={{ globalContextState: {}, globalContextDispatch } as $TSFixMe}
    >
      <UserContext.Provider
        value={{ admin: true, allowedFeatures: ["cool"] } as $TSFixMe}
      >
        <DiscoveryViewFC domain="my_data" {...props} />
      </UserContext.Provider>
    </GlobalContext.Provider>,
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

describe("consensus-genome row mapper null fallbacks", () => {
  it("leaves every metric undefined when the CG payload is all nulls", async () => {
    responses[WORKFLOWS] = { fedWorkflowRuns: [workflowRun()] };
    responses[SEQ_READS] = {
      fedSequencingReads: [
        sequencingRead({
          consensusGenomes: {
            edges: [
              {
                node: {
                  producingRunId: "wr1",
                  accession: null,
                  taxon: null,
                  metrics: {
                    coverageDepth: null,
                    totalReads: null,
                    gcPercent: null,
                    refSnps: null,
                    percentIdentity: null,
                    nActg: null,
                    percentGenomeCalled: null,
                    nMissing: null,
                    nAmbiguous: null,
                    referenceGenomeLength: null,
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

    // The CG-specific row replaces the bare sequencing-read row.
    const cgRow = latest().cgRows[0];
    expect(cgRow.consensusGenomeProducingRunId).toBe("wr1");
    expect(cgRow.coverageDepth).toBeUndefined();
    expect(cgRow.totalReadsCG).toBeUndefined();
    expect(cgRow.gcPercent).toBeUndefined();
    expect(cgRow.refSnps).toBeUndefined();
    expect(cgRow.percentIdentity).toBeUndefined();
    expect(cgRow.nActg).toBeUndefined();
    expect(cgRow.percentGenomeCalled).toBeUndefined();
    expect(cgRow.nMissing).toBeUndefined();
    expect(cgRow.nAmbiguous).toBeUndefined();
    expect(cgRow.referenceAccessionLength).toBeUndefined();
    // accession / taxon are null, so every accession field is undefined too.
    expect(cgRow.referenceAccession).toEqual({
      accessionName: undefined,
      referenceAccessionId: undefined,
      taxonName: undefined,
    });
  });

  it("falls back to undefined when the metrics object itself is missing", async () => {
    responses[WORKFLOWS] = { fedWorkflowRuns: [workflowRun()] };
    responses[SEQ_READS] = {
      fedSequencingReads: [
        sequencingRead({
          consensusGenomes: {
            edges: [
              {
                node: {
                  producingRunId: "wr1",
                  accession: { accessionName: null, accessionId: null },
                  taxon: { name: null },
                  metrics: null,
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

    const cgRow = latest().cgRows[0];
    expect(cgRow.consensusGenomeProducingRunId).toBe("wr1");
    // Optional chaining on a null metrics object yields undefined throughout.
    expect(cgRow.coverageDepth).toBeUndefined();
    expect(cgRow.nAmbiguous).toBeUndefined();
    expect(cgRow.referenceAccessionLength).toBeUndefined();
    // Present-but-null accession and taxon fields collapse to undefined.
    expect(cgRow.referenceAccession).toEqual({
      accessionName: undefined,
      referenceAccessionId: undefined,
      taxonName: undefined,
    });
  });

  it("drops a null consensus-genome edge instead of emitting a row for it", async () => {
    responses[WORKFLOWS] = { fedWorkflowRuns: [workflowRun()] };
    responses[SEQ_READS] = {
      fedSequencingReads: [
        sequencingRead({ consensusGenomes: { edges: [null] } }),
      ],
    };

    const latest = renderFC();
    latest().fetchNextGenWorkflowRuns(conditions({ projectId: "8" }));
    await waitFor(() => expect(latest().cgRows).toHaveLength(1));

    // Only the bare sequencing-read row survives; no CG fields were added.
    expect(latest().cgRows[0].consensusGenomeProducingRunId).toBeUndefined();
  });

  it("uses undefined for a missing entity taxon and a null taxon name", async () => {
    responses[WORKFLOWS] = { fedWorkflowRuns: [workflowRun()] };
    responses[SEQ_READS] = {
      fedSequencingReads: [sequencingRead({ taxon: null })],
    };

    const latest = renderFC();
    latest().fetchNextGenWorkflowRuns(conditions({ projectId: "8" }));
    await waitFor(() => expect(latest().cgRows).toHaveLength(1));
    // No taxon at all -> no referenceAccession object is built.
    expect(latest().cgRows[0].referenceAccession).toBeUndefined();
  });

  it("builds a referenceAccession with an undefined name when the taxon has none", async () => {
    responses[WORKFLOWS] = { fedWorkflowRuns: [workflowRun()] };
    responses[SEQ_READS] = {
      fedSequencingReads: [sequencingRead({ taxon: { name: null } })],
    };

    const latest = renderFC();
    latest().fetchNextGenWorkflowRuns(conditions({ projectId: "8" }));
    await waitFor(() => expect(latest().cgRows).toHaveLength(1));
    // The taxon exists, so the object is built, but its name is nulled out.
    expect(latest().cgRows[0].referenceAccession).toEqual({
      taxonName: undefined,
    });
  });

  it("throws when a sequencing read comes back without a sample", async () => {
    responses[WORKFLOWS] = { fedWorkflowRuns: [workflowRun()] };
    responses[SEQ_READS] = { fedSequencingReads: [sequencingRead()] };

    const latest = renderFC();
    latest().fetchNextGenWorkflowRuns(conditions({ projectId: "8" }));
    await waitFor(() => expect(latest().cgRows).toHaveLength(1));

    responses[SEQ_READS] = {
      fedSequencingReads: [sequencingRead({ sample: null })],
    };
    await expect(latest().fetchCgPage(50)).rejects.toThrow(
      /sample was nullish/,
    );
  });
});

describe("orderBy builders: the null and undefined arms", () => {
  it("omits sequencing-read and consensus-genome ordering when orderBy is null", async () => {
    responses[WORKFLOWS] = { fedWorkflowRuns: [workflowRun()] };
    responses[SEQ_READS] = { fedSequencingReads: [sequencingRead()] };

    const latest = renderFC();
    latest().fetchNextGenWorkflowRuns(
      conditions({ projectId: "8", orderBy: null, orderDir: null }),
    );
    await waitFor(() => expect(latest().cgRows).toHaveLength(1));

    // With no sort key the workflow-runs query falls back to startedAt.
    expect(inputFor(WORKFLOWS).orderByArray).toEqual([
      { startedAt: "desc_nulls_last" },
    ]);
    // The page query carries no ordering of its own.
    expect(inputFor(SEQ_READS).orderByArray).toBeUndefined();
    expect(inputFor(SEQ_READS).consensusGenomesInput?.orderBy).toBeUndefined();
  });

  it("orders by startedAt ascending when the direction is ASC and no key is given", async () => {
    responses[WORKFLOWS] = { fedWorkflowRuns: [workflowRun()] };
    responses[SEQ_READS] = { fedSequencingReads: [sequencingRead()] };

    const latest = renderFC();
    latest().fetchNextGenWorkflowRuns(
      conditions({ projectId: "8", orderBy: undefined, orderDir: "ASC" }),
    );
    await waitFor(() => expect(latest().cgRows).toHaveLength(1));

    expect(inputFor(WORKFLOWS).orderByArray).toEqual([
      { startedAt: "asc_nulls_first" },
    ]);
  });

  it("orders by createdAt through the same startedAt arm", async () => {
    responses[WORKFLOWS] = { fedWorkflowRuns: [workflowRun()] };
    responses[SEQ_READS] = { fedSequencingReads: [sequencingRead()] };

    const latest = renderFC();
    latest().fetchNextGenWorkflowRuns(
      conditions({ projectId: "8", orderBy: "createdAt", orderDir: "DESC" }),
    );
    await waitFor(() => expect(latest().cgRows).toHaveLength(1));

    expect(inputFor(WORKFLOWS).orderByArray).toEqual([
      { startedAt: "desc_nulls_last" },
    ]);
  });
});

describe("sequencing-read sort path", () => {
  const setUp = (orderBy: string) => {
    responses[WORKFLOWS] = { fedWorkflowRuns: [workflowRun()] };
    responses[SEQ_READ_IDS] = { fedSequencingReads: [{ id: "sr1" }] };
    responses[SEQ_READS] = { fedSequencingReads: [sequencingRead()] };
    const latest = renderFC();
    latest().fetchNextGenWorkflowRuns(
      conditions({ projectId: "8", orderBy, orderDir: "ASC" }),
    );
    return latest;
  };

  it("issues a sequencing-read id query and orders by the technology column", async () => {
    const latest = setUp("technology");
    await waitFor(() => expect(callsFor(SEQ_READ_IDS)).toHaveLength(1));
    expect(inputFor(SEQ_READ_IDS).orderByArray).toEqual([
      { technology: "asc_nulls_first" },
    ]);
    await waitFor(() => expect(latest().cgRows).toHaveLength(1));
  });

  it("logs a missing-data error when the sequencing-read sort query returns nothing", async () => {
    responses[WORKFLOWS] = { fedWorkflowRuns: [workflowRun()] };
    responses[SEQ_READ_IDS] = { fedSequencingReads: null };
    responses[SEQ_READS] = { fedSequencingReads: [sequencingRead()] };

    const latest = renderFC();
    latest().fetchNextGenWorkflowRuns(
      conditions({ projectId: "8", orderBy: "technology", orderDir: "ASC" }),
    );

    await waitFor(() => expect(mockLogError).toHaveBeenCalled());
    expect(String(mockLogError.mock.calls[0][0].details.error)).toMatch(
      /sequencingReads data/,
    );
  });
});

describe("consensus-genome sort path", () => {
  it("issues a consensus-genome id query and orders by a metrics column", async () => {
    responses[WORKFLOWS] = { fedWorkflowRuns: [workflowRun()] };
    responses[CG_IDS] = {
      fedConsensusGenomes: [{ producingRunId: "wr1" }],
    };
    responses[SEQ_READS] = { fedSequencingReads: [sequencingRead()] };

    const latest = renderFC();
    latest().fetchNextGenWorkflowRuns(
      conditions({ projectId: "8", orderBy: "coverageDepth", orderDir: "ASC" }),
    );
    await waitFor(() => expect(callsFor(CG_IDS)).toHaveLength(1));
    expect(inputFor(CG_IDS).orderBy).toEqual([
      { metrics: { coverageDepth: "asc_nulls_first" } },
    ]);
  });

  it("maps the aliased metric columns onto their NextGen field names", async () => {
    responses[WORKFLOWS] = { fedWorkflowRuns: [workflowRun()] };
    responses[CG_IDS] = { fedConsensusGenomes: [] };
    responses[SEQ_READS] = { fedSequencingReads: [] };

    const latest = renderFC();
    latest().fetchNextGenWorkflowRuns(
      conditions({ projectId: "8", orderBy: "totalReadsCG", orderDir: "DESC" }),
    );
    await waitFor(() => expect(callsFor(CG_IDS)).toHaveLength(1));
    expect(inputFor(CG_IDS).orderBy).toEqual([
      { metrics: { totalReads: "desc_nulls_last" } },
    ]);

    capturedProps.length = 0;
    const second = renderFC();
    second().fetchNextGenWorkflowRuns(
      conditions({
        projectId: "8",
        orderBy: "referenceAccessionLength",
        orderDir: "ASC",
      }),
    );
    await waitFor(() => expect(callsFor(CG_IDS).length).toBeGreaterThan(1));
    expect(inputFor(CG_IDS, 1).orderBy).toEqual([
      { metrics: { referenceGenomeLength: "asc_nulls_first" } },
    ]);
  });

  it("orders by the accession id when sorting on referenceAccession", async () => {
    responses[WORKFLOWS] = { fedWorkflowRuns: [workflowRun()] };
    responses[CG_IDS] = { fedConsensusGenomes: [] };
    responses[SEQ_READS] = { fedSequencingReads: [] };

    const latest = renderFC();
    latest().fetchNextGenWorkflowRuns(
      conditions({
        projectId: "8",
        orderBy: "referenceAccession",
        orderDir: "ASC",
      }),
    );
    await waitFor(() => expect(callsFor(CG_IDS)).toHaveLength(1));
    expect(inputFor(CG_IDS).orderBy).toEqual([
      { accession: { accessionId: "asc_nulls_first" } },
    ]);
  });

  it("logs a missing-data error when the consensus-genome sort query returns nothing", async () => {
    responses[WORKFLOWS] = { fedWorkflowRuns: [workflowRun()] };
    responses[CG_IDS] = { fedConsensusGenomes: null };
    responses[SEQ_READS] = { fedSequencingReads: [sequencingRead()] };

    const latest = renderFC();
    latest().fetchNextGenWorkflowRuns(
      conditions({
        projectId: "8",
        orderBy: "coverageDepth",
        orderDir: "ASC",
      }),
    );

    await waitFor(() => expect(mockLogError).toHaveBeenCalled());
    expect(String(mockLogError.mock.calls[0][0].details.error)).toMatch(
      /consensusGenomes data/,
    );
  });
});
