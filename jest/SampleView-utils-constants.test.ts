// Coverage for app/assets/src/components/views/SampleView/utils/constants.ts
//
// Most of this module is data, but it also carries executable code: the
// BACKGROUND_DEPENDENT_READS_THRESHOLDS derivation (a filter/some pair) and the
// per-metric `agg` reducers in TREE_VIZ_TOOLTIP_METRICS. Those functions are
// only ever reached when something calls them, so they are exercised directly
// here alongside assertions that pin the derived table's contents.
import { WORKFLOW_TABS, WorkflowType } from "~/components/utils/workflows";
import {
  BACKGROUND_DEPENDENT_READS_THRESHOLDS,
  getWorkflowRunStatusCategory,
  isKnownWorkflowRunStatus,
  LONG_READS_THRESHOLDS,
  METRIC_DECIMAL_PLACES,
  NON_BACKGROUND_DEPENDENT_SHORT_READS_THRESHOLDS,
  SHORT_READS_THRESHOLDS,
  TAXON_COUNT_TYPE_METRICS,
  THRESHOLDS,
  TREE_METRICS,
  TREE_VIZ_TOOLTIP_METRICS,
  WORKFLOW_RUN_STATUS_CATEGORY,
} from "~/components/views/SampleView/utils/constants";

describe("BACKGROUND_DEPENDENT_READS_THRESHOLDS", () => {
  it("is exactly the short-read thresholds that need a background model", () => {
    expect(BACKGROUND_DEPENDENT_READS_THRESHOLDS).toEqual([
      { text: "Score", value: "agg_score" },
      { text: "NT Z Score", value: "nt:z_score" },
      { text: "NR Z Score", value: "nr:z_score" },
    ]);
  });

  it("excludes every non-background-dependent threshold", () => {
    const backgroundDependentValues = BACKGROUND_DEPENDENT_READS_THRESHOLDS.map(
      t => t.value,
    );
    NON_BACKGROUND_DEPENDENT_SHORT_READS_THRESHOLDS.forEach(t => {
      expect(backgroundDependentValues).not.toContain(t.value);
    });
  });

  it("partitions the full short-read threshold list without loss", () => {
    expect(
      BACKGROUND_DEPENDENT_READS_THRESHOLDS.length +
        NON_BACKGROUND_DEPENDENT_SHORT_READS_THRESHOLDS.length,
    ).toBe(SHORT_READS_THRESHOLDS.length);
  });
});

describe("THRESHOLDS lookup", () => {
  it("maps each mNGS tab to its own threshold list", () => {
    expect(THRESHOLDS[WORKFLOW_TABS.SHORT_READ_MNGS]).toBe(
      SHORT_READS_THRESHOLDS,
    );
    expect(THRESHOLDS[WORKFLOW_TABS.LONG_READ_MNGS]).toBe(
      LONG_READS_THRESHOLDS,
    );
  });

  it("offers base-count metrics only on the long-read list", () => {
    const shortValues = SHORT_READS_THRESHOLDS.map(t => t.value);
    const longValues = LONG_READS_THRESHOLDS.map(t => t.value);
    expect(longValues).toContain("nt:bpm");
    expect(shortValues).not.toContain("nt:bpm");
    expect(shortValues).toContain("nt:z_score");
    expect(longValues).not.toContain("nt:z_score");
  });
});

describe("TREE_VIZ_TOOLTIP_METRICS aggregators", () => {
  const shortRead = TREE_VIZ_TOOLTIP_METRICS[WorkflowType.SHORT_READ_MNGS];
  const longRead = TREE_VIZ_TOOLTIP_METRICS[WorkflowType.LONG_READ_MNGS];

  it("aggregate score takes the maximum across the subtree", () => {
    expect(shortRead.aggregatescore.agg([3, 17, 5])).toBe(17);
    expect(shortRead.aggregatescore.label).toBe("Aggregate Score");
  });

  it("every short-read count metric sums across the subtree", () => {
    ["nt_r", "nt_rpm", "nr_r", "nr_rpm"].forEach(key => {
      expect(shortRead[key].agg([1, 2, 3])).toBe(6);
      // Empty subtree aggregates to the additive identity.
      expect(shortRead[key].agg([])).toBe(0);
    });
    expect(shortRead.nt_r.label).toBe("NT r");
    expect(shortRead.nr_rpm.label).toBe("NR rpm");
  });

  it("every long-read base metric sums across the subtree", () => {
    ["nt_b", "nt_bpm", "nr_b", "nr_bpm"].forEach(key => {
      expect(longRead[key].agg([10, 20])).toBe(30);
      expect(longRead[key].agg([])).toBe(0);
    });
    expect(longRead.nt_b.label).toBe("NT b");
    expect(longRead.nr_bpm.label).toBe("NR bpm");
  });

  it("exposes an aggregator for every metric offered in TREE_METRICS", () => {
    [WorkflowType.SHORT_READ_MNGS, WorkflowType.LONG_READ_MNGS].forEach(wf => {
      TREE_METRICS[wf].forEach(metric => {
        expect(typeof TREE_VIZ_TOOLTIP_METRICS[wf][metric.value].agg).toBe(
          "function",
        );
      });
    });
  });
});

