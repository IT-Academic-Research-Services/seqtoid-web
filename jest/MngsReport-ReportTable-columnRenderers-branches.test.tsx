// Coverage:
//   app/assets/src/components/views/SampleView/components/MngsReport/components/ReportTable/components/columns/components/CellValue/CellValue.tsx
//   app/assets/src/components/views/SampleView/components/MngsReport/components/ReportTable/components/columns/renderers/zScoreRenderer.tsx
//   app/assets/src/components/views/SampleView/components/MngsReport/components/ReportTable/components/columns/renderers/aggregateScoreRenderer.tsx
//   app/assets/src/components/views/SampleView/components/MngsReport/components/ReportTable/components/columns/renderers/expandIconRenderer.tsx
//   app/assets/src/components/views/SampleView/components/MngsReport/components/ReportTable/components/columns/renderers/expandIconHeaderRenderer.tsx
//   app/assets/src/components/views/SampleView/components/MngsReport/components/ReportTable/components/columns/renderers/base10ExponentRenderer.tsx
//
// These are cell/header renderer factories for the mNGS report table. Each one
// is a small closure over report state with one or two conditionals in it -- the
// "no background model chosen" fallback, the genus-vs-species expand control,
// the open/closed chevron, the empty-cellData dash and the decimalPlaces
// default. Every one of those conditionals is driven in both directions below.
import { fireEvent, render, screen } from "@testing-library/react";

// jest.config.js maps "\.(css|scss)$" to a style mock, but the "~" webpack alias
// is registered first and wins, so an aliased stylesheet import reaches the TS
// transform and blows up. These modules import report_table.scss through "~/".
jest.mock(
  "~/components/views/SampleView/components/MngsReport/components/ReportTable/report_table.scss",
  () => ({}),
);

import { CellValue } from "~/components/views/SampleView/components/MngsReport/components/ReportTable/components/columns/components/CellValue/CellValue";
import { getAggregateScoreRenderer } from "~/components/views/SampleView/components/MngsReport/components/ReportTable/components/columns/renderers/aggregateScoreRenderer";
import { getBase10ExponentRenderer } from "~/components/views/SampleView/components/MngsReport/components/ReportTable/components/columns/renderers/base10ExponentRenderer";
import { getExpandIconHeaderRenderer } from "~/components/views/SampleView/components/MngsReport/components/ReportTable/components/columns/renderers/expandIconHeaderRenderer";
import { getExpandIconRenderer } from "~/components/views/SampleView/components/MngsReport/components/ReportTable/components/columns/renderers/expandIconRenderer";
import { getZScoreRenderer } from "~/components/views/SampleView/components/MngsReport/components/ReportTable/components/columns/renderers/zScoreRenderer";

const withAnalytics = jest.fn() as $TSFixMe;

describe("CellValue", () => {
  it("renders a dash when there is no cell data", () => {
    const { container } = render(
      <CellValue cellData={[]} dbType={"nt" as $TSFixMe} />,
    );

    expect(container.textContent).toBe("-");
    // The dash short-circuit means no nt/nr stack is built at all.
    expect(container.querySelectorAll("div").length).toBe(0);
  });

  it("rounds to whole numbers when decimalPlaces is not supplied", () => {
    const { container } = render(
      <CellValue cellData={[1234.56, 78.4]} dbType={"nt" as $TSFixMe} />,
    );

    expect(container.textContent).toContain("1,235");
    expect(container.textContent).toContain("78");
    expect(container.textContent).not.toContain("1,234.6");
  });

  it("honours an explicit decimalPlaces", () => {
    const { container } = render(
      <CellValue
        cellData={[1234.56, 78.44]}
        dbType={"nr" as $TSFixMe}
        decimalPlaces={1}
      />,
    );

    expect(container.textContent).toContain("1,234.6");
    expect(container.textContent).toContain("78.4");
  });

  it("treats decimalPlaces={0} the same as omitting it", () => {
    const { container } = render(
      <CellValue
        cellData={[9.87, 1.2]}
        dbType={"nt" as $TSFixMe}
        decimalPlaces={0}
      />,
    );

    expect(container.textContent).toContain("10");
    expect(container.textContent).not.toContain("9.9");
  });
});

describe("getZScoreRenderer", () => {
  it("renders the 'choose a background model' tooltip trigger when there is no background", () => {
    const ZScore = getZScoreRenderer("nt" as $TSFixMe, true) as $TSFixMe;
    const { container } = render(<ZScore cellData={[100, 50]} />);

    // The no-background branch ignores cellData entirely and renders a dash.
    expect(container.textContent).toBe("-");
    expect(container.textContent).not.toContain("100");
  });

  it("renders the z-score values when a background model is selected", () => {
    const ZScore = getZScoreRenderer("nt" as $TSFixMe, false) as $TSFixMe;
    const { container } = render(<ZScore cellData={[1234.56, 50.44]} />);

    // One decimal place, comma-grouped, one row per database.
    expect(container.textContent).toContain("1,234.6");
    expect(container.textContent).toContain("50.4");
  });

  it("renders a bare dash when a background model is selected but cellData is missing", () => {
    const ZScore = getZScoreRenderer("nr" as $TSFixMe, false) as $TSFixMe;
    const { container } = render(<ZScore cellData={null} />);

    expect(container.textContent).toBe("-");
  });
});

