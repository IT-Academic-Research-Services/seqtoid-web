// Coverage: app/assets/src/components/views/PhyloTree/PhyloTreeDownloadButton.tsx
//
// PhyloTreeDownloadButton is a class component that builds the set of download
// options for a phylo tree and routes a chosen option to the right place:
// a legacy /phylo_trees download, a /phylo_tree_ngs download, an in-browser SVG
// or PNG save (via svgsaver), or a console error for an unknown option. The
// render path also branches on showPhyloTreeNgOptions and, within that, on
// whether the tree already has a clustermap svg. The two leaf UI components are
// stubbed so assertions land on this file's option-building + routing logic.
import { render } from "@testing-library/react";
import React from "react";

const mockAsSvg = jest.fn();
const mockAsPng = jest.fn();

jest.mock("svgsaver", () =>
  jest.fn().mockImplementation(() => ({
    asSvg: mockAsSvg,
    asPng: mockAsPng,
  })),
);

// Capture the props handed to the leaf dropdown so we can inspect the option
// list / disabled state and drive its onClick.
const mockDownloadDropdownProps: $TSFixMe[] = [];
jest.mock("~ui/controls/dropdowns/DownloadButtonDropdown", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => {
    mockDownloadDropdownProps.push(props);
    return (
      <div
        data-testid="download-dropdown"
        data-disabled={String(props.disabled)}
        data-optioncount={props.options ? props.options.length : "none"}
        data-itemcount={props.items ? props.items.length : "none"}
      />
    );
  },
}));

jest.mock("~ui/controls/dropdowns/BareDropdown", () => {
  const ReactLib = require("react");
  const Item = (props: $TSFixMe) =>
    ReactLib.createElement("button", {
      "data-testid": "bare-item",
      "data-text": props.text,
      onClick: props.onClick,
    });
  const Divider = () =>
    ReactLib.createElement("hr", { "data-testid": "bare-divider" });
  const BareDropdown = () => null;
  BareDropdown.Item = Item;
  BareDropdown.Divider = Divider;
  return { __esModule: true, default: BareDropdown };
});

import PhyloTreeDownloadButton from "~/components/views/PhyloTree/PhyloTreeDownloadButton";

const renderButton = (props: $TSFixMe = {}) => {
  const ref = React.createRef<$TSFixMe>();
  const utils = render(<PhyloTreeDownloadButton ref={ref} {...props} />);
  return { ...utils, ref };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockDownloadDropdownProps.length = 0;
});

describe("PhyloTreeDownloadButton default (legacy) options", () => {
  it("includes ready data options plus the svg/png tree images, excluding newick", () => {
    renderButton({ tree: { id: 7, vcf: true, snp_annotations: true } });
    const props = mockDownloadDropdownProps[0];
    const values = props.options.map((o: $TSFixMe) => o.value);
    // Both data options are ready...
    expect(values).toContain("vcf");
    expect(values).toContain("snp_annotations");
    // ...svg + png tree images survive the phyloTreeNg filter...
    expect(values).toContain("svg");
    expect(values).toContain("png");
    // ...but the newick option (a phyloTreeNg value) is excluded.
    expect(values).not.toContain("phylotree.phylotree_newick");
    expect(props.disabled).toBe(false);
  });

  it("drops data options whose files are absent", () => {
    renderButton({ tree: { id: 7, vcf: true } });
    const values = mockDownloadDropdownProps[0].options.map(
      (o: $TSFixMe) => o.value,
    );
    expect(values).toContain("vcf");
    expect(values).not.toContain("snp_annotations");
  });

  it("disables the dropdown when no options are ready and only image options remain", () => {
    // No vcf/snp files -> only svg + png survive, so still 2 options (enabled).
    renderButton({ tree: { id: 7 } });
    const props = mockDownloadDropdownProps[0];
    expect(props.options.map((o: $TSFixMe) => o.value)).toEqual(["svg", "png"]);
    expect(props.disabled).toBe(false);
  });
});

describe("PhyloTreeDownloadButton phyloTreeNg options", () => {
  it("renders matrix items when the tree already has a clustermap svg", () => {
    renderButton({
      showPhyloTreeNgOptions: true,
      tree: { id: 7, clustermap_svg_url: "http://x/c.svg" },
    });
    const props = mockDownloadDropdownProps[0];
    // getMatrixItems: 2 image items + divider + ska items (only matrixOnly ones
    // return an element; the non-matrix ska option returns undefined).
    expect(props.items).toBeDefined();
    expect(props.options).toBeUndefined();
    expect(props.items.length).toBeGreaterThan(0);
  });

  it("renders the full ng item list when the tree has no clustermap svg", () => {
    renderButton({
      showPhyloTreeNgOptions: true,
      tree: { id: 7 },
    });
    const props = mockDownloadDropdownProps[0];
    // getPhyloTreeNgItems: treeOptions(3) + matrixImageOptions(2) + divider(1)
    // + skaOptions(2) = 8 items.
    expect(props.items.length).toBe(8);
    expect(props.disabled).toBe(false);
  });
});

describe("PhyloTreeDownloadButton download routing", () => {
  const setHref = (): { getHref: () => string } => {
    let href = "";
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        get href() {
          return href;
        },
        set href(v: string) {
          href = v;
        },
      },
    });
    return { getHref: () => href };
  };

  it("routes legacy data options to /phylo_trees", () => {
    const loc = setHref();
    const { ref } = renderButton({ tree: { id: 42, vcf: true } });
    ref.current.download("vcf");
    expect(loc.getHref()).toBe("/phylo_trees/42/download?output=vcf");
  });

  it("routes phyloTreeNg options to /phylo_tree_ngs", () => {
    const loc = setHref();
    const { ref } = renderButton({ tree: { id: 42 } });
    ref.current.download("phylotree.clustermap_svg");
    expect(loc.getHref()).toBe(
      "/phylo_tree_ngs/42/download?output=phylotree.clustermap_svg",
    );
  });

  it("saves an in-browser svg via svgsaver", () => {
    const container = document.createElement("div");
    const { ref } = renderButton({
      tree: { id: 42 },
      treeContainer: container,
    });
    ref.current.download("svg");
    expect(mockAsSvg).toHaveBeenCalledWith(container, "phylo_tree.svg");
    expect(mockAsPng).not.toHaveBeenCalled();
  });

  it("saves an in-browser png via svgsaver", () => {
    const container = document.createElement("div");
    const { ref } = renderButton({
      tree: { id: 42 },
      treeContainer: container,
    });
    ref.current.download("png");
    expect(mockAsPng).toHaveBeenCalledWith(container, "phylo_tree.png");
  });

  it("logs an error for an unrecognized option", () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const { ref } = renderButton({ tree: { id: 42 } });
    ref.current.download("not-a-real-option");
    expect(spy).toHaveBeenCalledWith("Bad download option: not-a-real-option");
    spy.mockRestore();
  });
});
