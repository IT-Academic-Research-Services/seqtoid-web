// Branch coverage for
// app/assets/src/components/views/SampleView/components/ReportPanel/components/HoverActions/HoverActions.tsx
//
// getConsensusGenomeError() is an else-if ladder of five guards. The existing
// HoverActions spec exercises the first four (pipeline version too old,
// non-viral category, genus level, zero NT contigs) but never the last one:
//
//   } else if (!coverageVizEnabled) {
//     return "Consensus genome pipeline only available when coverage visualization is available.";
//   }
//
// Reaching it needs a row that clears every earlier guard -- viral, species
// level, at least one NT contig -- while still failing the coverage-viz check.
// coverageVizEnabled is
//   currentTab === LONG_READ_MNGS || (validTaxonId && nt.count > 0)
// so a short-read row with contigs but zero NT reads is exactly that state, and
// it is a real shape: contigs can be assembled for a taxon whose per-read NT
// counts were filtered out.
import { render, screen } from "@testing-library/react";
import { kebabCase } from "lodash/fp";
import { WORKFLOW_TABS } from "~/components/utils/workflows";
import { HoverActions } from "~/components/views/SampleView/components/ReportPanel/components/HoverActions/HoverActions";

jest.mock("~/api/analytics", () => ({
  ...jest.requireActual("~/api/analytics"),
  useWithAnalytics: () => (fn: $TSFixMe) => fn,
  useTrackEvent: () => jest.fn(),
  trackEvent: jest.fn(),
}));

// Importing the real ReportTable for one sentinel constant drags in the whole
// column-renderer tree; stub it down to the constant HoverActions actually uses.
jest.mock(
  "~/components/views/SampleView/components/MngsReport/components/ReportTable/ReportTable",
  () => ({ INVALID_CALL_BASE_TAXID: -1e8 }),
);

jest.mock("~/components/ui/controls/dropdowns/BareDropdown", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => <div>{props.trigger}</div>,
}));

// The disabled reason only reaches the DOM as the popup's `content` prop, so
// the popup is replaced with a wrapper that parks it on an attribute. That is
// what lets these tests assert WHICH guard fired rather than just "disabled".
jest.mock("~/components/common/BasicPopup", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => (
    <div
      data-popup-content={
        typeof props.content === "string" ? props.content : "[element]"
      }
    >
      {props.trigger}
    </div>
  ),
}));

const COVERAGE_VIZ_UNAVAILABLE_MESSAGE =
  "Consensus genome pipeline only available when coverage visualization is available.";

const viralSpeciesRow = (overrides: $TSFixMe = {}) => ({
  taxId: 2697049,
  genus_tax_id: 694002,
  taxLevel: "species",
  category: "viruses",
  name: "Severe acute respiratory syndrome coronavirus 2",
  common_name: "SARS-CoV-2",
  species: [],
  nt: { count: 0, contigs: 3, percent_identity: 98.4 },
  nr: { count: 0, contigs: 0 },
  ...overrides,
});

const renderActions = (props: $TSFixMe = {}) =>
  render(
    <HoverActions
      currentTab={WORKFLOW_TABS.SHORT_READ_MNGS as $TSFixMe}
      isPhyloTreeAllowed={false}
      pipelineVersion="6.8"
      projectId={3}
      sampleId={77}
      rowData={viralSpeciesRow() as $TSFixMe}
      consensusGenomeEnabled
      fastaEnabled
      onBlastClick={jest.fn()}
      onConsensusGenomeClick={jest.fn()}
      onCoverageVizClick={jest.fn()}
      onPhyloTreeModalOpened={jest.fn()}
      onPreviousConsensusGenomeClick={jest.fn()}
      {...props}
    />,
  );

const button = (key: string) =>
  screen
    .getByTestId(`hover-action-${kebabCase(key)}`)
    .closest("button") as HTMLButtonElement;

const tooltipFor = (key: string) =>
  screen
    .getByTestId(`hover-action-${kebabCase(key)}`)
    .closest("[data-popup-content]")
    ?.getAttribute("data-popup-content");

const CG_WORKFLOW_RUN = "consensus_genome_2697049";
const VIZ_WORKFLOW_RUN = "coverage_viz_2697049";

describe("HoverActions consensus genome coverage-viz guard", () => {
  it("blocks consensus genome when the row has NT contigs but no NT reads", () => {
    renderActions();

    // Coverage viz itself is off, which is the precondition for the last guard.
    expect(button(VIZ_WORKFLOW_RUN).disabled).toBe(true);
    // ...and the consensus genome action reports that specific reason, proving
    // the four earlier guards in the ladder all passed.
    expect(button(CG_WORKFLOW_RUN).disabled).toBe(true);
    expect(tooltipFor(CG_WORKFLOW_RUN)).toBe(COVERAGE_VIZ_UNAVAILABLE_MESSAGE);
  });

  it("clears the guard as soon as the row has NT reads", () => {
    renderActions({
      rowData: viralSpeciesRow({
        nt: { count: 12, contigs: 3, percent_identity: 98.4 },
      }),
    });

    expect(button(VIZ_WORKFLOW_RUN).disabled).toBe(false);
    expect(button(CG_WORKFLOW_RUN).disabled).toBe(false);
    // No error string -> the popup falls back to the plain action label.
    expect(tooltipFor(CG_WORKFLOW_RUN)).toBe("Consensus Genome");
  });

  it("never reaches the coverage-viz guard on the long-read tab, where coverage viz is unconditional", () => {
    // Same zero-NT-read row, but LONG_READ_MNGS short-circuits coverageVizEnabled
    // to true. The consensus genome action is not offered on that tab at all,
    // so the ladder's last rung is unreachable from here.
    renderActions({ currentTab: WORKFLOW_TABS.LONG_READ_MNGS });

    expect(button(VIZ_WORKFLOW_RUN).disabled).toBe(false);
    expect(
      screen.queryByTestId(`hover-action-${kebabCase(CG_WORKFLOW_RUN)}`),
    ).toBeNull();
  });

  it("reports the contig guard, not the coverage-viz guard, when contigs are missing", () => {
    // Ordering check: with neither contigs nor reads BOTH final guards would be
    // true, and the ladder must stop at the earlier one.
    renderActions({
      rowData: viralSpeciesRow({ nt: { count: 0, contigs: 0 } }),
    });

    expect(button(CG_WORKFLOW_RUN).disabled).toBe(true);
    expect(tooltipFor(CG_WORKFLOW_RUN)).toBe(
      "Please select a virus with at least 1 contig that aligned to the NT database to run the consensus genome pipeline.",
    );
  });
});
