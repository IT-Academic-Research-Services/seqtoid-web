// CZID-462 (#586) coverage: constant-only util modules
// features.ts / resultsFolder.ts / documentationLinks.ts carry no branching
// logic; importing and spot-checking a few values locks in their coverage.
import * as documentationLinks from "../app/assets/src/components/utils/documentationLinks";
import {
  AMR_DEPRECATED_FEATURE,
  BENCHMARKING_FEATURE,
  EDIT_SNAPSHOT_LINKS_FEATURE,
  SAMPLES_TABLE_METADATA_COLUMNS_ADMIN_FEATURE,
  SORTING_V0_ADMIN_FEATURE,
} from "../app/assets/src/components/utils/features";
import {
  READ_DEDUP_KEYS,
  RESULTS_FOLDER_ROOT_KEY,
  RESULTS_FOLDER_STAGE_KEYS,
  RESULTS_FOLDER_STEP_KEYS,
} from "../app/assets/src/components/utils/resultsFolder";

describe("utils/features.ts", () => {
  it("exposes the feature-flag string constants", () => {
    expect(AMR_DEPRECATED_FEATURE).toBe("AMR");
    expect(SORTING_V0_ADMIN_FEATURE).toBe("sorting_v0_admin");
    expect(SAMPLES_TABLE_METADATA_COLUMNS_ADMIN_FEATURE).toBe(
      "samples_table_metadata_columns_admin",
    );
    expect(EDIT_SNAPSHOT_LINKS_FEATURE).toBe("edit_snapshot_links");
    expect(BENCHMARKING_FEATURE).toBe("benchmarking");
  });
});

describe("utils/resultsFolder.ts", () => {
  it("exposes the stage/step key maps and dedup keys", () => {
    expect(RESULTS_FOLDER_STAGE_KEYS.stageNameKey).toBe("name");
    expect(RESULTS_FOLDER_STEP_KEYS.filesKey).toBe("fileList");
    expect(RESULTS_FOLDER_ROOT_KEY).toBe("displayedData");
    expect(READ_DEDUP_KEYS).toEqual(
      expect.arrayContaining(["runCZIDDedup", "czid_dedup_out"]),
    );
  });
});

describe("utils/documentationLinks.ts", () => {
  it("exposes documentation URLs", () => {
    expect(documentationLinks.NEXTCLADE_APP_LINK).toBe(
      "https://clades.nextstrain.org/",
    );
    // Help-center links are authored as "helpcenter:" sentinel paths and resolved
    // to the environment host at render by Link.tsx (SW-2).
    expect(documentationLinks.CONTACT_US_LINK).toBe("helpcenter:/contact");
    // Every exported link should be a non-empty string.
    Object.values(documentationLinks).forEach(link => {
      expect(typeof link).toBe("string");
      expect((link as string).length).toBeGreaterThan(0);
    });
  });
});
