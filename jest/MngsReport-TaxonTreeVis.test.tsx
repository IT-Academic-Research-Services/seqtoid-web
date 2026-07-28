// Frontend coverage for TaxonTreeVis: it turns the report's genus/species list
// plus the lineage hash into the flat node list the TidyTree visualization
// consumes, keeps the collapsed-node state in the URL, aggregates metric values
// up the tree, and forwards hover/label-click interactions.
//
// TidyTree itself is a D3 visualization that needs a laid-out DOM, so it is
// replaced with a recording double -- that also gives direct access to the node
// list and the callbacks TaxonTreeVis hands it, which is where all of this
// component's logic lives.
import { act, render, screen } from "@testing-library/react";
import { WORKFLOW_TABS } from "~/components/utils/workflows";
import { TaxonTreeVis } from "~/components/views/SampleView/components/MngsReport/components/TaxonTreeVis/TaxonTreeVis";

const mockTidyTreeInstances: $TSFixMe[] = [];

jest.mock("~/components/visualizations/TidyTree", () => ({
  TidyTree: function (container: $TSFixMe, nodes: $TSFixMe, options: $TSFixMe) {
    const instance = {
      container,
      nodes,
      options,
      update: jest.fn(),
      setOptions: jest.fn(),
      setTree: jest.fn(),
    };
    mockTidyTreeInstances.push(instance);
    return instance;
  },
}));

jest.mock(
  "~/components/views/SampleView/components/MngsReport/components/TaxonTreeVis/components/TaxonTreePathogenLabels",
  () => ({
    TaxonTreePathogenLabels: (props: $TSFixMe) => (
      <span data-testid="pathogen-labels">{(props.taxa ?? []).length}</span>
    ),
  }),
);

jest.mock(
  "~/components/views/SampleView/components/MngsReport/components/TaxonTreeVis/components/TaxonTreeNodeTooltip",
  () => ({
    TaxonTreeNodeTooltip: (props: $TSFixMe) => (
      <div data-testid="tooltip">
        <span data-testid="tooltip-metric">{props.activeMetric}</span>
        <span data-testid="tooltip-common-name">
          {String(props.isCommonNameActive)}
        </span>
        <span data-testid="tooltip-node">
          {props.node ? props.node.data.scientificName : "none"}
        </span>
      </div>
    ),
  }),
);

const species = (taxId: number, name: string, extra = {}) => ({
  taxId,
  name,
  taxLevel: "species",
  common_name: `${name} common`,
  agg_score: 9,
  nt: { count: 5, rpm: 1, z_score: 2, base_count: 50, bpm: 10 },
  nr: { count: 3, rpm: 0.5, z_score: 1, base_count: 30, bpm: 6 },
  ...extra,
});

const baseProps = {
  currentTab: WORKFLOW_TABS.SHORT_READ_MNGS,
  metric: "nt_r",
  nameType: "Scientific Name",
  onTaxonClick: jest.fn(),
};

const renderVis = (props: $TSFixMe) =>
  render(<TaxonTreeVis {...(baseProps as $TSFixMe)} {...props} />);

const latestTree = () =>
  mockTidyTreeInstances[mockTidyTreeInstances.length - 1];

beforeEach(() => {
  jest.clearAllMocks();
  mockTidyTreeInstances.length = 0;
  window.history.replaceState({}, "", "/");
});

