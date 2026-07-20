// Frontend coverage: SampleView/utils/setup.ts holds the pure setup helpers for
// the sample view -- counting workflows per sample, the default filter
// selections, the initial-tab decision tree, applied-filter derivation, and a
// safe localStorage loader. Cover the SAMPLES vs WORKFLOW_RUNS count branches,
// every arm of determineInitialTab, the applied-filter omit/diff behavior, and
// loadState's empty/valid/null/throw paths.
import {
  WORKFLOW_TABS,
  WORKFLOWS,
  WorkflowType,
} from "~/components/utils/workflows";
import {
  determineInitialTab,
  getAppliedFilters,
  getDefaultSelectedOptions,
  getWorkflowCount,
  hasAppliedFilters,
  loadState,
} from "~/components/views/SampleView/utils/setup";

describe("getWorkflowCount", () => {
  it("counts SAMPLES-entity workflows from pipeline_runs by initial_workflow", () => {
    const sample = {
      initial_workflow: WorkflowType.SHORT_READ_MNGS,
      pipeline_runs: [{}, {}],
      workflow_runs: [],
    } as any;
    const count = getWorkflowCount(sample);
    // Matching initial_workflow -> number of pipeline runs.
    expect(count[WorkflowType.SHORT_READ_MNGS]).toBe(2);
    // Non-matching SAMPLES workflow -> falsy.
    expect(count[WorkflowType.LONG_READ_MNGS]).toBe(false);
  });

  it("counts WORKFLOW_RUNS-entity workflows by matching workflow field", () => {
    const sample = {
      initial_workflow: WorkflowType.AMR,
      pipeline_runs: [],
      workflow_runs: [
        { workflow: WorkflowType.AMR },
        { workflow: WorkflowType.CONSENSUS_GENOME },
        { workflow: WorkflowType.AMR },
      ],
    } as any;
    const count = getWorkflowCount(sample);
    expect(count[WorkflowType.AMR]).toBe(2);
    expect(count[WorkflowType.CONSENSUS_GENOME]).toBe(1);
    expect(count[WorkflowType.BENCHMARK]).toBe(0);
  });
});

describe("getDefaultSelectedOptions", () => {
  it("returns the canonical default filter selections", () => {
    const defaults = getDefaultSelectedOptions();
    expect(defaults.metricShortReads).toBe("nt_r");
    expect(defaults.metricLongReads).toBe("nt_b");
    expect(defaults.nameType).toBe("Scientific name");
    expect(defaults.readSpecificity).toBe(0);
    expect(defaults.taxa).toEqual([]);
    expect(defaults.background).toBeNull();
    expect(defaults.categories).toEqual({
      categories: [],
      subcategories: { Viruses: [] },
    });
  });
});

describe("determineInitialTab", () => {
  const empty = {
    [WorkflowType.SHORT_READ_MNGS]: 0,
    [WorkflowType.LONG_READ_MNGS]: 0,
    [WorkflowType.CONSENSUS_GENOME]: 0,
    [WorkflowType.AMR]: 0,
    [WorkflowType.BENCHMARK]: 0,
  } as any;

  it("keeps the current tab when it still has results", () => {
    const result = determineInitialTab({
      initialWorkflow: WorkflowType.SHORT_READ_MNGS,
      workflowCount: { ...empty, [WorkflowType.AMR]: 1 },
      currentTab: WORKFLOW_TABS.AMR as any,
    });
    expect(result).toBe(WORKFLOW_TABS.AMR);
  });

  it("prefers short-read mNGS, then long-read, CG, AMR, benchmark in order", () => {
    expect(
      determineInitialTab({
        initialWorkflow: WorkflowType.AMR,
        workflowCount: { ...empty, [WorkflowType.SHORT_READ_MNGS]: 3 },
        currentTab: null,
      }),
    ).toBe(WORKFLOW_TABS.SHORT_READ_MNGS);

    expect(
      determineInitialTab({
        initialWorkflow: WorkflowType.AMR,
        workflowCount: { ...empty, [WorkflowType.LONG_READ_MNGS]: 1 },
        currentTab: null,
      }),
    ).toBe(WORKFLOW_TABS.LONG_READ_MNGS);

    expect(
      determineInitialTab({
        initialWorkflow: WorkflowType.AMR,
        workflowCount: { ...empty, [WorkflowType.CONSENSUS_GENOME]: 1 },
        currentTab: null,
      }),
    ).toBe(WORKFLOW_TABS.CONSENSUS_GENOME);

    expect(
      determineInitialTab({
        initialWorkflow: WorkflowType.SHORT_READ_MNGS,
        workflowCount: { ...empty, [WorkflowType.AMR]: 1 },
        currentTab: null,
      }),
    ).toBe(WORKFLOW_TABS.AMR);

    expect(
      determineInitialTab({
        initialWorkflow: WorkflowType.SHORT_READ_MNGS,
        workflowCount: { ...empty, [WorkflowType.BENCHMARK]: 1 },
        currentTab: null,
      }),
    ).toBe(WORKFLOW_TABS.BENCHMARK);
  });

  it("falls back to the initial workflow's label when nothing has results", () => {
    expect(
      determineInitialTab({
        initialWorkflow: WorkflowType.CONSENSUS_GENOME,
        workflowCount: empty,
        currentTab: null,
      }),
    ).toBe(WORKFLOWS[WorkflowType.CONSENSUS_GENOME].label);
  });

  it("defaults to the short-read mNGS tab when there is no initial workflow", () => {
    expect(
      determineInitialTab({
        initialWorkflow: undefined as any,
        workflowCount: empty,
        currentTab: null,
      }),
    ).toBe(WORKFLOW_TABS.SHORT_READ_MNGS);
  });
});

