// Coverage: app/assets/src/components/common/DetailsSidebar/SampleDetailsMode/constants.ts
// These constants drive which "Pipeline Info" rows the sidebar renders for each
// workflow, so the assertions below pin the contract the PipelineTab relies on:
// every entry is a {name, key} pair, the keys are unique within a workflow, and
// the workflow-specific fields (Guppy for long read, CARD for AMR, ...) live in
// exactly the lists that should have them.
import * as SampleDetailsConstants from "~/components/common/DetailsSidebar/SampleDetailsMode/constants";
import {
  AMR_WORKFLOW_INFO_FIELDS,
  CG_WORKFLOW_INFO_FIELDS,
  LONG_READ_MNGS_INFO_FIELDS,
  SAMPLE_ADDITIONAL_INFO,
  SHORT_READ_MNGS_INFO_FIELDS,
  SIDEBAR_TABS,
} from "~/components/common/DetailsSidebar/SampleDetailsMode/constants";

const keysOf = (fields: { name: string; key: string }[]) =>
  fields.map(f => f.key);

const ALL_FIELD_LISTS: [string, { name: string; key: string }[]][] = [
  ["short read mNGS", SHORT_READ_MNGS_INFO_FIELDS],
  ["long read mNGS", LONG_READ_MNGS_INFO_FIELDS],
  ["consensus genome", CG_WORKFLOW_INFO_FIELDS],
  ["AMR", AMR_WORKFLOW_INFO_FIELDS],
];

describe("SampleDetailsMode/constants", () => {
  it("exposes the three sidebar tabs in display order", () => {
    expect(SIDEBAR_TABS).toEqual(["Metadata", "Pipelines", "Notes"]);
  });

  it("lists the sample header fields with their server keys", () => {
    expect(SAMPLE_ADDITIONAL_INFO).toEqual([
      { name: "Sample Name", key: "name" },
      { name: "Project", key: "project_name" },
      { name: "Upload Date", key: "upload_date" },
      { name: "Host", key: "host_genome_name" },
    ]);
  });

  describe.each(ALL_FIELD_LISTS)("%s info fields", (_label, fields) => {
    it("is a non-empty list of {name, key} pairs", () => {
      expect(fields.length).toBeGreaterThan(0);
      fields.forEach(field => {
        expect(typeof field.name).toBe("string");
        expect(field.name.length).toBeGreaterThan(0);
        expect(typeof field.key).toBe("string");
        expect(field.key.length).toBeGreaterThan(0);
      });
    });

    it("has no duplicate keys", () => {
      const keys = keysOf(fields);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it("always starts with Analysis Type followed by Sequencing Platform", () => {
      expect(fields[0]).toEqual({ name: "Analysis Type", key: "analysisType" });
      expect(fields[1]).toEqual({
        name: "Sequencing Platform",
        key: "technology",
      });
    });

    it("ends with Date Processed", () => {
      expect(fields[fields.length - 1]).toEqual({
        name: "Date Processed",
        key: "lastProcessedAt",
      });
    });
  });

  it("only shows the Guppy basecaller version for long-read mNGS", () => {
    expect(keysOf(LONG_READ_MNGS_INFO_FIELDS)).toContain(
      "guppyBasecallerVersion",
    );
    expect(keysOf(SHORT_READ_MNGS_INFO_FIELDS)).not.toContain(
      "guppyBasecallerVersion",
    );
    expect(keysOf(CG_WORKFLOW_INFO_FIELDS)).not.toContain(
      "guppyBasecallerVersion",
    );
    expect(keysOf(AMR_WORKFLOW_INFO_FIELDS)).not.toContain(
      "guppyBasecallerVersion",
    );
  });

  it("only shows CARD/wildcard database versions for AMR", () => {
    expect(keysOf(AMR_WORKFLOW_INFO_FIELDS)).toEqual(
      expect.arrayContaining([
        "cardDatabaseVersion",
        "wildcardDatabaseVersion",
      ]),
    );
    [
      SHORT_READ_MNGS_INFO_FIELDS,
      LONG_READ_MNGS_INFO_FIELDS,
      CG_WORKFLOW_INFO_FIELDS,
    ].forEach(fields => {
      expect(keysOf(fields)).not.toContain("cardDatabaseVersion");
      expect(keysOf(fields)).not.toContain("wildcardDatabaseVersion");
    });
  });

  it("only shows wetlab protocol, medaka model and mapped reads for consensus genome", () => {
    expect(keysOf(CG_WORKFLOW_INFO_FIELDS)).toEqual(
      expect.arrayContaining(["wetlabProtocol", "medakaModel", "mappedReads"]),
    );
    [
      SHORT_READ_MNGS_INFO_FIELDS,
      LONG_READ_MNGS_INFO_FIELDS,
      AMR_WORKFLOW_INFO_FIELDS,
    ].forEach(fields => {
      expect(keysOf(fields)).not.toContain("wetlabProtocol");
      expect(keysOf(fields)).not.toContain("medakaModel");
      expect(keysOf(fields)).not.toContain("mappedReads");
    });
  });

  it("reports mean insert size and compression ratio only for Illumina-based workflows", () => {
    // Short read mNGS and AMR are Illumina-only, so they surface insert size.
    expect(keysOf(SHORT_READ_MNGS_INFO_FIELDS)).toContain("meanInsertSize");
    expect(keysOf(AMR_WORKFLOW_INFO_FIELDS)).toContain("meanInsertSize");
    expect(keysOf(LONG_READ_MNGS_INFO_FIELDS)).not.toContain("meanInsertSize");
    expect(keysOf(CG_WORKFLOW_INFO_FIELDS)).not.toContain("meanInsertSize");
    expect(keysOf(SHORT_READ_MNGS_INFO_FIELDS)).toContain("compressionRatio");
    expect(keysOf(LONG_READ_MNGS_INFO_FIELDS)).not.toContain(
      "compressionRatio",
    );
  });

  it("shares the common read-count fields across every workflow", () => {
    ALL_FIELD_LISTS.forEach(([, fields]) => {
      expect(keysOf(fields)).toEqual(
        expect.arrayContaining([
          "analysisType",
          "technology",
          "pipelineVersion",
          "totalReads",
          "totalErccReads",
          "lastProcessedAt",
        ]),
      );
    });
  });

  it("exposes no external host filtering wiki link (no seqtoid-workflows equivalent)", () => {
    // The czid-workflows host-filtering wiki page was not carried over to the
    // seqtoid-workflows fork, so the tooltip link was removed rather than
    // repointed. This pins that a dead external link is not reintroduced.
    expect(
      (SampleDetailsConstants as Record<string, unknown>).HOST_FILTERING_WIKI,
    ).toBeUndefined();
  });
});