describe("TaxonTreeVis", () => {
  describe("createTree", () => {
    it("parents species at their lineage parent and walks the lineage up to the root", () => {
      renderVis({
        taxa: [
          {
            taxId: 100,
            name: "Genus A",
            taxLevel: "genus",
            common_name: "genus a common",
            highlighted: true,
            filteredSpecies: [species(101, "Species A1")],
          },
        ],
        lineage: {
          101: { parent: 100, name: "Genus A", rank: "genus" },
          100: { parent: 10, name: "Family F", rank: "family" },
          10: { parent: null, name: "Order O", rank: "order" },
        },
      });

      const nodes = latestTree().nodes;
      expect(nodes[0]).toEqual({ id: "_" });

      const speciesNode = nodes.find((n: $TSFixMe) => n.id === "101");
      expect(speciesNode.parentId).toBe("100");
      expect(speciesNode.lineageRank).toBe("species");
      expect(speciesNode.commonName).toBe("Species A1 common");
      expect(speciesNode.scientificName).toBe("Species A1");

      const genusNode = nodes.find((n: $TSFixMe) => n.id === "100");
      expect(genusNode.parentId).toBe("10");
      expect(genusNode.highlight).toBe(true);

      // The remaining lineage entry that is not already a node gets appended.
      const orderNode = nodes.find((n: $TSFixMe) => n.id === "10");
      expect(orderNode).toEqual({
        id: "10",
        taxId: 10,
        parentId: "_",
        scientificName: "Order O",
        lineageRank: "order",
      });
    });

    it("infers a real genus id from the species lineage when the genus id is negative", () => {
      renderVis({
        taxa: [
          {
            taxId: -200,
            name: "Uncategorized",
            taxLevel: "genus",
            filteredSpecies: [species(201, "Species B1")],
          },
        ],
        lineage: {
          201: { parent: 570, name: "Genus X", rank: "genus" },
          570: { parent: 100, name: "Genus X", rank: "genus" },
        },
      });

      const nodes = latestTree().nodes;
      // The genus node is keyed by the inferred id but keeps its own taxId.
      const genusNode = nodes.find((n: $TSFixMe) => n.id === "570");
      expect(genusNode.taxId).toBe(-200);
      expect(genusNode.parentId).toBe("100");
      expect(nodes.find((n: $TSFixMe) => n.id === "201").parentId).toBe("570");
    });

    it("falls back to the genus taxId when the species has no lineage of its own", () => {
      renderVis({
        taxa: [
          {
            taxId: 100,
            name: "Genus A",
            taxLevel: "genus",
            filteredSpecies: [species(101, "Species A1")],
          },
        ],
        lineage: { 100: { parent: 10, name: "Family F", rank: "family" } },
      });

      const nodes = latestTree().nodes;
      expect(nodes.find((n: $TSFixMe) => n.id === "101").parentId).toBe("100");
    });

    it("falls back to the root when neither the species nor the genus has lineage", () => {
      renderVis({
        taxa: [
          {
            taxId: 100,
            name: "Genus A",
            taxLevel: "genus",
            filteredSpecies: [species(101, "Species A1")],
          },
        ],
        lineage: {},
      });

      const nodes = latestTree().nodes;
      expect(nodes.find((n: $TSFixMe) => n.id === "101").parentId).toBe("_");
      expect(nodes.find((n: $TSFixMe) => n.id === "100").parentId).toBe("_");
    });
  });

  describe("node metric values", () => {
    const taxa = [
      {
        taxId: 100,
        name: "Genus A",
        taxLevel: "genus",
        filteredSpecies: [species(101, "Species A1")],
      },
    ];

    it("uses the Illumina metrics on the short-read tab", () => {
      renderVis({ taxa, lineage: {} });
      const speciesNode = latestTree().nodes.find(
        (n: $TSFixMe) => n.id === "101",
      );
      expect(speciesNode.values).toEqual({
        aggregatescore: 9,
        nt_r: 5,
        nt_rpm: 1,
        nt_zscore: 2,
        nr_r: 3,
        nr_rpm: 0.5,
        nr_zscore: 1,
      });
    });

    it("uses the Nanopore metrics on the long-read tab", () => {
      renderVis({
        taxa,
        lineage: {},
        currentTab: WORKFLOW_TABS.LONG_READ_MNGS,
      });
      const speciesNode = latestTree().nodes.find(
        (n: $TSFixMe) => n.id === "101",
      );
      expect(speciesNode.values).toEqual({
        nt_b: 50,
        nt_bpm: 10,
        nr_b: 30,
        nr_bpm: 6,
      });
    });

    it("defaults missing counts to zero", () => {
      renderVis({
        taxa: [
          {
            taxId: 100,
            name: "Genus A",
            taxLevel: "genus",
            filteredSpecies: [
              { taxId: 101, name: "Species A1", taxLevel: "species" },
            ],
          },
        ],
        lineage: {},
      });
      const speciesNode = latestTree().nodes.find(
        (n: $TSFixMe) => n.id === "101",
      );
      expect(speciesNode.values).toEqual({
        aggregatescore: undefined,
        nt_r: 0,
        nt_rpm: 0,
        nt_zscore: 0,
        nr_r: 0,
        nr_rpm: 0,
        nr_zscore: 0,
      });
    });

    it("produces no values for a tab that has no tree metrics", () => {
      renderVis({ taxa, lineage: {}, currentTab: WORKFLOW_TABS.AMR });
      const speciesNode = latestTree().nodes.find(
        (n: $TSFixMe) => n.id === "101",
      );
      expect(speciesNode.values).toBeUndefined();
    });
  });

  describe("tree options and updates", () => {
    const taxa = [
      {
        taxId: 100,
        name: "Genus A",
        taxLevel: "genus",
        filteredSpecies: [species(101, "Species A1")],
      },
    ];

    it("passes the active metric and scientific-name mode into TidyTree", () => {
      renderVis({ taxa, lineage: {} });
      expect(latestTree().options.attribute).toBe("nt_r");
      expect(latestTree().options.useCommonName).toBe(false);
      expect(latestTree().update).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("tooltip-common-name").textContent).toBe(
        "false",
      );
    });

    it("detects common-name mode case-insensitively", () => {
      renderVis({ taxa, lineage: {}, nameType: "Common Name" });
      expect(latestTree().options.useCommonName).toBe(true);
      expect(screen.getByTestId("tooltip-common-name").textContent).toBe(
        "true",
      );
    });

    it("pushes new options into the existing tree when the metric changes", () => {
      const { rerender } = renderVis({ taxa, lineage: {} });
      const tree = latestTree();
      expect(tree.setOptions).not.toHaveBeenCalled();

      rerender(
        <TaxonTreeVis
          {...(baseProps as $TSFixMe)}
          taxa={taxa as $TSFixMe}
          lineage={{}}
          metric="nr_r"
        />,
      );

      expect(tree.setOptions).toHaveBeenCalledWith({
        attribute: "nr_r",
        useCommonName: false,
      });
      expect(screen.getByTestId("tooltip-metric").textContent).toBe("nr_r");
    });

    it("rebuilds the tree when the taxa change", () => {
      const { rerender } = renderVis({ taxa, lineage: {} });
      const tree = latestTree();
      expect(tree.setTree).not.toHaveBeenCalled();

      const newTaxa = [
        {
          taxId: 300,
          name: "Genus C",
          taxLevel: "genus",
          filteredSpecies: [species(301, "Species C1")],
        },
      ];
      rerender(
        <TaxonTreeVis
          {...(baseProps as $TSFixMe)}
          taxa={newTaxa as $TSFixMe}
          lineage={{}}
        />,
      );

      expect(tree.setTree).toHaveBeenCalledTimes(1);
      const rebuiltNodes = tree.setTree.mock.calls[0][0];
      expect(rebuiltNodes.map((n: $TSFixMe) => n.id).sort()).toEqual([
        "300",
        "301",
        "_",
      ]);
      expect(screen.getByTestId("pathogen-labels").textContent).toBe("1");
    });
  });

  describe("interactions", () => {
    const taxa = [
      {
        taxId: 100,
        name: "Genus A",
        taxLevel: "genus",
        filteredSpecies: [species(101, "Species A1")],
      },
    ];

    it("opens the taxon details for genus and species labels only", () => {
      const onTaxonClick = jest.fn();
      renderVis({ taxa, lineage: {}, onTaxonClick });
      const { onNodeLabelClick } = latestTree().options;

      onNodeLabelClick({ data: { lineageRank: "species", taxId: 101 } });
      expect(onTaxonClick).toHaveBeenCalledWith({
        lineageRank: "species",
        taxId: 101,
      });

      onTaxonClick.mockClear();
      onNodeLabelClick({ data: { lineageRank: "genus", taxId: 100 } });
      expect(onTaxonClick).toHaveBeenCalledTimes(1);

      onTaxonClick.mockClear();
      onNodeLabelClick({ data: { lineageRank: "family", taxId: 10 } });
      expect(onTaxonClick).not.toHaveBeenCalled();
    });

    it("shows the hovered node in the tooltip", () => {
      renderVis({ taxa, lineage: {} });
      expect(screen.getByTestId("tooltip-node").textContent).toBe("none");

      const { onNodeHover } = latestTree().options;
      act(() => onNodeHover({ data: { scientificName: "Species A1" } }));

      expect(screen.getByTestId("tooltip-node").textContent).toBe("Species A1");
    });
  });

  describe("collapsed state in the URL", () => {
    const taxa = [
      {
        taxId: 100,
        name: "Genus A",
        taxLevel: "genus",
        filteredSpecies: [species(101, "Species A1")],
      },
    ];

    it("seeds the collapsed set from the query string", () => {
      window.history.replaceState({}, "", "/?100=c&other=x");
      renderVis({ taxa, lineage: {} });

      const collapsed = latestTree().options.collapsed;
      expect(collapsed instanceof Set).toBe(true);
      expect(collapsed.has("100")).toBe(true);
      expect(collapsed.has("other")).toBe(false);
    });

    it("records a fully collapsed node in the query string and removes it when reopened", () => {
      renderVis({ taxa, lineage: {} });
      const { onCollapsedStateChange } = latestTree().options;

      onCollapsedStateChange({
        id: "100",
        children: null,
        collapsedChildren: [{ id: "101" }],
      });
      expect(window.location.search).toContain("100=c");

      onCollapsedStateChange({
        id: "100",
        children: [{ id: "101" }],
        collapsedChildren: null,
      });
      expect(window.location.search).not.toContain("100=c");
    });
  });

  describe("fillNodeValues", () => {
    const taxa = [
      {
        taxId: 100,
        name: "Genus A",
        taxLevel: "genus",
        filteredSpecies: [species(101, "Species A1")],
      },
    ];

    it("prunes leaves with no values and aggregates metrics up the tree", () => {
      renderVis({ taxa, lineage: {} });
      const { onCreatedTree } = latestTree().options;

      // Spurious leaf: no children and no values -> it and its now-empty
      // ancestors are unlinked.
      const grand: $TSFixMe = { id: "g", children: [] };
      const parent: $TSFixMe = { id: "p", children: [] };
      const spuriousLeaf: $TSFixMe = {
        id: "l1",
        children: null,
        data: {},
        ancestors: () => [spuriousLeaf, parent, grand],
      };
      parent.children = [spuriousLeaf];
      grand.children = [parent];

      const goodLeaf: $TSFixMe = {
        id: "l2",
        children: null,
        data: { values: { nt_r: 4 } },
        ancestors: () => [goodLeaf],
      };

      const child: $TSFixMe = {
        children: [],
        data: {
          highlight: true,
          values: {
            aggregatescore: 5,
            nt_r: 2,
            nt_rpm: 1,
            nr_r: 3,
            nr_rpm: 4,
          },
        },
      };
      const root: $TSFixMe = { children: [child], data: {} };
      child.ancestors = () => [child, root];
      root.ancestors = () => [root];

      onCreatedTree({
        leaves: () => [spuriousLeaf, goodLeaf],
        eachAfter: (cb: $TSFixMe) => [child, root].forEach(cb),
      });

      // The spurious leaf was detached from its parent, and the parent from
      // the grandparent since it became childless.
      expect(parent.children).toEqual([]);
      expect(grand.children).toEqual([]);
      // The good leaf was left alone.
      expect(goodLeaf.data.values).toEqual({ nt_r: 4 });

      // Highlight propagates to the ancestors.
      expect(root.data.highlight).toBe(true);
      // Root metrics are aggregated from its children (max for the aggregate
      // score, sum for the rest).
      expect(root.data.values).toEqual({
        aggregatescore: 5,
        nt_r: 2,
        nt_rpm: 1,
        nr_r: 3,
        nr_rpm: 4,
      });
    });
  });
});
