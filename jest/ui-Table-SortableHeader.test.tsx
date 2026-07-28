// Coverage for SortableHeader, the shared TanStack-table header cell. The
// interesting logic is the click handler's three-way sort decision (already
// desc -> asc, already asc -> desc, not sorted -> follow isSortDefaultDesc)
// plus the sortable / tooltip flags handed down to the SDS CellHeader.
import { fireEvent, render, screen } from "@testing-library/react";
import { SortableHeader } from "~/components/ui/Table/components/SortableHeader/SortableHeader";

// The SDS CellHeader renders MUI internals (tooltips, sort icons) that are not
// what this unit is about; stub it so the props the component computes are
// directly observable.
const cellHeaderProps: Record<string, unknown>[] = [];

jest.mock("@czi-sds/components", () => ({
  CellHeader: ({
    children,
    onClick,
    ...rest
  }: {
    children: React.ReactNode;
    onClick: () => void;
    [key: string]: unknown;
  }) => {
    cellHeaderProps.push({ onClick, ...rest });
    return (
      <th data-testid="cell-header" onClick={onClick}>
        {children}
      </th>
    );
  },
}));

const lastProps = () => cellHeaderProps[cellHeaderProps.length - 1];

const makeHeader = ({
  canSort = true,
  sorted = false as false | "asc" | "desc",
  toggleSorting = jest.fn(),
  id = "reads",
}) =>
  ({
    id,
    column: {
      getCanSort: () => canSort,
      getIsSorted: () => sorted,
      toggleSorting,
    },
  } as unknown as Parameters<typeof SortableHeader>[0]["header"]);

const renderHeader = (
  props: Partial<Parameters<typeof SortableHeader>[0]> & {
    header: Parameters<typeof SortableHeader>[0]["header"];
  },
) =>
  render(
    <table>
      <thead>
        <tr>
          <SortableHeader {...props}>
            {props.children ?? "Reads"}
          </SortableHeader>
        </tr>
      </thead>
    </table>,
  );

describe("SortableHeader", () => {
  beforeEach(() => {
    cellHeaderProps.length = 0;
  });

  it("renders its children inside the header cell", () => {
    renderHeader({ header: makeHeader({}) });
    expect(screen.getByTestId("cell-header").textContent).toBe("Reads");
  });

  it("switches a descending column to ascending on click", () => {
    const toggleSorting = jest.fn();
    renderHeader({ header: makeHeader({ sorted: "desc", toggleSorting }) });

    fireEvent.click(screen.getByTestId("cell-header"));

    expect(toggleSorting).toHaveBeenCalledWith(false);
  });

  it("switches an ascending column back to descending on click", () => {
    const toggleSorting = jest.fn();
    renderHeader({ header: makeHeader({ sorted: "asc", toggleSorting }) });

    fireEvent.click(screen.getByTestId("cell-header"));

    expect(toggleSorting).toHaveBeenCalledWith(true);
  });

  it("defaults an unsorted column to descending", () => {
    const toggleSorting = jest.fn();
    renderHeader({ header: makeHeader({ sorted: false, toggleSorting }) });

    fireEvent.click(screen.getByTestId("cell-header"));

    expect(toggleSorting).toHaveBeenCalledWith(true);
  });

  it("honours isSortDefaultDesc=false for an unsorted column", () => {
    const toggleSorting = jest.fn();
    renderHeader({
      header: makeHeader({ sorted: false, toggleSorting }),
      isSortDefaultDesc: false,
    });

    fireEvent.click(screen.getByTestId("cell-header"));

    expect(toggleSorting).toHaveBeenCalledWith(false);
  });

  it("ignores isSortDefaultDesc once the column is already sorted", () => {
    const toggleSorting = jest.fn();
    renderHeader({
      header: makeHeader({ sorted: "asc", toggleSorting }),
      isSortDefaultDesc: false,
    });

    fireEvent.click(screen.getByTestId("cell-header"));

    // Active column toggles relative to its own direction, not the default.
    expect(toggleSorting).toHaveBeenCalledWith(true);
  });

  it("marks an unsorted column inactive with no direction", () => {
    renderHeader({ header: makeHeader({ sorted: false }) });

    expect(lastProps().active).toBe(false);
    expect(lastProps().direction).toBeUndefined();
  });

  it("marks a sorted column active and forwards its direction", () => {
    renderHeader({ header: makeHeader({ sorted: "desc" }) });

    expect(lastProps().active).toBe(true);
    expect(lastProps().direction).toBe("desc");
  });

  it("hides the sort icon when the column cannot be sorted", () => {
    renderHeader({ header: makeHeader({ canSort: false }) });

    expect(lastProps().hideSortIcon).toBe(true);
  });

  it("shows the sort icon when the column can be sorted", () => {
    renderHeader({ header: makeHeader({ canSort: true }) });

    expect(lastProps().hideSortIcon).toBe(false);
  });

  it("disables the hover tooltip when no tooltip strings are given", () => {
    renderHeader({ header: makeHeader({}) });

    expect(lastProps().shouldShowTooltipOnHover).toBe(false);
  });

  it("enables the hover tooltip and renders the tooltip body when strings are given", () => {
    renderHeader({
      header: makeHeader({}),
      tooltipStrings: {
        boldText: "Reads",
        regularText: "Number of reads aligning to the taxon.",
      },
    });

    expect(lastProps().shouldShowTooltipOnHover).toBe(true);
    const tooltipProps = lastProps().tooltipProps as {
      title: React.ReactElement;
      enterNextDelay: number;
    };
    expect(tooltipProps.enterNextDelay).toBe(800);
    // Render the tooltip title element on its own to confirm it is the
    // populated TooltipText rather than the null-returning empty case.
    const { container } = render(<div>{tooltipProps.title}</div>);
    expect(container.textContent).toContain("Reads");
    expect(container.textContent).toContain("Number of reads");
  });

  it("passes extra props (e.g. style) through to the header cell", () => {
    renderHeader({
      header: makeHeader({}),
      style: { width: 120 },
      className: "custom-class",
    });

    expect(lastProps().style).toEqual({ width: 120 });
    expect(String(lastProps().className)).toContain("custom-class");
  });
});
