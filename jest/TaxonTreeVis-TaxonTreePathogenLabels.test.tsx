// Coverage: .../MngsReport/components/TaxonTreeVis/components/TaxonTreePathogenLabels/TaxonTreePathogenLabels.tsx
//
// TaxonTreePathogenLabels walks the genus list and, for every genus AND every
// filtered species that carries a pathogenFlag, emits one TaxonTreePathogenLabel.
// Both sides of both guards matter: flagged vs unflagged genus, flagged vs
// unflagged species, and an empty species list. The leaf label component is
// stubbed so the assertions land on the selection/keying logic in this file.
import { render, screen } from "@testing-library/react";
import { TaxonTreePathogenLabels } from "~/components/views/SampleView/components/MngsReport/components/TaxonTreeVis/components/TaxonTreePathogenLabels/TaxonTreePathogenLabels";

jest.mock(
  "~/components/views/SampleView/components/MngsReport/components/TaxonTreeVis/components/TaxonTreePathogenLabel",
  () => ({
    TaxonTreePathogenLabel: (props: $TSFixMe) => (
      <span
        data-testid="pathogen-label"
        data-taxid={String(props.taxId)}
        data-tagtype={String(props.tagType)}
      />
    ),
  }),
);

const label = (taxId: number, tagType: string | null | undefined) => ({
  taxId,
  pathogenFlag: tagType,
});

const genus = (
  taxId: number,
  pathogenFlag: string | null,
  filteredSpecies: $TSFixMe[] = [],
) =>
  ({
    taxId,
    pathogenFlag,
    filteredSpecies,
  } as $TSFixMe);

const renderLabels = (taxa: $TSFixMe[]) =>
  render(<TaxonTreePathogenLabels taxa={taxa} />);

const readLabels = () =>
  screen.queryAllByTestId("pathogen-label").map(el => ({
    taxId: el.getAttribute("data-taxid"),
    tagType: el.getAttribute("data-tagtype"),
  }));

describe("TaxonTreePathogenLabels", () => {
  it("renders nothing when no genus or species carries a pathogen flag", () => {
    const { container } = renderLabels([
      genus(1, null, [label(11, null), label(12, undefined)]),
    ]);

    expect(readLabels()).toHaveLength(0);
    expect(container.querySelector(".pathogen-labels")).not.toBeNull();
  });

  it("renders a label for a flagged genus", () => {
    renderLabels([genus(570, "knownPathogen", [])]);

    expect(readLabels()).toEqual([{ taxId: "570", tagType: "knownPathogen" }]);
  });

  it("renders labels for flagged species even when the genus is unflagged", () => {
    renderLabels([
      genus(570, null, [label(573, "knownPathogen"), label(574, null)]),
    ]);

    expect(readLabels()).toEqual([{ taxId: "573", tagType: "knownPathogen" }]);
  });

  it("renders the genus label before its flagged species labels", () => {
    renderLabels([
      genus(570, "genusFlag", [label(573, "speciesFlag"), label(574, null)]),
    ]);

    expect(readLabels()).toEqual([
      { taxId: "570", tagType: "genusFlag" },
      { taxId: "573", tagType: "speciesFlag" },
    ]);
  });

  it("accumulates labels across multiple genera", () => {
    renderLabels([
      genus(1, "a", [label(10, "b")]),
      genus(2, null, [label(20, null)]),
      genus(3, "c", [label(30, "d"), label(31, "e")]),
    ]);

    expect(readLabels()).toEqual([
      { taxId: "1", tagType: "a" },
      { taxId: "10", tagType: "b" },
      { taxId: "3", tagType: "c" },
      { taxId: "30", tagType: "d" },
      { taxId: "31", tagType: "e" },
    ]);
  });

  it("renders an empty container when the taxa list itself is empty", () => {
    const { container } = renderLabels([]);

    expect(readLabels()).toHaveLength(0);
    expect(
      container.querySelector(".pathogen-labels")?.childNodes,
    ).toHaveLength(0);
  });
});
