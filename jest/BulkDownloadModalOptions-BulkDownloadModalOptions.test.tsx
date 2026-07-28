// Coverage: app/assets/src/components/views/DiscoveryView/components/SamplesView/components/BulkDownloadModal/components/BulkDownloadModalOptions/BulkDownloadModalOptions.tsx
//
// BulkDownloadModalOptions decides how the download-type list is laid out: a
// loading message when types are absent, a flat sorted list when the workflow
// config says shouldShowCategories is false, and grouped category sections
// (with humanized titles and appended non-standard categories) otherwise. It
// also filters out types with no category or hide_in_creation_modal set. Every
// branch is covered by stubbing the leaf DownloadTypeOptionWrapper.
const wrapperProps: $TSFixMe[] = [];
jest.mock(
  "~/components/views/DiscoveryView/components/SamplesView/components/BulkDownloadModal/components/BulkDownloadModalOptions/components/DownloadTypeOptionWrapper",
  () => {
    const ReactLib = require("react");
    return {
      DownloadTypeOptionWrapper: (props: $TSFixMe) => {
        wrapperProps.push(props);
        return ReactLib.createElement("div", {
          "data-testid": "download-type",
          "data-type": String(props.downloadType.type),
        });
      },
    };
  },
);

jest.mock("~/components/common/LoadingMessage", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: (props: $TSFixMe) =>
      ReactLib.createElement(
        "div",
        { "data-testid": "loading-message" },
        props.message,
      ),
  };
});

import { render, screen } from "@testing-library/react";
import React from "react";
import { WorkflowType } from "~/components/utils/workflows";
import { BulkDownloadModalOptions } from "~/components/views/DiscoveryView/components/SamplesView/components/BulkDownloadModal/components/BulkDownloadModalOptions/BulkDownloadModalOptions";

const _React: typeof React = React;

const baseProps = (overrides: $TSFixMe = {}) => ({
  handleHeatmapLink: jest.fn(),
  isUserCollaboratorOnAllRequestedSamples: false,
  onSelectDownloadType: jest.fn(),
  onSelectField: jest.fn(),
  selectedFields: {},
  validObjectIds: new Set<string | number>(),
  workflow: WorkflowType.SHORT_READ_MNGS,
  ...overrides,
});

beforeEach(() => {
  wrapperProps.length = 0;
});

describe("BulkDownloadModalOptions", () => {
  it("shows the loading message when downloadTypes is missing", () => {
    render(
      <BulkDownloadModalOptions {...baseProps({ downloadTypes: null })} />,
    );
    expect(screen.getByTestId("loading-message").textContent).toContain(
      "Loading download types...",
    );
    expect(screen.queryByTestId("download-type")).toBeNull();
  });

  it("filters out types with no category or hide_in_creation_modal", () => {
    render(
      <BulkDownloadModalOptions
        {...baseProps({
          workflow: WorkflowType.SHORT_READ_MNGS,
          downloadTypes: [
            { type: "reads", category: "results" },
            { type: "no-category" },
            {
              type: "hidden",
              category: "results",
              hide_in_creation_modal: true,
            },
          ],
        })}
      />,
    );
    const rendered = screen.getAllByTestId("download-type");
    expect(rendered).toHaveLength(1);
    expect(rendered[0].getAttribute("data-type")).toBe("reads");
  });

  it("groups by humanized category and appends non-standard categories", () => {
    render(
      <BulkDownloadModalOptions
        {...baseProps({
          workflow: WorkflowType.SHORT_READ_MNGS,
          downloadTypes: [
            { type: "a", category: "results" },
            { type: "b", category: "reports" },
            { type: "c", category: "raw_data" },
            { type: "d", category: "extras" },
          ],
        })}
      />,
    );
    // Standard categories are humanized.
    expect(screen.getByText("Results")).toBeTruthy();
    expect(screen.getByText("Reports")).toBeTruthy();
    expect(screen.getByText("Raw Data")).toBeTruthy();
    // Non-standard category is appended and also rendered.
    expect(screen.getByText("Extras")).toBeTruthy();
    expect(screen.getAllByTestId("download-type")).toHaveLength(4);
  });

  it("renders a flat, category-sorted list when categories are hidden", () => {
    render(
      <BulkDownloadModalOptions
        {...baseProps({
          workflow: WorkflowType.CONSENSUS_GENOME,
          downloadTypes: [
            { type: "raw", category: "raw_data" },
            { type: "res", category: "results" },
          ],
        })}
      />,
    );
    // No category headings in the flat layout.
    expect(screen.queryByText("Results")).toBeNull();
    const rendered = screen.getAllByTestId("download-type");
    expect(rendered).toHaveLength(2);
    // Sorted so results (index 0 in CATEGORY_ORDER) comes before raw_data.
    expect(rendered[0].getAttribute("data-type")).toBe("res");
    expect(rendered[1].getAttribute("data-type")).toBe("raw");
    // Leaf receives the enableMassNormalizedBackgrounds pass-through prop.
    expect(wrapperProps[0]).toHaveProperty(
      "shouldEnableMassNormalizedBackgrounds",
    );
  });
});
