// Coverage: app/assets/src/components/views/SampleView/components/
//   ConsensusGenomeView/components/ConsensusGenomeHeader/ConsensusGenomeHeader.tsx
//
// The header has two independent decisions. (1) It only renders the
// consensus-genome run picker when the sample has MORE THAN ONE consensus
// genome workflow run -- null entries and non-CG workflows are filtered out
// first, so a sample with one CG run plus an mNGS run gets no dropdown. When
// the dropdown does render, picking a run id must be resolved back to the full
// workflow run object before it reaches onWorkflowRunSelect. (2) The "learn
// more" link is hidden while the run is still RUNNING, and its href depends on
// whether the run's accession is SARS-CoV-2. The child dropdown and the
// ExternalLink are stubbed so the assertions stay on this component's branches.
import { render, screen } from "@testing-library/react";

// scss imports in this graph are routed to the shared style mock; give them
// real-looking class names so the layout branches can be told apart.
jest.mock("./__mocks__/styleMock.ts", () => ({
  headerContainer: "header-container",
  removeBottomMargin: "remove-bottom-margin",
  dropdownContainer: "dropdown-container",
  learnMoreLink: "learn-more-link",
  alignRight: "align-right",
}));

let lastDropdownProps: $TSFixMe = null;
jest.mock(
  "~/components/views/SampleView/components/ConsensusGenomeView/components/ConsensusGenomeHeader/components/ConsensusGenomeDropdown",
  () => ({
    ConsensusGenomeDropdown: (props: $TSFixMe) => {
      lastDropdownProps = props;
      const ReactLib = require("react");
      return ReactLib.createElement("div", { "data-testid": "cg-dropdown" });
    },
  }),
);

jest.mock("~ui/controls/ExternalLink", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => {
    const ReactLib = require("react");
    return ReactLib.createElement(
      "a",
      {
        "data-testid": "learn-more-link",
        href: props.href,
        className: props.className,
      },
      props.children,
    );
  },
}));

import { WorkflowType } from "~/components/utils/workflows";
import { ConsensusGenomeHeader } from "~/components/views/SampleView/components/ConsensusGenomeView/components/ConsensusGenomeHeader/ConsensusGenomeHeader";
import {
  RUNNING_STATE,
  SUCCEEDED_STATE,
} from "~/components/views/SampleView/utils";
import {
  SARS_COV_2_CONSENSUS_GENOME_DOC_LINK,
  VIRAL_CONSENSUS_GENOME_DOC_LINK,
} from "~utils/documentationLinks";

const cgRun = (id: number, accessionId = "NC_001802.1") => ({
  id,
  workflow: WorkflowType.CONSENSUS_GENOME,
  status: SUCCEEDED_STATE,
  inputs: {
    accession_id: accessionId,
    accession_name: `accession ${id}`,
    taxon_name: `taxon ${id}`,
  },
});

const renderHeader = ({
  workflowRuns,
  workflowRun,
}: {
  workflowRuns?: $TSFixMe;
  workflowRun?: $TSFixMe;
} = {}) => {
  const onWorkflowRunSelect = jest.fn();
  const runs = workflowRuns === undefined ? [cgRun(1), cgRun(2)] : workflowRuns;
  const current = workflowRun === undefined ? cgRun(1) : workflowRun;
  const utils = render(
    <ConsensusGenomeHeader
      sample={{ workflow_runs: runs } as $TSFixMe}
      workflowRun={current as $TSFixMe}
      onWorkflowRunSelect={onWorkflowRunSelect}
    />,
  );
  return { onWorkflowRunSelect, ...utils };
};

beforeEach(() => {
  lastDropdownProps = null;
});

