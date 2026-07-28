// Coverage: app/assets/src/components/views/SampleView/components/ReportPanel/ReportPanel.tsx
//
// ReportPanel is pure tab dispatch: it picks which report view to render from
// currentTab, with two extra guards -- the deprecated AMR view also needs
// amrDeprecatedData, and the benchmark view also needs a sample. Every one of
// those conditions is exercised on both sides here (including the "no tab
// matches" case), and the props each view receives are checked so the run-type
// casts (pipelineRun vs workflowRun) do not silently swap. All five child views
// are stubbed to prop-reporting placeholders.
import { fireEvent, render, screen } from "@testing-library/react";
import { WORKFLOW_TABS } from "~/components/utils/workflows";
import { ReportPanel } from "~/components/views/SampleView/components/ReportPanel/ReportPanel";

jest.mock("~/components/views/SampleView/components/MngsReport", () => ({
  MngsReport: (props: $TSFixMe) => (
    <div
      data-testid="mngs-report"
      data-tab={String(props.currentTab)}
      data-run-id={String(props.pipelineRun?.id)}
      data-loading={String(props.loadingReport)}
      data-row-count={String((props.filteredReportData ?? []).length)}
    />
  ),
}));

jest.mock("~/components/views/SampleView/components/AmrView", () => ({
  AmrView: (props: $TSFixMe) => (
    <div
      data-testid="amr-view"
      data-sample-id={String(props.sample?.id)}
      data-run-id={String(props.workflowRun?.id)}
    />
  ),
}));

jest.mock("~/components/views/SampleView/components/BenchmarkView", () => ({
  BenchmarkView: (props: $TSFixMe) => (
    <div
      data-testid="benchmark-view"
      data-run-id={String(props.workflowRun?.id)}
    />
  ),
}));

jest.mock(
  "~/components/views/SampleView/components/ConsensusGenomeView",
  () => ({
    ConsensusGenomeView: (props: $TSFixMe) => (
      <div data-testid="cg-view" data-run-id={String(props.workflowRun?.id)}>
        <button
          data-testid="cg-select"
          onClick={() => props.onWorkflowRunSelect({ id: 42 })}
        />
      </div>
    ),
  }),
);

jest.mock(
  "~/components/views/SampleView/components/ReportPanel/components/DeprecatedAmrView",
  () => ({
    DeprecatedAmrView: (props: $TSFixMe) => (
      <div
        data-testid="deprecated-amr-view"
        data-count={String((props.amr ?? []).length)}
      />
    ),
  }),
);

const renderPanel = (overrides: $TSFixMe = {}) => {
  const handleWorkflowRunSelect = jest.fn();
  const view = render(
    <ReportPanel
      amrDeprecatedData={null}
      backgrounds={[]}
      currentRun={{ id: 5 } as $TSFixMe}
      currentTab={WORKFLOW_TABS.SHORT_READ_MNGS as $TSFixMe}
      clearAllFilters={jest.fn()}
      dispatchSelectedOptions={jest.fn()}
      enableMassNormalizedBackgrounds={false}
      filteredReportData={[{ taxId: 1 }] as $TSFixMe}
      handleAnnotationUpdate={jest.fn()}
      handleBlastClick={jest.fn()}
      handleConsensusGenomeClick={jest.fn()}
      handleCoverageVizClick={jest.fn()}
      handlePreviousConsensusGenomeClick={jest.fn()}
      handleTaxonClick={jest.fn()}
      handleViewClick={jest.fn()}
      handleWorkflowRunSelect={handleWorkflowRunSelect}
      lineageData={{}}
      loadingReport={false}
      ownedBackgrounds={[]}
      otherBackgrounds={[]}
      project={null}
      reportData={[] as $TSFixMe}
      reportMetadata={{} as $TSFixMe}
      sample={{ id: 12 } as $TSFixMe}
      selectedOptions={{} as $TSFixMe}
      view="table"
      {...overrides}
    />,
  );
  return { handleWorkflowRunSelect, ...view };
};

describe("ReportPanel", () => {
  it("renders the mNGS report for the short read tab", () => {
    renderPanel();

    const report = screen.getByTestId("mngs-report");
    expect(report.getAttribute("data-tab")).toBe(WORKFLOW_TABS.SHORT_READ_MNGS);
    expect(report.getAttribute("data-run-id")).toBe("5");
    expect(report.getAttribute("data-row-count")).toBe("1");
  });

  it("renders the mNGS report for the long read tab too", () => {
    renderPanel({
      currentTab: WORKFLOW_TABS.LONG_READ_MNGS,
      loadingReport: true,
    });

    const report = screen.getByTestId("mngs-report");
    expect(report.getAttribute("data-tab")).toBe(WORKFLOW_TABS.LONG_READ_MNGS);
    expect(report.getAttribute("data-loading")).toBe("true");
  });

  it("does not render the mNGS report on a non-mNGS tab", () => {
    renderPanel({ currentTab: WORKFLOW_TABS.AMR });

    expect(screen.queryByTestId("mngs-report")).toBeNull();
    expect(screen.getByTestId("amr-view")).not.toBeNull();
  });

  it("renders the AMR view with the current run cast as a workflow run", () => {
    renderPanel({ currentTab: WORKFLOW_TABS.AMR, currentRun: { id: 77 } });

    const amr = screen.getByTestId("amr-view");
    expect(amr.getAttribute("data-sample-id")).toBe("12");
    expect(amr.getAttribute("data-run-id")).toBe("77");
  });

  it("renders the deprecated AMR view only when deprecated data is present", () => {
    renderPanel({
      currentTab: WORKFLOW_TABS.AMR_DEPRECATED,
      amrDeprecatedData: [{ gene: "a" }, { gene: "b" }],
    });

    expect(
      screen.getByTestId("deprecated-amr-view").getAttribute("data-count"),
    ).toBe("2");
  });

  it("renders nothing on the deprecated AMR tab when there is no deprecated data", () => {
    const { container } = renderPanel({
      currentTab: WORKFLOW_TABS.AMR_DEPRECATED,
      amrDeprecatedData: null,
    });

    expect(screen.queryByTestId("deprecated-amr-view")).toBeNull();
    expect(container.innerHTML).toBe("");
  });

  it("renders the benchmark view when a sample is available", () => {
    renderPanel({
      currentTab: WORKFLOW_TABS.BENCHMARK,
      currentRun: { id: 31 },
    });

    expect(
      screen.getByTestId("benchmark-view").getAttribute("data-run-id"),
    ).toBe("31");
  });

  it("skips the benchmark view when the sample is null", () => {
    const { container } = renderPanel({
      currentTab: WORKFLOW_TABS.BENCHMARK,
      sample: null,
    });

    expect(screen.queryByTestId("benchmark-view")).toBeNull();
    expect(container.innerHTML).toBe("");
  });

  it("renders the consensus genome view and forwards run selection", () => {
    const { handleWorkflowRunSelect } = renderPanel({
      currentTab: WORKFLOW_TABS.CONSENSUS_GENOME,
      currentRun: { id: 9 },
    });

    expect(screen.getByTestId("cg-view").getAttribute("data-run-id")).toBe("9");

    fireEvent.click(screen.getByTestId("cg-select"));
    expect(handleWorkflowRunSelect).toHaveBeenCalledWith({ id: 42 });
  });

  it("renders nothing for an unrecognized tab", () => {
    const { container } = renderPanel({ currentTab: "Something Else" });

    expect(container.innerHTML).toBe("");
  });
});
