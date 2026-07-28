// Coverage: app/assets/src/components/views/DiscoveryView/components/ProjectHeader/components/ProjectSettingsModal/ViewOnlyLinkForm.tsx
//
// ViewOnlyLinkForm is the snapshot-sharing panel: it loads snapshot info +
// background options on mount, toggles sharing on/off (with a confirmation
// modal on the way down), renders the sample/pipeline-version summary line and
// pushes background changes back to the API. Every network call and the
// background dropdown are stubbed so the tests can walk both the success and
// failure paths of each API call.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockGetBackgrounds = jest.fn();
const mockGetSnapshotInfo = jest.fn();
const mockCreateSnapshot = jest.fn();
const mockDeleteSnapshot = jest.fn();
const mockUpdateSnapshotBackground = jest.fn();
const mockCopyUrlToClipboard = jest.fn();
const mockBackgroundFilterProps: $TSFixMe[] = [];

jest.mock("~/api", () => ({
  getBackgrounds: (...args: $TSFixMe[]) => mockGetBackgrounds(...args),
}));

jest.mock("~/api/snapshot_links", () => ({
  getSnapshotInfo: (...args: $TSFixMe[]) => mockGetSnapshotInfo(...args),
  createSnapshot: (...args: $TSFixMe[]) => mockCreateSnapshot(...args),
  deleteSnapshot: (...args: $TSFixMe[]) => mockDeleteSnapshot(...args),
  updateSnapshotBackground: (...args: $TSFixMe[]) =>
    mockUpdateSnapshotBackground(...args),
}));

jest.mock("~/helpers/url", () => ({
  copyUrlToClipboard: (...args: $TSFixMe[]) => mockCopyUrlToClipboard(...args),
}));

jest.mock(
  "~/components/views/SampleView/components/MngsReport/components/ReportFilters/components/BackgroundModelFilter",
  () => {
    const ReactLib = require("react");
    return {
      __esModule: true,
      default: (props: $TSFixMe) => {
        mockBackgroundFilterProps.push(props);
        return ReactLib.createElement(
          "button",
          {
            "data-testid": "background-filter",
            "data-value": String(props.value),
            "data-massnormalized": String(
              props.enableMassNormalizedBackgrounds,
            ),
            "data-optioncount": String(
              props.allBackgrounds ? props.allBackgrounds.length : "none",
            ),
            onClick: () => props.onChange(42),
          },
          "background",
        );
      },
    };
  },
);

jest.mock(
  "~/components/views/DiscoveryView/components/ProjectHeader/components/ProjectSettingsModal/DisableSharingConfirmationModal",
  () => {
    const ReactLib = require("react");
    return {
      __esModule: true,
      default: ({ onCancel, onConfirm }: $TSFixMe) =>
        ReactLib.createElement(
          "div",
          { "data-testid": "disable-modal" },
          ReactLib.createElement("button", {
            "data-testid": "disable-cancel",
            onClick: onCancel,
          }),
          ReactLib.createElement("button", {
            "data-testid": "disable-confirm",
            onClick: onConfirm,
          }),
        ),
    };
  },
);

import ViewOnlyLinkForm from "~/components/views/DiscoveryView/components/ProjectHeader/components/ProjectSettingsModal/ViewOnlyLinkForm";

const snapshot = (overrides: $TSFixMe = {}) => ({
  share_id: "abc123",
  background_id: 7,
  mass_normalized_backgronds_available: true,
  num_samples: 3,
  pipeline_versions: ["3.1", "3.2"],
  timestamp: "2021-08-01",
  ...overrides,
});

const backgrounds = [
  { id: 1, name: "Default", mass_normalized: false },
  { id: 2, name: "Mine", mass_normalized: true },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockBackgroundFilterProps.length = 0;
  mockGetBackgrounds.mockResolvedValue({ backgrounds });
  mockGetSnapshotInfo.mockResolvedValue(null);
  mockCreateSnapshot.mockResolvedValue({});
  mockDeleteSnapshot.mockResolvedValue({});
  mockUpdateSnapshotBackground.mockResolvedValue({});
});

const renderForm = async (projectId = "12") => {
  const utils = render(<ViewOnlyLinkForm project={{ id: projectId }} />);
  await waitFor(() => expect(mockGetBackgrounds).toHaveBeenCalled());
  return utils;
};

