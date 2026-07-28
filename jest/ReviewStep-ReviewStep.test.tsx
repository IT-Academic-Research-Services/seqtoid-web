// Coverage: app/assets/src/components/views/SampleUploadFlow/components/ReviewStep/ReviewStep.tsx
//
// ReviewStep is the container for the upload review screen. It loads the
// project metadata fields on mount, wires the consent checkbox to enabling the
// Start Upload button, swaps the button for the UploadProgressModal once upload
// begins (which also disables the edit links), and conditionally renders the
// HostOrganismMessage unless a COVID consensus-genome workflow is selected. All
// heavy children are stubbed to expose the props/callbacks under test, and the
// metadata API + analytics hooks are mocked so the assertions land on this
// file's own state machine.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ReviewStep from "~/components/views/SampleUploadFlow/components/ReviewStep/ReviewStep";
import { UploadWorkflows } from "~/components/views/SampleUploadFlow/constants";

const mockGetProjectMetadataFields = jest.fn();

jest.mock("~/api/metadata", () => ({
  getProjectMetadataFields: (...args: $TSFixMe[]) =>
    mockGetProjectMetadataFields(...args),
}));

jest.mock("~/api/analytics", () => ({
  useTrackEvent: () => jest.fn(),
  useWithAnalytics: () => jest.fn(),
}));

const stub = (testid: string) => (props: $TSFixMe) =>
  require("react").createElement("div", { "data-testid": testid }, props.name);

jest.mock(
  "~/components/views/SampleUploadFlow/components/ReviewStep/components/ProjectInfo",
  () => ({
    ProjectInfo: (props: $TSFixMe) =>
      require("react").createElement(
        "button",
        {
          "data-testid": "project-info",
          "data-links-enabled": String(props.areLinksEnabled),
          onClick: () => props.onLinkClick("uploadSamples"),
        },
        "project-info",
      ),
  }),
);

jest.mock(
  "~/components/views/SampleUploadFlow/components/ReviewStep/components/ReviewHeader",
  () => ({ ReviewHeader: () => require("react").createElement("div") }),
);

jest.mock(
  "~/components/views/SampleUploadFlow/components/ReviewStep/components/AnalysesSections",
  () => ({
    AnalysesSections: () =>
      require("react").createElement("div", { "data-testid": "analyses" }),
  }),
);

jest.mock(
  "~/components/views/SampleUploadFlow/components/ReviewStep/components/SampleInfo",
  () => ({
    SampleInfo: () =>
      require("react").createElement("div", { "data-testid": "sample-info" }),
  }),
);

jest.mock(
  "~/components/views/SampleUploadFlow/components/ReviewStep/components/HostOrganismMessage",
  () => ({
    HostOrganismMessage: () =>
      require("react").createElement("div", {
        "data-testid": "host-organism-message",
      }),
  }),
);

jest.mock(
  "~/components/views/SampleUploadFlow/components/UploadProgressModal",
  () => ({
    UploadProgressModal: () =>
      require("react").createElement("div", {
        "data-testid": "upload-progress-modal",
      }),
  }),
);

jest.mock("~ui/controls/TermsAgreement", () => ({
  __esModule: true,
  default: (props: $TSFixMe) =>
    require("react").createElement(
      "button",
      { "data-testid": "terms-agreement", onClick: props.onChange },
      "terms",
    ),
}));

jest.mock("~/components/ui/controls/buttons/PrimaryButton", () => ({
  __esModule: true,
  default: (props: $TSFixMe) =>
    require("react").createElement(
      "button",
      {
        "data-testid": "start-upload",
        disabled: props.disabled,
        onClick: props.onClick,
      },
      props.text,
    ),
}));

