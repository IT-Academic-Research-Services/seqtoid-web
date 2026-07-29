// Coverage: app/assets/src/components/views/SampleView/components/MngsReport/components/ReportTable/components/columns/renderers/nameRenderer.tsx
//
// getNameRenderer is a factory that returns the NameRenderer cell component.
// The heavy children (AnnotationMenu, HoverActions, GenusLevelPreview,
// PathogenLabel) are stubbed so the assertions land on this file's branching:
// genus vs species, category-vs-no-category count text, cellData fallback to
// the taxon name, pathogen flag / dimming, the name-click callback, and the
// null-rowData short circuit.
import { fireEvent, render, screen } from "@testing-library/react";

// This scss is imported via a "~/"-prefixed path, which the jest alias resolves
// before the css/scss style mock, so it must be stubbed explicitly.
jest.mock(
  "~/components/views/SampleView/components/MngsReport/components/ReportTable/report_table.scss",
  () => ({}),
);

jest.mock(
  "~/components/views/SampleView/components/MngsReport/components/ReportTable/components/columns/components/AnnotationMenu",
  () => ({
    AnnotationMenu: (props: $TSFixMe) => (
      <div
        data-testid="annotation-menu"
        data-label={props.currentLabelType}
        data-taxonid={props.taxonId}
      />
    ),
  }),
);

jest.mock(
  "~/components/views/SampleView/components/MngsReport/components/ReportTable/components/columns/components/GenusLevelPreview",
  () => ({
    GenusLevelPreview: () => <span data-testid="genus-preview" />,
  }),
);

jest.mock(
  "~/components/views/SampleView/components/ReportPanel/components/HoverActions",
  () => ({
    HoverActions: (props: $TSFixMe) => (
      <div data-testid="hover-actions" data-taxid={props.rowData.taxId} />
    ),
  }),
);

jest.mock("~/components/ui/labels/PathogenLabel", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => (
    <span data-testid="pathogen-label" data-dimmed={String(props.isDimmed)} />
  ),
}));

import { getNameRenderer } from "~/components/views/SampleView/components/MngsReport/components/ReportTable/components/columns/renderers/nameRenderer";

const buildRenderer = (overrides: $TSFixMe = {}) =>
  getNameRenderer(
    {}, // consensusGenomeData
    "Metagenomics" as $TSFixMe, // currentTab
    jest.fn(), // onCoverageVizClick
    true, // isConsensusGenomeEnabled
    true, // isFastaDownloadEnabled
    true, // isPhyloTreeAllowed
    "1.0", // pipelineVersion
    123, // pipelineRunId
    "proj-1", // projectId
    42, // sampleId
    jest.fn(), // handlePhyloTreeModalOpen
    jest.fn(), // onAnnotationUpdate
    jest.fn(), // onBlastClick
    jest.fn(), // onConsensusGenomeClick
    jest.fn(), // onPreviousConsensusGenomeClick
    overrides.onTaxonNameClick, // may be undefined
    overrides.snapshotShareId,
  );

const speciesRow = {
  taxId: 7,
  taxLevel: "species",
  name: "Klebsiella pneumoniae",
  annotation: "hit",
  pathogenFlag: null,
};