describe("ViewOnlyLinkForm loading", () => {
  it("requests snapshot info and owned-or-public backgrounds on mount", async () => {
    await renderForm("99");
    expect(mockGetSnapshotInfo).toHaveBeenCalledWith("99");
    expect(mockGetBackgrounds).toHaveBeenCalledWith({
      ownedOrPublicBackgroundsOnly: true,
    });
  });

  it("keeps sharing off when the snapshot endpoint returns no share id", async () => {
    await renderForm();
    expect(screen.getByText("View-Only Link")).toBeTruthy();
    // No shareable link body while sharing is disabled.
    expect(document.querySelector("#shareableLink")).toBeNull();
  });

  it("clears snapshot state when the snapshot request fails", async () => {
    mockGetSnapshotInfo.mockRejectedValue(new Error("boom"));
    await renderForm();
    expect(document.querySelector("#shareableLink")).toBeNull();
  });
});

describe("ViewOnlyLinkForm enabled body", () => {
  it("renders the shareable link, sample count and pipeline versions", async () => {
    mockGetSnapshotInfo.mockResolvedValue(snapshot());
    await renderForm();
    await waitFor(() =>
      expect(document.querySelector("#shareableLink")).toBeTruthy(),
    );

    const input = document.querySelector("#shareableLink") as HTMLInputElement;
    expect(input.value).toBe(window.location.origin + "/pub/abc123");
    expect(screen.getByText(/3 Samples/)).toBeTruthy();
    expect(screen.getByText(/Pipeline versions 3.1 or 3.2/)).toBeTruthy();
    expect(screen.getByText(/2021-08-01/)).toBeTruthy();
  });

  it("uses the singular sample label for a single-sample snapshot", async () => {
    mockGetSnapshotInfo.mockResolvedValue(
      snapshot({ num_samples: 1, pipeline_versions: ["3.1"] }),
    );
    await renderForm();
    await waitFor(() => expect(screen.getByText(/1 Sample /)).toBeTruthy());
    expect(screen.getByText(/Pipeline version 3.1/)).toBeTruthy();
  });

  it("says there are no pipeline versions when the list is empty", async () => {
    mockGetSnapshotInfo.mockResolvedValue(snapshot({ pipeline_versions: [] }));
    await renderForm();
    await waitFor(() =>
      expect(screen.getByText(/No pipeline versions/)).toBeTruthy(),
    );
  });

  it("collapses more than three pipeline versions behind a 'more' tooltip", async () => {
    mockGetSnapshotInfo.mockResolvedValue(
      snapshot({ pipeline_versions: ["3.1", "3.2", "3.3", "3.4"] }),
    );
    await renderForm();
    await waitFor(() =>
      expect(screen.getByText(/Pipeline versions 3.1, 3.2 or/)).toBeTruthy(),
    );
    expect(screen.getByText("more")).toBeTruthy();
  });

  it("passes the snapshot background and mass-normalized flag to the filter", async () => {
    mockGetSnapshotInfo.mockResolvedValue(snapshot());
    await renderForm();
    await waitFor(() =>
      expect(screen.getByTestId("background-filter")).toBeTruthy(),
    );
    const filter = screen.getByTestId("background-filter");
    expect(filter.getAttribute("data-value")).toBe("7");
    expect(filter.getAttribute("data-massnormalized")).toBe("true");
    expect(filter.getAttribute("data-optioncount")).toBe("2");
    // Backgrounds are reshaped into {text, value, mass_normalized}.
    const last =
      mockBackgroundFilterProps[mockBackgroundFilterProps.length - 1];
    expect(last.allBackgrounds).toEqual([
      { text: "Default", value: 1, mass_normalized: false },
      { text: "Mine", value: 2, mass_normalized: true },
    ]);
  });

  it("copies the shareable url to the clipboard", async () => {
    mockGetSnapshotInfo.mockResolvedValue(snapshot());
    await renderForm();
    await waitFor(() => expect(screen.getByText("Copy")).toBeTruthy());
    fireEvent.click(screen.getByText("Copy"));
    expect(mockCopyUrlToClipboard).toHaveBeenCalledWith(
      window.location.origin + "/pub/abc123",
    );
  });
});

