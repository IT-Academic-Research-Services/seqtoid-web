// Coverage for the PipelineVersionSelect per-workflow config map: the
// timeKey/versionKey/workflowName lookups and, more importantly, every branch
// of the per-workflow `getDatabaseVersionString` builders (AMR's two optional
// DB versions, the mNGS NCBI index date, and the workflows that contribute
// nothing).
import { PipelineVersionSelectConfig } from "~/components/common/PipelineVersionSelect/workflowTypeConfig";
import { WorkflowType } from "~/components/utils/workflows";

// The config's callbacks are typed against WorkflowRun / PipelineRun, which are
// large interfaces; these tests only feed the couple of fields the callbacks
// read, so cast the partials at the call site.
const amrRun = (inputs?: Record<string, unknown>) =>
  ({ inputs } as unknown as Parameters<
    (typeof PipelineVersionSelectConfig)[WorkflowType.AMR]["getDatabaseVersionString"]
  >[0]);

const mngsRun = (alignmentConfigName?: string) =>
  ({ alignment_config_name: alignmentConfigName } as unknown as Parameters<
    (typeof PipelineVersionSelectConfig)[WorkflowType.SHORT_READ_MNGS]["getDatabaseVersionString"]
  >[0]);

describe("PipelineVersionSelectConfig", () => {
  describe("AMR", () => {
    const config = PipelineVersionSelectConfig[WorkflowType.AMR];

    it("uses the workflow-run keys and the abbreviated workflow name", () => {
      expect(config.timeKey).toBe("executed_at");
      expect(config.versionKey).toBe("wdl_version");
      // AMR is special-cased to the shorthand because the full name is long.
      expect(config.workflowName).toBe("AMR");
    });

    it("includes both DB versions when both inputs are present", () => {
      expect(
        config.getDatabaseVersionString(
          amrRun({ card_version: "3.2.6", wildcard_version: "4.0.0" }),
        ),
      ).toBe("CARD DB: 3.2.6 | Wildcard DB: 4.0.0 | ");
    });

    it("includes only the CARD version when wildcard is missing", () => {
      expect(
        config.getDatabaseVersionString(amrRun({ card_version: "3.2.6" })),
      ).toBe("CARD DB: 3.2.6 | ");
    });

    it("includes only the wildcard version when CARD is missing", () => {
      expect(
        config.getDatabaseVersionString(amrRun({ wildcard_version: "4.0.0" })),
      ).toBe("Wildcard DB: 4.0.0 | ");
    });

    it("returns an empty string when the inputs carry no DB versions", () => {
      expect(config.getDatabaseVersionString(amrRun({}))).toBe("");
    });

    it("returns an empty string when `inputs` itself is absent", () => {
      // Optional-chaining branch: a run that has not been given inputs at all.
      expect(config.getDatabaseVersionString(amrRun(undefined))).toBe("");
    });
  });

  describe("metagenomics workflows", () => {
    it.each([
      [WorkflowType.SHORT_READ_MNGS, "Illumina mNGS"],
      [WorkflowType.LONG_READ_MNGS, "Nanopore mNGS"],
    ] as const)(
      "%s reads the pipeline-run keys and prefixes the NCBI index date",
      (workflow, pipelineName) => {
        const config = PipelineVersionSelectConfig[workflow];
        expect(config.timeKey).toBe("created_at");
        expect(config.versionKey).toBe("pipeline_version");
        expect(config.workflowName).toBe(pipelineName);
        expect(config.getDatabaseVersionString(mngsRun("2024-02-06"))).toBe(
          "NCBI Index Date: 2024-02-06 | ",
        );
      },
    );

    it.each([WorkflowType.SHORT_READ_MNGS, WorkflowType.LONG_READ_MNGS])(
      "%s returns an empty string when the alignment config name is missing",
      workflow => {
        const config = PipelineVersionSelectConfig[workflow];
        expect(config.getDatabaseVersionString(mngsRun(undefined))).toBe("");
        // An empty alignment config name is falsy too and must not produce a
        // dangling "NCBI Index Date:  | " prefix.
        expect(config.getDatabaseVersionString(mngsRun(""))).toBe("");
      },
    );
  });

  describe("workflows without a database version", () => {
    it.each([
      [WorkflowType.CONSENSUS_GENOME, "Consensus Genome"],
      [WorkflowType.BENCHMARK, "Benchmark"],
    ] as const)("%s contributes no DB version string", (workflow, name) => {
      const config = PipelineVersionSelectConfig[workflow];
      expect(config.timeKey).toBe("executed_at");
      expect(config.versionKey).toBe("wdl_version");
      expect(config.workflowName).toBe(name);
      expect(
        config.getDatabaseVersionString(
          {} as unknown as Parameters<
            typeof config.getDatabaseVersionString
          >[0],
        ),
      ).toBe("");
    });
  });

  it("reuses the short-read config for the deprecated AMR workflow", () => {
    const deprecated = PipelineVersionSelectConfig[WorkflowType.AMR_DEPRECATED];
    const shortRead = PipelineVersionSelectConfig[WorkflowType.SHORT_READ_MNGS];
    expect(deprecated).toBe(shortRead);
    expect(deprecated.getDatabaseVersionString(mngsRun("2023-01-01"))).toBe(
      "NCBI Index Date: 2023-01-01 | ",
    );
  });

  it("defines a config entry for every workflow type", () => {
    expect(Object.keys(PipelineVersionSelectConfig).sort()).toEqual(
      Object.values(WorkflowType).sort(),
    );
  });
});
