// Frontend coverage: SampleViewHeader wires the sample view's top banner. The
// heavy children (ViewHeader layout primitives, Primary/SecondaryHeaderControls)
// are stubbed so the assertions land on this file's own branch logic: the
// breadcrumb-link builder (no project / snapshot / normal), the workflow
// fallback, the sample-present-vs-null title, the snapshot gate that hides the
// controls, the per-sample option onClick that opens a sample URL, and the
// getAllRunsPerWorkflow selector for both mNGS and non-mNGS workflows.
import { fireEvent, render, screen } from "@testing-library/react";

const mockOpenUrl = jest.fn();
const mockGenerateUrl = jest.fn(() => "/samples/9/url");

let primaryProps: $TSFixMe;
let secondaryProps: $TSFixMe;
let pretitleProps: $TSFixMe;
let titleProps: $TSFixMe;

jest.mock("~utils/links", () => ({
  openUrl: (...args: $TSFixMe[]) => mockOpenUrl(...args),
}));

jest.mock("~/components/utils/urls", () => ({
  generateUrlToSampleView: (...args: $TSFixMe[]) => mockGenerateUrl(...args),
}));

jest.mock("~/components/layout/ViewHeader", () => {
  const ReactLib = require("react");
  const ViewHeader = (props: $TSFixMe) =>
    ReactLib.createElement(
      "div",
      { "data-testid": "view-header" },
      props.children,
    );
  ViewHeader.Content = (props: $TSFixMe) =>
    ReactLib.createElement(
      "div",
      { "data-testid": "vh-content" },
      props.children,
    );
  ViewHeader.Pretitle = (props: $TSFixMe) => {
    pretitleProps = props;
    return ReactLib.createElement(
      "div",
      {
        "data-testid": "vh-pretitle",
        "data-breadcrumb": String(props.breadcrumbLink),
      },
      props.children,
    );
  };
  ViewHeader.Title = (props: $TSFixMe) => {
    titleProps = props;
    return ReactLib.createElement(
      "div",
      { "data-testid": "vh-title", "data-label": props.label },
      (props.options || []).map((opt: $TSFixMe) =>
        ReactLib.createElement(
          "button",
          {
            key: opt.id,
            "data-testid": `title-option-${opt.id}`,
            onClick: opt.onClick,
          },
          opt.label,
        ),
      ),
    );
  };
  ViewHeader.Controls = (props: $TSFixMe) =>
    ReactLib.createElement(
      "div",
      { "data-testid": "vh-controls" },
      props.children,
    );
  return { __esModule: true, default: ViewHeader };
});

jest.mock(
  "~/components/views/SampleView/components/SampleViewHeader/components/PrimaryHeaderControls",
  () => ({
    PrimaryHeaderControls: (props: $TSFixMe) => {
      primaryProps = props;
      const ReactLib = require("react");
      return ReactLib.createElement("div", {
        "data-testid": "primary-controls",
      });
    },
  }),
);

jest.mock(
  "~/components/views/SampleView/components/SampleViewHeader/components/SecondaryHeaderControls",
  () => ({
    SecondaryHeaderControls: (props: $TSFixMe) => {
      secondaryProps = props;
      const ReactLib = require("react");
      return ReactLib.createElement("div", {
        "data-testid": "secondary-controls",
      });
    },
  }),
);

import { WorkflowType } from "~/components/utils/workflows";
import { SampleViewHeader } from "~/components/views/SampleView/components/SampleViewHeader/SampleViewHeader";

const baseProps = {
  backgroundId: 1,
  currentTab: "Metagenomic" as $TSFixMe,
  getDownloadReportTableWithAppliedFiltersLink: () => "link",
  hasAppliedFilters: false,
  onDetailsClick: jest.fn(),
  onPipelineVersionChange: jest.fn(),
  currentRun: null,
  project: { id: 42, name: "My Project" } as $TSFixMe,
  projectSamples: [{ id: 9, name: "Sample Nine" }] as $TSFixMe,
  reportMetadata: {} as $TSFixMe,
  sample: { id: 5, name: "Sample Five" } as $TSFixMe,
  snapshotShareId: undefined as $TSFixMe,
  view: "table",
  onDeleteRunSuccess: jest.fn(),
};

