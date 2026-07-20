// CZID-462 coverage: pure helpers in
// app/assets/src/components/views/DiscoveryView/components/SamplesView/components/BulkDownloadModal/utils.ts
// The parseValidationInfo family is already covered by bulkDownloadUtils.test.ts;
// this file pins the remaining synchronous helpers: conditional-field triggering,
// selected-download assembly, and the Rails sample-id extractors.
import {
  assembleSelectedDownload,
  getRailsSampleIdsFromSamples,
  getRailsSampleIdsFromWorkflowRuns,
  parseRailsIsUserOwnerOfAllObjects,
  triggersConditionalField,
  triggersCondtionalFieldMetricList,
} from "../app/assets/src/components/views/DiscoveryView/components/SamplesView/components/BulkDownloadModal/utils";

describe("triggersCondtionalFieldMetricList", () => {
  // filter_by metrics use '_' as separator internally; bulk downloads compare
  // against a '.'-separated trigger list, so the first underscore is swapped.
  const field = { triggerValues: ["nt.rpm", "nr.count"] };

  it("returns true when a selected metric (after '_' -> '.') is a trigger value", () => {
    const selected = { filter_by: [{ metric: "nt_rpm" }] };
    expect(triggersCondtionalFieldMetricList(field, selected)).toBe(true);
  });

  it("returns false when no selected metric matches a trigger value", () => {
    const selected = { filter_by: [{ metric: "nt_zscore" }] };
    expect(triggersCondtionalFieldMetricList(field, selected)).toBe(false);
  });

  it("only rewrites the first underscore", () => {
    // 'nr_count_extra' -> 'nr.count_extra', which is not in triggerValues.
    const selected = { filter_by: [{ metric: "nr_count_extra" }] };
    expect(triggersCondtionalFieldMetricList(field, selected)).toBe(false);
    // But the exact trigger 'nr_count' -> 'nr.count' does match.
    expect(
      triggersCondtionalFieldMetricList(field, {
        filter_by: [{ metric: "nr_count" }],
      }),
    ).toBe(true);
  });
});

describe("triggersConditionalField", () => {
  it("triggers via the filter_by metric-list branch", () => {
    const field = {
      dependentFields: ["filter_by"],
      triggerValues: ["nt.rpm"],
    };
    expect(
      triggersConditionalField(field, { filter_by: [{ metric: "nt_rpm" }] }),
    ).toBe(true);
    expect(
      triggersConditionalField(field, { filter_by: [{ metric: "nt_zscore" }] }),
    ).toBe(false);
  });

  it("triggers via a plain dependent field whose value is a trigger value", () => {
    const field = {
      dependentFields: ["file_format"],
      triggerValues: ["fasta"],
    };
    expect(triggersConditionalField(field, { file_format: "fasta" })).toBe(
      true,
    );
    expect(triggersConditionalField(field, { file_format: "fastq" })).toBe(
      false,
    );
  });

  it("is true if ANY dependent field triggers (some semantics)", () => {
    const field = {
      dependentFields: ["file_format", "metric"],
      triggerValues: ["fasta", "nt_rpm"],
    };
    // Neither matches -> false.
    expect(
      triggersConditionalField(field, {
        file_format: "fastq",
        metric: "nr_count",
      }),
    ).toBe(false);
    // Second field matches -> true.
    expect(
      triggersConditionalField(field, {
        file_format: "fastq",
        metric: "nt_rpm",
      }),
    ).toBe(true);
  });

  it("falls back to the value-lookup branch when filter_by is absent", () => {
    const field = { dependentFields: ["filter_by"], triggerValues: ["x"] };
    // No filter_by key -> get('filter_by', {...}) is undefined, not in triggers.
    expect(triggersConditionalField(field, { other: 1 })).toBe(false);
  });
});

describe("assembleSelectedDownload", () => {
  it("builds fields with display-name fallback and materializes object ids", () => {
    const result = assembleSelectedDownload(
      "reads_non_host",
      { reads_non_host: { file_format: ".fasta", taxa_with_reads: 573 } },
      { reads_non_host: { file_format: "FASTA" } }, // no display for taxa_with_reads
      new Set(["1", "2", "3"]),
      "short-read-mngs",
      "Sample",
    );

    expect(result).toEqual({
      downloadType: "reads_non_host",
      fields: {
        file_format: { value: ".fasta", displayName: "FASTA" },
        // falls back to the raw value when no display name exists
        taxa_with_reads: { value: 573, displayName: 573 },
      },
      validObjectIds: ["1", "2", "3"],
      workflow: "short-read-mngs",
      workflowEntity: "Sample",
    });
  });

  it("yields an empty fields object when the download type has no selected fields", () => {
    const result = assembleSelectedDownload(
      "sample_metadata",
      {}, // nothing selected for this type
      {},
      new Set(["9"]),
      "amr",
      "WorkflowRun",
    );
    expect(result.fields).toEqual({});
    expect(result.validObjectIds).toEqual(["9"]);
    expect(result.downloadType).toBe("sample_metadata");
  });
});

describe("getRailsSampleIdsFromWorkflowRuns", () => {
  const objects = [
    { id: "wr1", sample: { id: "s1" } },
    { id: "wr2", sample: { id: "s2" } },
    { id: "wr3", sample: { id: "s3" } },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ] as any;

  it("maps only the workflow runs whose id is valid to their sample ids", () => {
    expect(
      getRailsSampleIdsFromWorkflowRuns(objects, new Set(["wr1", "wr3"])),
    ).toEqual(["s1", "s3"]);
  });

  it("returns an empty list when none of the objects are valid", () => {
    expect(
      getRailsSampleIdsFromWorkflowRuns(objects, new Set(["nope"])),
    ).toEqual([]);
  });
});

describe("getRailsSampleIdsFromSamples", () => {
  it("returns the valid ids directly, ignoring the objects argument", () => {
    expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getRailsSampleIdsFromSamples([] as any, new Set(["a", "b"])),
    ).toEqual(["a", "b"]);
  });

  it("returns an empty array when validObjectIds is nullish", () => {
    expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getRailsSampleIdsFromSamples([] as any, undefined as any),
    ).toEqual([]);
  });
});

describe("parseRailsIsUserOwnerOfAllObjects", () => {
  it("passes the third argument through and coerces nullish to false", () => {
    expect(parseRailsIsUserOwnerOfAllObjects(null, null, true)).toBe(true);
    expect(parseRailsIsUserOwnerOfAllObjects(null, null, false)).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(parseRailsIsUserOwnerOfAllObjects(null, null, null as any)).toBe(
      false,
    );
  });
});
