// Coverage:
//   app/assets/src/components/views/SampleView/components/BenchmarkView/components/benchmarkInfoColumnGroup/benchmarkInfoColumnGroup.tsx
//   app/assets/src/components/views/SampleView/components/BenchmarkView/components/BenchmarkSampleReportInfo/columnDefinitions/refColumn/refColumn.tsx
//
// benchmarkInfoColumnGroup's header has a single `!!nRows &&` short circuit;
// refColumn's accessorFn has a `row?.isRef ? "Yes" : "-"` ternary whose optional
// chain also has to be driven with a missing row. Both sides of both, plus the
// undefined-row path, are covered here.
import { render } from "@testing-library/react";
import { benchmarkInfoColumnGroup } from "~/components/views/SampleView/components/BenchmarkView/components/benchmarkInfoColumnGroup/benchmarkInfoColumnGroup";
import { refColumn } from "~/components/views/SampleView/components/BenchmarkView/components/BenchmarkSampleReportInfo/columnDefinitions/refColumn/refColumn";

const fakeHeader = (id = "bench", colSpan = 2, size = 300) => ({
  id,
  colSpan,
  getSize: () => size,
});

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

describe("benchmarkInfoColumnGroup", () => {
  it("passes the column list and colspan straight through", () => {
    const columns = [{ id: "a" }, { id: "b" }, { id: "c" }] as $TSFixMe;
    const group = benchmarkInfoColumnGroup(columns, 7);

    expect(group.id).toBe("benchmarkInfoColumnGroup");
    expect(group.colspan).toBe(3);
    expect(group.columns).toBe(columns);
  });

  it("renders no row-count span when nRows is 0", () => {
    const { container } = renderGroupHeader(
      benchmarkInfoColumnGroup([{ id: "a" }] as $TSFixMe, 0),
    );

    const th = container.querySelector("th") as HTMLElement;
    expect(th.querySelector("span")).toBeNull();
    expect(th.textContent).toBe("");
  });

  it("renders the row count when nRows is non-zero", () => {
    const { container } = renderGroupHeader(
      benchmarkInfoColumnGroup([{ id: "a" }] as $TSFixMe, 12),
    );

    const th = container.querySelector("th") as HTMLElement;
    expect(th.querySelector("span")).not.toBeNull();
    expect(th.textContent).toBe("12 Rows");
  });

  it("takes colSpan and width from the react-table header", () => {
    const { container } = renderGroupHeader(
      benchmarkInfoColumnGroup([{ id: "a" }] as $TSFixMe, 1),
      fakeHeader("bench-info", 5, 96),
    );

    const th = container.querySelector("th") as HTMLElement;
    expect(th.getAttribute("colspan")).toBe("5");
    expect(th.style.width).toBe("96px");
  });
});

describe("refColumn", () => {
  const accessorFn = refColumn.accessorFn as $TSFixMe;

  it("renders 'Yes' for the reference row", () => {
    expect(accessorFn({ isRef: true })).toBe("Yes");
  });

  it("renders a dash for a non-reference row", () => {
    expect(accessorFn({ isRef: false })).toBe("-");
  });

  it("renders a dash when the row itself is missing", () => {
    // Exercises the `row?.` optional-chain short circuit.
    expect(accessorFn(undefined)).toBe("-");
    expect(accessorFn(null)).toBe("-");
  });

  it("renders a sortable REF header sized from the column", () => {
    const HeaderFn = refColumn.header as $TSFixMe;
    const header = {
      id: "isRef",
      colSpan: 1,
      column: {
        getIsSorted: () => false,
        getCanSort: () => true,
        toggleSorting: jest.fn(),
      },
      getContext: () => ({}),
    };
    const column = { getSize: () => 200 };

    const { container } = render(
      <table>
        <thead>
          <tr>{HeaderFn({ header, column })}</tr>
        </thead>
      </table>,
    );

    expect(container.textContent).toContain("REF");
  });
});
