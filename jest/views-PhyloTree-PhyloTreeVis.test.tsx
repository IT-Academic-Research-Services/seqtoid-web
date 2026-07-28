// Coverage for app/assets/src/components/views/PhyloTree/PhyloTreeVis.tsx
//
// The D3 dendrogram is stubbed (jsdom has no layout engine), which lets us
// drive the component's real behaviour: mount/update lifecycle, metadata
// fetching, the metadata-type dropdown -> Dendogram option wiring, node
// click/hover routing and the two tooltip shapes (NCBI reference vs sample).
import { act, render, waitFor } from "@testing-library/react";
import React from "react";

const mockUpdate = jest.fn();
const mockSetTree = jest.fn();
const mockUpdateOptions = jest.fn();
const dendogramCtorArgs: $TSFixMe[] = [];

jest.mock("~/components/visualizations/dendrogram/Dendogram", () => {
  return {
    __esModule: true,
    default: class DendogramStub {
      constructor(container: $TSFixMe, tree: $TSFixMe, options: $TSFixMe) {
        dendogramCtorArgs.push({ container, tree, options });
      }
      update = mockUpdate;
      setTree = mockSetTree;
      updateOptions = mockUpdateOptions;
    },
  };
});

const mockGetSampleMetadataFields = jest.fn();
jest.mock("~/api/metadata", () => ({
  getSampleMetadataFields: (...args: unknown[]) =>
    mockGetSampleMetadataFields(...args),
}));

// The semantic-ui dropdown pulls in a lot of chrome we do not need; a plain
// <select> keeps the onChange contract (value, text) intact.
jest.mock("~ui/controls/dropdowns/Dropdown", () => ({
  __esModule: true,
  default: ({ options, value, onChange }: $TSFixMe) => (
    <select
      data-testid="metadata-dropdown"
      value={value}
      onChange={e => {
        const opt = options.find((o: $TSFixMe) => o.value === e.target.value);
        onChange(e.target.value, opt ? opt.text : "");
      }}
    >
      {options.map((o: $TSFixMe) => (
        <option key={o.value} value={o.value}>
          {o.text}
        </option>
      ))}
    </select>
  ),
}));

import PhyloTreeVis from "~/components/views/PhyloTree/PhyloTreeVis";

const NEWICK = "(sampleA:0.1,sampleB:0.2);";

const NODE_DATA = {
  sampleA: {
    sample_id: 1,
    pipeline_run_id: 11,
    name: "Sample A",
    project_name: "Project X",
    created_at: "2024-01-01",
    coverage_breadth: 0.42,
    metadata: { collection_date: "2023-12-01", sample_type: "Blood" },
  },
  sampleB: {
    sample_id: 2,
    pipeline_run_id: 22,
    name: "Sample B",
    project_name: "Project X",
    created_at: "2024-01-02",
    metadata: {},
  },
  ncbiRef: {
    accession: "NC_001",
    country: "USA",
    collection_date: "2020-05-05",
  },
};

const renderVis = (props: $TSFixMe = {}) => {
  const ref = React.createRef<$TSFixMe>();
  const utils = render(
    <PhyloTreeVis
      ref={ref}
      newick={NEWICK}
      nodeData={NODE_DATA}
      afterSelectedMetadataChange={
        props.afterSelectedMetadataChange || jest.fn()
      }
      onNewTreeContainer={props.onNewTreeContainer || jest.fn()}
      onSampleNodeClick={props.onSampleNodeClick || jest.fn()}
      {...props}
    />,
  );
  return { ...utils, instance: ref.current };
};

