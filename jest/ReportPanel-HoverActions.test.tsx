// Coverage for
// app/assets/src/components/views/SampleView/components/ReportPanel/components/HoverActions/HoverActions.tsx
//
// HoverActions decides, per report row, which of the five row actions exist
// (coverage viz / BLAST / phylo tree / consensus genome / downloads), which are
// enabled, and what the disabled tooltip says. That is almost entirely branch
// logic driven by the row's counts, the pipeline version, the current tab and
// the snapshot flag -- so each test below pins one arm of that decision tree
// and then drives the resulting click handler.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { kebabCase } from "lodash/fp";
import React from "react";
import { WORKFLOW_TABS } from "~/components/utils/workflows";
import { HoverActions } from "~/components/views/SampleView/components/ReportPanel/components/HoverActions/HoverActions";

jest.mock("~/api/analytics", () => ({
  ...jest.requireActual("~/api/analytics"),
  // withAnalytics wrappers are identity here so the underlying handler runs.
  useWithAnalytics: () => (fn: $TSFixMe) => fn,
  useTrackEvent: () => jest.fn(),
  trackEvent: jest.fn(),
}));

// HoverActions only needs one sentinel constant from ReportTable, but importing
// the real module drags in the entire column-renderer tree (and its
// alias-prefixed SCSS, which escapes the style mock). Stub it to the constant.
jest.mock(
  "~/components/views/SampleView/components/MngsReport/components/ReportTable/ReportTable",
  () => ({ INVALID_CALL_BASE_TAXID: -1e8 }),
);

// The download action's dropdown is captured rather than driven through the
// real menu, so its option list and onChange contract can be asserted directly.
let bareDropdownProps: $TSFixMe = null;
jest.mock("~/components/ui/controls/dropdowns/BareDropdown", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => {
    bareDropdownProps = props;
    return <div data-testid="bare-dropdown">{props.trigger}</div>;
  },
}));

// Keeps organize-imports from dropping the React import the classic JSX runtime needs.
const _React: typeof React = React;

const SAMPLE_ID = 55;
const PIPELINE_VERSION = "6.8"; // above both COVERAGE_VIZ (3.6) and CG (3.7) minimums

const speciesRow = (overrides: $TSFixMe = {}) => ({
  taxId: 573,
  genus_tax_id: 570,
  taxLevel: "species",
  category: "viruses",
  name: "Klebsiella pneumoniae",
  common_name: "kpneu",
  species: [],
  nt: { count: 200, contigs: 4, percent_identity: 99.1 },
  nr: { count: 120, contigs: 2 },
  ...overrides,
});

const renderActions = (props: $TSFixMe = {}) => {
  const handlers = {
    onBlastClick: jest.fn(),
    onConsensusGenomeClick: jest.fn(),
    onCoverageVizClick: jest.fn(),
    onPhyloTreeModalOpened: jest.fn(),
    onPreviousConsensusGenomeClick: jest.fn(),
  };
  const utils = render(
    <HoverActions
      currentTab={WORKFLOW_TABS.SHORT_READ_MNGS as $TSFixMe}
      isPhyloTreeAllowed={true}
      pipelineVersion={PIPELINE_VERSION}
      projectId={9}
      sampleId={SAMPLE_ID}
      rowData={speciesRow() as $TSFixMe}
      consensusGenomeEnabled
      fastaEnabled
      {...handlers}
      {...props}
    />,
  );
  return { ...utils, ...handlers };
};

// data-testids are `hover-action-<kebabCase(key)>`; the keys embed the taxId.
const actionButton = (key: string) =>
  screen
    .getByTestId(`hover-action-${kebabCase(key)}`)
    .closest("button") as HTMLButtonElement;

const queryAction = (key: string) =>
  screen.queryByTestId(`hover-action-${kebabCase(key)}`);

const allActionIds = () =>
  Array.from(document.querySelectorAll("[data-testid^='hover-action-']")).map(
    el => el.getAttribute("data-testid"),
  );

beforeEach(() => {
  bareDropdownProps = null;
});

