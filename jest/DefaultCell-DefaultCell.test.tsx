// Coverage: app/assets/src/components/views/SampleView/components/AmrView/
//   components/AmrSampleReport/columnDefinitions/components/DefaultCell/DefaultCell.tsx
//
// getDefaultCell is a factory that returns a memoized cell renderer for the AMR
// report table. The two decisions it makes are (a) which alignment class to put
// on the cell -- right only for Align.RIGHT, left for everything else including
// an omitted argument -- and (b) whether the raw value is "empty" ("" / null /
// -1), in which case the NO_CONTENT_FALLBACK dash is shown instead. It also
// forwards a column-width style and asks shouldShowTooltip whether the value is
// long-form text. CellBasic is stubbed so every prop it receives can be
// asserted directly.
import { render } from "@testing-library/react";

// Every scss import in this module graph is routed to the shared style mock by
// jest.config's moduleNameMapper. Replacing that mock with real-looking class
// names is the only way to tell the left- and right-aligned branches apart.
jest.mock("./__mocks__/styleMock.ts", () => ({
  leftAlignedCell: "left-aligned-cell",
  rightAlignedCell: "right-aligned-cell",
}));

let lastCellProps: $TSFixMe = null;
jest.mock("@czi-sds/components", () => {
  const ReactLib = require("react");
  return {
    CellBasic: (props: $TSFixMe) => {
      lastCellProps = props;
      return ReactLib.createElement(
        "td",
        { "data-testid": "cell", className: props.className },
        String(props.primaryText),
      );
    },
  };
});

import { NO_CONTENT_FALLBACK } from "~/components/ui/Table/constants";
import {
  Align,
  getDefaultCell,
} from "~/components/views/SampleView/components/AmrView/components/AmrSampleReport/columnDefinitions/components/DefaultCell/DefaultCell";

const makeCell = (id = "cell-1", size = 120) =>
  ({
    id,
    column: { getSize: () => size },
  } as $TSFixMe);

const renderCell = (
  value: unknown,
  align?: Align,
  headerGroupClassName?: string,
) => {
  const Cell = getDefaultCell(align, headerGroupClassName);
  return render(
    <table>
      <tbody>
        <tr>
          <Cell cell={makeCell()} getValue={() => value} />
        </tr>
      </tbody>
    </table>,
  );
};

beforeEach(() => {
  lastCellProps = null;
});

describe("getDefaultCell value handling", () => {
  it("renders a normal value as-is", () => {
    const { getByTestId } = renderCell("Perfect");
    expect(getByTestId("cell").textContent).toBe("Perfect");
    expect(lastCellProps.primaryText).toBe("Perfect");
  });

  it("renders numeric zero rather than treating it as empty", () => {
    renderCell(0);
    expect(lastCellProps.primaryText).toBe(0);
  });

  it("substitutes the fallback dash for an empty string", () => {
    renderCell("");
    expect(lastCellProps.primaryText).toBe(NO_CONTENT_FALLBACK);
  });

  it("substitutes the fallback dash for null", () => {
    renderCell(null);
    expect(lastCellProps.primaryText).toBe(NO_CONTENT_FALLBACK);
  });

  it("substitutes the fallback dash for the -1 sentinel", () => {
    renderCell(-1);
    expect(lastCellProps.primaryText).toBe(NO_CONTENT_FALLBACK);
  });
});

describe("getDefaultCell tooltip decision", () => {
  it("enables the hover tooltip for non-numeric text", () => {
    renderCell("aminoglycoside antibiotic");
    expect(lastCellProps.shouldShowTooltipOnHover).toBe(true);
  });

  it("disables the hover tooltip for numeric values", () => {
    renderCell("42");
    expect(lastCellProps.shouldShowTooltipOnHover).toBe(false);
  });

  it("disables the hover tooltip for the fallback dash", () => {
    renderCell(null);
    expect(lastCellProps.shouldShowTooltipOnHover).toBe(false);
  });
});

describe("getDefaultCell layout props", () => {
  it("passes the column width through as inline styles", () => {
    const Cell = getDefaultCell();
    render(
      <table>
        <tbody>
          <tr>
            <Cell cell={makeCell("c", 250)} getValue={() => "x"} />
          </tr>
        </tbody>
      </table>,
    );
    expect(lastCellProps.style).toEqual({
      width: "250px",
      maxWidth: "250px",
    });
  });

  it("always wraps text to at most two lines", () => {
    renderCell("x");
    expect(lastCellProps.shouldTextWrap).toBe(true);
    expect(lastCellProps.primaryTextWrapLineCount).toBe(2);
  });

  it("appends the header group class name when one is given", () => {
    renderCell("x", Align.LEFT, "my-group");
    expect(lastCellProps.className).toContain("my-group");
  });

  it("omits any group class name when none is given", () => {
    renderCell("x");
    expect(lastCellProps.className).not.toContain("my-group");
    expect(lastCellProps.className).toBe("left-aligned-cell");
  });

  it("uses the right-aligned class only for Align.RIGHT", () => {
    renderCell("x", Align.RIGHT, "shared");
    expect(lastCellProps.className).toBe("right-aligned-cell shared");
  });

  it("uses the left-aligned class for Align.LEFT", () => {
    renderCell("x", Align.LEFT, "shared");
    expect(lastCellProps.className).toBe("left-aligned-cell shared");
  });

  it("defaults to the left-aligned class when alignment is omitted", () => {
    renderCell("x", undefined, "shared");
    expect(lastCellProps.className).toBe("left-aligned-cell shared");
  });
});