// SMP-1501 / SMP-1476: every value of BOTH Rails status vocabularies -- the raw
// WorkflowRun::STATUS (SampleForReport) and the SFN-mapped form (fedWorkflowRuns), which
// can overwrite each other on the shared Relay record -- must classify explicitly, and an
// unknown value must NOT fall through to the failure screen.
describe("getWorkflowRunStatusCategory", () => {
  const CASES: Array<
    [string, "success" | "inProgress" | "waiting" | "failed"]
  > = [
    // success -- both vocabularies
    ["SUCCEEDED", "success"], // raw Rails
    ["SUCCEEDED_WITH_ISSUE", "success"], // raw Rails
    ["COMPLETE", "success"], // SFN-mapped -- the SMP-1501 regression
    ["COMPLETE - ISSUE", "success"], // SFN-mapped
    // in progress
    ["RUNNING", "inProgress"],
    ["STARTED", "inProgress"],
    // waiting
    ["CREATED", "waiting"],
    ["PENDING", "waiting"],
    // failed
    ["FAILED", "failed"],
    ["TIMED_OUT", "failed"],
    ["ABORTED", "failed"],
  ];

  it.each(CASES)("classifies %s as %s", (status, category) => {
    expect(getWorkflowRunStatusCategory(status)).toBe(category);
  });

  it("covers every key in WORKFLOW_RUN_STATUS_CATEGORY", () => {
    const tested = new Set(CASES.map(([status]) => status));
    Object.keys(WORKFLOW_RUN_STATUS_CATEGORY).forEach(status => {
      expect(tested.has(status)).toBe(true);
    });
  });

  it.each([null, undefined, ""])(
    "treats the absent status %p as in progress, never failed",
    status => {
      expect(getWorkflowRunStatusCategory(status)).toBe("inProgress");
    },
  );

  it("defaults an UNRECOGNISED status to in progress, never failed", () => {
    expect(getWorkflowRunStatusCategory("SOME_NEW_STATUS")).toBe("inProgress");
    // A value colliding with an Object.prototype member must not resolve to a
    // prototype function via a bare bracket lookup.
    expect(getWorkflowRunStatusCategory("toString")).toBe("inProgress");
    expect(getWorkflowRunStatusCategory("constructor")).toBe("inProgress");
  });
});

describe("isKnownWorkflowRunStatus", () => {
  it("is true for every mapped status and false otherwise", () => {
    Object.keys(WORKFLOW_RUN_STATUS_CATEGORY).forEach(status => {
      expect(isKnownWorkflowRunStatus(status)).toBe(true);
    });
    ["SOME_NEW_STATUS", "toString", "constructor", "", null, undefined].forEach(
      status => {
        expect(isKnownWorkflowRunStatus(status)).toBe(false);
      },
    );
  });
});

describe("metric metadata tables", () => {
  it("gives integer metrics zero decimal places and rates one", () => {
    expect(METRIC_DECIMAL_PLACES.count).toBe(0);
    expect(METRIC_DECIMAL_PLACES.contigs).toBe(0);
    expect(METRIC_DECIMAL_PLACES.rpm).toBe(1);
    expect(METRIC_DECIMAL_PLACES.z_score).toBe(1);
  });

  it("only the short-read count-type metrics include background statistics", () => {
    const short = TAXON_COUNT_TYPE_METRICS[WorkflowType.SHORT_READ_MNGS];
    const long = TAXON_COUNT_TYPE_METRICS[WorkflowType.LONG_READ_MNGS];
    expect(short).toContain("bg_mean");
    expect(short).toContain("z_score");
    expect(long).not.toContain("bg_mean");
    expect(long).toContain("base_count");
  });
});
