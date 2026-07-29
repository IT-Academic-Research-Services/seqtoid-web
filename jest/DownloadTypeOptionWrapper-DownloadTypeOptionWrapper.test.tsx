// Coverage: app/assets/src/components/views/DiscoveryView/components/SamplesView/
//   components/BulkDownloadModal/components/BulkDownloadModalOptions/components/
//   DownloadTypeOptionWrapper/DownloadTypeOptionWrapper.tsx
//
// DownloadTypeOptionWrapper computes a disabled/enabled state for one download
// option and, when disabled, wraps the option in a BasicPopup that surfaces the
// reason. All of its logic is in getDisabledMessageForDownload, which branches
// on download type, admin flag, uploader/collaborator flags and a sample-count
// cap. Both the option and the popup are stubbed so the assertions land on the
// message-selection + wrap/no-wrap branches.
import { render, screen } from "@testing-library/react";
import React from "react";
import { UserContext } from "~/components/common/UserContext";

const _React: typeof React = React;

jest.mock(
  "~/components/views/DiscoveryView/components/SamplesView/components/BulkDownloadModal/components/BulkDownloadModalOptions/components/DownloadTypeOption/DownloadTypeOption",
  () => ({
    __esModule: true,
    DownloadTypeOption: (props: $TSFixMe) => (
      <div
        data-testid="download-type-option"
        data-disabled={String(props.isDisabled)}
        data-selected={String(props.isSelected)}
      />
    ),
  }),
);

jest.mock("~/components/common/BasicPopup", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => (
    <div data-testid="basic-popup" data-content={props.content}>
      {props.trigger}
    </div>
  ),
}));

import { DownloadTypeOptionWrapper } from "~/components/views/DiscoveryView/components/SamplesView/components/BulkDownloadModal/components/BulkDownloadModalOptions/components/DownloadTypeOptionWrapper/DownloadTypeOptionWrapper";

const baseProps = () => ({
  areAllObjectsUploadedByCurrentUser: true,
  backgroundOptions: [],
  handleHeatmapLink: jest.fn(),
  isUserCollaboratorOnAllRequestedSamples: true,
  metricsOptions: [],
  objectDownloaded: "sample",
  onSelectDownloadType: jest.fn(),
  onSelectField: jest.fn(),
  selectedDownloadTypeName: null,
  selectedFields: {},
  shouldEnableMassNormalizedBackgrounds: false,
  validObjectIds: new Set<number | string>([1, 2]),
});

const renderWrapper = (
  downloadType: $TSFixMe,
  ctx: $TSFixMe,
  overrides: $TSFixMe = {},
) =>
  render(
    <UserContext.Provider value={ctx}>
      <DownloadTypeOptionWrapper
        {...baseProps()}
        downloadType={downloadType}
        {...overrides}
      />
    </UserContext.Provider>,
  );

const NON_ADMIN = { admin: false, appConfig: {} } as $TSFixMe;
const ADMIN = { admin: true, appConfig: {} } as $TSFixMe;

describe("DownloadTypeOptionWrapper enabled (no popup)", () => {
  it("renders the bare option when nothing disables it", () => {
    renderWrapper({ type: "reads_non_host" }, NON_ADMIN);
    expect(screen.queryByTestId("basic-popup")).toBeNull();
    expect(
      screen.getByTestId("download-type-option").getAttribute("data-disabled"),
    ).toBe("false");
  });

  it("marks the option selected when the name matches the type", () => {
    renderWrapper({ type: "reads_non_host" }, NON_ADMIN, {
      selectedDownloadTypeName: "reads_non_host",
    });
    expect(
      screen.getByTestId("download-type-option").getAttribute("data-selected"),
    ).toBe("true");
  });

  it("does not disable original_input_file for an admin", () => {
    renderWrapper({ type: "original_input_file" }, ADMIN, {
      areAllObjectsUploadedByCurrentUser: false,
    });
    expect(screen.queryByTestId("basic-popup")).toBeNull();
  });

  it("does not disable original_input_file when user uploaded all objects", () => {
    renderWrapper({ type: "original_input_file" }, NON_ADMIN, {
      areAllObjectsUploadedByCurrentUser: true,
    });
    expect(screen.queryByTestId("basic-popup")).toBeNull();
  });

  it("does not disable host_gene_counts for a collaborator", () => {
    renderWrapper({ type: "host_gene_counts" }, NON_ADMIN, {
      isUserCollaboratorOnAllRequestedSamples: true,
    });
    expect(screen.queryByTestId("basic-popup")).toBeNull();
  });
});

describe("DownloadTypeOptionWrapper disabled (popup)", () => {
  it("disables original_input_file when a non-admin did not upload all", () => {
    renderWrapper({ type: "original_input_file" }, NON_ADMIN, {
      areAllObjectsUploadedByCurrentUser: false,
    });
    const popup = screen.getByTestId("basic-popup");
    expect(popup.getAttribute("data-content")).toContain(
      "you must be the original",
    );
    expect(
      screen.getByTestId("download-type-option").getAttribute("data-disabled"),
    ).toBe("true");
  });

  it("disables original_input_file when the sample-count cap is exceeded", () => {
    renderWrapper(
      { type: "original_input_file" },
      { admin: false, appConfig: { maxSamplesBulkDownloadOriginalFiles: 1 } },
      {
        areAllObjectsUploadedByCurrentUser: true,
        validObjectIds: new Set([1, 2, 3]),
      },
    );
    const popup = screen.getByTestId("basic-popup");
    expect(popup.getAttribute("data-content")).toContain("No more than 1");
  });

  it("does not apply the cap for an admin over the limit", () => {
    renderWrapper(
      { type: "original_input_file" },
      { admin: true, appConfig: { maxSamplesBulkDownloadOriginalFiles: 1 } },
      {
        areAllObjectsUploadedByCurrentUser: true,
        validObjectIds: new Set([1, 2, 3]),
      },
    );
    expect(screen.queryByTestId("basic-popup")).toBeNull();
  });

  it("disables host_gene_counts for a non-collaborator non-admin", () => {
    renderWrapper({ type: "host_gene_counts" }, NON_ADMIN, {
      isUserCollaboratorOnAllRequestedSamples: false,
    });
    const popup = screen.getByTestId("basic-popup");
    expect(popup.getAttribute("data-content")).toContain(
      "you must be a collaborator",
    );
  });

  it("does not disable host_gene_counts for an admin non-collaborator", () => {
    renderWrapper({ type: "host_gene_counts" }, ADMIN, {
      isUserCollaboratorOnAllRequestedSamples: false,
    });
    expect(screen.queryByTestId("basic-popup")).toBeNull();
  });

  it("tolerates a missing UserContext (empty object fallback)", () => {
    // Passing undefined exercises the `useContext(UserContext) || {}` fallback.
    render(
      <UserContext.Provider value={undefined as $TSFixMe}>
        <DownloadTypeOptionWrapper
          {...baseProps()}
          downloadType={{ type: "reads_non_host" }}
        />
      </UserContext.Provider>,
    );
    expect(screen.getByTestId("download-type-option")).toBeTruthy();
  });
});
