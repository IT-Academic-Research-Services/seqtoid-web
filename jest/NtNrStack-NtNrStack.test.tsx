// Coverage: app/assets/src/components/views/SampleView/components/MngsReport/
//   components/ReportTable/components/columns/components/NtNrStack/NtNrStack.tsx
//
// NtNrStack stacks the NT value above the NR value in a single report-table
// cell. It has two shapes: an interactive pair of buttons (only when the
// NtNrSelector passes an onClick pair *and* there is cell data) and a static
// pair of divs where the row that does not match the active dbType is dimmed
// with the lowlight class, falling back to "-" when there is no cell data.
import { fireEvent, render, screen } from "@testing-library/react";

// This scss is imported via a "~/"-prefixed path, which the jest alias resolves
// before the css/scss style mock, so it must be stubbed explicitly. Giving it
// real-looking class names is also the only way to tell the lowlighted row from
// the active one.
jest.mock(
  "~/components/views/SampleView/components/MngsReport/components/ReportTable/report_table.scss",
  () => ({
    stack: "stack",
    stackElement: "stack-element",
    lowlightValue: "lowlight-value",
  }),
);

import { NtNrStack } from "~/components/views/SampleView/components/MngsReport/components/ReportTable/components/columns/components/NtNrStack/NtNrStack";

const renderStack = (props: $TSFixMe) => render(<NtNrStack {...props} />);

const rows = (container: HTMLElement) =>
  Array.from(container.querySelectorAll(".stack-element"));

describe("NtNrStack interactive variant", () => {
  it("renders both values as buttons when onClick handlers are supplied", () => {
    renderStack({
      cellData: [123, 456],
      dbType: "nt",
      onClick: [jest.fn(), jest.fn()],
    });
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0].textContent).toBe("123");
    expect(buttons[1].textContent).toBe("456");
  });

  it("calls the first handler with 'nt' and the second with 'nr'", () => {
    const ntHandler = jest.fn();
    const nrHandler = jest.fn();
    renderStack({
      cellData: ["a", "b"],
      dbType: "nr",
      onClick: [ntHandler, nrHandler],
    });
    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[0]);
    expect(ntHandler).toHaveBeenCalledWith("nt");
    expect(nrHandler).not.toHaveBeenCalled();

    fireEvent.click(buttons[1]);
    expect(nrHandler).toHaveBeenCalledWith("nr");
    expect(ntHandler).toHaveBeenCalledTimes(1);
  });

  it("never dims a row in the interactive variant", () => {
    const { container } = renderStack({
      cellData: [1, 2],
      dbType: "nt",
      onClick: [jest.fn(), jest.fn()],
    });
    expect(container.querySelectorAll(".lowlight-value")).toHaveLength(0);
  });

  it("falls back to the static variant when handlers exist but data does not", () => {
    const { container } = renderStack({
      cellData: undefined,
      dbType: "nt",
      onClick: [jest.fn(), jest.fn()],
    });
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(rows(container).map(el => el.textContent)).toEqual(["-", "-"]);
  });
});

describe("NtNrStack static variant", () => {
  it("dims only the NR row when NT is the active dbType", () => {
    const { container } = renderStack({ cellData: [10, 20], dbType: "nt" });
    const [nt, nr] = rows(container);
    expect(nt.className).not.toContain("lowlight-value");
    expect(nr.className).toContain("lowlight-value");
    expect(nt.textContent).toBe("10");
    expect(nr.textContent).toBe("20");
  });

  it("dims only the NT row when NR is the active dbType", () => {
    const { container } = renderStack({ cellData: [10, 20], dbType: "nr" });
    const [nt, nr] = rows(container);
    expect(nt.className).toContain("lowlight-value");
    expect(nr.className).not.toContain("lowlight-value");
  });

  it("dims both rows when neither NT nor NR is active", () => {
    const { container } = renderStack({
      cellData: [10, 20],
      dbType: "merged_nt_nr",
    });
    expect(container.querySelectorAll(".lowlight-value")).toHaveLength(2);
  });

  it("renders a dash in both rows when there is no cell data", () => {
    const { container } = renderStack({ cellData: null, dbType: "nr" });
    expect(rows(container).map(el => el.textContent)).toEqual(["-", "-"]);
  });

  it("renders element cell data as-is", () => {
    renderStack({
      cellData: [<em key="a">low</em>, <em key="b">high</em>],
      dbType: "nt",
    });
    expect(screen.getByText("low").tagName).toBe("EM");
    expect(screen.getByText("high").tagName).toBe("EM");
  });
});
