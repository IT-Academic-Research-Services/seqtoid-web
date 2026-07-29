// Coverage: app/assets/src/components/views/SampleUploadFlow/components/WorkflowSelector/components/SequencingPlatformOption/SequencingPlatformOption.tsx
//
// SequencingPlatformOption renders one selectable sequencing-technology card.
// The branch-heavy bits are: wrapping the radio in a disabled-only tooltip,
// the onClick guard (disabled -> no-op), the custom-vs-default description, and
// the isSelected block that renders the pipeline (and optional index) version
// indicators, deriving each "new version available" flag. PipelineVersion
// Indicator, ExternalLink and the SDS radio/tooltip are stubbed so the
// assertions land on this file's branching.
import { fireEvent, render, screen } from "@testing-library/react";
import { SequencingPlatformOption } from "~/components/views/SampleUploadFlow/components/WorkflowSelector/components/SequencingPlatformOption/SequencingPlatformOption";

const mockIndicatorProps: $TSFixMe[] = [];

// The source imports this scss through the "~/" alias, which resolves before
// jest's scss style-mock, so mock it explicitly to a no-op module.
jest.mock(
  "~/components/views/SampleUploadFlow/components/WorkflowSelector/workflow_selector.scss",
  () => ({}),
  { virtual: true },
);

jest.mock("@czi-sds/components", () => {
  const ReactLib = require("react");
  return {
    InputRadio: (props: $TSFixMe) =>
      ReactLib.createElement("span", {
        "data-testid": "radio",
        "data-stage": props.stage,
        "data-disabled": String(props.disabled),
      }),
    Tooltip: (props: $TSFixMe) =>
      ReactLib.createElement(
        "span",
        { "data-testid": "tooltip", "data-title": props.title },
        props.children,
      ),
  };
});

jest.mock("~/components/ui/controls/ExternalLink", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: (props: $TSFixMe) =>
      ReactLib.createElement(
        "a",
        {
          "data-testid": "external-link",
          href: props.href,
          "data-disabled": String(props.disabled),
        },
        props.children,
      ),
  };
});

jest.mock(
  "~/components/views/SampleUploadFlow/components/WorkflowSelector/components/PipelineVersionIndicator",
  () => {
    const ReactLib = require("react");
    return {
      PipelineVersionIndicator: (props: $TSFixMe) => {
        mockIndicatorProps.push(props);
        return ReactLib.createElement("div", {
          "data-testid": props.isPipelineVersion
            ? "pipeline-version"
            : "index-version",
          "data-version": String(props.version),
          "data-newversion": String(props.isNewVersionAvailable),
        });
      },
    };
  },
);

const baseProps = {
  analyticsEventName: "evt",
  githubLink: "https://github.com/example",
  isSelected: false,
  onClick: jest.fn(),
  technologyName: "Illumina",
  technologyDetails: <div data-testid="tech-details">details</div>,
  testId: "illumina",
  versionHelpLink: "https://help/version",
  warningHelpLink: "https://help/warning",
};

const renderOption = (props: $TSFixMe = {}) =>
  render(<SequencingPlatformOption {...baseProps} {...props} />);

beforeEach(() => {
  jest.clearAllMocks();
  mockIndicatorProps.length = 0;
});

describe("SequencingPlatformOption basics", () => {
  it("renders the technology name and the default description with a github link", () => {
    renderOption();
    expect(screen.getByText("Illumina")).toBeTruthy();
    expect(
      screen.getByText(/You can check out the Illumina pipeline on Github/),
    ).toBeTruthy();
    expect(screen.getByTestId("external-link").getAttribute("href")).toBe(
      "https://github.com/example",
    );
    // Not disabled -> radio + link enabled, no tooltip.
    expect(screen.getByTestId("radio").getAttribute("data-disabled")).toBe(
      "false",
    );
    expect(screen.queryByTestId("tooltip")).toBeNull();
  });

  it("uses the custom description when provided", () => {
    renderOption({ customDescription: "A custom blurb" });
    expect(screen.getByText(/A custom blurb/)).toBeTruthy();
    expect(
      screen.queryByText(/You can check out the Illumina pipeline/),
    ).toBeNull();
  });

  it("has an unchecked radio stage when not selected", () => {
    renderOption({ isSelected: false });
    expect(screen.getByTestId("radio").getAttribute("data-stage")).toBe(
      "unchecked",
    );
    // No version indicators render when unselected.
    expect(screen.queryByTestId("pipeline-version")).toBeNull();
    expect(screen.queryByTestId("tech-details")).toBeNull();
  });
});

describe("SequencingPlatformOption click handling", () => {
  it("fires onClick when enabled", () => {
    const onClick = jest.fn();
    renderOption({ onClick });
    fireEvent.click(screen.getByTestId("sequencing-technology-illumina"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not fire onClick when disabled", () => {
    const onClick = jest.fn();
    renderOption({ onClick, isDisabled: true });
    fireEvent.click(screen.getByTestId("sequencing-technology-illumina"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("wraps the radio in a tooltip only when disabled and tooltipText is given", () => {
    renderOption({ isDisabled: true, tooltipText: "Not available" });
    expect(screen.getByTestId("tooltip").getAttribute("data-title")).toBe(
      "Not available",
    );
    expect(screen.getByTestId("radio").getAttribute("data-disabled")).toBe(
      "true",
    );
  });

  it("does not render a tooltip when disabled without tooltipText", () => {
    renderOption({ isDisabled: true });
    expect(screen.queryByTestId("tooltip")).toBeNull();
  });
});

describe("SequencingPlatformOption selected version indicators", () => {
  it("renders the pipeline indicator and flags a new version when the major differs", () => {
    renderOption({
      isSelected: true,
      pipelineVersion: "3.1.0",
      latestMajorPipelineVersion: "4",
    });
    expect(screen.getByTestId("radio").getAttribute("data-stage")).toBe(
      "checked",
    );
    const pipeline = screen.getByTestId("pipeline-version");
    expect(pipeline.getAttribute("data-version")).toBe("3.1.0");
    // "3"[0] !== "4" -> new version available.
    expect(pipeline.getAttribute("data-newversion")).toBe("true");
    // technologyDetails renders inside the selected block.
    expect(screen.getByTestId("tech-details")).toBeTruthy();
    // Index indicator hidden when showIndexVersion is falsy.
    expect(screen.queryByTestId("index-version")).toBeNull();
  });

  it("does not flag a new version when the major matches", () => {
    renderOption({
      isSelected: true,
      pipelineVersion: "4.2.0",
      latestMajorPipelineVersion: "4",
    });
    expect(
      screen.getByTestId("pipeline-version").getAttribute("data-newversion"),
    ).toBe("false");
  });

  it("renders the index indicator and flags a stale index version", () => {
    renderOption({
      isSelected: true,
      pipelineVersion: "4.0.0",
      latestMajorPipelineVersion: "4",
      showIndexVersion: true,
      indexVersion: "2020-01",
      latestMajorIndexVersion: "2024-02",
    });
    const index = screen.getByTestId("index-version");
    expect(index.getAttribute("data-version")).toBe("2020-01");
    expect(index.getAttribute("data-newversion")).toBe("true");
  });

  it("does not flag the index when it already matches the latest", () => {
    renderOption({
      isSelected: true,
      showIndexVersion: true,
      indexVersion: "2024-02",
      latestMajorIndexVersion: "2024-02",
    });
    expect(
      screen.getByTestId("index-version").getAttribute("data-newversion"),
    ).toBe("false");
  });
});