describe("HoverActions action set", () => {
  it("renders the full short-read action set for a modern pipeline", () => {
    renderActions();
    expect(allActionIds()).toEqual([
      "hover-action-coverage-viz-573",
      "hover-action-blast-573-v-1",
      "hover-action-phylo-tree-573",
      "hover-action-consensus-genome-573",
      "hover-action-download-573",
    ]);
    // The divider between BLAST and phylo tree is rendered too.
    expect(screen.getByTestId("hover-actions")).toBeTruthy();
  });

  it("omits coverage viz on a pipeline older than the feature minimum", () => {
    renderActions({ pipelineVersion: "3.0" });
    expect(queryAction("coverage_viz_573")).toBeNull();
    expect(queryAction("blast_573_v1")).toBeTruthy();
  });

  it("shows only coverage viz and downloads on the long-read tab", () => {
    renderActions({ currentTab: WORKFLOW_TABS.LONG_READ_MNGS });
    expect(allActionIds()).toEqual([
      "hover-action-coverage-viz-573",
      "hover-action-download-573",
    ]);
  });

  it("keeps coverage viz on the long-read tab even for an old pipeline version", () => {
    renderActions({
      currentTab: WORKFLOW_TABS.LONG_READ_MNGS,
      pipelineVersion: "1.0",
    });
    expect(queryAction("coverage_viz_573")).toBeTruthy();
  });

  it("drops every non-snapshot action when viewing a snapshot", () => {
    renderActions({ snapshotShareId: "abc123" });
    expect(allActionIds()).toEqual(["hover-action-coverage-viz-573"]);
  });

  it("omits the consensus genome action when the feature is off", () => {
    renderActions({ consensusGenomeEnabled: false });
    expect(queryAction("consensus_genome_573")).toBeNull();
  });
});

describe("HoverActions enablement", () => {
  it("disables coverage viz for a row with no NT reads", () => {
    renderActions({ rowData: speciesRow({ nt: { count: 0, contigs: 0 } }) });
    expect(actionButton("coverage_viz_573").disabled).toBe(true);
  });

  it("enables coverage viz for a row with NT reads", () => {
    renderActions();
    expect(actionButton("coverage_viz_573").disabled).toBe(false);
  });

  it("disables the phylo tree action when phylo trees are not allowed", () => {
    renderActions({ isPhyloTreeAllowed: false });
    expect(actionButton("phylo_tree_573").disabled).toBe(true);
  });

  it("disables the phylo tree action for a row with no reads", () => {
    renderActions({
      rowData: speciesRow({ nt: { count: 0 }, nr: { count: 0 } }),
    });
    expect(actionButton("phylo_tree_573").disabled).toBe(true);
  });

  it("disables downloads when neither contigs nor reads are downloadable", () => {
    renderActions({
      fastaEnabled: false,
      rowData: speciesRow({ nt: { count: 5 }, nr: { count: 5 } }),
    });
    expect(actionButton("download_573").disabled).toBe(true);
  });

  it("enables downloads when only the reads fasta is available", () => {
    renderActions({
      fastaEnabled: true,
      rowData: speciesRow({ nt: { count: 5 }, nr: { count: 5 } }),
    });
    expect(actionButton("download_573").disabled).toBe(false);
  });
});

describe("HoverActions consensus genome gating", () => {
  const cgButton = () => actionButton("consensus_genome_573");

  it("is enabled for a viral species with an NT contig and coverage", () => {
    renderActions();
    expect(cgButton().disabled).toBe(false);
  });

  it("is disabled for a pipeline older than the consensus genome minimum", () => {
    // 3.6 clears coverage viz but not consensus genome (3.7).
    renderActions({ pipelineVersion: "3.6" });
    expect(cgButton().disabled).toBe(true);
  });

  it("is disabled for a non-viral taxon", () => {
    renderActions({ rowData: speciesRow({ category: "bacteria" }) });
    expect(cgButton().disabled).toBe(true);
  });

  it("is disabled at the genus level", () => {
    renderActions({ rowData: speciesRow({ taxLevel: "genus" }) });
    expect(cgButton().disabled).toBe(true);
  });

  it("is disabled when the taxon has no NT contigs", () => {
    renderActions({ rowData: speciesRow({ nt: { count: 200, contigs: 0 } }) });
    expect(cgButton().disabled).toBe(true);
  });

  it("shows a count badge and uses the previous-run handler when prior runs exist", () => {
    const { onPreviousConsensusGenomeClick, onConsensusGenomeClick } =
      renderActions({
        previousConsensusGenomeRuns: [{ id: 1 }, { id: 2 }],
      });
    expect(screen.getByText("2")).toBeTruthy();
    const button = cgButton();
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(onPreviousConsensusGenomeClick).toHaveBeenCalledWith({
      percentIdentity: 99.1,
      taxId: 573,
      taxName: "Klebsiella pneumoniae",
    });
    expect(onConsensusGenomeClick).not.toHaveBeenCalled();
  });
});

