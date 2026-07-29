// Coverage: app/assets/src/components/views/SampleView/components/MngsReport/
//   components/TaxonTreeVis/components/TaxonTreeNodeTooltip/
//   TaxonTreeNodeTooltip.tsx
//
// The tooltip shown when hovering a node in the taxon tree. It bails out
// entirely for a missing node, builds one row per configured metric (marking
// the active one), picks between the common and scientific name, and replaces
// the name with an "N Taxa" summary for aggregated (collapsed) nodes.
import { render, screen } from "@testing-library/react";

// The shared style mock is an empty object; real-looking class names are the
// only way to tell the active metric row from the inactive ones.
jest.mock("./__mocks__/styleMock.ts", () => ({
  taxonTooltip: "taxon-tooltip",
  taxonTooltipTitle: "taxon-tooltip-title",
  taxonTooltipName: "taxon-tooltip-name",
  taxonTooltipData: "taxon-tooltip-data",
  taxonTooltipRow: "taxon-tooltip-row",
  taxonTooltipRowActive: "taxon-tooltip-row-active",
  taxonTooltipRowLabel: "taxon-tooltip-row-label",
  taxonTooltipRowValue: "taxon-tooltip-row-value",
}));

import { TaxonTreeNodeTooltip } from "~/components/views/SampleView/components/MngsReport/components/TaxonTreeVis/components/TaxonTreeNodeTooltip/TaxonTreeNodeTooltip";

const METRICS = {
  nt_r: { label: "NT rPM" },
  nr_r: { label: "NR rPM" },
};

const makeNode = (overrides: $TSFixMe = {}) =>
  ({
    data: {
      lineageRank: "species",
      scientificName: "Klebsiella pneumoniae",
      commonName: "Friedlander bacillus",
      values: { nt_r: 1234.6, nr_r: 12.2 },
    },
    ...overrides,
  } as $TSFixMe);

const renderTooltip = (props: $TSFixMe) =>
  render(
    <TaxonTreeNodeTooltip
      activeMetric="nt_r"
      isCommonNameActive={false}
      metrics={METRICS}
      {...props}
    />,
  );

describe("TaxonTreeNodeTooltip missing node", () => {
  it("renders nothing when there is no hovered node", () => {
    const { container } = renderTooltip({ node: null });
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when the node is undefined", () => {
    const { container } = renderTooltip({ node: undefined });
    expect(container.innerHTML).toBe("");
  });
});

describe("TaxonTreeNodeTooltip metric rows", () => {
  it("renders one row per metric with a rounded, localized value", () => {
    const { container } = renderTooltip({ node: makeNode() });
    const labels = Array.from(
      container.querySelectorAll(".taxon-tooltip-row-label"),
    ).map(el => el.textContent);
    expect(labels).toEqual(["NT rPM:", "NR rPM:"]);
    expect(screen.getByText("1,235")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
  });

  it("highlights only the row for the active metric", () => {
    const { container } = renderTooltip({
      activeMetric: "nr_r",
      node: makeNode(),
    });
    const active = container.querySelectorAll(".taxon-tooltip-row-active");
    expect(active).toHaveLength(1);
    expect(active[0].textContent).toContain("NR rPM:");
  });

  it("highlights no row when the active metric is not configured", () => {
    const { container } = renderTooltip({
      activeMetric: "not_a_metric",
      node: makeNode(),
    });
    expect(container.querySelectorAll(".taxon-tooltip-row")).toHaveLength(2);
    expect(
      container.querySelectorAll(".taxon-tooltip-row-active"),
    ).toHaveLength(0);
  });

  it("renders no rows when there are no metrics configured", () => {
    const { container } = renderTooltip({ metrics: {}, node: makeNode() });
    expect(container.querySelectorAll(".taxon-tooltip-row")).toHaveLength(0);
    expect(container.querySelector(".taxon-tooltip-name")?.textContent).toBe(
      "Klebsiella pneumoniae",
    );
  });
});

describe("TaxonTreeNodeTooltip name selection", () => {
  const name = (container: HTMLElement) =>
    container.querySelector(".taxon-tooltip-name")?.textContent;

  it("uses the scientific name when common names are off", () => {
    const { container } = renderTooltip({ node: makeNode() });
    expect(name(container)).toBe("Klebsiella pneumoniae");
    expect(
      container.querySelectorAll(".taxon-tooltip-title")[0].textContent,
    ).toBe("species");
  });

  it("uses the common name when common names are on", () => {
    const { container } = renderTooltip({
      isCommonNameActive: true,
      node: makeNode(),
    });
    expect(name(container)).toBe("Friedlander bacillus");
  });

  it("falls back to the scientific name when the common name is missing", () => {
    const node = makeNode();
    node.data.commonName = "";
    const { container } = renderTooltip({ isCommonNameActive: true, node });
    expect(name(container)).toBe("Klebsiella pneumoniae");
  });
});

describe("TaxonTreeNodeTooltip aggregated nodes", () => {
  const name = (container: HTMLElement) =>
    container.querySelector(".taxon-tooltip-name")?.textContent;

  it("summarises the collapsed children count instead of a name", () => {
    const { container } = renderTooltip({
      node: makeNode({
        isAggregated: true,
        parent: { collapsedChildren: [{}, {}, {}] },
      }),
    });
    expect(name(container)).toBe("3 Taxa");
  });

  it("reports zero taxa when the parent has no collapsed children", () => {
    const { container } = renderTooltip({
      node: makeNode({ isAggregated: true, parent: {} }),
    });
    expect(name(container)).toBe("0 Taxa");
  });

  it("still renders the metric rows for an aggregated node", () => {
    const { container } = renderTooltip({
      node: makeNode({
        isAggregated: true,
        parent: { collapsedChildren: [{}] },
      }),
    });
    expect(container.querySelectorAll(".taxon-tooltip-row")).toHaveLength(2);
    expect(name(container)).toBe("1 Taxa");
  });
});
