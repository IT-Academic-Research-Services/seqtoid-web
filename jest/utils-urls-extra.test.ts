// Additional coverage: app/assets/src/components/utils/urls.ts
// Complements jest/utilsUrls.test.ts by driving the branches it leaves cold:
// the workflow/workflowRunId query fields, the optionsToTemporarilyPersist
// whitelist, and every heatmap -> SampleView threshold metric mapping.
import {
  DISCOVERY_VIEW_SOURCE_TEMP_PERSISTED_OPTIONS,
  generateUrlToSampleView,
  getTempSelectedOptions,
  HEATMAP_SOURCE_TEMP_PERSISTED_OPTIONS,
} from "~/components/utils/urls";
import { WORKFLOWS, WorkflowType } from "~/components/utils/workflows";

describe("generateUrlToSampleView (extra branches)", () => {
  it("adds the currentTab query field derived from the workflow label", () => {
    const url = generateUrlToSampleView({
      sampleId: "9",
      workflow: WorkflowType.CONSENSUS_GENOME,
    });

    expect(url.startsWith("/samples/9?")).toBe(true);
    expect(url).toContain(
      encodeURIComponent(WORKFLOWS[WorkflowType.CONSENSUS_GENOME].label),
    );
  });

  it("adds the workflowRunId query field", () => {
    const url = generateUrlToSampleView({
      sampleId: "9",
      workflowRunId: "1234",
    });

    expect(url).toContain("workflowRunId=1234");
  });

  it("combines the snapshot prefix with query params", () => {
    const url = generateUrlToSampleView({
      sampleId: "9",
      snapshotShareId: "snap",
      workflowRunId: "77",
    });

    expect(url.startsWith("/pub/snap/samples/9?")).toBe(true);
    expect(url).toContain("workflowRunId=77");
  });

  it("keeps a non-default background in the query", () => {
    const url = generateUrlToSampleView({
      sampleId: "9",
      // @ts-expect-error partial temp options are fine for this path
      tempSelectedOptions: { background: 99 },
    });

    expect(url).toContain("99");
  });

  it("mutates the caller's tempSelectedOptions to null out the default background", () => {
    const tempSelectedOptions = { background: 26 } as $TSFixMe;
    generateUrlToSampleView({ sampleId: "9", tempSelectedOptions });
    expect(tempSelectedOptions.background).toBeNull();
  });
});

describe("getTempSelectedOptions (extra branches)", () => {
  it("only persists the whitelisted options when optionsToTemporarilyPersist is non-empty", () => {
    const result = getTempSelectedOptions({
      optionsToTemporarilyPersist: ["background"],
      source: DISCOVERY_VIEW_SOURCE_TEMP_PERSISTED_OPTIONS,
      selectedOptions: {
        background: 12,
        readSpecificity: 1,
        categories: ["viruses"],
        taxonSelected: [{ label: "a", value: 1 }],
      } as $TSFixMe,
    });

    expect(result.background).toBe(12);
    // Everything not whitelisted is dropped and falls back to its default.
    expect(result.readSpecificity).toBeUndefined();
    expect(result.taxa).toEqual([]);
    expect(result.categories).toEqual({ categories: [], subcategories: {} });
  });

  it("maps every supported heatmap threshold metric into SampleView form", () => {
    const result = getTempSelectedOptions({
      source: HEATMAP_SOURCE_TEMP_PERSISTED_OPTIONS,
      selectedOptions: {
        thresholdFilters: [
          { metric: "NT_zscore", value: 1 },
          { metric: "NT_rpm", value: 2 },
          { metric: "NR_r", value: 3 },
          { metric: "NT_percentidentity", value: 4 },
          { metric: "NR_alignmentlength", value: 5 },
          { metric: "NT_logevalue", value: 6 },
        ],
      } as $TSFixMe,
    });

    expect(result.thresholdsShortReads?.map(t => t.metric)).toEqual([
      "nt:z_score",
      "nt:rpm",
      "nr:count",
      "nt:percent_identity",
      "nr:alignment_length",
      "nt:e_value",
    ]);
    // The original value on each threshold survives the transform.
    expect(result.thresholdsShortReads?.map(t => t.value)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
  });

  it("maps an unrecognised heatmap metric to an undefined suffix rather than throwing", () => {
    const result = getTempSelectedOptions({
      source: HEATMAP_SOURCE_TEMP_PERSISTED_OPTIONS,
      selectedOptions: {
        thresholdFilters: [{ metric: "NT_bogus", value: 1 }],
      } as $TSFixMe,
    });

    expect(result.thresholdsShortReads?.[0].metric).toBe("nt:undefined");
  });

  it("returns an empty threshold list when the heatmap has no threshold filters", () => {
    const result = getTempSelectedOptions({
      source: HEATMAP_SOURCE_TEMP_PERSISTED_OPTIONS,
      selectedOptions: {} as $TSFixMe,
    });

    expect(result.thresholdsShortReads).toEqual([]);
  });

  it("keeps explicitly provided subcategories when categories are absent", () => {
    const result = getTempSelectedOptions({
      source: DISCOVERY_VIEW_SOURCE_TEMP_PERSISTED_OPTIONS,
      selectedOptions: {
        subcategories: { Viruses: ["Phage"] },
      } as $TSFixMe,
    });

    expect(result.categories).toEqual({
      categories: [],
      subcategories: { Viruses: ["Phage"] },
    });
  });
});
