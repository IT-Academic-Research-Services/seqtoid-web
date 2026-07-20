// Frontend coverage: AmrSampleReport columnDefinitions/columnDefUtils.ts drives
// AMR table column-visibility: whether a section is fully expanded, persisting
// visibility to localStorage, and toggling a whole section open/closed. We mock
// the react-table instance (getColumn/getIsVisible/toggleVisibility) and use the
// real jsdom localStorage.
import {
  handleSectionOpenToggled,
  isAllColumnsVisible,
  persistColumnVisibilityToLocalStorage,
} from "~/components/views/SampleView/components/AmrView/components/AmrSampleReport/columnDefinitions/columnDefUtils";
import {
  ColumnId,
  ColumnSection,
  LOCAL_STORAGE_AMR_COLUMN_VISIBILITY_KEY,
  SECTION_TO_COLUMN_IDS,
} from "~/components/views/SampleView/components/AmrView/constants";

// Build a fake react-table whose columns report visibility from a lookup map
// and record toggleVisibility calls.
const makeTable = (visibility: Record<string, boolean>) => {
  const toggleCalls: Array<{ id: string; value: boolean }> = [];
  return {
    table: {
      getColumn: (id: string) => ({
        getIsVisible: () => visibility[id],
        toggleVisibility: (value: boolean) => {
          visibility[id] = value;
          toggleCalls.push({ id, value });
        },
      }),
    } as any,
    toggleCalls,
    visibility,
  };
};

beforeEach(() => {
  localStorage.clear();
});

describe("isAllColumnsVisible", () => {
  const columns = [{ id: ColumnId.CONTIGS }, { id: ColumnId.CUTOFF }] as any;

  it("returns true when every column in the group is visible", () => {
    const { table } = makeTable({
      [ColumnId.CONTIGS]: true,
      [ColumnId.CUTOFF]: true,
    });
    expect(isAllColumnsVisible(columns, table)).toBe(true);
  });

  it("returns false when at least one column is hidden", () => {
    const { table } = makeTable({
      [ColumnId.CONTIGS]: true,
      [ColumnId.CUTOFF]: false,
    });
    expect(isAllColumnsVisible(columns, table)).toBe(false);
  });
});

describe("persistColumnVisibilityToLocalStorage", () => {
  it("writes visibility for every ColumnId when the group is ALL", () => {
    persistColumnVisibilityToLocalStorage([ColumnId.GENE, ColumnId.CONTIGS]);

    const stored = JSON.parse(
      localStorage.getItem(LOCAL_STORAGE_AMR_COLUMN_VISIBILITY_KEY) as string,
    );
    // Every ColumnId gets a boolean; the two passed ids are true.
    expect(stored.columnVisibility[ColumnId.GENE]).toBe(true);
    expect(stored.columnVisibility[ColumnId.CONTIGS]).toBe(true);
    expect(stored.columnVisibility[ColumnId.MECHANISM]).toBe(false);
    expect(Object.keys(stored.columnVisibility).length).toBe(
      Object.values(ColumnId).length,
    );
  });

  it("only rewrites the targeted group and preserves other groups' state", () => {
    // Seed local storage with a stale value for a READS-group column.
    localStorage.setItem(
      LOCAL_STORAGE_AMR_COLUMN_VISIBILITY_KEY,
      JSON.stringify({
        columnVisibility: { [ColumnId.READS]: true, [ColumnId.CONTIGS]: true },
      }),
    );

    persistColumnVisibilityToLocalStorage(
      [ColumnId.CONTIGS],
      ColumnSection.CONTIGS,
    );

    const stored = JSON.parse(
      localStorage.getItem(LOCAL_STORAGE_AMR_COLUMN_VISIBILITY_KEY) as string,
    );
    // Untouched READS column keeps its seeded value.
    expect(stored.columnVisibility[ColumnId.READS]).toBe(true);
    // CONTIGS group columns are recomputed: CONTIGS true, CUTOFF (not passed) false.
    expect(stored.columnVisibility[ColumnId.CONTIGS]).toBe(true);
    expect(stored.columnVisibility[ColumnId.CUTOFF]).toBe(false);
  });
});

describe("handleSectionOpenToggled", () => {
  it("collapses an open section to just its first column", () => {
    const sectionIds = SECTION_TO_COLUMN_IDS.get(
      ColumnSection.CONTIGS,
    ) as ColumnId[];
    const initial: Record<string, boolean> = {};
    sectionIds.forEach(id => (initial[id] = true));
    const { table, visibility } = makeTable(initial);

    handleSectionOpenToggled(table, true, ColumnSection.CONTIGS);

    // First column stays visible, the rest are hidden.
    expect(visibility[sectionIds[0]]).toBe(true);
    sectionIds.slice(1).forEach(id => expect(visibility[id]).toBe(false));

    const stored = JSON.parse(
      localStorage.getItem(LOCAL_STORAGE_AMR_COLUMN_VISIBILITY_KEY) as string,
    );
    // Only the first column was persisted as visible in this group.
    expect(stored.columnVisibility[sectionIds[0]]).toBe(true);
    expect(stored.columnVisibility[sectionIds[1]]).toBe(false);
  });

  it("expands a closed section so all its columns become visible", () => {
    const sectionIds = SECTION_TO_COLUMN_IDS.get(
      ColumnSection.CONTIGS,
    ) as ColumnId[];
    const initial: Record<string, boolean> = {};
    sectionIds.forEach((id, idx) => (initial[id] = idx === 0));
    const { table, visibility } = makeTable(initial);

    handleSectionOpenToggled(table, false, ColumnSection.CONTIGS);

    sectionIds.forEach(id => expect(visibility[id]).toBe(true));

    const stored = JSON.parse(
      localStorage.getItem(LOCAL_STORAGE_AMR_COLUMN_VISIBILITY_KEY) as string,
    );
    sectionIds.forEach(id => expect(stored.columnVisibility[id]).toBe(true));
  });
});