describe("PhyloTreeVis", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    dendogramCtorArgs.length = 0;
    mockGetSampleMetadataFields.mockResolvedValue([
      { key: "collection_date", name: "Collection Date" },
      { key: "sample_type", name: "Sample Type" },
    ]);
  });

  it("builds the dendrogram on mount and reports the container upward", async () => {
    const onNewTreeContainer = jest.fn();
    renderVis({ onNewTreeContainer });

    expect(dendogramCtorArgs).toHaveLength(1);
    const { options, container } = dendogramCtorArgs[0];
    expect(container).toBeTruthy();
    expect(options.colorGroupAttribute).toBe("project_name");
    expect(options.colorGroupLegendTitle).toBe("Project Name");
    // project_name gets the special absent label.
    expect(options.colorGroupAbsentName).toBe("NCBI References");
    expect(mockUpdate).toHaveBeenCalled();
    expect(onNewTreeContainer).toHaveBeenCalledWith(container);

    await waitFor(() =>
      expect(mockGetSampleMetadataFields).toHaveBeenCalledWith([1, 2]),
    );
  });

  it("defaults the selected metadata type to the prop when provided", () => {
    const { instance } = renderVis({ defaultMetadata: "sample_type" });
    expect(instance.state.selectedMetadataType).toBe("sample_type");
  });

  it("falls back to project_name when no defaultMetadata is given", () => {
    const { instance } = renderVis();
    expect(instance.state.selectedMetadataType).toBe("project_name");
  });

  it("prefixes non-extra metadata fields with 'metadata.' and uses the generic absent name", () => {
    const afterSelectedMetadataChange = jest.fn();
    const { instance } = renderVis({ afterSelectedMetadataChange });
    mockUpdateOptions.mockClear();

    act(() => {
      instance.handleMetadataTypeChange("collection_date", "Collection Date");
    });

    expect(mockUpdateOptions).toHaveBeenCalledWith({
      colorGroupAttribute: "metadata.collection_date",
      colorGroupLegendTitle: "Collection Date",
      colorGroupAbsentName: "No data",
    });
    expect(afterSelectedMetadataChange).toHaveBeenCalledWith("collection_date");
    expect(instance.state.selectedMetadataType).toBe("collection_date");
  });

  it("does not prefix the extra dropdown options", () => {
    const { instance } = renderVis();
    mockUpdateOptions.mockClear();

    act(() => {
      instance.handleMetadataTypeChange("host_genome_name", "Host Genome Name");
    });

    expect(mockUpdateOptions).toHaveBeenCalledWith({
      colorGroupAttribute: "host_genome_name",
      colorGroupLegendTitle: "Host Genome Name",
      colorGroupAbsentName: "No data",
    });
  });

  it("merges fetched metadata fields into the dropdown options, sorted by text", async () => {
    const { instance } = renderVis();
    await waitFor(() => expect(instance.state.metadataFields).toHaveLength(2));

    const options = instance.getMetadataDropdownOptions();
    expect(options.map((o: $TSFixMe) => o.value)).toEqual([
      "collection_date",
      "host_genome_name",
      "project_name",
      "sample_type",
    ]);
  });

  it("opens NCBI in a new window for an accession node", () => {
    const openSpy = jest.spyOn(window, "open").mockImplementation(() => null);
    const onSampleNodeClick = jest.fn();
    const { instance } = renderVis({ onSampleNodeClick });

    instance.handleNodeClick({ data: { accession: "NC_001" } });

    expect(openSpy).toHaveBeenCalledWith(
      "https://www.ncbi.nlm.nih.gov/nuccore/NC_001",
      "_blank",
      "noopener",
      "noreferrer",
    );
    expect(onSampleNodeClick).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("routes a sample node click to the callback with sample and run ids", () => {
    const openSpy = jest.spyOn(window, "open").mockImplementation(() => null);
    const onSampleNodeClick = jest.fn();
    const { instance } = renderVis({ onSampleNodeClick });

    instance.handleNodeClick({
      data: { sample_id: 7, pipeline_run_id: 70 },
    });

    expect(onSampleNodeClick).toHaveBeenCalledWith(7, 70);
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("ignores a node that has neither an accession nor a sample id", () => {
    const openSpy = jest.spyOn(window, "open").mockImplementation(() => null);
    const onSampleNodeClick = jest.fn();
    const { instance } = renderVis({ onSampleNodeClick });

    instance.handleNodeClick({ data: {} });

    expect(openSpy).not.toHaveBeenCalled();
    expect(onSampleNodeClick).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("builds the NCBI reference tooltip for accession nodes", () => {
    const { instance } = renderVis();
    act(() => {
      instance.handleNodeHover({ data: NODE_DATA.ncbiRef });
    });

    const tooltip = instance.getTooltipData();
    expect(tooltip.description).toContain("Reference samples are chosen");
    expect(tooltip.data).toHaveLength(1);
    expect(tooltip.data[0].name).toBe("NCBI Reference");
    expect(tooltip.data[0].data).toEqual([
      ["Country", "USA"],
      ["Collection Date", "2020-05-05"],
    ]);
  });

  it("builds the sample tooltip with resolved metadata labels and metrics", async () => {
    const { instance } = renderVis();
    await waitFor(() => expect(instance.state.metadataFields).toHaveLength(2));
    act(() => {
      instance.handleNodeHover({ data: NODE_DATA.sampleA });
    });

    const tooltip = instance.getTooltipData();
    expect(tooltip.description).toBeUndefined();
    const [info, metrics] = tooltip.data;
    expect(info.name).toBe("Info");
    expect(info.data[0]).toEqual(["Name", "Sample A"]);
    expect(info.data[1]).toEqual(["Project", "Project X"]);
    // Known key -> resolved display name; unknown key -> raw key echoed back.
    const labels = info.data.map((row: $TSFixMe) => row[0]);
    expect(labels).toContain("Collection Date");
    expect(labels).toContain("collection_location_v2");
    expect(metrics.name).toBe("Metrics");
    expect(metrics.data[0][0]).toBe("Coverage Breadth");
  });

  it("falls back to '-' for missing metadata values", async () => {
    const { instance } = renderVis();
    await waitFor(() => expect(instance.state.metadataFields).toHaveLength(2));
    act(() => {
      instance.handleNodeHover({ data: NODE_DATA.sampleB });
    });

    const info = instance.getTooltipData().data[0];
    const collectionDateRow = info.data.find(
      (row: $TSFixMe) => row[0] === "Collection Date",
    );
    expect(collectionDateRow[1]).toBe("-");
  });

  it("uses the field default when a metric is absent", () => {
    const { instance } = renderVis();
    act(() => {
      instance.handleNodeHover({ data: NODE_DATA.sampleB });
    });

    const metrics = instance.getTooltipData().data[1];
    expect(metrics.data[0]).toEqual(["Coverage Breadth", "See coverage viz"]);
  });

  it("logs and degrades gracefully when a field parser throws", () => {
    const consoleSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const { instance } = renderVis();
    act(() => {
      instance.handleNodeHover({ data: { boom: "x" } });
    });

    const value = instance.getFieldValue({
      name: "boom",
      parser: () => {
        throw new Error("nope");
      },
      default: "fallback",
    });

    expect(consoleSpy).toHaveBeenCalledWith("Error parsing: boom");
    // Parsing failed, so the raw (unparsed) value is still returned.
    expect(value).toBe("x");
    consoleSpy.mockRestore();
  });

  it("toggles the warning tooltip on hover and exit", () => {
    const { instance } = renderVis();

    act(() => {
      instance.handleWarningIconHover();
    });
    expect(instance.state.showWarningTooltip).toBe(true);

    act(() => {
      instance.handleWarningIconExit();
    });
    expect(instance.state.showWarningTooltip).toBe(false);
  });

  it("rebuilds the tree when the newick string changes", async () => {
    const ref = React.createRef<$TSFixMe>();
    const { rerender } = render(
      <PhyloTreeVis
        ref={ref}
        newick={NEWICK}
        nodeData={NODE_DATA}
        afterSelectedMetadataChange={jest.fn()}
        onNewTreeContainer={jest.fn()}
        onSampleNodeClick={jest.fn()}
      />,
    );
    mockSetTree.mockClear();
    mockGetSampleMetadataFields.mockClear();

    rerender(
      <PhyloTreeVis
        ref={ref}
        newick="(sampleA:0.3,sampleB:0.4);"
        nodeData={NODE_DATA}
        afterSelectedMetadataChange={jest.fn()}
        onNewTreeContainer={jest.fn()}
        onSampleNodeClick={jest.fn()}
      />,
    );

    expect(mockSetTree).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockGetSampleMetadataFields).toHaveBeenCalled());
  });

  it("does not rebuild the tree when unrelated props change", () => {
    const ref = React.createRef<$TSFixMe>();
    const { rerender } = render(
      <PhyloTreeVis
        ref={ref}
        newick={NEWICK}
        nodeData={NODE_DATA}
        phyloTreeId={1}
        afterSelectedMetadataChange={jest.fn()}
        onNewTreeContainer={jest.fn()}
        onSampleNodeClick={jest.fn()}
      />,
    );
    act(() => {
      ref.current.setState({ sidebarVisible: true });
    });
    mockSetTree.mockClear();

    rerender(
      <PhyloTreeVis
        ref={ref}
        newick={NEWICK}
        nodeData={NODE_DATA}
        phyloTreeId={2}
        afterSelectedMetadataChange={jest.fn()}
        onNewTreeContainer={jest.fn()}
        onSampleNodeClick={jest.fn()}
      />,
    );

    expect(mockSetTree).not.toHaveBeenCalled();
    // Switching trees closes the sidebar.
    expect(ref.current.state.sidebarVisible).toBe(false);
  });

  it("renders the tooltip table only while a node is hovered", () => {
    const { instance, container } = renderVis();
    expect(container.querySelector(".phylo-tree-vis")).toBeTruthy();
    // No hovered node -> no tooltip table rendered.
    expect(container.textContent).not.toContain("NCBI Reference");

    act(() => {
      instance.handleNodeHover({ data: NODE_DATA.ncbiRef });
    });
    expect(container.textContent).toContain("NCBI Reference");
  });
});
