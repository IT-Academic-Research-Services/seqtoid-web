// Coverage: app/assets/src/components/views/SampleView/components/AmrView/
//   components/AmrSampleReport/columnDefinitions/reads.tsx
//
// The Reads column definition. Unlike the percent columns it parses the raw
// value with parseFloat and does NOT round, so the accessor tests pin that
// difference alongside the null -> -1 sentinel branch. The header is the
// sortable "Reads" cell and the memoized cell swaps to the no-content fallback
// on the sentinel. SDS primitives are stubbed to expose the computed props.
import { render, screen } from "@testing-library/react";

jest.mock("@czi-sds/components", () => {
  const ReactLib = require("react");
  return {
    CellBasic: (props: $TSFixMe) =>
      ReactLib.createElement("div", {
        "data-testid": "cell-basic",
        "data-primary-text": String(props.primaryText),
        style: props.style,
      }),
    CellHeader: (props: $TSFixMe) =>
      ReactLib.createElement(
        "th",
        {
          "data-testid": "cell-header",
          "data-active": String(props.active),
          "data-direction": String(props.direction),
          style: props.style,
          onClick: props.onClick,
        },
        props.children,
      ),
  };
});

import { readsColumn } from "~/components/views/SampleView/components/AmrView/components/AmrSampleReport/columnDefinitions/reads";

const accessor = readsColumn.accessorFn as (
  row: $TSFixMe,
  index: number,
) => number;

const makeColumn = () => ({ getSize: () => 82 });

const makeHeader = (
  sorted: false | "asc" | "desc" = false,
  toggleSorting = jest.fn(),
) => ({
  id: "reads",
  column: {
    getCanSort: () => true,
    getIsSorted: () => sorted,
    toggleSorting,
  },
});

const renderHeader = (header: $TSFixMe) => {
  const HeaderComponent = readsColumn.header as $TSFixMe;
  return render(
    <table>
      <thead>
        <tr>
          <HeaderComponent header={header} column={makeColumn()} />
        </tr>
      </thead>
    </table>,
  );
};

const renderCell = (value: number) => {
  const CellComponent = readsColumn.cell as $TSFixMe;
  return render(
    <CellComponent
      getValue={() => value}
      cell={{ id: "cell-reads", column: makeColumn() }}
    />,
  );
};

describe("readsColumn definition", () => {
  it("is registered under the reads id at a fixed width", () => {
    expect(readsColumn.id).toBe("reads");
    expect(readsColumn.size).toBe(82);
  });
});

describe("readsColumn accessor", () => {
  it("returns the -1 sentinel when the read count is null", () => {
    expect(accessor({ reads: null }, 0)).toBe(-1);
  });

  it("parses a read count string into a number", () => {
    expect(accessor({ reads: "1234" }, 0)).toBe(1234);
    expect(accessor({ reads: "0" }, 0)).toBe(0);
  });

  it("does not round the parsed value (unlike the percent columns)", () => {
    expect(accessor({ reads: "10.987" }, 0)).toBe(10.987);
  });

  it("yields NaN for a non-numeric read count rather than the sentinel", () => {
    expect(accessor({ reads: "not-a-number" }, 0)).toBeNaN();
  });
});

describe("readsColumn header", () => {
  it("renders the Reads label with width styles", () => {
    renderHeader(makeHeader());
    const cellHeader = screen.getByTestId("cell-header");
    expect(cellHeader.textContent).toBe("Reads");
    expect(cellHeader.style.width).toBe("82px");
    expect(cellHeader.getAttribute("data-direction")).toBe("undefined");
  });

  it("sorts descending first from an unsorted header click", () => {
    const toggleSorting = jest.fn();
    renderHeader(makeHeader(false, toggleSorting));
    screen.getByTestId("cell-header").click();
    expect(toggleSorting).toHaveBeenCalledWith(true);
  });

  it("flips to ascending when the header is already sorted descending", () => {
    const toggleSorting = jest.fn();
    renderHeader(makeHeader("desc", toggleSorting));
    const cellHeader = screen.getByTestId("cell-header");
    expect(cellHeader.getAttribute("data-active")).toBe("true");
    cellHeader.click();
    expect(toggleSorting).toHaveBeenCalledWith(false);
  });
});

describe("readsColumn cell", () => {
  it("shows the no-content fallback for the -1 sentinel", () => {
    renderCell(-1);
    expect(
      screen.getByTestId("cell-basic").getAttribute("data-primary-text"),
    ).toBe("-");
  });

  it("shows the read count when there is content", () => {
    renderCell(1234);
    const cell = screen.getByTestId("cell-basic");
    expect(cell.getAttribute("data-primary-text")).toBe("1234");
    expect(cell.style.width).toBe("82px");
  });

  it("renders a zero read count instead of the fallback", () => {
    renderCell(0);
    expect(
      screen.getByTestId("cell-basic").getAttribute("data-primary-text"),
    ).toBe("0");
  });
});
