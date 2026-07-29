// Branch coverage for
// app/assets/src/components/views/SampleUploadFlow/components/WorkflowSelector/components/IlluminaSequencingPlatformOption/IlluminaSequencingPlatformOption.tsx
//
// The component is a props router with three isCg-driven conditionals
// (analytics event name, GitHub link, showIndexVersion) plus the
// `isCg && isSelected && <WetlabSelector>` short circuit, which needs all
// three combinations to be exercised. SequencingPlatformOption and
// WetlabSelector are stubbed so the assertions land on the routed props.
import { render, screen } from "@testing-library/react";

// Alias-resolved scss imports bypass the global style mapping, so stub it.
jest.mock(
  "~/components/views/SampleUploadFlow/components/WorkflowSelector/workflow_selector.scss",
  () => ({}),
);

const capturedOptionProps: $TSFixMe[] = [];
const capturedWetlabProps: $TSFixMe[] = [];

jest.mock(
  "~/components/views/SampleUploadFlow/components/WorkflowSelector/components/SequencingPlatformOption",
  () => {
    const ReactLib = require("react");
    return {
      __esModule: true,
      SequencingPlatformOption: (props: $TSFixMe) => {
        capturedOptionProps.push(props);
        return ReactLib.createElement(
          "div",
          { "data-testid": "platform-option" },
          props.technologyDetails,
        );
      },
    };
  },
);

jest.mock(
  "~/components/views/SampleUploadFlow/components/WorkflowSelector/components/WetlabSelector",
  () => {
    const ReactLib = require("react");
    return {
      __esModule: true,
      WetlabSelector: (props: $TSFixMe) => {
        capturedWetlabProps.push(props);
        return ReactLib.createElement("div", { "data-testid": "wetlab" });
      },
    };
  },
);

import { ANALYTICS_EVENT_NAMES } from "~/api/analytics";
import {
  CG_ILLUMINA_PIPELINE_GITHUB_LINK,
  MNGS_ILLUMINA_PIPELINE_GITHUB_LINK,
} from "~/components/utils/documentationLinks";
import { IlluminaSequencingPlatformOption } from "~/components/views/SampleUploadFlow/components/WorkflowSelector/components/IlluminaSequencingPlatformOption/IlluminaSequencingPlatformOption";

const baseProps = {
  onClick: jest.fn(),
  versionHelpLink: "/version-help",
  warningHelpLink: "/warning-help",
};

beforeEach(() => {
  capturedOptionProps.length = 0;
  capturedWetlabProps.length = 0;
});

const lastOption = () => capturedOptionProps[capturedOptionProps.length - 1];

describe("IlluminaSequencingPlatformOption", () => {
  it("routes mNGS analytics, links and index version when isCg is false", () => {
    render(
      <IlluminaSequencingPlatformOption
        {...baseProps}
        isCg={false}
        isSelected={true}
        indexVersion="2024-02-06"
      />,
    );

    const props = lastOption();
    expect(props.analyticsEventName).toBe(
      ANALYTICS_EVENT_NAMES.UPLOAD_SAMPLE_STEP_MNGS_ILLUMINA_PIPELINE_LINK_CLICKED,
    );
    expect(props.githubLink).toBe(MNGS_ILLUMINA_PIPELINE_GITHUB_LINK);
    expect(props.showIndexVersion).toBe(true);
    expect(props.indexVersion).toBe("2024-02-06");
    // isCg is false, so the `isCg && isSelected` short circuit bails first.
    expect(screen.queryByTestId("wetlab")).toBeNull();
    expect(props.technologyDetails).toBe(false);
  });

  it("routes consensus-genome analytics and links when isCg is true", () => {
    render(
      <IlluminaSequencingPlatformOption
        {...baseProps}
        isCg={true}
        isSelected={false}
      />,
    );

    const props = lastOption();
    expect(props.analyticsEventName).toBe(
      ANALYTICS_EVENT_NAMES.UPLOAD_SAMPLE_CG_ILLUMINA_PIPELINE_GITHUB_LINK_CLICKED,
    );
    expect(props.githubLink).toBe(CG_ILLUMINA_PIPELINE_GITHUB_LINK);
    expect(props.showIndexVersion).toBe(false);
    // isCg is true but isSelected is false -- second operand short circuits.
    expect(screen.queryByTestId("wetlab")).toBeNull();
    expect(props.technologyDetails).toBe(false);
  });

  it("renders the WetlabSelector only when isCg and isSelected are both true", () => {
    const onWetlabProtocolChange = jest.fn();
    render(
      <IlluminaSequencingPlatformOption
        {...baseProps}
        isCg={true}
        isSelected={true}
        selectedWetlabProtocol="ARTIC v3"
        onWetlabProtocolChange={onWetlabProtocolChange}
        pipelineVersion="3.1.0"
        latestMajorPipelineVersion="3"
        latestMajorIndexVersion="2"
      />,
    );

    expect(screen.getByTestId("wetlab")).toBeTruthy();
    expect(capturedWetlabProps).toHaveLength(1);
    expect(capturedWetlabProps[0].selectedWetlabProtocol).toBe("ARTIC v3");
    expect(capturedWetlabProps[0].onWetlabProtocolChange).toBe(
      onWetlabProtocolChange,
    );
    expect(capturedWetlabProps[0].technology).toBe("Illumina");

    const props = lastOption();
    expect(props.technologyName).toBe("Illumina");
    expect(props.testId).toBe("Illumina");
    expect(props.pipelineVersion).toBe("3.1.0");
    expect(props.latestMajorPipelineVersion).toBe("3");
    expect(props.latestMajorIndexVersion).toBe("2");
    expect(props.versionHelpLink).toBe("/version-help");
    expect(props.warningHelpLink).toBe("/warning-help");
  });
});
