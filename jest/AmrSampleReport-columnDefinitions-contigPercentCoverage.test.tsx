// Coverage: app/assets/src/components/views/SampleView/components/AmrView/
//   components/AmrSampleReport/columnDefinitions/contigPercentCoverage.tsx
//
// A TanStack column definition with three executable pieces: the accessorFn
// (null -> sentinel -1, otherwise rounded to hundredths), the sortable header
// render function, and the memoized cell render function whose primaryText
// swaps to the no-content fallback on the -1 sentinel. The SDS primitives are
// stubbed so the props the definition computes (primaryText, width styles,
// tooltip copy) are directly observable.
import { render, screen } from "@testing-library/react";

jest.mock("@czi-sds/components", () => {
  const ReactLib = require("react");
  return {
    CellBasic: (props: $TSFixMe) =>
      ReactLib.createElement("div", {
        "data-testid": "cell-basic",
        "data-primary-text": String(props.primaryText),
        "data-wrap-lines": String(props.primaryTextWrapLineCount),
        "data-tooltip-on-hover": String(props.shouldShowTooltipOnHover),
        style: props.style,
      }),
    CellHeader: (props: $TSFixMe) =>
      ReactLib.createElement(
        "th",
        {
          "data-testid": "cell-header",
          "data-active": String(props.active),
          "data-direction": String(props.direction),
          "data-has-tooltip": String(props.shouldShowTooltipOnHover),
          style: props.style,
          onClick: props.onClick,
        },
        props.children,
      ),
  };
});

import { CONTIGS_PERCENT_COVERAGE_COLUMN_TOOLTIP_STRINGS } from "~/components/views/SampleView/components/AmrView/components/AmrSampleReport/columnDefinitions/constants";
import { contigPercentCoverageColumn } from "~/components/views/SampleView/components/AmrView/components/AmrSampleReport/columnDefinitions/contigPercentCoverage";

const accessor = contigPercentCoverageColumn.accessorFn as (
  row: $TSFixMe,
  index: number,
) => number;

const makeColumn = (size = 90) => ({ getSize: () => size });

const makeHeader = (sorted: false | "asc" | "desc" = false) => ({
  id: "contigCoverageBreadth",
  column: {
    getCanSort: () => true,
    getIsSorted: () => sorted,
    toggleSorting: jest.fn(),
  },
});

const renderHeader = (header: $TSFixMe) => {
  const HeaderComponent = contigPercentCoverageColumn.header as $TSFixMe;
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
  const CellComponent = contigPercentCoverageColumn.cell as $TSFixMe;
  return render(
    <CellComponent
      getValue={() => value}
      cell={{ id: "cell-1", column: makeColumn() }}
    />,
  );
};

describe("contigPercentCoverageColumn definition", () => {
  it("is registered under the contigCoverageBreadth id at a fixed width", () => {
    expect(contigPercentCoverageColumn.id).toBe("contigCoverageBreadth");
    expect(contigPercentCoverageColumn.size).toBe(90);
  });
});

describe("contigPercentCoverageColumn accessor", () => {
  it("returns the -1 sentinel when the raw coverage is null", () => {
    expect(accessor({ contigCoverageBreadth: null }, 0)).toBe(-1);
  });

  it("rounds a numeric string to the hundredths place", () => {
    expect(accessor({ contigCoverageBreadth: "98.7654" }, 0)).toBe(98.77);
    expect(accessor({ contigCoverageBreadth: "12.341" }, 0)).toBe(12.34);
  });

  it("keeps zero rather than collapsing it to the null sentinel", () => {
    expect(accessor({ contigCoverageBreadth: "0" }, 0)).toBe(0);
  });

  it("does not treat undefined as null (falls through to the parse branch)", () => {
    expect(accessor({ contigCoverageBreadth: undefined }, 0)).toBeNaN();
  });
});

describe("contigPercentCoverageColumn header", () => {
  it("renders the %Cov label with the coverage tooltip copy and width styles", () => {
    renderHeader(makeHeader());
    const cellHeader = screen.getByTestId("cell-header");
    expect(cellHeader.textContent).toBe("%Cov");
    expect(cellHeader.getAttribute("data-has-tooltip")).toBe("true");
    expect(cellHeader.style.width).toBe("90px");
    expect(cellHeader.style.maxWidth).toBe("90px");
    // The tooltip copy the definition points at is the contigs coverage entry.
    expect(
      CONTIGS_PERCENT_COVERAGE_COLUMN_TOOLTIP_STRINGS.regularText.length,
    ).toBeGreaterThan(0);
  });

  it("reports the active sort direction when the column is sorted", () => {
    renderHeader(makeHeader("desc"));
    const cellHeader = screen.getByTestId("cell-header");
    expect(cellHeader.getAttribute("data-active")).toBe("true");
    expect(cellHeader.getAttribute("data-direction")).toBe("desc");
  });
});

describe("contigPercentCoverageColumn cell", () => {
  it("shows the no-content fallback for the -1 sentinel", () => {
    renderCell(-1);
    expect(
      screen.getByTestId("cell-basic").getAttribute("data-primary-text"),
    ).toBe("-");
  });

  it("shows the rounded coverage value when there is content", () => {
    renderCell(98.77);
    const cell = screen.getByTestId("cell-basic");
    expect(cell.getAttribute("data-primary-text")).toBe("98.77");
    expect(cell.getAttribute("data-wrap-lines")).toBe("2");
    expect(cell.getAttribute("data-tooltip-on-hover")).toBe("false");
    expect(cell.style.width).toBe("90px");
  });

  it("renders a zero value instead of the fallback", () => {
    renderCell(0);
    expect(
      screen.getByTestId("cell-basic").getAttribute("data-primary-text"),
    ).toBe("0");
  });
});