describe("getAggregateScoreRenderer", () => {
  it("renders the 'choose a background model' tooltip trigger when there is no background", () => {
    const AggregateScore = getAggregateScoreRenderer(true) as $TSFixMe;
    const { container } = render(
      <AggregateScore cellData={12345} rowData={{ highlighted: true }} />,
    );

    expect(container.textContent).toBe("-");
    expect(container.textContent).not.toContain("12,345");
  });

  it("renders the comma-formatted score plus the highlight icon for a highlighted row", () => {
    const AggregateScore = getAggregateScoreRenderer(false) as $TSFixMe;
    const { container } = render(
      <AggregateScore cellData={1234567.8} rowData={{ highlighted: true }} />,
    );

    expect(container.textContent).toContain("1,234,568");
    // The highlight tooltip only exists on highlighted rows.
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("omits the highlight icon for a non-highlighted row", () => {
    const AggregateScore = getAggregateScoreRenderer(false) as $TSFixMe;
    const { container } = render(
      <AggregateScore cellData={42} rowData={{ highlighted: false }} />,
    );

    expect(container.textContent).toContain("42");
    expect(container.querySelector("svg")).toBeNull();
  });
});

describe("getExpandIconRenderer", () => {
  it("renders a collapsed chevron for a genus row that is not expanded", () => {
    const toggleExpandGenus = jest.fn();
    const ExpandIcon = getExpandIconRenderer(
      new Set<number>(),
      toggleExpandGenus,
      withAnalytics,
    ) as $TSFixMe;
    const { container } = render(
      <ExpandIcon rowData={{ taxLevel: "genus", taxId: 570 }} />,
    );

    expect(container.querySelector("i")?.className).toContain("fa-angle-right");
    expect(container.querySelector("i")?.className).not.toContain(
      "fa-angle-down",
    );
  });

  it("renders an expanded chevron for a genus row that is already expanded", () => {
    const ExpandIcon = getExpandIconRenderer(
      new Set<number>([570]),
      jest.fn(),
      withAnalytics,
    ) as $TSFixMe;
    const { container } = render(
      <ExpandIcon rowData={{ taxLevel: "genus", taxId: 570 }} />,
    );

    expect(container.querySelector("i")?.className).toContain("fa-angle-down");
  });

  it("toggles the clicked genus by taxId", () => {
    const toggleExpandGenus = jest.fn();
    const ExpandIcon = getExpandIconRenderer(
      new Set<number>(),
      toggleExpandGenus,
      withAnalytics,
    ) as $TSFixMe;
    render(<ExpandIcon rowData={{ taxLevel: "genus", taxId: 570 }} />);

    fireEvent.click(screen.getByTestId("expand-taxon-parent").firstChild!);

    expect(toggleExpandGenus).toHaveBeenCalledWith({ taxonId: 570 });
  });

  it("renders no control at all for a non-genus row", () => {
    const toggleExpandGenus = jest.fn();
    const ExpandIcon = getExpandIconRenderer(
      new Set<number>([573]),
      toggleExpandGenus,
      withAnalytics,
    ) as $TSFixMe;
    const { container } = render(
      <ExpandIcon rowData={{ taxLevel: "species", taxId: 573 }} />,
    );

    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("i")).toBeNull();
    expect(screen.getByTestId("expand-taxon-parent").textContent).toBe("");
  });
});

describe("getExpandIconHeaderRenderer", () => {
  it("renders the collapsed chevron when expand-all is off", () => {
    const ExpandAll = getExpandIconHeaderRenderer(
      false,
      jest.fn(),
      withAnalytics,
    ) as $TSFixMe;
    const { container } = render(<ExpandAll />);

    expect(container.querySelector("i")?.className).toContain("fa-angle-right");
  });

  it("renders the expanded chevron when expand-all is on, and toggles on click", () => {
    const toggleExpandAll = jest.fn();
    const ExpandAll = getExpandIconHeaderRenderer(
      true,
      toggleExpandAll,
      withAnalytics,
    ) as $TSFixMe;
    const { container } = render(<ExpandAll />);

    expect(container.querySelector("i")?.className).toContain("fa-angle-down");

    fireEvent.click(screen.getByTestId("expand-taxon-parent-all"));
    expect(toggleExpandAll).toHaveBeenCalledTimes(1);
  });
});

describe("getBase10ExponentRenderer", () => {
  it("renders a dash for empty cell data", () => {
    const Base10 = getBase10ExponentRenderer("nt" as $TSFixMe) as $TSFixMe;
    const { container } = render(<Base10 cellData={[]} />);

    expect(container.textContent).toBe("-");
  });

  it("renders each value as a rounded base-10 exponent", () => {
    const Base10 = getBase10ExponentRenderer("nt" as $TSFixMe) as $TSFixMe;
    const { container } = render(<Base10 cellData={[3.4, 5.6]} />);

    const exponents = Array.from(container.querySelectorAll("sup")).map(
      node => node.textContent,
    );
    expect(exponents).toEqual(["3", "6"]);
    expect(container.textContent).toContain("10");
  });
});