const renderHeader = (overrides: $TSFixMe = {}) =>
  render(<SampleViewHeader {...(baseProps as $TSFixMe)} {...overrides} />);

beforeEach(() => {
  jest.clearAllMocks();
  primaryProps = undefined;
  secondaryProps = undefined;
  pretitleProps = undefined;
  titleProps = undefined;
});

describe("SampleViewHeader", () => {
  it("renders the project name and sample title in the normal (non-snapshot) case", () => {
    renderHeader();
    expect(screen.getByTestId("vh-pretitle").textContent).toBe("My Project");
    expect(screen.getByTestId("vh-title").getAttribute("data-label")).toBe(
      "Sample Five",
    );
    // Controls render because there is no snapshotShareId.
    expect(screen.getByTestId("primary-controls")).toBeTruthy();
    expect(screen.getByTestId("secondary-controls")).toBeTruthy();
  });

  it("builds a normal home breadcrumb link when a project is present", () => {
    renderHeader();
    expect(
      screen.getByTestId("vh-pretitle").getAttribute("data-breadcrumb"),
    ).toBe("/home?project_id=42");
  });

  it("builds a /pub breadcrumb link and hides controls in snapshot mode", () => {
    renderHeader({ snapshotShareId: "abc123" });
    expect(
      screen.getByTestId("vh-pretitle").getAttribute("data-breadcrumb"),
    ).toBe("/pub/abc123");
    expect(screen.queryByTestId("primary-controls")).toBeNull();
    expect(screen.queryByTestId("secondary-controls")).toBeNull();
  });

  it("returns an undefined breadcrumb and empty pretitle when there is no project", () => {
    renderHeader({ project: null });
    const pretitle = screen.getByTestId("vh-pretitle");
    expect(pretitle.getAttribute("data-breadcrumb")).toBe("undefined");
    expect(pretitle.textContent).toBe("");
  });

  it("does not render a title when there is no sample", () => {
    renderHeader({ sample: null });
    expect(screen.queryByTestId("vh-title")).toBeNull();
  });

  it("opens a sample-view URL when a title option is clicked", () => {
    renderHeader();
    fireEvent.click(screen.getByTestId("title-option-9"));
    expect(mockGenerateUrl).toHaveBeenCalledWith({
      sampleId: "9",
      snapshotShareId: undefined,
    });
    expect(mockOpenUrl).toHaveBeenCalledWith("/samples/9/url");
  });

  it("falls back to short-read mNGS workflow when the tab label is unknown", () => {
    renderHeader({ currentTab: "Not A Real Tab" as $TSFixMe });
    expect(secondaryProps.workflow).toBe(WorkflowType.SHORT_READ_MNGS);
    expect(primaryProps.workflow).toBe(WorkflowType.SHORT_READ_MNGS);
  });

  it("resolves the workflow type from a recognized tab label", () => {
    renderHeader({ currentTab: "Consensus Genome" as $TSFixMe });
    expect(primaryProps.workflow).toBe(WorkflowType.CONSENSUS_GENOME);
  });

  it("getAllRuns returns pipeline_runs for an mNGS workflow", () => {
    renderHeader({
      currentTab: "Metagenomic" as $TSFixMe,
      sample: {
        id: 5,
        name: "Sample Five",
        pipeline_runs: [{ id: 111 }],
        workflow_runs: [{ id: 222, workflow: WorkflowType.CONSENSUS_GENOME }],
      } as $TSFixMe,
    });
    expect(secondaryProps.getAllRuns()).toEqual([{ id: 111 }]);
  });

  it("getAllRuns filters workflow_runs by type for a non-mNGS workflow", () => {
    renderHeader({
      currentTab: "Consensus Genome" as $TSFixMe,
      sample: {
        id: 5,
        name: "Sample Five",
        pipeline_runs: [{ id: 111 }],
        workflow_runs: [
          { id: 222, workflow: WorkflowType.CONSENSUS_GENOME },
          { id: 333, workflow: WorkflowType.AMR },
        ],
      } as $TSFixMe,
    });
    expect(secondaryProps.getAllRuns()).toEqual([
      { id: 222, workflow: WorkflowType.CONSENSUS_GENOME },
    ]);
  });
});
