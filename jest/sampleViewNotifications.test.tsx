// Frontend coverage: SampleView/utils/notifications.tsx dispatches toast
// notifications for the sample view. showNotification is a switch that hands a
// render function to showToast; the render functions build the actual
// Notification content (two of them wire up buttons). We mock showToast to
// capture the render fn + options, then render the content and exercise the
// interactive buttons.
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { showToast } from "~/components/utils/toast";
import { WORKFLOW_TABS } from "~/components/utils/workflows";
import { NOTIFICATION_TYPES } from "~/components/views/SampleView/utils/constants";
import { showNotification } from "~/components/views/SampleView/utils/notifications";

jest.mock("~/components/utils/toast", () => ({
  showToast: jest.fn(),
}));

const mockedShowToast = showToast as jest.Mock;

// Grab the render function + options handed to the mocked showToast, then render
// the content with an injected closeToast spy.
const renderLatestToast = () => {
  const [content, options] = mockedShowToast.mock.calls.at(-1) as [
    (a: { closeToast: () => void }) => React.ReactElement,
    { autoClose: number },
  ];
  const closeToast = jest.fn();
  const utils = render(content({ closeToast }));
  return { ...utils, closeToast, options };
};

beforeEach(() => mockedShowToast.mockClear());

describe("showNotification", () => {
  it("shows the invalid-background notification with the background name", () => {
    showNotification(NOTIFICATION_TYPES.invalidBackground, {
      backgroundName: "OldBG",
    });
    const { container, options } = renderLatestToast();
    expect(options.autoClose).toBe(12000);
    expect(container.textContent).toContain("is not compatible with");
    expect(container.textContent).toContain("OldBG");
  });

  it("shows the sample-delete success notification with the sample name", () => {
    showNotification(NOTIFICATION_TYPES.sampleDeleteSuccess, {
      sampleName: "SampleZ",
    });
    const { container } = renderLatestToast();
    expect(container.textContent).toContain(
      "SampleZ has been successfully deleted",
    );
  });

  it("falls back to 'Sample' on delete success when no name is given", () => {
    showNotification(NOTIFICATION_TYPES.sampleDeleteSuccess, {});
    const { container } = renderLatestToast();
    expect(container.textContent).toContain(
      "Sample has been successfully deleted",
    );
  });

  it("falls back to 'Sample' when no name is given on delete error", () => {
    showNotification(NOTIFICATION_TYPES.sampleDeleteError, {});
    const { container } = renderLatestToast();
    expect(container.textContent).toContain("Sample failed to delete");
  });

  it("shows the multiple-index-versions warning with the index name", () => {
    showNotification(NOTIFICATION_TYPES.multipleIndexVersions, {
      indexName: "2021-01-22",
    });
    const { container } = renderLatestToast();
    expect(container.textContent).toContain("2021-01-22");
  });

  it("wires the consensus-genome-created button to tab change + close", () => {
    const handleTabChange = jest.fn();
    showNotification(NOTIFICATION_TYPES.consensusGenomeCreated, {
      handleTabChange,
    });
    const { closeToast } = renderLatestToast();
    const button = screen.getByText("View Consensus Genomes");
    fireEvent.click(button);
    // The keyboard handler mirrors the click handler.
    fireEvent.keyDown(button);
    expect(handleTabChange).toHaveBeenCalledWith(
      WORKFLOW_TABS.CONSENSUS_GENOME,
    );
    expect(handleTabChange).toHaveBeenCalledTimes(2);
    expect(closeToast).toHaveBeenCalledTimes(2);
  });

  it("wires the discovery-view-filters revert button to revert + close", () => {
    const revertToSampleViewFilters = jest.fn();
    showNotification(NOTIFICATION_TYPES.discoveryViewFiltersPersisted, {
      revertToSampleViewFilters,
    });
    const { closeToast } = renderLatestToast();
    const button = screen.getByText("Revert");
    fireEvent.click(button);
    fireEvent.keyDown(button);
    expect(revertToSampleViewFilters).toHaveBeenCalledTimes(2);
    expect(closeToast).toHaveBeenCalledTimes(2);
  });

  it("does nothing for an unrecognized notification type", () => {
    showNotification("somethingElse");
    expect(mockedShowToast).not.toHaveBeenCalled();
  });
});
