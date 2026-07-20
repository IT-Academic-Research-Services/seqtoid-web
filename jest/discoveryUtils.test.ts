// CZID-462 coverage: app/assets/src/components/views/DiscoveryView/utils.ts
// Pure filter-preparation + sessionStorage order-key helpers. These translate
// UI filter selections into the shapes the Rails and NextGen APIs expect, so
// their branch behavior (time ranges, taxon flattening, threshold validation)
// is exactly the kind of logic worth pinning.
import moment from "moment";
import { WORKFLOWS } from "~/components/utils/workflows";
import {
  TAB_PROJECTS,
  TAB_SAMPLES,
  TAB_VISUALIZATIONS,
} from "../app/assets/src/components/views/DiscoveryView/constants";
import {
  getOrderByKeyFor,
  getOrderDirKeyFor,
  getOrderKeyPrefix,
  getSessionOrderFieldsKeys,
  prepareFilters,
  prepareNextGenFilters,
} from "../app/assets/src/components/views/DiscoveryView/utils";

describe("DiscoveryView/utils order-key helpers", () => {
  describe("getOrderKeyPrefix", () => {
    it("namespaces the samples tab per workflow", () => {
      expect(getOrderKeyPrefix(TAB_SAMPLES, "amr")).toBe("samples-amr");
    });

    it("uses only the tab name for non-samples tabs", () => {
      expect(getOrderKeyPrefix(TAB_PROJECTS, "amr")).toBe("projects");
      expect(getOrderKeyPrefix(TAB_VISUALIZATIONS, "amr")).toBe(
        "visualizations",
      );
    });
  });

  describe("getOrderByKeyFor / getOrderDirKeyFor", () => {
    it("appends the OrderBy / OrderDir suffix to the prefix", () => {
      expect(getOrderByKeyFor(TAB_SAMPLES, "amr")).toBe("samples-amrOrderBy");
      expect(getOrderDirKeyFor(TAB_SAMPLES, "amr")).toBe("samples-amrOrderDir");
      expect(getOrderByKeyFor(TAB_PROJECTS)).toBe("projectsOrderBy");
      expect(getOrderDirKeyFor(TAB_PROJECTS)).toBe("projectsOrderDir");
    });
  });

  describe("getSessionOrderFieldsKeys", () => {
    it("emits an OrderBy+OrderDir pair for projects, visualizations and every workflow", () => {
      const keys = getSessionOrderFieldsKeys();
      const workflowCount = Object.keys(WORKFLOWS).length;
      // projects (2) + visualizations (2) + 2 per workflow
      expect(keys).toHaveLength(4 + workflowCount * 2);

      // No duplicates -- each key must be distinct so session values don't clobber.
      expect(new Set(keys).size).toBe(keys.length);

      expect(keys).toContain("projectsOrderBy");
      expect(keys).toContain("projectsOrderDir");
      expect(keys).toContain("visualizationsOrderBy");
      expect(keys).toContain("visualizationsOrderDir");
      // Each workflow contributes a samples-namespaced pair.
      Object.keys(WORKFLOWS).forEach(wf => {
        expect(keys).toContain(`samples-${wf}OrderBy`);
        expect(keys).toContain(`samples-${wf}OrderDir`);
      });
    });
  });
});

