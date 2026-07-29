// Coverage: app/assets/src/components/views/SampleView/components/AmrView/
//   components/AmrSampleReport/columnDefinitions/contigPercentId.tsx
//
// The %Id column definition. Its accessorFn maps a null percent-identity to the
// -1 sentinel and otherwise rounds to hundredths; the header renders the
// sortable "%Id" cell; the memoized cell swaps primaryText to the no-content
// fallback on the sentinel. SDS primitives are stubbed so the computed props
// are observable.
import { render, screen } from "@testing-library/react";

jest.mock("@czi-sds/components", () => {
  const ReactLib = require("react");
  return {
    CellBasic: (props: $TSFixMe) =>
      ReactLib.createElement("div", {
        "data-testid": "cell-basic",
        "data-primary-text": String(props.primaryText),
        "data-should-wrap": String(props.shouldTextWrap),
        style: props.style,
      }),
    CellHeader: (props: $TSFixMe) =>
      ReactLib.createElement(
        "th",
        {
          "data-testid": "cell-header",
          "data-active": String(props.active),
          "data-direction": String(props.direction),
          "data-hide-sort-icon": String(props.hideSortIcon),
          style: props.style,
          onClick: props.onClick,
        },
        props.children,
      ),
  };
});

import { contigPercentIdColumn } from "~/components/views/SampleView/components/AmrView/components/AmrSampleReport/columnDefinitions/contigPercentId";

const accessor = contigPercentIdColumn.accessorFn as (
  row: $TSFixMe,
  index: number,
) => number;

const makeColumn = () => ({ getSize: () => 76 });

const makeHeader = (
  sorted: false | "asc" | "desc" = false,
  canSort = true,
  toggleSorting = jest.fn(),
) => ({
  id: "contigPercentId",
  column: {
    getCanSort: () => canSort,
    getIsSorted: () => sorted,
    toggleSorting,
  },
});

const renderHeader = (header: $TSFixMe) => {
  const HeaderComponent = contigPercentIdColumn.header as $TSFixMe;
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
  const CellComponent = contigPercentIdColumn.cell as $TSFixMe;
  return render(
    <CellComponent
      getValue={() => value}
      cell={{ id: "cell-id", column: makeColumn() }}
    />,
  );
};

describe("contigPercentIdColumn definition", () => {
  it("is registered under the contigPercentId id at a fixed width", () => {
    expect(contigPercentIdColumn.id).toBe("contigPercentId");
    expect(contigPercentIdColumn.size).toBe(76);
  });
});

describe("contigPercentIdColumn accessor", () => {
  it("returns the -1 sentinel when percent identity is null", () => {
    expect(accessor({ contigPercentId: null }, 0)).toBe(-1);
  });

  it("rounds a numeric string up and down at the hundredths boundary", () => {
    expect(accessor({ contigPercentId: "99.995" }, 0)).toBe(100);
    expect(accessor({ contigPercentId: "88.881" }, 0)).toBe(88.88);
  });

  it("reads only the contigPercentId field of the row", () => {
    expect(
      accessor({ contigPercentId: "50", contigCoverageBreadth: "10" }, 0),
    ).toBe(50);
  });
});

describe("contigPercentIdColumn header", () => {
  it("renders the %Id label with width styles and a sortable icon", () => {
    renderHeader(makeHeader());
    const cellHeader = screen.getByTestId("cell-header");
    expect(cellHeader.textContent).toBe("%Id");
    expect(cellHeader.getAttribute("data-hide-sort-icon")).toBe("false");
    expect(cellHeader.getAttribute("data-active")).toBe("false");
    expect(cellHeader.style.width).toBe("76px");
  });

  it("hides the sort icon when the column cannot be sorted", () => {
    renderHeader(makeHeader(false, false));
    expect(
      screen.getByTestId("cell-header").getAttribute("data-hide-sort-icon"),
    ).toBe("true");
  });

  it("toggles to descending sort from an ascending header click", () => {
    const toggleSorting = jest.fn();
    renderHeader(makeHeader("asc", true, toggleSorting));
    screen.getByTestId("cell-header").click();
    expect(toggleSorting).toHaveBeenCalledWith(true);
  });
});

describe("contigPercentIdColumn cell", () => {
  it("shows the no-content fallback for the -1 sentinel", () => {
    renderCell(-1);
    expect(
      screen.getByTestId("cell-basic").getAttribute("data-primary-text"),
    ).toBe("-");
  });

  it("shows the percent identity when there is content", () => {
    renderCell(88.88);
    const cell = screen.getByTestId("cell-basic");
    expect(cell.getAttribute("data-primary-text")).toBe("88.88");
    expect(cell.getAttribute("data-should-wrap")).toBe("true");
    expect(cell.style.maxWidth).toBe("76px");
  });
});