describe("ConsensusGenomeHeader run picker", () => {
  it("renders the dropdown when the sample has more than one consensus genome", () => {
    renderHeader();
    expect(screen.getByTestId("cg-dropdown")).toBeTruthy();
    expect(lastDropdownProps.workflowRuns).toHaveLength(2);
    expect(lastDropdownProps.initialSelectedValue).toBe(1);
  });

  it("hides the dropdown when the sample has only one consensus genome", () => {
    renderHeader({ workflowRuns: [cgRun(1)] });
    expect(screen.queryByTestId("cg-dropdown")).toBeNull();
  });

  it("ignores non-consensus-genome workflow runs when counting", () => {
    renderHeader({
      workflowRuns: [
        cgRun(1),
        { id: 2, workflow: WorkflowType.AMR, status: SUCCEEDED_STATE },
        { id: 3, workflow: WorkflowType.SHORT_READ_MNGS, status: "SUCCEEDED" },
      ],
    });
    expect(screen.queryByTestId("cg-dropdown")).toBeNull();
  });

  it("drops nullish workflow run entries before counting", () => {
    renderHeader({ workflowRuns: [null, cgRun(1), undefined, cgRun(2)] });
    expect(screen.getByTestId("cg-dropdown")).toBeTruthy();
    expect(lastDropdownProps.workflowRuns.map((r: $TSFixMe) => r.id)).toEqual([
      1, 2,
    ]);
  });

  it("hides the dropdown when the sample has no workflow runs at all", () => {
    renderHeader({ workflowRuns: null });
    expect(screen.queryByTestId("cg-dropdown")).toBeNull();
  });

  it("resolves a selected run id back to the full workflow run", () => {
    const { onWorkflowRunSelect } = renderHeader();
    lastDropdownProps.onConsensusGenomeSelection(2);
    expect(onWorkflowRunSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 2 }),
    );
  });

  it("passes undefined to the selection handler for an unknown run id", () => {
    const { onWorkflowRunSelect } = renderHeader();
    lastDropdownProps.onConsensusGenomeSelection(404);
    expect(onWorkflowRunSelect).toHaveBeenCalledWith(undefined);
  });
});

describe("ConsensusGenomeHeader learn-more link", () => {
  it("links to the SARS-CoV-2 doc for a SARS-CoV-2 accession", () => {
    renderHeader({ workflowRun: cgRun(1, "MN908947.3") });
    expect(screen.getByTestId("learn-more-link").getAttribute("href")).toBe(
      SARS_COV_2_CONSENSUS_GENOME_DOC_LINK,
    );
  });

  it("links to the general viral doc for any other accession", () => {
    renderHeader({ workflowRun: cgRun(1, "NC_045512.2") });
    expect(screen.getByTestId("learn-more-link").getAttribute("href")).toBe(
      VIRAL_CONSENSUS_GENOME_DOC_LINK,
    );
  });

  it("falls back to the general viral doc when the run has no inputs", () => {
    renderHeader({
      workflowRun: { id: 1, status: SUCCEEDED_STATE },
      workflowRuns: [cgRun(1)],
    });
    expect(screen.getByTestId("learn-more-link").getAttribute("href")).toBe(
      VIRAL_CONSENSUS_GENOME_DOC_LINK,
    );
  });

  it("hides the link while the run is still in progress", () => {
    renderHeader({
      workflowRun: { ...cgRun(1), status: RUNNING_STATE },
    });
    expect(screen.queryByTestId("learn-more-link")).toBeNull();
  });

  it("shows the link once the run is no longer running", () => {
    renderHeader({ workflowRun: { ...cgRun(1), status: "FAILED" } });
    expect(screen.getByTestId("learn-more-link").textContent).toContain(
      "Learn more about consensus genomes",
    );
  });

  it("right-aligns the link and drops the bottom margin when there is no dropdown", () => {
    const { container } = renderHeader({ workflowRuns: [cgRun(1)] });
    expect(screen.getByTestId("learn-more-link").className).toBe(
      "learn-more-link align-right",
    );
    expect((container.firstChild as HTMLElement).className).toBe(
      "header-container remove-bottom-margin",
    );
  });

  it("keeps the default alignment and margin when the dropdown is shown", () => {
    const { container } = renderHeader();
    expect(screen.getByTestId("learn-more-link").className).toBe(
      "learn-more-link",
    );
    expect((container.firstChild as HTMLElement).className).toBe(
      "header-container",
    );
  });
});