describe("ViewOnlyLinkForm background changes", () => {
  it("persists a new background selection", async () => {
    mockGetSnapshotInfo.mockResolvedValue(snapshot());
    await renderForm();
    await waitFor(() =>
      expect(screen.getByTestId("background-filter")).toBeTruthy(),
    );
    fireEvent.click(screen.getByTestId("background-filter"));
    await waitFor(() =>
      expect(mockUpdateSnapshotBackground).toHaveBeenCalledWith("abc123", 42),
    );
    // The optimistic state update is reflected immediately.
    expect(
      screen.getByTestId("background-filter").getAttribute("data-value"),
    ).toBe("42");
  });

  it("logs but survives a failed background update", async () => {
    const spy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mockGetSnapshotInfo.mockResolvedValue(snapshot());
    mockUpdateSnapshotBackground.mockRejectedValue(new Error("nope"));
    await renderForm();
    await waitFor(() =>
      expect(screen.getByTestId("background-filter")).toBeTruthy(),
    );
    fireEvent.click(screen.getByTestId("background-filter"));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(
      screen.getByTestId("background-filter").getAttribute("data-value"),
    ).toBe("42");
    spy.mockRestore();
  });
});

describe("ViewOnlyLinkForm sharing toggle", () => {
  // The semantic-ui toggle renders a radio input, and jsdom will not fire a
  // change event when an already-checked radio is clicked. Driving the root
  // element with the mouse sequence exercises the same onChange either way.
  const clickToggle = () => {
    const toggle = document.querySelector(".ui.checkbox") as HTMLElement;
    fireEvent.mouseDown(toggle);
    fireEvent.mouseUp(toggle);
    fireEvent.click(toggle);
  };

  it("creates a snapshot and refetches info when sharing is turned on", async () => {
    mockGetSnapshotInfo.mockResolvedValueOnce(null);
    await renderForm();
    mockGetSnapshotInfo.mockResolvedValue(snapshot());

    clickToggle();
    await waitFor(() => expect(mockCreateSnapshot).toHaveBeenCalledWith("12"));
    await waitFor(() =>
      expect(document.querySelector("#shareableLink")).toBeTruthy(),
    );
  });

  it("logs but survives a failed snapshot creation", async () => {
    const spy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mockCreateSnapshot.mockRejectedValue(new Error("nope"));
    await renderForm();

    clickToggle();
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(document.querySelector("#shareableLink")).toBeNull();
    spy.mockRestore();
  });

  it("asks for confirmation before disabling, and cancelling keeps the link", async () => {
    mockGetSnapshotInfo.mockResolvedValue(snapshot());
    await renderForm();
    await waitFor(() =>
      expect(document.querySelector("#shareableLink")).toBeTruthy(),
    );

    clickToggle();
    expect(screen.getByTestId("disable-modal")).toBeTruthy();
    expect(mockDeleteSnapshot).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("disable-cancel"));
    expect(screen.queryByTestId("disable-modal")).toBeNull();
    expect(document.querySelector("#shareableLink")).toBeTruthy();
  });

  it("deletes the snapshot and clears the link on confirmation", async () => {
    mockGetSnapshotInfo.mockResolvedValue(snapshot());
    await renderForm();
    await waitFor(() =>
      expect(document.querySelector("#shareableLink")).toBeTruthy(),
    );

    clickToggle();
    fireEvent.click(screen.getByTestId("disable-confirm"));
    await waitFor(() =>
      expect(mockDeleteSnapshot).toHaveBeenCalledWith("abc123"),
    );
    await waitFor(() =>
      expect(document.querySelector("#shareableLink")).toBeNull(),
    );
    expect(screen.queryByTestId("disable-modal")).toBeNull();
  });

  it("logs and closes the modal when deletion fails", async () => {
    const spy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mockGetSnapshotInfo.mockResolvedValue(snapshot());
    mockDeleteSnapshot.mockRejectedValue(new Error("nope"));
    await renderForm();
    await waitFor(() =>
      expect(document.querySelector("#shareableLink")).toBeTruthy(),
    );

    clickToggle();
    fireEvent.click(screen.getByTestId("disable-confirm"));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByTestId("disable-modal")).toBeNull(),
    );
    // Deletion failed, so the snapshot link is still shown.
    expect(document.querySelector("#shareableLink")).toBeTruthy();
    spy.mockRestore();
  });
});