describe("prepareFilters (Rails filter shape)", () => {
  it("strips the 'Selected' suffix from passthrough filter keys", () => {
    const result = prepareFilters({
      hostSelected: [1, 2],
      tissueSelected: ["blood"],
      visibilitySelected: "public",
    });
    expect(result).toEqual({
      host: [1, 2],
      tissue: ["blood"],
      visibility: "public",
    });
    // The suffixed keys must not survive.
    expect(result).not.toHaveProperty("hostSelected");
  });

  it("does not emit time/taxon keys when those filters are absent", () => {
    const result = prepareFilters({ hostSelected: [1] });
    expect(result).not.toHaveProperty("time");
    expect(result).not.toHaveProperty("taxon");
    expect(result).not.toHaveProperty("taxaLevels");
    expect(result).not.toHaveProperty("taxonThresholds");
  });

  describe("timeSelected -> [start, end] date range", () => {
    beforeEach(() => {
      // Fixed, non-DST-transition instant so day math is stable.
      jest.useFakeTimers("modern");
      jest.setSystemTime(new Date("2023-06-15T12:00:00Z"));
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    const spanInDays = (range: string[]) =>
      moment(range[1], "YYYYMMDD").diff(moment(range[0], "YYYYMMDD"), "days");

    it("formats a 1-week window as [now-7d, now+1d]", () => {
      const { time } = prepareFilters({ timeSelected: "1_week" });
      expect(time).toHaveLength(2);
      // end is now + 1 day
      expect(time[1]).toBe(
        moment("2023-06-15T12:00:00Z").add(1, "days").format("YYYYMMDD"),
      );
      // start is now - 7 days -> span of 8 days
      expect(spanInDays(time)).toBe(8);
    });

    it("uses progressively earlier start dates for wider windows", () => {
      const week = prepareFilters({ timeSelected: "1_week" }).time;
      const month = prepareFilters({ timeSelected: "1_month" }).time;
      const sixMonth = prepareFilters({ timeSelected: "6_month" }).time;
      const year = prepareFilters({ timeSelected: "1_year" }).time;
      // All share the same end date.
      expect(month[1]).toBe(week[1]);
      // Wider window -> earlier (smaller) start date string.
      expect(month[0] < week[0]).toBe(true);
      expect(sixMonth[0] < month[0]).toBe(true);
      expect(year[0] < sixMonth[0]).toBe(true);
    });
  });

  describe("taxonSelected -> flattened taxon + level arrays", () => {
    it("splits complete taxon options into parallel id and level arrays", () => {
      const result = prepareFilters({
        taxonSelected: [
          { id: 101, name: "E. coli", level: "species" },
          { id: 202, name: "Salmonella", level: "genus" },
        ],
      });
      expect(result.taxon).toEqual([101, 202]);
      expect(result.taxaLevels).toEqual(["species", "genus"]);
    });

    it("ignores an empty taxon selection", () => {
      const result = prepareFilters({ taxonSelected: [] });
      expect(result).not.toHaveProperty("taxon");
      expect(result).not.toHaveProperty("taxaLevels");
    });
  });

  describe("taxonThresholdsSelected -> API threshold objects", () => {
    it("keeps nt/nr thresholds and upcases the count type", () => {
      const result = prepareFilters({
        taxonThresholdsSelected: [
          { metric: "nt:count", operator: ">=", value: 5 },
          { metric: "nr:rpm", operator: "<=", value: 10 },
        ],
      });
      expect(result.taxonThresholds).toEqual([
        { metric: "count", count_type: "NT", operator: ">=", value: 5 },
        { metric: "rpm", count_type: "NR", operator: "<=", value: 10 },
      ]);
    });

    it("drops thresholds whose metric prefix is not nt/nr or is malformed", () => {
      const result = prepareFilters({
        taxonThresholdsSelected: [
          { metric: "zz:count", operator: ">=", value: 1 }, // bad count type
          { metric: "count", operator: ">=", value: 2 }, // no ':' separator
          { metric: "nt:zscore", operator: ">", value: 3 }, // valid, kept
        ],
      });
      expect(result.taxonThresholds).toEqual([
        { metric: "zscore", count_type: "NT", operator: ">", value: 3 },
      ]);
    });

    it("returns an empty array when every threshold is invalid", () => {
      const result = prepareFilters({
        taxonThresholdsSelected: [{ metric: "bad", operator: ">", value: 1 }],
      });
      expect(result.taxonThresholds).toEqual([]);
    });
  });
});

describe("prepareNextGenFilters (NextGen filter shape)", () => {
  it("maps selected taxa to their names and defaults to an empty list", () => {
    expect(
      prepareNextGenFilters({
        taxonSelected: [
          { id: 1, name: "E. coli", level: "species" },
          { id: 2, name: "Salmonella", level: "genus" },
        ],
      }).taxonNames,
    ).toEqual(["E. coli", "Salmonella"]);

    expect(prepareNextGenFilters({}).taxonNames).toEqual([]);
  });

  it("omits startedAtIso when no time filter is selected", () => {
    expect(prepareNextGenFilters({}).startedAtIso).toBeUndefined();
  });

  describe("timeSelected -> startedAtIso", () => {
    beforeEach(() => {
      jest.useFakeTimers("modern");
      jest.setSystemTime(new Date("2023-06-15T12:00:00Z"));
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it("sets startedAtIso to exactly 7 days ago for 1_week", () => {
      const { startedAtIso } = prepareNextGenFilters({
        timeSelected: "1_week",
      });
      const deltaDays =
        (Date.parse("2023-06-15T12:00:00Z") - Date.parse(startedAtIso)) /
        (24 * 3600 * 1000);
      expect(Math.round(deltaDays)).toBe(7);
    });

    it("produces earlier start instants for wider windows (switch branches)", () => {
      const t = (sel: string) =>
        Date.parse(prepareNextGenFilters({ timeSelected: sel }).startedAtIso);
      const now = Date.parse("2023-06-15T12:00:00Z");
      expect(t("1_week")).toBeLessThan(now);
      expect(t("1_month")).toBeLessThan(t("1_week"));
      expect(t("3_month")).toBeLessThan(t("1_month"));
      expect(t("6_month")).toBeLessThan(t("3_month"));
      expect(t("1_year")).toBeLessThan(t("6_month"));
    });

    it("defaults startedAtIso to now for an unrecognized time token", () => {
      // Any non-null token enters the block and startedAtIso is assigned
      // unconditionally after the switch; an unmatched token leaves the date
      // at "now" rather than shifting it back (see report note).
      expect(
        prepareNextGenFilters({ timeSelected: "all_time" }).startedAtIso,
      ).toBe(new Date("2023-06-15T12:00:00Z").toISOString());
    });
  });
});
