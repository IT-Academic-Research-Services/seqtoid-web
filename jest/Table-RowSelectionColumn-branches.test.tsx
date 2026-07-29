// Coverage: app/assets/src/components/ui/Table/columnDefinitions/RowSelectionColumn/RowSelectionColumn.tsx
//
// This is a react-table column definition rather than a component, so the
// header/cell renderers are pulled off the definition and rendered directly
// with hand-built table/row/column doubles. The branches are the nested
// checked / indeterminate / unchecked ternary in the header and the
// selected / unselected ternary in the cell -- all four arms below.
import { fireEvent, render } from "@testing-library/react";
import { rowSelectionColumn } from "~/components/ui/Table/columnDefinitions/RowSelectionColumn/RowSelectionColumn";

// The SDS checkbox does not surface `stage` in the DOM, so it is stubbed to
// expose the value the column computed.
jest.mock("@czi-sds/components", () => ({
  CellHeader: ({
    children,
    style,
  }: {
    children: React.ReactNode;
    style: React.CSSProperties;
  }) => (
    <div data-testid="cell-header" data-width={String(style?.width)}>
      {children}
    </div>
  ),
  CellComponent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="cell">{children}</div>
  ),
  InputCheckbox: ({
    stage,
    onChange,
  }: {
    stage: string;
    onChange: () => void;
  }) => (
    <button data-testid="checkbox" data-stage={stage} onClick={onChange}>
      checkbox
    </button>
  ),
}));

const column = { getSize: () => 40 } as $TSFixMe;
const header = { id: "select-header" } as $TSFixMe;
const cell = { id: "select-cell" } as $TSFixMe;

const renderHeader = ({
  allSelected,
  someSelected,
}: {
  allSelected: boolean;
  someSelected: boolean;
}) => {
  const toggleAll = jest.fn();
  const table = {
    getIsAllRowsSelected: () => allSelected,
    getIsSomeRowsSelected: () => someSelected,
    getToggleAllRowsSelectedHandler: () => toggleAll,
  } as $TSFixMe;
  const HeaderRenderer = rowSelectionColumn.header as $TSFixMe;
  const { container } = render(
    <HeaderRenderer table={table} column={column} header={header} />,
  );
  return { container, toggleAll };
};

const renderCell = ({ selected }: { selected: boolean }) => {
  const toggle = jest.fn();
  const row = {
    getIsSelected: () => selected,
    getToggleSelectedHandler: () => toggle,
  } as $TSFixMe;
  const CellRenderer = rowSelectionColumn.cell as $TSFixMe;
  const { container } = render(<CellRenderer row={row} cell={cell} />);
  return { container, toggle };
};

const stageOf = (container: HTMLElement) =>
  container
    .querySelector("[data-testid='checkbox']")
    ?.getAttribute("data-stage");

describe("rowSelectionColumn", () => {
  it("pins the column to a fixed 40px width", () => {
    expect(rowSelectionColumn.id).toBe("select");
    expect(rowSelectionColumn.size).toBe(40);
    expect(rowSelectionColumn.minSize).toBe(40);
    expect(rowSelectionColumn.maxSize).toBe(40);
  });

  describe("header checkbox stage", () => {
    it("is checked when every row is selected", () => {
      const { container } = renderHeader({
        allSelected: true,
        someSelected: false,
      });

      expect(stageOf(container)).toBe("checked");
    });

    it("stays checked even if react-table also reports a partial selection", () => {
      // getIsAllRowsSelected wins the outer ternary.
      const { container } = renderHeader({
        allSelected: true,
        someSelected: true,
      });

      expect(stageOf(container)).toBe("checked");
    });

    it("is indeterminate when only some rows are selected", () => {
      const { container } = renderHeader({
        allSelected: false,
        someSelected: true,
      });

      expect(stageOf(container)).toBe("indeterminate");
    });

    it("is unchecked when nothing is selected", () => {
      const { container } = renderHeader({
        allSelected: false,
        someSelected: false,
      });

      expect(stageOf(container)).toBe("unchecked");
    });

    it("forwards the width style and the select-all handler", () => {
      const { container, toggleAll } = renderHeader({
        allSelected: false,
        someSelected: false,
      });

      expect(
        container
          .querySelector("[data-testid='cell-header']")
          ?.getAttribute("data-width"),
      ).toBe("40px");

      fireEvent.click(
        container.querySelector("[data-testid='checkbox']") as Element,
      );
      expect(toggleAll).toHaveBeenCalledTimes(1);
    });
  });

  describe("cell checkbox stage", () => {
    it("is checked for a selected row", () => {
      const { container } = renderCell({ selected: true });

      expect(stageOf(container)).toBe("checked");
    });

    it("is unchecked for an unselected row", () => {
      const { container } = renderCell({ selected: false });

      expect(stageOf(container)).toBe("unchecked");
    });

    it("forwards the per-row toggle handler", () => {
      const { container, toggle } = renderCell({ selected: false });

      fireEvent.click(
        container.querySelector("[data-testid='checkbox']") as Element,
      );
      expect(toggle).toHaveBeenCalledTimes(1);
    });
  });
});
