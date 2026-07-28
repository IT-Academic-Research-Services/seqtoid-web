// Coverage: app/assets/src/components/common/DetailsSidebar/BulkDownloadDetailsMode/components/AdvancedDownloadTab/AdvancedDownloadTab.tsx
//
// AdvancedDownloadTab builds the CLI download command for a bulk download. The
// command text branches on status (in-progress / failed / succeeded-no-url) and
// on downloadType (biom, concatenated consensus genome, generic tarball). When
// the download succeeded with a url the container is clickable: clicking copies
// the command (copy-to-clipboard is stubbed) and shows a tooltip; mouse-leave
// clears it. react-relay's useFragment is stubbed to return the array it's given.
import { fireEvent, render, screen } from "@testing-library/react";

const mockCopy = jest.fn();

jest.mock("react-relay", () => ({
  __esModule: true,
  graphql: () => ({}),
  useFragment: (_frag: unknown, data: unknown) => data,
}));

jest.mock("copy-to-clipboard", () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockCopy(...args),
}));

// useWithAnalytics returns a wrapper that just runs the handler; the event-name
// bag is a proxy so any lookup resolves.
jest.mock("~/api/analytics", () => ({
  __esModule: true,
  useWithAnalytics: () => (fn: $TSFixMe) => fn,
  ANALYTICS_EVENT_NAMES: new Proxy({}, { get: (_t, p) => String(p) }),
}));

// Stub BasicPopup so the tooltip text renders inline without a portal.
jest.mock("~/components/common/BasicPopup", () => ({
  __esModule: true,
  default: ({ trigger, content }: $TSFixMe) => (
    <div>
      {trigger}
      <div data-testid="popup-content">{content}</div>
    </div>
  ),
}));

// scss imported via the "~/" alias would bypass the scss->styleMock mapping.
jest.mock(
  "~/components/common/DetailsSidebar/BulkDownloadDetailsMode/bulk_download_details_mode.scss",
  () => ({}),
);

import { AdvancedDownloadTab } from "~/components/common/DetailsSidebar/BulkDownloadDetailsMode/components/AdvancedDownloadTab/AdvancedDownloadTab";

const renderTab = (item: $TSFixMe, id = "1") =>
  render(
    <AdvancedDownloadTab
      bulkDownloadData={[item] as $TSFixMe}
      bulkDownloadId={id}
    />,
  );

beforeEach(() => jest.clearAllMocks());

describe("AdvancedDownloadTab null guard", () => {
  it("renders nothing when no download matches", () => {
    const { container } = renderTab(
      { id: "1", downloadType: "reads_non_host" },
      "other",
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("AdvancedDownloadTab command text branches", () => {
  const command = () =>
    screen.getByTestId("cloud-command-container").textContent || "";

  it("says the download is not yet complete for an in-progress status", () => {
    renderTab({
      id: "1",
      downloadType: "reads_non_host",
      status: "RUNNING",
      url: null,
    });
    expect(command()).toContain("Bulk download is not yet complete.");
  });

  it("says the download failed for a failed status", () => {
    renderTab({
      id: "1",
      downloadType: "reads_non_host",
      status: "FAILED",
      url: null,
    });
    expect(command()).toContain("Bulk download failed.");
  });

  it("reports a missing command when succeeded but url is null", () => {
    renderTab({
      id: "1",
      downloadType: "reads_non_host",
      status: "SUCCEEDED",
      url: null,
    });
    expect(command()).toContain("Failed to generate command.");
  });

  it("produces a .biom curl command for the biom_format download type", () => {
    renderTab({
      id: "1",
      downloadType: "biom_format",
      status: "SUCCEEDED",
      url: "http://x/file",
    });
    expect(command()).toContain(".biom");
    expect(command()).toContain("http://x/file");
  });

  it("produces a .fa command for a concatenated consensus genome", () => {
    renderTab({
      id: "1",
      downloadType: "consensus_genome",
      status: "SUCCEEDED",
      url: "http://x/cg",
      params: [{ paramType: "downloadFormat", value: "concatenate" }],
    });
    expect(command()).toContain(".fa");
  });

  it("produces a generic tarball command for other download types", () => {
    renderTab({
      id: "1",
      downloadType: "reads_non_host",
      status: "SUCCEEDED",
      url: "http://x/reads",
    });
    expect(command()).toContain(".tar.gz");
    expect(command()).toContain("tar -zvxf");
  });
});

describe("AdvancedDownloadTab copy interaction", () => {
  it("copies the command and shows a tooltip when clicking an available command, then clears it on mouse leave", () => {
    renderTab({
      id: "1",
      downloadType: "reads_non_host",
      status: "SUCCEEDED",
      url: "http://x/reads",
      fileSize: "10MB",
    });
    const container = screen.getByTestId("cloud-command-container");

    fireEvent.click(container);
    expect(mockCopy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("popup-content").textContent).toBe(
      "Copied command to clipboard",
    );

    // The container is re-rendered inside the popup trigger; re-query it.
    fireEvent.mouseLeave(screen.getByTestId("cloud-command-container"));
    expect(screen.queryByTestId("popup-content")).toBeNull();
  });

  it("does nothing on click when the command is unavailable (no url)", () => {
    renderTab({
      id: "1",
      downloadType: "reads_non_host",
      status: "SUCCEEDED",
      url: null,
    });
    fireEvent.click(screen.getByTestId("cloud-command-container"));
    expect(mockCopy).not.toHaveBeenCalled();
    expect(screen.queryByTestId("popup-content")).toBeNull();
  });
});
