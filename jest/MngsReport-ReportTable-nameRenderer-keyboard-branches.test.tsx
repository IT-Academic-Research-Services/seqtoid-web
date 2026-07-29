// Branch coverage for
// app/assets/src/components/views/SampleView/components/MngsReport/components/ReportTable/components/columns/renderers/nameRenderer.tsx
//
// The taxon name span carries the same guarded callback on two handlers:
//
//   onClick={() => onTaxonNameClick && onTaxonNameClick({ ...rowData })}
//   onKeyDown={() => onTaxonNameClick && onTaxonNameClick({ ...rowData })}
//
// The existing spec drives only the onClick copy, so both arms of the onKeyDown
// short-circuit were unexercised. The keyboard handler is the accessibility
// path for a role="button" span, so it matters that it behaves identically --
// including staying silent when the report is read-only and no handler is wired.
import { fireEvent, render, screen } from "@testing-library/react";

// "~/"-prefixed scss resolves through the alias before the style mock.
jest.mock(
  "~/components/views/SampleView/components/MngsReport/components/ReportTable/report_table.scss",
  () => ({}),
);

jest.mock(
  "~/components/views/SampleView/components/MngsReport/components/ReportTable/components/columns/components/AnnotationMenu",
  () => ({ AnnotationMenu: () => <div data-testid="annotation-menu" /> }),
);

jest.mock(
  "~/components/views/SampleView/components/MngsReport/components/ReportTable/components/columns/components/GenusLevelPreview",
  () => ({ GenusLevelPreview: () => <span data-testid="genus-preview" /> }),
);

jest.mock(
  "~/components/views/SampleView/components/ReportPanel/components/HoverActions",
  () => ({ HoverActions: () => <div data-testid="hover-actions" /> }),
);

jest.mock("~/components/ui/labels/PathogenLabel", () => ({
  __esModule: true,
  default: () => <span data-testid="pathogen-label" />,
}));

import { getNameRenderer } from "~/components/views/SampleView/components/MngsReport/components/ReportTable/components/columns/renderers/nameRenderer";

const buildRenderer = (onTaxonNameClick?: $TSFixMe) =>
  getNameRenderer(
    {}, // consensusGenomeData
    "Metagenomics" as $TSFixMe, // currentTab
    jest.fn(), // onCoverageVizClick
    true, // isConsensusGenomeEnabled
    true, // isFastaDownloadEnabled
    true, // isPhyloTreeAllowed
    "8.0", // pipelineVersion
    123, // pipelineRunId
    "proj-1", // projectId
    42, // sampleId
    jest.fn(), // handlePhyloTreeModalOpen
    jest.fn(), // onAnnotationUpdate
    jest.fn(), // onBlastClick
    jest.fn(), // onConsensusGenomeClick
    jest.fn(), // onPreviousConsensusGenomeClick
    onTaxonNameClick,
  );

const speciesRow = {
  taxId: 573,
  taxLevel: "species",
  name: "Klebsiella pneumoniae",
  annotation: "hit",
  pathogenFlag: null,
};

const renderName = (onTaxonNameClick?: $TSFixMe) => {
  const NameRenderer = buildRenderer(onTaxonNameClick);
  return render(
    <NameRenderer
      cellData={"Klebsiella pneumoniae" as $TSFixMe}
      rowData={speciesRow as $TSFixMe}
    />,
  );
};

const nameSpan = () => screen.getByText("Klebsiella pneumoniae");

describe("NameRenderer keyboard activation", () => {
  it("invokes onTaxonNameClick with a copy of the row on keydown", () => {
    const onTaxonNameClick = jest.fn();
    renderName(onTaxonNameClick);

    fireEvent.keyDown(nameSpan(), { key: "Enter", code: "Enter" });

    expect(onTaxonNameClick).toHaveBeenCalledTimes(1);
    const passed = onTaxonNameClick.mock.calls[0][0];
    expect(passed).toEqual(speciesRow);
    // The handler spreads the row, so mutating the argument cannot write back
    // into the table's row object.
    expect(passed).not.toBe(speciesRow);
  });

  it("stays silent on keydown when no name-click handler is supplied", () => {
    renderName(undefined);

    // The short-circuit arm: no handler, so nothing is called and nothing throws.
    expect(() =>
      fireEvent.keyDown(nameSpan(), { key: "Enter", code: "Enter" }),
    ).not.toThrow();
  });

  it("keeps the span reachable as a button for keyboard users", () => {
    renderName(jest.fn());

    expect(nameSpan().getAttribute("role")).toBe("button");
  });

  it("fires once per keydown, independently of clicks", () => {
    const onTaxonNameClick = jest.fn();
    renderName(onTaxonNameClick);

    fireEvent.keyDown(nameSpan(), { key: " ", code: "Space" });
    fireEvent.click(nameSpan());

    expect(onTaxonNameClick).toHaveBeenCalledTimes(2);
  });
});
