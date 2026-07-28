// Frontend coverage: app/assets/src/components/views/DiscoveryView/discovery_api.ts
// This module is the translation layer between the Rails discovery endpoints
// and the shapes the Discovery tables render. The interesting behaviour is the
// per-workflow branching in processRawWorkflowRun (CG / AMR / benchmark /
// unknown), the snapshot branch in getDiscoveryDimensions, and the
// swallow-and-log error paths -- all of which are driven here against a mocked
// ~/api layer.
import {
  getProjectDimensions,
  getProjects,
  getSampleDimensions,
  getSamples,
  getSamplesLocations,
  getSampleStats,
  getVisualizations,
  getWorkflowRuns,
} from "~/api";
import { WorkflowType } from "~/components/utils/workflows";
import {
  DISCOVERY_DOMAIN_ALL_DATA,
  DISCOVERY_DOMAIN_MY_DATA,
  DISCOVERY_DOMAIN_PUBLIC,
  DISCOVERY_DOMAIN_SNAPSHOT,
  DISCOVERY_DOMAINS,
  formatWetlabProtocol,
  getDiscoveryDimensions,
  getDiscoveryLocations,
  getDiscoveryProjects,
  getDiscoverySamples,
  getDiscoveryStats,
  getDiscoveryVisualizations,
  getDiscoveryWorkflowRuns,
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

let consoleErrorSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  consoleErrorSpy = jest
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

describe("discovery domain constants", () => {
  it("lists exactly the four discovery domains", () => {
    expect(DISCOVERY_DOMAINS).toEqual([
      DISCOVERY_DOMAIN_ALL_DATA,
      DISCOVERY_DOMAIN_MY_DATA,
      DISCOVERY_DOMAIN_PUBLIC,
      DISCOVERY_DOMAIN_SNAPSHOT,
    ]);
    expect(DISCOVERY_DOMAIN_MY_DATA).toBe("my_data");
    expect(DISCOVERY_DOMAIN_ALL_DATA).toBe("all_data");
    expect(DISCOVERY_DOMAIN_PUBLIC).toBe("public");
    expect(DISCOVERY_DOMAIN_SNAPSHOT).toBe("snapshot");
  });
});

describe("formatWetlabProtocol", () => {
  it("upper-cases and de-underscores the protocol name", () => {
    expect(formatWetlabProtocol("artic_v4")).toBe("ARTIC V4");
    expect(formatWetlabProtocol("msspe")).toBe("MSSPE");
  });

  it("returns an empty string for nullish input rather than throwing", () => {
    expect(formatWetlabProtocol(undefined)).toBe("");
    expect(formatWetlabProtocol(null)).toBe("");
  });
});

describe("getDiscoveryDimensions", () => {
  it("requests both sample and project dimensions when not a snapshot", async () => {
    mocked(getSampleDimensions).mockResolvedValue([{ dimension: "host" }]);
    mocked(getProjectDimensions).mockResolvedValue([{ dimension: "tissue" }]);

    const result = await getDiscoveryDimensions({
      domain: DISCOVERY_DOMAIN_MY_DATA,
      filters: { host: [1] },
      projectId: 7,
      snapshotShareId: null,
      search: "abc",
      sampleIds: [1, 2],
    });

    expect(getSampleDimensions).toHaveBeenCalledWith({
      domain: DISCOVERY_DOMAIN_MY_DATA,
      filters: { host: [1] },
      projectId: 7,
      snapshotShareId: null,
      search: "abc",
      sampleIds: [1, 2],
    });
    expect(getProjectDimensions).toHaveBeenCalledWith({
      domain: DISCOVERY_DOMAIN_MY_DATA,
      filters: { host: [1] },
      projectId: 7,
      search: "abc",
    });
    expect(result).toEqual({
      sampleDimensions: [{ dimension: "host" }],
      projectDimensions: [{ dimension: "tissue" }],
    });
  });

  it("skips project dimensions on a snapshot share and leaves them undefined", async () => {
    mocked(getSampleDimensions).mockResolvedValue(["s"]);

    const result = await getDiscoveryDimensions({
      domain: DISCOVERY_DOMAIN_SNAPSHOT,
      snapshotShareId: "share-abc",
    });

    expect(getProjectDimensions).not.toHaveBeenCalled();
    expect(result).toEqual({
      sampleDimensions: ["s"],
      projectDimensions: undefined,
    });
  });

  it("logs and returns an empty object when the dimension fetch rejects", async () => {
    mocked(getSampleDimensions).mockRejectedValue(new Error("boom"));

    const result = await getDiscoveryDimensions({
      domain: DISCOVERY_DOMAIN_ALL_DATA,
    });

    expect(result).toEqual({});
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});

describe("getDiscoveryStats", () => {
  it("wraps the sample stats response", async () => {
    mocked(getSampleStats).mockResolvedValue({ countByWorkflow: { amr: 3 } });

    await expect(
      getDiscoveryStats({ domain: DISCOVERY_DOMAIN_PUBLIC }),
    ).resolves.toEqual({ sampleStats: { countByWorkflow: { amr: 3 } } });
  });

  it("logs and returns an empty object on failure", async () => {
    mocked(getSampleStats).mockRejectedValue(new Error("nope"));

    await expect(
      getDiscoveryStats({ domain: DISCOVERY_DOMAIN_PUBLIC }),
    ).resolves.toEqual({});
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});

describe("getDiscoveryLocations", () => {
  it("returns the locations payload untouched", async () => {
    mocked(getSamplesLocations).mockResolvedValue({ 1: { name: "CA" } });

    await expect(
      getDiscoveryLocations({ domain: DISCOVERY_DOMAIN_MY_DATA }),
    ).resolves.toEqual({ 1: { name: "CA" } });
  });

  it("logs and returns an empty object when the locations fetch rejects", async () => {
    mocked(getSamplesLocations).mockRejectedValue(new Error("down"));

    await expect(
      getDiscoveryLocations({ domain: DISCOVERY_DOMAIN_MY_DATA }),
    ).resolves.toEqual({});
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});

describe("getDiscoverySamples", () => {
  it("applies the default limit/offset and maps the raw samples", async () => {
    mocked(getSamples).mockResolvedValue({
      samples: [
        {
          id: 11,
          name: "Sample A",
          created_at: "2024-01-01",
          public: 1,
          private_until: "2024-06-01",
          project_id: 3,
          details: {
            db_sample: { initial_workflow: "amr", sample_notes: "note" },
            derived_sample_output: {
              project_name: "Proj",
              host_genome_name: "Human",
              summary_stats: {
                insert_size_mean: 300.4,
                insert_size_standard_deviation: 20.6,
                compression_ratio: 1.5,
                adjusted_remaining_reads: 500,
                percent_remaining: 12.5,
                qc_percent: 88,
              },
              pipeline_run: {
                total_ercc_reads: 9,
                pipeline_version: "8.2",
                fraction_subsampled: 0.5,
                total_reads: 1000,
              },
            },
            mngs_run_info: {
              result_status_description: "COMPLETE",
              ncbi_index_version: "2024-02-06",
              created_at: "2024-01-02",
              finalized: 1,
              total_runtime: 120,
            },
            upload_error: { result_status_description: "" },
            uploader: { name: "Ada", id: 42 },
            workflow_runs_count_by_workflow: { amr: 2 },
            metadata: { collection_location: "San Francisco" },
          },
        },
      ],
      all_samples_ids: [11, 12],
    });

    const { samples, sampleIds } = await getDiscoverySamples({
      domain: DISCOVERY_DOMAIN_MY_DATA,
    });

    expect(mocked(getSamples).mock.calls[0][0]).toMatchObject({
      limit: 100,
      offset: 0,
      listAllIds: false,
    });
    expect(sampleIds).toEqual([11, 12]);
    expect(samples).toHaveLength(1);

    const sample = samples[0];
    expect(sample.id).toBe(11);
    expect(sample.host).toBe("Human");
    expect(sample.projectId).toBe(3);
    expect(sample.privateUntil).toBe("2024-06-01");
    expect(sample.createdAt).toBe("2024-01-01");
    expect(sample.notes).toBe("note");
    expect(sample.pipelineVersion).toBe("8.2");
    expect(sample.totalReads).toBe(1000);
    expect(sample.totalRuntime).toBe(120);
    expect(sample.qcPercent).toBe(88);
    expect(sample.erccReads).toBe(9);
    expect(sample.subsampledFraction).toBe(0.5);
    expect(sample.duplicateCompressionRatio).toBe(1.5);
    expect(sample.nonHostReads).toEqual({ value: 500, percent: 12.5 });
    // Rounded and joined by the +/- helper.
    expect(sample.meanInsertSize).toBe("300±21");
    // Metadata is spread onto the row.
    expect(sample.collection_location).toBe("San Francisco");

    expect(sample.sample).toMatchObject({
      initialWorkflow: "amr",
      name: "Sample A",
      project: "Proj",
      publicAccess: true,
      pipelineRunStatus: "complete",
      ncbiIndexVersion: "2024-02-06",
      pipelineRunCreatedAt: "2024-01-02",
      pipelineRunFinalized: 1,
      user: "Ada",
      userId: 42,
      workflowRunsCountByWorkflow: { amr: 2 },
    });
  });

  it("degrades gracefully when the sample has no details at all", async () => {
    mocked(getSamples).mockResolvedValue({
      samples: [{ id: 5, name: "Bare", public: 0, details: undefined }],
      all_samples_ids: null,
    });

    const { samples, sampleIds } = await getDiscoverySamples({
      domain: DISCOVERY_DOMAIN_ALL_DATA,
      limit: 5,
      offset: 10,
      listAllIds: true,
    });

    expect(mocked(getSamples).mock.calls[0][0]).toMatchObject({
      limit: 5,
      offset: 10,
      listAllIds: true,
    });
    expect(sampleIds).toBeNull();
    // meanInsertSize falls back to "" when the stats are missing.
    expect(samples[0].meanInsertSize).toBe("");
    expect(samples[0].sample.publicAccess).toBe(false);
    expect(samples[0].host).toBeUndefined();
    expect(samples[0].nonHostReads).toEqual({
      value: undefined,
      percent: undefined,
    });
  });
});

describe("getDiscoveryProjects", () => {
  it("unwraps the projects response and its id list", async () => {
    mocked(getProjects).mockResolvedValue({
      projects: [{ id: 1 }],
      all_projects_ids: [1, 2, 3],
    });

    await expect(getDiscoveryProjects({ domain: "public" })).resolves.toEqual({
      projects: [{ id: 1 }],
      projectIds: [1, 2, 3],
    });
    expect(mocked(getProjects).mock.calls[0][0]).toMatchObject({
      limit: 100,
      offset: 0,
      listAllIds: false,
    });
  });
});

describe("getDiscoveryVisualizations", () => {
  it("returns null visualizationIds when listAllIds is false", async () => {
    mocked(getVisualizations).mockResolvedValue([{ id: 8 }, { id: 9 }]);

    const result = await getDiscoveryVisualizations({ domain: "my_data" });

    expect(result.visualizations).toEqual([{ id: 8 }, { id: 9 }]);
    expect(result.visualizationIds).toBeNull();
  });

  it("collects the ids when listAllIds is true", async () => {
    mocked(getVisualizations).mockResolvedValue([{ id: 8 }, { id: 9 }]);

    const result = await getDiscoveryVisualizations({
      domain: "my_data",
      listAllIds: true,
    });

    expect(result.visualizationIds).toEqual([8, 9]);
  });
});

describe("getDiscoveryWorkflowRuns", () => {
  const baseRun = (overrides: $TSFixMe) => ({
    id: 1,
    status: "SUCCEEDED",
    created_at: "2024-03-01",
    wdl_version: "3.4.5",
    runner: { name: "Grace", id: 7 },
    sample: {
      info: {
        id: 55,
        name: "S1",
        created_at: "2024-02-01",
        public: 1,
        result_status_description: "COMPLETE",
        host_genome_name: "Human",
        sample_notes: "n",
        private_until: "2024-08-01",
        project_id: 4,
      },
      project_name: "P",
      uploader: { name: "Ada", id: 42 },
      metadata: { collection_date: "2024-01" },
    },
    ...overrides,
  });

  it("maps the shared workflow-run fields and truncates the wdl version to major.minor", async () => {
    mocked(getWorkflowRuns).mockResolvedValue({
      workflow_runs: [baseRun({ workflow: "unknown-workflow" })],
      all_workflow_run_ids: [1, 2],
    });

    const { workflowRuns, workflowRunIds } = await getDiscoveryWorkflowRuns({
      domain: "my_data",
    });

    // listAllIds defaults to false -> ids are withheld.
    expect(workflowRunIds).toBeNull();
    expect(mocked(getWorkflowRuns).mock.calls[0][0]).toMatchObject({
      mode: "with_sample_info",
      limit: 100,
      offset: 0,
      listAllIds: false,
    });

    const run = workflowRuns[0];
    expect(run.id).toBe(1);
    expect(run.status).toBe("succeeded");
    expect(run.wdl_version).toBe("3.4");
    expect(run.host).toBe("Human");
    expect(run.notes).toBe("n");
    expect(run.privateUntil).toBe("2024-08-01");
    expect(run.projectId).toBe(4);
    expect(run.collection_date).toBe("2024-01");
    expect(run.sample).toMatchObject({
      id: 55,
      name: "S1",
      project: "P",
      publicAccess: true,
      uploadError: "complete",
      user: "Ada",
      userId: 42,
      userNameWhoInitiatedWorkflowRun: "Grace",
      userIdWhoInitiatedWorkflowRun: 7,
    });
    // An unrecognised workflow contributes no extra fields.
    expect(run.coverageDepth).toBeUndefined();
    expect(run.aupr).toBeUndefined();
  });

  it("returns the full id list when listAllIds is true", async () => {
    mocked(getWorkflowRuns).mockResolvedValue({
      workflow_runs: [],
      all_workflow_run_ids: [3, 4],
    });

    const { workflowRunIds } = await getDiscoveryWorkflowRuns({
      domain: "my_data",
      listAllIds: true,
    });

    expect(workflowRunIds).toEqual([3, 4]);
  });

  it("adds consensus genome inputs and cached quality metrics", async () => {
    mocked(getWorkflowRuns).mockResolvedValue({
      workflow_runs: [
        baseRun({
          workflow: WorkflowType.CONSENSUS_GENOME,
          inputs: {
            medaka_model: "r941",
            technology: "ONT",
            creation_source: "SARS-CoV-2 Upload",
            wetlab_protocol: "artic_v4",
            accession_name: "Acc",
            accession_id: "MN908947.3",
            taxon_name: "Severe acute respiratory syndrome coronavirus 2",
            taxon_id: 2697049,
          },
          cached_results: {
            coverage_viz: { coverage_depth: 12.5 },
            quality_metrics: {
              total_reads: 400,
              gc_percent: 38,
              ref_snps: 5,
              percent_identity: 99.4,
              n_actg: 29000,
              percent_genome_called: 97.5,
              n_missing: 100,
              n_ambiguous: 3,
              reference_genome_length: 29903,
            },
          },
        }),
      ],
      all_workflow_run_ids: null,
    });

    const { workflowRuns } = await getDiscoveryWorkflowRuns({
      domain: "public",
    });
    const run = workflowRuns[0];

    expect(run.medakaModel).toBe("r941");
    expect(run.technology).toBe("ONT");
    expect(run.creation_source).toBe("SARS-CoV-2 Upload");
    expect(run.wetlabProtocol).toBe("ARTIC V4");
    expect(run.referenceAccession).toEqual({
      accessionName: "Acc",
      referenceAccessionId: "MN908947.3",
      taxonName: "Severe acute respiratory syndrome coronavirus 2",
      taxonId: 2697049,
    });
    expect(run.coverageDepth).toBe(12.5);
    expect(run.totalReadsCG).toBe(400);
    expect(run.gcPercent).toBe(38);
    expect(run.refSnps).toBe(5);
    expect(run.percentIdentity).toBe(99.4);
    expect(run.nActg).toBe(29000);
    expect(run.percentGenomeCalled).toBe(97.5);
    expect(run.nMissing).toBe(100);
    expect(run.nAmbiguous).toBe(3);
    expect(run.referenceAccessionLength).toBe(29903);
  });

  it("omits the cached consensus genome metrics when cached_results is absent", async () => {
    mocked(getWorkflowRuns).mockResolvedValue({
      workflow_runs: [
        baseRun({
          workflow: WorkflowType.CONSENSUS_GENOME,
          inputs: { technology: "Illumina" },
        }),
      ],
      all_workflow_run_ids: null,
    });

    const { workflowRuns } = await getDiscoveryWorkflowRuns({
      domain: "public",
    });
    const run = workflowRuns[0];

    expect(run.technology).toBe("Illumina");
    expect(run.wetlabProtocol).toBe("");
    expect("coverageDepth" in run).toBe(false);
    expect("totalReadsCG" in run).toBe(false);
  });

  it("adds AMR quality metrics, including the +/- mean insert size", async () => {
    mocked(getWorkflowRuns).mockResolvedValue({
      workflow_runs: [
        baseRun({
          workflow: WorkflowType.AMR,
          cached_results: {
            quality_metrics: {
              adjusted_remaining_reads: 250,
              percent_remaining: 25,
              total_reads: 1000,
              qc_percent: 90,
              compression_ratio: 2,
              total_ercc_reads: 4,
              fraction_subsampled: 0.25,
              insert_size_mean: 199.5,
              insert_size_standard_deviation: 10.2,
            },
          },
        }),
      ],
      all_workflow_run_ids: null,
    });

    const { workflowRuns } = await getDiscoveryWorkflowRuns({
      domain: "public",
    });
    const run = workflowRuns[0];

    expect(run.nonHostReads).toEqual({ value: 250, percent: 25 });
    expect(run.totalReadsAMR).toBe(1000);
    expect(run.qcPercent).toBe(90);
    expect(run.duplicateCompressionRatio).toBe(2);
    expect(run.erccReads).toBe(4);
    expect(run.subsampledFraction).toBe(0.25);
    expect(run.meanInsertSize).toBe("200±10");
  });

  it("falls back to an empty mean insert size when the AMR insert stats are missing", async () => {
    mocked(getWorkflowRuns).mockResolvedValue({
      workflow_runs: [
        baseRun({
          workflow: WorkflowType.AMR,
          cached_results: {
            quality_metrics: { total_reads: 10, qc_percent: 50 },
          },
        }),
      ],
      all_workflow_run_ids: null,
    });

    const { workflowRuns } = await getDiscoveryWorkflowRuns({
      domain: "public",
    });
    expect(workflowRuns[0].meanInsertSize).toBe("");
    expect(workflowRuns[0].totalReadsAMR).toBe(10);
  });

  it("adds no AMR fields at all when there are no cached quality metrics", async () => {
    mocked(getWorkflowRuns).mockResolvedValue({
      workflow_runs: [baseRun({ workflow: WorkflowType.AMR })],
      all_workflow_run_ids: null,
    });

    const { workflowRuns } = await getDiscoveryWorkflowRuns({
      domain: "public",
    });
    expect("totalReadsAMR" in workflowRuns[0]).toBe(false);
    expect("meanInsertSize" in workflowRuns[0]).toBe(false);
  });

  it("adds benchmark metrics and camelizes the additional info", async () => {
    mocked(getWorkflowRuns).mockResolvedValue({
      workflow_runs: [
        baseRun({
          workflow: WorkflowType.BENCHMARK,
          cached_results: {
            benchmark_metrics: {
              nt_aupr: 0.99,
              nr_aupr: 0.97,
              nt_l2_norm: 0.1,
              nr_l2_norm: 0.2,
              correlation: 0.88,
            },
            benchmark_info: {
              workflow: "short-read-mngs",
              ground_truth_file: "truth.csv",
            },
            additional_info: { some_key: "value" },
          },
        }),
      ],
      all_workflow_run_ids: null,
    });

    const { workflowRuns } = await getDiscoveryWorkflowRuns({
      domain: "public",
    });
    const run = workflowRuns[0];

    expect(run.aupr).toEqual({ nt: 0.99, nr: 0.97 });
    expect(run.l2Norm).toEqual({ nt: 0.1, nr: 0.2 });
    expect(run.correlation).toBe(0.88);
    expect(run.workflowBenchmarked).toBe("short-read-mngs");
    expect(run.groundTruthFile).toBe("truth.csv");
    expect(run.additionalInfo).toEqual({ someKey: "value" });
  });

  it("leaves benchmark metrics undefined when the run has no cached results", async () => {
    mocked(getWorkflowRuns).mockResolvedValue({
      workflow_runs: [baseRun({ workflow: WorkflowType.BENCHMARK })],
      all_workflow_run_ids: null,
    });

    const { workflowRuns } = await getDiscoveryWorkflowRuns({
      domain: "public",
    });
    const run = workflowRuns[0];

    expect(run.aupr).toEqual({ nt: undefined, nr: undefined });
    expect(run.correlation).toBeUndefined();
    expect(run.workflowBenchmarked).toBeUndefined();
  });
});
