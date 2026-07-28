// Coverage:
//   app/assets/src/components/views/SampleView/components/AmrView/components/AmrSampleReport/columnDefinitions/geneInfoColumnGroup.tsx
//   app/assets/src/components/views/SampleView/components/AmrView/components/AmrSampleReport/columnDefinitions/contigsColumnGroup.tsx
//   app/assets/src/components/views/SampleView/components/AmrView/components/AmrSampleReport/columnDefinitions/readsColumnGroup.tsx
//
// Each of these three factories returns a react-table group descriptor whose
// `header` render function carries the branches we care about:
//   * geneInfo -- the `!!nRows &&` row-count short circuit and the
//     `nRows === 1 ? "Row" : "Rows"` pluralisation ternary.
//   * contigs/reads -- the `isSectionOpen ? chevronLeft : chevronRight` ternary,
//     driven by whether every column in the section is visible.
// Both outcomes of every one of those are exercised below.
import { fireEvent, render, screen } from "@testing-library/react";
import { getContigsColumnGroup } from "~/components/views/SampleView/components/AmrView/components/AmrSampleReport/columnDefinitions/contigsColumnGroup";
import { getGeneInfoColumnGroup } from "~/components/views/SampleView/components/AmrView/components/AmrSampleReport/columnDefinitions/geneInfoColumnGroup";
import { getReadsColumnGroup } from "~/components/views/SampleView/components/AmrView/components/AmrSampleReport/columnDefinitions/readsColumnGroup";

const fakeHeader = (id = "h1", colSpan = 3, size = 240) => ({
  id,
  colSpan,
  getSize: () => size,
});

// Renders a group descriptor's header function inside a real table so the <th>
// is legal DOM.
const renderGroupHeader = (group: $TSFixMe, header = fakeHeader()) => {
  const HeaderFn = group.header as $TSFixMe;
  return render(
    <table>
      <thead>
        <tr>{HeaderFn({ header })}</tr>
      </thead>
    </table>,
  );
};

// A minimal react-table stand-in: only getColumn/getIsVisible/toggleVisibility
// are touched by the code under test.
const fakeTable = (visibilityById: Record<string, boolean>) => {
  const toggles: Record<string, boolean[]> = {};
  return {
    toggles,
    getColumn: (columnId: string) => ({
      getIsVisible: () => visibilityById[columnId] ?? false,
      toggleVisibility: (value: boolean) => {
        toggles[columnId] = toggles[columnId] || [];
        toggles[columnId].push(value);
      },
    }),
  } as $TSFixMe;
};

describe("getGeneInfoColumnGroup", () => {
  it("carries the column list and colspan through to the descriptor", () => {
    const columns = [{ id: "gene" }, { id: "drugClass" }] as $TSFixMe;
    const group = getGeneInfoColumnGroup(columns, 5);

    expect(group.id).toBe("geneInfoHeaderGroup");
    expect(group.colspan).toBe(2);
    expect(group.columns).toBe(columns);
  });

  it("omits the row count entirely when nRows is 0", () => {
    const group = getGeneInfoColumnGroup([{ id: "gene" }] as $TSFixMe, 0);
    renderGroupHeader(group);

    const th = screen.getByTestId("gene-info-group-header");
    // The `!!nRows &&` guard short-circuits, so no <span> is rendered at all.
    expect(th.querySelector("span")).toBeNull();
    expect(th.textContent).toBe("");
  });

  it("uses the singular 'Row' when there is exactly one row", () => {
    const group = getGeneInfoColumnGroup([{ id: "gene" }] as $TSFixMe, 1);
    renderGroupHeader(group);

    const th = screen.getByTestId("gene-info-group-header");
    expect(th.querySelector("span")).not.toBeNull();
    expect(th.textContent).toBe("1 Row");
  });

  it("uses the plural 'Rows' for any other non-zero count", () => {
    const group = getGeneInfoColumnGroup([{ id: "gene" }] as $TSFixMe, 42);
    renderGroupHeader(group);

    expect(screen.getByTestId("gene-info-group-header").textContent).toBe(
      "42 Rows",
    );
  });

  it("applies the header width and colSpan from the react-table header", () => {
    const group = getGeneInfoColumnGroup([{ id: "gene" }] as $TSFixMe, 3);
    renderGroupHeader(group, fakeHeader("gene-info", 4, 175));

    const th = screen.getByTestId("gene-info-group-header") as HTMLElement;
    expect(th.getAttribute("colspan")).toBe("4");
    expect(th.style.width).toBe("175px");
  });
});

const collapsibleGroups = [
  {
    name: "contigs",
    factory: getContigsColumnGroup,
    testId: "contigs-group-header",
    label: "Contigs",
    columnIds: ["contigs", "contigPercentId"],
  },
  {
    name: "reads",
    factory: getReadsColumnGroup,
    testId: "reads-group-header",
    label: "Reads",
    columnIds: ["reads", "readsPercentId"],
  },
];

collapsibleGroups.forEach(({ name, factory, testId, label, columnIds }) => {
  describe(`${name} column group header`, () => {
    const columns = () => columnIds.map(id => ({ id })) as $TSFixMe;

    it("renders the collapse (left) chevron when every column is visible", () => {
      const table = fakeTable(
        Object.fromEntries(columnIds.map(id => [id, true])),
      );
      renderGroupHeader(factory(columns(), table));

      const th = screen.getByTestId(testId);
      expect(th.textContent).toContain(label);
      // Open section -> chevronLeft2. The SDS Icon inlines an <svg> whose clipPath
      // id is derived from the icon component name.
      expect(th.innerHTML).toContain("IconChevronLeft2");
      expect(th.innerHTML).not.toContain("IconChevronRight2");
    });

    it("renders the expand (right) chevron when a column is hidden", () => {
      const visibility = Object.fromEntries(columnIds.map(id => [id, true]));
      visibility[columnIds[1]] = false;
      renderGroupHeader(factory(columns(), fakeTable(visibility)));

      const th = screen.getByTestId(testId);
      expect(th.innerHTML).toContain("IconChevronRight2");
      expect(th.innerHTML).not.toContain("IconChevronLeft2");
    });

    it("opens a closed section on click, leaving every column visible", () => {
      const table = fakeTable({ [columnIds[0]]: true, [columnIds[1]]: false });
      renderGroupHeader(factory(columns(), table));

      fireEvent.click(screen.getByRole("button"));

      // sectionWasOpen === false -> every column in the section is turned on.
      const toggled = Object.values(table.toggles).flat();
      expect(toggled.length).toBeGreaterThan(0);
      expect(toggled.every(v => v === true)).toBe(true);
    });

    it("collapses an open section on click, hiding all but the first column", () => {
      const table = fakeTable(
        Object.fromEntries(columnIds.map(id => [id, true])),
      );
      renderGroupHeader(factory(columns(), table));

      fireEvent.click(screen.getByRole("button"));

      const toggleEntries = Object.entries(table.toggles) as [
        string,
        boolean[],
      ][];
      // sectionWasOpen === true -> the first column stays visible, the rest are
      // hidden. So both `true` and `false` must appear across the section.
      expect(toggleEntries.some(([, values]) => values.includes(true))).toBe(
        true,
      );
      expect(toggleEntries.some(([, values]) => values.includes(false))).toBe(
        true,
      );
    });
  });
});