describe("getAppliedFilters", () => {
  it("returns only changed filters and drops the non-applied keys", () => {
    const selected = {
      ...getDefaultSelectedOptions(),
      readSpecificity: 1,
      taxa: [{ id: 5 }],
      background: 999,
      nameType: "Common name",
    } as any;
    const applied = getAppliedFilters(selected);
    // Non-applied keys are always omitted, even when changed.
    expect("nameType" in applied).toBe(false);
    expect("background" in applied).toBe(false);
    expect("metricShortReads" in applied).toBe(false);
    // Genuinely changed applied filters remain.
    expect(applied.readSpecificity).toBe(1);
    expect(applied.taxa).toEqual([{ id: 5 }]);
  });

  it("returns no applied filters when selections match the defaults", () => {
    const applied = getAppliedFilters(getDefaultSelectedOptions());
    expect(Object.keys(applied)).toHaveLength(0);
  });
});

describe("hasAppliedFilters", () => {
  const base = () => getDefaultSelectedOptions();

  it("returns false for pristine default selections", () => {
    expect(hasAppliedFilters(WORKFLOW_TABS.SHORT_READ_MNGS, base())).toBe(
      false,
    );
  });

  it("detects category filters", () => {
    const selected = {
      ...base(),
      categories: { categories: ["Bacteria"], subcategories: { Viruses: [] } },
    };
    expect(hasAppliedFilters(WORKFLOW_TABS.SHORT_READ_MNGS, selected)).toBe(
      true,
    );
  });

  it("detects a viral subcategory filter", () => {
    const selected = {
      ...base(),
      categories: { categories: [], subcategories: { Viruses: ["Phage"] } },
    };
    expect(hasAppliedFilters(WORKFLOW_TABS.SHORT_READ_MNGS, selected)).toBe(
      true,
    );
  });

  it("detects read specificity and taxon filters", () => {
    expect(
      hasAppliedFilters(WORKFLOW_TABS.SHORT_READ_MNGS, {
        ...base(),
        readSpecificity: 1,
      }),
    ).toBe(true);
    expect(
      hasAppliedFilters(WORKFLOW_TABS.SHORT_READ_MNGS, {
        ...base(),
        taxa: [{ id: 1 }],
      }),
    ).toBe(true);
  });

  it("reads short-read thresholds on the short-read tab and long-read on the nanopore tab", () => {
    const shortReadThresholded = {
      ...base(),
      thresholdsShortReads: [{ metric: "nt_r" }],
    };
    // On the short-read tab this counts...
    expect(
      hasAppliedFilters(WORKFLOW_TABS.SHORT_READ_MNGS, shortReadThresholded),
    ).toBe(true);
    // ...but not when the long-read tab is active (it reads the other list).
    expect(
      hasAppliedFilters(WORKFLOW_TABS.LONG_READ_MNGS, shortReadThresholded),
    ).toBe(false);

    const longReadThresholded = {
      ...base(),
      thresholdsLongReads: [{ metric: "nt_b" }],
    };
    expect(
      hasAppliedFilters(WORKFLOW_TABS.LONG_READ_MNGS, longReadThresholded),
    ).toBe(true);
  });
});

describe("loadState", () => {
  beforeEach(() => localStorage.clear());

  it("returns an empty object when no value is stored", () => {
    expect(loadState(localStorage, "missing")).toEqual({});
  });

  it("parses and returns stored JSON", () => {
    localStorage.setItem(
      "k",
      JSON.stringify({ selectedOptions: { metric: "x" } }),
    );
    expect(loadState(localStorage, "k")).toEqual({
      selectedOptions: { metric: "x" },
    });
  });

  it("returns an empty object when the stored value parses to null", () => {
    localStorage.setItem("k", "null");
    expect(loadState(localStorage, "k")).toEqual({});
  });

  it("returns an empty object and warns when the stored value is invalid JSON", () => {
    const warn = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    localStorage.setItem("k", "{not valid json");
    expect(loadState(localStorage, "k")).toEqual({});
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
