// Branch coverage for the AMR report metric column definitions whose only
// conditional is the "missing value" sentinel in their accessorFn, plus the
// no-content fallback in the two species cells:
//   contigs.tsx / readCoverageBreadth.tsx / readCoverageDepth.tsx
//     -> `if (rawValue === null) value = -1; else value = parse(rawValue)`
//   readDepthPerMillion.tsx / readsPerMillion.tsx
//     -> `row.x === null ? -1 : row.x`
//   contigSpecies.tsx / readSpecies.tsx
//     -> `primaryText={value || NO_CONTENT_FALLBACK}` in the memoized cell
// The sentinel arm and the real-value arm are asserted separately for each.
import { render, screen } from "@testing-library/react";

jest.mock("@czi-sds/components", () => {
  const ReactLib = require("react");
  return {
    CellBasic: (props: $TSFixMe) =>
      ReactLib.createElement("div", {
        "data-testid": "cell-basic",
        "data-primary-text": String(props.primaryText),
        "data-tooltip-on-hover": String(props.shouldShowTooltipOnHover),
      }),
    CellHeader: (props: $TSFixMe) =>
      ReactLib.createElement("th", { "data-testid": "cell-header" }),
    Tag: (props: $TSFixMe) =>
      ReactLib.createElement("span", { "data-testid": "tag" }, props.label),
  };
});

import { contigSpeciesColumn } from "~/components/views/SampleView/components/AmrView/components/AmrSampleReport/columnDefinitions/contigSpecies";
import { contigsColumn } from "~/components/views/SampleView/components/AmrView/components/AmrSampleReport/columnDefinitions/contigs";
import { readCoverageBreadthColumn } from "~/components/views/SampleView/components/AmrView/components/AmrSampleReport/columnDefinitions/readCoverageBreadth";
import { readCoverageDepthColumn } from "~/components/views/SampleView/components/AmrView/components/AmrSampleReport/columnDefinitions/readCoverageDepth";
import { readDepthPerMillionColumn } from "~/components/views/SampleView/components/AmrView/components/AmrSampleReport/columnDefinitions/readDepthPerMillion";
import { readSpeciesColumn } from "~/components/views/SampleView/components/AmrView/components/AmrSampleReport/columnDefinitions/readSpecies";
import { readsPerMillionColumn } from "~/components/views/SampleView/components/AmrView/components/AmrSampleReport/columnDefinitions/readsPerMillion";

const accessorOf = (column: $TSFixMe) =>
  column.accessorFn as (row: $TSFixMe, index: number) => $TSFixMe;

describe("contigsColumn accessor", () => {
  it("maps a null contig count to the -1 sort sentinel", () => {
    expect(accessorOf(contigsColumn)({ contigs: null }, 0)).toBe(-1);
  });

  it("parses a present contig count into a number", () => {
    expect(accessorOf(contigsColumn)({ contigs: "12" }, 0)).toBe(12);
  });

  it("keeps a zero contig count distinct from the missing sentinel", () => {
    expect(accessorOf(contigsColumn)({ contigs: "0" }, 0)).toBe(0);
  });

  it("declares the id and size the report table lays out against", () => {
    expect(contigsColumn.id).toBe("contigs");
    expect(contigsColumn.size).toBe(91);
  });
});

describe("readCoverageBreadthColumn accessor", () => {
  it("maps a null coverage breadth to the -1 sort sentinel", () => {
    expect(
      accessorOf(readCoverageBreadthColumn)({ readCoverageBreadth: null }, 0),
    ).toBe(-1);
  });

  it("rounds a present coverage breadth to the hundredths place", () => {
    expect(
      accessorOf(readCoverageBreadthColumn)(
        { readCoverageBreadth: "12.3456" },
        0,
      ),
    ).toBe(12.35);
  });
});

describe("readCoverageDepthColumn accessor", () => {
  it("maps a null coverage depth to the -1 sort sentinel", () => {
    expect(
      accessorOf(readCoverageDepthColumn)({ readCoverageDepth: null }, 0),
    ).toBe(-1);
  });

  it("rounds a present coverage depth to the hundredths place", () => {
    expect(
      accessorOf(readCoverageDepthColumn)({ readCoverageDepth: "3.14159" }, 0),
    ).toBe(3.14);
  });
});

describe("readDepthPerMillionColumn accessor", () => {
  it("maps a null dPM to the -1 sort sentinel", () => {
    expect(accessorOf(readDepthPerMillionColumn)({ dpm: null }, 0)).toBe(-1);
  });

  it("passes a present dPM straight through", () => {
    expect(accessorOf(readDepthPerMillionColumn)({ dpm: 8.5 }, 0)).toBe(8.5);
  });

  it("does not confuse a zero dPM with a missing one", () => {
    expect(accessorOf(readDepthPerMillionColumn)({ dpm: 0 }, 0)).toBe(0);
  });
});

describe("readsPerMillionColumn accessor", () => {
  it("maps a null rPM to the -1 sort sentinel", () => {
    expect(accessorOf(readsPerMillionColumn)({ rpm: null }, 0)).toBe(-1);
  });

  it("passes a present rPM straight through", () => {
    expect(accessorOf(readsPerMillionColumn)({ rpm: 1234.5 }, 0)).toBe(1234.5);
  });
});

describe("species cell no-content fallback", () => {
  const renderCell = (column: $TSFixMe, value: $TSFixMe) => {
    const CellComponent = column.cell as $TSFixMe;
    return render(
      <CellComponent
        getValue={() => value}
        cell={{ id: "cell-1", column: { getSize: () => 200 } }}
      />,
    );
  };

  const primaryText = () =>
    screen.getByTestId("cell-basic").getAttribute("data-primary-text");

  it("renders the contig species name when one is present", () => {
    renderCell(contigSpeciesColumn, "Escherichia coli");

    expect(primaryText()).toBe("Escherichia coli");
  });

  it("falls back to the dash placeholder when the contig species is empty", () => {
    renderCell(contigSpeciesColumn, "");

    expect(primaryText()).toBe("-");
  });

  it("renders the read species name when one is present", () => {
    renderCell(readSpeciesColumn, "Klebsiella pneumoniae");

    expect(primaryText()).toBe("Klebsiella pneumoniae");
  });

  it("falls back to the dash placeholder when the read species is empty", () => {
    renderCell(readSpeciesColumn, "");

    expect(primaryText()).toBe("-");
  });
});

describe("species column accessors", () => {
  it("formats a compound contig species list into a display string", () => {
    const value = accessorOf(contigSpeciesColumn)(
      { contigSpecies: "Escherichia coli;Klebsiella pneumoniae" },
      0,
    );

    expect(typeof value).toBe("string");
    expect(value).toContain("Escherichia coli");
  });

  it("formats a compound read species list into a display string", () => {
    const value = accessorOf(readSpeciesColumn)(
      { readSpecies: "Klebsiella pneumoniae" },
      0,
    );

    expect(value).toContain("Klebsiella pneumoniae");
  });
});
