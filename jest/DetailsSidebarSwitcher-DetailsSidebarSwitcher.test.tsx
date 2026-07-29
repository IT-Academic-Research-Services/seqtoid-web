// Coverage: app/assets/src/components/views/SampleView/components/DetailsSidebarSwitcher/DetailsSidebarSwitcher.tsx
//
// This is a thin router that hands a DetailsSidebar either taxon-detail params
// (when in taxonDetails mode with taxon data) or sample-detail params. Its logic
// is the two param builders: the taxon builder pulls rpm out of the taxon via
// lodash get with 0 fallbacks, and the sample builder assembles the enabled
// workflow-tab labels via lodash compact over the sample's pipeline/workflow
// runs. DetailsSidebar is stubbed so the params it receives can be asserted, and
// the null-sample guard is exercised.
import { render } from "@testing-library/react";
import { WORKFLOW_TABS, WorkflowType } from "~/components/utils/workflows";

let mockSidebarProps: $TSFixMe = null;
jest.mock("~/components/common/DetailsSidebar", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => {
    mockSidebarProps = props;
    return <div data-testid="details-sidebar" />;
  },
}));

import { DetailsSidebarSwitcher } from "~/components/views/SampleView/components/DetailsSidebarSwitcher/DetailsSidebarSwitcher";

const baseSample = {
  id: 42,
  pipeline_runs: [{ id: 1 }],
  workflow_runs: [
    { workflow: WorkflowType.CONSENSUS_GENOME },
    { workflow: WorkflowType.AMR },
  ],
};

const renderSwitcher = (overrides: $TSFixMe = {}) => {
  const props = {
    background: { id: 7 },
    handleMetadataUpdate: jest.fn(),
    handleWorkflowRunSelect: jest.fn(),
    handleTabChange: jest.fn(),
    currentRun: { id: 9 },
    currentTab: WORKFLOW_TABS.SHORT_READ_MNGS,
    snapshotShareId: undefined,
    closeSidebar: jest.fn(),
    sidebarVisible: true,
    sidebarMode: "sampleDetails",
    sample: baseSample,
    sidebarTaxonData: null,
    ...overrides,
  };
  return render(<DetailsSidebarSwitcher {...(props as $TSFixMe)} />);
};

beforeEach(() => {
  mockSidebarProps = null;
});

describe("DetailsSidebarSwitcher", () => {
  it("renders nothing when there is no sample", () => {
    const { container } = renderSwitcher({ sample: null });
    expect(container.firstChild).toBeNull();
  });

  it("builds sample-detail params including the enabled workflow labels", () => {
    renderSwitcher();
    expect(mockSidebarProps.mode).toBe("sampleDetails");
    const params = mockSidebarProps.params;
    expect(params.sampleId).toBe(42);
    expect(params.currentRun).toEqual({ id: 9 });
    expect(params.sampleWorkflowLabels).toContain(
      WORKFLOW_TABS.SHORT_READ_MNGS,
    );
    expect(params.sampleWorkflowLabels).toContain(
      WORKFLOW_TABS.CONSENSUS_GENOME,
    );
    expect(params.sampleWorkflowLabels).toContain(WORKFLOW_TABS.AMR);
  });

  it("omits workflow labels for runs the sample does not have", () => {
    renderSwitcher({
      sample: { id: 5, pipeline_runs: [], workflow_runs: [] },
    });
    expect(mockSidebarProps.params.sampleWorkflowLabels).toEqual([]);
  });

  it("builds taxon-detail params when in taxonDetails mode with taxon data", () => {
    renderSwitcher({
      sidebarMode: "taxonDetails",
      sidebarTaxonData: {
        taxId: 573,
        name: "Klebsiella pneumoniae",
        genus: { taxId: 570 },
        nt: { rpm: 12.5 },
        nr: { rpm: 8 },
      },
    });
    expect(mockSidebarProps.mode).toBe("taxonDetails");
    const params = mockSidebarProps.params;
    expect(params.taxonId).toBe(573);
    expect(params.taxonName).toBe("Klebsiella pneumoniae");
    expect(params.parentTaxonId).toBe(570);
    expect(params.taxonValues.NT.rpm).toBe(12.5);
    expect(params.taxonValues.NR.rpm).toBe(8);
    expect(params.background).toEqual({ id: 7 });
  });

  it("falls back to zero rpm and undefined genus when taxon data is sparse", () => {
    renderSwitcher({
      sidebarMode: "taxonDetails",
      sidebarTaxonData: { taxId: 100, name: "Unknown" },
    });
    const params = mockSidebarProps.params;
    expect(params.taxonValues.NT.rpm).toBe(0);
    expect(params.taxonValues.NR.rpm).toBe(0);
    expect(params.parentTaxonId).toBeUndefined();
  });

  it("falls back to sample-detail params in taxonDetails mode when there is no taxon data", () => {
    renderSwitcher({ sidebarMode: "taxonDetails", sidebarTaxonData: null });
    // No taxon data -> the sample param builder runs instead.
    expect(mockSidebarProps.params.sampleId).toBe(42);
  });
});