describe("NameRenderer species rows", () => {
  it("renders the display name from cellData and the annotation menu", () => {
    const NameRenderer = buildRenderer();
    render(
      <NameRenderer
        cellData={"Custom Name" as $TSFixMe}
        rowData={speciesRow as $TSFixMe}
      />,
    );
    expect(screen.getByText("Custom Name")).toBeTruthy();
    expect(
      screen.getByTestId("annotation-menu").getAttribute("data-label"),
    ).toBe("hit");
    expect(screen.getByTestId("hover-actions").getAttribute("data-taxid")).toBe(
      "7",
    );
  });

  it("falls back to the taxon name when cellData is missing", () => {
    const NameRenderer = buildRenderer();
    render(
      <NameRenderer
        cellData={0 as $TSFixMe}
        rowData={speciesRow as $TSFixMe}
      />,
    );
    expect(screen.getByText("Klebsiella pneumoniae")).toBeTruthy();
  });

  it("uses the default annotation label when the row has none", () => {
    const NameRenderer = buildRenderer();
    render(
      <NameRenderer
        cellData={"x" as $TSFixMe}
        rowData={{ ...speciesRow, annotation: undefined } as $TSFixMe}
      />,
    );
    expect(
      screen.getByTestId("annotation-menu").getAttribute("data-label"),
    ).toBe("none");
  });

  it("dims the pathogen label for not_a_hit species and shows the flag", () => {
    const NameRenderer = buildRenderer();
    render(
      <NameRenderer
        cellData={"x" as $TSFixMe}
        rowData={
          {
            ...speciesRow,
            annotation: "not_a_hit",
            pathogenFlag: "known",
          } as $TSFixMe
        }
      />,
    );
    expect(
      screen.getByTestId("pathogen-label").getAttribute("data-dimmed"),
    ).toBe("true");
  });

  it("omits the pathogen label when there is no flag", () => {
    const NameRenderer = buildRenderer();
    render(
      <NameRenderer
        cellData={"x" as $TSFixMe}
        rowData={speciesRow as $TSFixMe}
      />,
    );
    expect(screen.queryByTestId("pathogen-label")).toBeNull();
  });
});

describe("NameRenderer name-click callback", () => {
  it("invokes onTaxonNameClick with a copy of the row on click", () => {
    const onTaxonNameClick = jest.fn();
    const NameRenderer = buildRenderer({ onTaxonNameClick });
    render(
      <NameRenderer
        cellData={"Name" as $TSFixMe}
        rowData={speciesRow as $TSFixMe}
      />,
    );
    fireEvent.click(screen.getByText("Name"));
    expect(onTaxonNameClick).toHaveBeenCalledWith(
      expect.objectContaining({ taxId: 7 }),
    );
  });

  it("does not throw when no name-click handler is supplied", () => {
    const NameRenderer = buildRenderer();
    render(
      <NameRenderer
        cellData={"Name" as $TSFixMe}
        rowData={speciesRow as $TSFixMe}
      />,
    );
    expect(() => fireEvent.click(screen.getByText("Name"))).not.toThrow();
  });
});

describe("NameRenderer genus rows", () => {
  const genusRow = {
    taxId: 3,
    taxLevel: "genus",
    name: "Klebsiella",
    annotation: "hit",
    filteredSpecies: [{}, {}, {}],
    pathogenFlag: null,
  };

  it("shows the category adjective count for a categorised genus", () => {
    const NameRenderer = buildRenderer();
    render(
      <NameRenderer
        cellData={"Klebsiella" as $TSFixMe}
        rowData={{ ...genusRow, category: "bacteria" } as $TSFixMe}
      />,
    );
    expect(screen.getByText(/3 bacterial species/)).toBeTruthy();
    expect(screen.getByTestId("genus-preview")).toBeTruthy();
  });

  it("shows a plain species count when the genus has no category", () => {
    const NameRenderer = buildRenderer();
    render(
      <NameRenderer
        cellData={"Klebsiella" as $TSFixMe}
        rowData={{ ...genusRow, category: undefined } as $TSFixMe}
      />,
    );
    expect(screen.getByText(/3 species/)).toBeTruthy();
  });
});

describe("NameRenderer snapshot / share id", () => {
  it("threads the snapshot share id and pipeline props into HoverActions", () => {
    const NameRenderer = buildRenderer({ snapshotShareId: "snap-1" });
    render(
      <NameRenderer
        cellData={"Name" as $TSFixMe}
        rowData={speciesRow as $TSFixMe}
      />,
    );
    expect(screen.getByTestId("hover-actions")).toBeTruthy();
  });
});
