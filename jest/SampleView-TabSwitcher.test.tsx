// Coverage: app/assets/src/components/views/SampleView/components/TabSwitcher/TabSwitcher.tsx
//
// TabSwitcher turns the per-workflow run counts of a sample into the list of
// workflow tabs to render. The interesting logic is computeWorkflowTabs: it
// compacts the truthy workflows into a tab list, conditionally appends the
// deprecated-AMR tab (feature flag + SUCCEEDED pipeline + short-read present),
// and falls back to the initial-workflow label when nothing matched. getWorkflowCount
// is stubbed so each of those branches can be driven directly, and the SDS Tabs
// widget is stubbed so we can read the tabs it was handed.
import { render, screen } from "@testing-library/react";
import { UserContext } from "~/components/common/UserContext";
import { TabSwitcher } from "~/components/views/SampleView/components/TabSwitcher/TabSwitcher";

const mockGetWorkflowCount = jest.fn();
jest.mock("~/components/views/SampleView/utils", () => ({
  getWorkflowCount: (...args: $TSFixMe[]) => mockGetWorkflowCount(...args),
}));

// Stub the Tabs control so we can inspect the tab list + selected value.
jest.mock("~/components/ui/controls/Tabs", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => (
    <div data-testid="tabs" data-value={props.value}>
      {props.tabs.map((t: string) => (
        <button
          key={t}
          data-testid={`tab-${t}`}
          onClick={() => props.onChange(t)}
        >
          {t}
        </button>
      ))}
    </div>
  ),
}));

const renderSwitcher = (
  {
    counts,
    reportMetadata = { pipelineRunStatus: "SUCCEEDED" },
    sample = { initial_workflow: "short-read-mngs" },
    currentTab = "Metagenomic",
    handleTabChange = jest.fn(),
  }: $TSFixMe = {},
  allowedFeatures: string[] = [],
) => {
  mockGetWorkflowCount.mockReturnValue(counts);
  return {
    handleTabChange,
    ...render(
      <UserContext.Provider value={{ allowedFeatures } as $TSFixMe}>
        <TabSwitcher
          currentTab={currentTab as $TSFixMe}
          handleTabChange={handleTabChange}
          reportMetadata={reportMetadata as $TSFixMe}
          sample={sample as $TSFixMe}
        />
      </UserContext.Provider>,
    ),
  };
};

describe("TabSwitcher", () => {
  it("renders a tab for each workflow that has runs", () => {
    renderSwitcher({
      counts: {
        "short-read-mngs": 1,
        "long-read-mngs": 0,
        "consensus-genome": 2,
        amr: 1,
      },
    });
    expect(screen.getByTestId("tabs")).toBeTruthy();
    expect(screen.getByTestId("tab-Metagenomic")).toBeTruthy();
    expect(screen.getByTestId("tab-Antimicrobial Resistance")).toBeTruthy();
    expect(screen.getByTestId("tab-Consensus Genome")).toBeTruthy();
    // long-read has zero runs -> no Nanopore tab
    expect(screen.queryByTestId("tab-Nanopore")).toBeNull();
    // deprecated AMR tab requires the feature flag, which is off here
    expect(
      screen.queryByTestId("tab-Antimicrobial Resistance (Deprecated)"),
    ).toBeNull();
  });

  it("appends the deprecated-AMR tab when the flag is on, pipeline SUCCEEDED and short-read present", () => {
    renderSwitcher(
      {
        counts: {
          "short-read-mngs": 1,
          "long-read-mngs": 0,
          "consensus-genome": 0,
          amr: 0,
        },
        reportMetadata: { pipelineRunStatus: "SUCCEEDED" },
      },
      ["AMR"],
    );
    expect(screen.getByTestId("tab-Metagenomic")).toBeTruthy();
    expect(
      screen.getByTestId("tab-Antimicrobial Resistance (Deprecated)"),
    ).toBeTruthy();
  });

  it("does not append the deprecated-AMR tab when the pipeline has not SUCCEEDED", () => {
    renderSwitcher(
      {
        counts: {
          "short-read-mngs": 1,
          "long-read-mngs": 0,
          "consensus-genome": 0,
          amr: 0,
        },
        reportMetadata: { pipelineRunStatus: "RUNNING" },
      },
      ["AMR"],
    );
    expect(screen.getByTestId("tab-Metagenomic")).toBeTruthy();
    expect(
      screen.queryByTestId("tab-Antimicrobial Resistance (Deprecated)"),
    ).toBeNull();
  });

  it("falls back to the initial-workflow label when no workflow has runs", () => {
    renderSwitcher({
      counts: {
        "short-read-mngs": 0,
        "long-read-mngs": 0,
        "consensus-genome": 0,
        amr: 0,
      },
      sample: { initial_workflow: "consensus-genome" },
    });
    // isEmpty(workflowTabs) -> [WORKFLOWS[initial_workflow].label]
    expect(screen.getByTestId("tab-Consensus Genome")).toBeTruthy();
  });

  it("fires handleTabChange with the clicked tab", () => {
    const { handleTabChange } = renderSwitcher({
      counts: {
        "short-read-mngs": 1,
        "long-read-mngs": 0,
        "consensus-genome": 0,
        amr: 0,
      },
    });
    screen.getByTestId("tab-Metagenomic").click();
    expect(handleTabChange).toHaveBeenCalledWith("Metagenomic");
  });

  it("renders the divider (no Tabs) when there is no sample", () => {
    renderSwitcher({
      counts: {
        "short-read-mngs": 0,
        "long-read-mngs": 0,
        "consensus-genome": 0,
        amr: 0,
      },
      sample: null,
    });
    expect(screen.queryByTestId("tabs")).toBeNull();
  });
});