const baseProps = {
  bedFile: null,
  clearlabs: false,
  guppyBasecallerSetting: null,
  hostGenomes: [],
  medakaModel: null,
  metadata: null,
  onUploadComplete: jest.fn(),
  onUploadStatusChange: jest.fn(),
  onStepSelect: jest.fn(),
  originalHostGenomes: [],
  pipelineVersions: {},
  project: { id: 1, name: "P" },
  refSeqAccession: null,
  refSeqFile: null,
  refSeqTaxon: null,
  samples: [],
  uploadType: "local",
  visible: true,
  technology: null,
  wetlabProtocol: null,
};

const renderStep = (overrides = {}) =>
  render(
    <ReviewStep
      {...(baseProps as $TSFixMe)}
      workflows={new Set([UploadWorkflows.MNGS]) as $TSFixMe}
      {...overrides}
    />,
  );

// Flush the async componentDidMount metadata load inside act() so the trailing
// setState does not fire after the test window.
const flushMount = () =>
  waitFor(() => expect(mockGetProjectMetadataFields).toHaveBeenCalled());

beforeEach(() => {
  jest.clearAllMocks();
  mockGetProjectMetadataFields.mockResolvedValue([
    { key: "collection_date", name: "Collection Date" },
  ]);
});

describe("ReviewStep", () => {
  it("loads project metadata fields on mount", async () => {
    renderStep();
    await waitFor(() =>
      expect(mockGetProjectMetadataFields).toHaveBeenCalledWith(1),
    );
    expect(screen.getByTestId("project-info")).toBeTruthy();
    expect(screen.getByTestId("analyses")).toBeTruthy();
    expect(screen.getByTestId("sample-info")).toBeTruthy();
  });

  it("keeps Start Upload disabled until consent is checked, then enables it", async () => {
    renderStep();
    const startButton = screen.getByTestId("start-upload") as HTMLButtonElement;
    expect(startButton.disabled).toBe(true);

    // Check the terms agreement -> consentChecked flips true.
    fireEvent.click(screen.getByTestId("terms-agreement"));
    expect(
      (screen.getByTestId("start-upload") as HTMLButtonElement).disabled,
    ).toBe(false);
    await flushMount();
  });

  it("shows the upload progress modal and disables links once upload starts", async () => {
    renderStep();
    // Consent, then start.
    fireEvent.click(screen.getByTestId("terms-agreement"));
    fireEvent.click(screen.getByTestId("start-upload"));

    expect(baseProps.onUploadStatusChange).toHaveBeenCalledWith(true);
    expect(screen.getByTestId("upload-progress-modal")).toBeTruthy();
    // Start Upload button is replaced by the modal.
    expect(screen.queryByTestId("start-upload")).toBeNull();
    // Links are now disabled (areLinksEnabled=false is passed down).
    expect(
      screen.getByTestId("project-info").getAttribute("data-links-enabled"),
    ).toBe("false");
    await flushMount();
  });

  it("forwards onStepSelect when a child link is clicked while links are enabled", async () => {
    renderStep();
    fireEvent.click(screen.getByTestId("project-info"));
    expect(baseProps.onStepSelect).toHaveBeenCalledWith("uploadSamples");
    await flushMount();
  });

  it("does not forward onStepSelect after upload has started (links disabled)", async () => {
    renderStep();
    fireEvent.click(screen.getByTestId("terms-agreement"));
    fireEvent.click(screen.getByTestId("start-upload"));
    baseProps.onStepSelect.mockClear();
    fireEvent.click(screen.getByTestId("project-info"));
    expect(baseProps.onStepSelect).not.toHaveBeenCalled();
    await flushMount();
  });

  it("renders the HostOrganismMessage for non-COVID workflows", async () => {
    renderStep({ workflows: new Set([UploadWorkflows.MNGS]) });
    expect(screen.getByTestId("host-organism-message")).toBeTruthy();
    await flushMount();
  });

  it("hides the HostOrganismMessage when a COVID consensus genome workflow is selected", async () => {
    renderStep({
      workflows: new Set([UploadWorkflows.COVID_CONSENSUS_GENOME]),
    });
    expect(screen.queryByTestId("host-organism-message")).toBeNull();
    await flushMount();
  });
});
