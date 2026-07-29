// Coverage: .../LocalUploadProgressModal/components/LocalUploadModalHeader/LocalUploadModalHeader.tsx
//
// LocalUploadModalHeader is a pure presentational header for the local upload
// modal. It derives three mutually-exclusive display modes (in-progress /
// failed / completed) from the sample counts and flags, chooses singular vs
// plural copy, and only shows the retry-all notification and the "contact us"
// link under specific conditions. The image and Notification children are
// stubbed so the assertions land on this file's own copy/mode branching.
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { LocalUploadModalHeader } from "~/components/views/SampleUploadFlow/components/UploadProgressModal/components/LocalUploadProgressModal/components/LocalUploadModalHeader/LocalUploadModalHeader";

jest.mock("~/components/ui/illustrations/ImgUploadPrimary", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: () =>
      ReactLib.createElement("span", { "data-testid": "upload-img" }),
  };
});

jest.mock("~ui/notifications/Notification", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: ({ children }: { children: React.ReactNode }) =>
      ReactLib.createElement(
        "div",
        { "data-testid": "notification" },
        children,
      ),
  };
});

const FAILED = [{ name: "f1" }, { name: "f2" }] as any;

const renderHeader = (overrides: Record<string, unknown> = {}) =>
  render(
    <LocalUploadModalHeader
      hasFailedSamples={false}
      numberOfFailedSamples={0}
      localSamplesFailed={[]}
      numLocalSamplesInProgress={0}
      retryFailedSampleUploads={jest.fn()}
      retryingSampleUpload={false}
      sampleUploadStatuses={{}}
      numberOfSamples={0}
      projectName="Ocean"
      {...(overrides as any)}
    />,
  );

describe("LocalUploadModalHeader in-progress mode", () => {
  it("renders the uploading title with plural copy for multiple samples", () => {
    renderHeader({ numLocalSamplesInProgress: 3 });
    expect(screen.getByText("Uploading 3 samples to Ocean")).toBeTruthy();
    expect(
      screen.getByText(/Please stay on this page until upload completes/),
    ).toBeTruthy();
  });

  it("uses the singular sample wording for a single in-progress sample", () => {
    renderHeader({ numLocalSamplesInProgress: 1 });
    expect(screen.getByText("Uploading 1 sample to Ocean")).toBeTruthy();
  });

  it("switches to the retrying title while retrying", () => {
    renderHeader({ numLocalSamplesInProgress: 2, retryingSampleUpload: true });
    expect(screen.getByText("Retrying 2 sample uploads")).toBeTruthy();
  });
});

describe("LocalUploadModalHeader completed and failed modes", () => {
  it("shows the completed title when nothing is in progress and nothing failed", () => {
    renderHeader({ numLocalSamplesInProgress: 0, hasFailedSamples: false });
    expect(screen.getByText("Uploads completed!")).toBeTruthy();
    expect(screen.queryByTestId("notification")).toBeNull();
  });

  it("shows a partial-failure title and the retry-all notification", () => {
    const retryFailedSampleUploads = jest.fn();
    renderHeader({
      numLocalSamplesInProgress: 0,
      hasFailedSamples: true,
      numberOfFailedSamples: 2,
      numberOfSamples: 5,
      sampleUploadStatuses: { a: 1, b: 1, c: 1, d: 1, e: 1 },
      localSamplesFailed: FAILED,
      retryFailedSampleUploads,
    });
    expect(screen.getByText("Uploads completed with 2 errors")).toBeTruthy();
    expect(screen.getByTestId("notification")).toBeTruthy();
    expect(screen.getByText("2 uploads have failed")).toBeTruthy();

    fireEvent.click(screen.getByText("Retry all failed"));
    expect(retryFailedSampleUploads).toHaveBeenCalledWith(FAILED);
  });

  it("shows the all-uploads-failed title when every sample failed", () => {
    renderHeader({
      numLocalSamplesInProgress: 0,
      hasFailedSamples: true,
      numberOfFailedSamples: 3,
      numberOfSamples: 3,
      sampleUploadStatuses: { a: 1, b: 1, c: 1 },
      localSamplesFailed: FAILED,
    });
    expect(screen.getByText("All uploads failed")).toBeTruthy();
    // When every sample failed, the "contact us" help link is shown.
    const link = screen.getByText("Contact us for help") as HTMLAnchorElement;
    expect(link.tagName).toBe("A");
  });

  it("uses singular error copy for exactly one failure", () => {
    renderHeader({
      numLocalSamplesInProgress: 0,
      hasFailedSamples: true,
      numberOfFailedSamples: 1,
      numberOfSamples: 4,
      sampleUploadStatuses: { a: 1, b: 1, c: 1, d: 1 },
      localSamplesFailed: [{ name: "f1" }] as any,
    });
    expect(screen.getByText("Uploads completed with 1 error")).toBeTruthy();
    // Notification uses "1 upload has failed" (singular).
    expect(screen.getByText("1 upload has failed")).toBeTruthy();
    // Not all samples failed, so no contact-us link.
    expect(screen.queryByText("Contact us for help")).toBeNull();
  });
});