describe("HoverActions click handlers", () => {
  it("coverage viz passes the taxon identity and per-count-type stats", () => {
    const { onCoverageVizClick } = renderActions();
    fireEvent.click(actionButton("coverage_viz_573"));
    expect(onCoverageVizClick).toHaveBeenCalledWith({
      taxId: 573,
      taxName: "Klebsiella pneumoniae",
      taxCommonName: "kpneu",
      taxLevel: "species",
      taxSpecies: [],
      taxonStatsByCountType: {
        ntContigs: 4,
        ntReads: 200,
        nrContigs: 2,
        nrReads: 120,
      },
    });
  });

  it("BLAST reports the species-level index and the row's stats", () => {
    const { onBlastClick } = renderActions();
    fireEvent.click(actionButton("blast_573_v1"));
    expect(onBlastClick).toHaveBeenCalledWith(
      expect.objectContaining({
        context: { blastedFrom: "HoverActions" },
        pipelineVersion: PIPELINE_VERSION,
        sampleId: SAMPLE_ID,
        shouldBlastContigs: true,
        taxId: 573,
        taxLevel: 1,
        taxName: "Klebsiella pneumoniae",
      }),
    );
  });

  it("BLAST reports the genus-level index for a genus row", () => {
    const { onBlastClick } = renderActions({
      rowData: speciesRow({ taxLevel: "genus" }),
    });
    fireEvent.click(actionButton("blast_573_v1"));
    expect(onBlastClick.mock.calls[0][0].taxLevel).toBe(2);
  });

  it("phylo tree opens the modal with the taxon", () => {
    const { onPhyloTreeModalOpened } = renderActions();
    fireEvent.click(actionButton("phylo_tree_573"));
    expect(onPhyloTreeModalOpened).toHaveBeenCalledWith({
      taxId: 573,
      taxName: "Klebsiella pneumoniae",
    });
  });

  it("consensus genome passes the NT percent identity", () => {
    const { onConsensusGenomeClick } = renderActions();
    fireEvent.click(actionButton("consensus_genome_573"));
    expect(onConsensusGenomeClick).toHaveBeenCalledWith({
      percentIdentity: 99.1,
      taxId: 573,
      taxName: "Klebsiella pneumoniae",
    });
  });
});

describe("HoverActions download dropdown", () => {
  const originalLocation = window.location;

  const stubLocation = () => {
    const stub = { ...originalLocation, href: "" };
    Object.defineProperty(window, "location", {
      configurable: true,
      value: stub,
    });
    return stub;
  };

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  it("enables both options when contigs and reads are available", () => {
    renderActions();
    expect(bareDropdownProps.options).toEqual([
      { text: "Contigs (.fasta)", value: "download-contigs", disabled: false },
      { text: "Reads (.fasta)", value: "download-reads", disabled: false },
    ]);
  });

  it("disables the contigs option when the row has no contigs", () => {
    renderActions({
      rowData: speciesRow({ nt: { count: 9 }, nr: { count: 9 } }),
    });
    expect(bareDropdownProps.options[0].disabled).toBe(true);
    expect(bareDropdownProps.options[1].disabled).toBe(false);
  });

  it("disables the reads option when fasta download is off", () => {
    renderActions({ fastaEnabled: false });
    expect(bareDropdownProps.options[1].disabled).toBe(true);
  });

  it("navigates to the contig download URL", () => {
    const stub = stubLocation();
    renderActions();
    bareDropdownProps.onChange("download-contigs");
    expect(stub.href).toBe(
      `/samples/${SAMPLE_ID}/taxid_contigs_download?taxid=573&pipeline_version=${PIPELINE_VERSION}`,
    );
  });

  it("navigates to the reads fasta URL at the species level", () => {
    const stub = stubLocation();
    renderActions();
    bareDropdownProps.onChange("download-reads");
    expect(stub.href).toBe(
      `/samples/${SAMPLE_ID}/fasta/1/573/NT_or_NR?pipeline_version=${PIPELINE_VERSION}`,
    );
  });

  it("navigates to the genus-level reads fasta URL for a genus row", () => {
    const stub = stubLocation();
    renderActions({ rowData: speciesRow({ taxLevel: "genus" }) });
    bareDropdownProps.onChange("download-reads");
    expect(stub.href).toContain("/fasta/2/573/NT_or_NR");
  });

  it("logs and navigates nowhere for an unexpected dropdown value", () => {
    const stub = stubLocation();
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    renderActions();
    bareDropdownProps.onChange("something-else" as $TSFixMe);
    expect(consoleError).toHaveBeenCalledWith(
      "Unexpected dropdown value:",
      "something-else",
    );
    expect(stub.href).toBe("");
    consoleError.mockRestore();
  });

  it("drops the caller's class while the dropdown is open so it stays visible", () => {
    renderActions({ className: "row-hover" });
    expect(screen.getByTestId("hover-actions").className).toContain(
      "row-hover",
    );
    act(() => bareDropdownProps.onOpen());
    expect(screen.getByTestId("hover-actions").className).not.toContain(
      "row-hover",
    );
    act(() => bareDropdownProps.onClose());
    expect(screen.getByTestId("hover-actions").className).toContain(
      "row-hover",
    );
  });
});
