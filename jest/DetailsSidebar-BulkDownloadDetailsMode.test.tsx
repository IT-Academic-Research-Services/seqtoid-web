// Coverage: app/assets/src/components/common/DetailsSidebar/BulkDownloadDetailsMode/BulkDownloadDetailsMode.tsx
//
// BulkDownloadDetailsMode is the Relay-backed sidebar shell for a single bulk
// download. useFragment is stubbed to return the array it is handed; the two tab
// bodies and the Tabs control are stubbed so the assertions land on this
// component's own logic: the null guard, the admin-only ID/log-url block, the
// FAILED / SUCCEEDED-with-error notifications, and tab switching.
import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("react-relay", () => ({
  __esModule: true,
  graphql: () => ({}),
  useFragment: (_frag: unknown, data: unknown) => data,
}));

jest.mock(
  "~/components/common/DetailsSidebar/BulkDownloadDetailsMode/bulk_download_details_mode.scss",
  () => ({}),
);

// Stub the Tabs control so switching tabs is a simple button click.
jest.mock("~/components/ui/controls/Tabs", () => ({
  __esModule: true,
  default: ({ tabs, value, onChange }: $TSFixMe) => (
    <div data-testid="tabs">
      {tabs.map((t: string) => (
        <button
          key={t}
          data-testid={`tab-${t}`}
          data-active={String(t === value)}
          onClick={() => onChange(t)}
        >
          {t}
        </button>
      ))}
    </div>
  ),
}));

jest.mock(
  "~/components/common/DetailsSidebar/BulkDownloadDetailsMode/components/DetailsTab",
  () => ({
    __esModule: true,
    DetailsTab: () => <div data-testid="details-tab-body">details body</div>,
  }),
);

jest.mock(
  "~/components/common/DetailsSidebar/BulkDownloadDetailsMode/components/AdvancedDownloadTab",
  () => ({
    __esModule: true,
    AdvancedDownloadTab: () => (
      <div data-testid="advanced-tab-body">advanced body</div>
    ),
  }),
);

import { BulkDownloadDetailsMode } from "~/components/common/DetailsSidebar/BulkDownloadDetailsMode/BulkDownloadDetailsMode";
import { UserContext } from "~/components/common/UserContext";

const renderMode = (
  item: $TSFixMe,
  { id = "1", admin = false }: { id?: string; admin?: boolean } = {},
) =>
  render(
    <UserContext.Provider value={{ admin } as $TSFixMe}>
      <BulkDownloadDetailsMode
        bulkDownloadData={item ? ([item] as $TSFixMe) : ([] as $TSFixMe)}
        bulkDownloadId={id}
      />
    </UserContext.Provider>,
  );

describe("BulkDownloadDetailsMode null guard", () => {
  it("renders nothing when there is no matching download", () => {
    const { container } = renderMode(
      { id: "1", downloadType: "reads_non_host", status: "SUCCEEDED" },
      { id: "missing" },
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when no bulkDownloadId is provided", () => {
    const { container } = render(
      <UserContext.Provider value={{ admin: false } as $TSFixMe}>
        <BulkDownloadDetailsMode
          bulkDownloadData={
            [{ id: "1", downloadType: "reads_non_host" }] as $TSFixMe
          }
        />
      </UserContext.Provider>,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("BulkDownloadDetailsMode content", () => {
  it("renders the download display name and the Details tab by default", () => {
    renderMode({
      id: "1",
      downloadType: "reads_non_host",
      status: "SUCCEEDED",
    });
    expect(screen.getByTestId("sidebar-download-name").textContent).toBe(
      "Reads (Non-host)",
    );
    expect(screen.getByTestId("details-tab-body")).toBeTruthy();
    expect(screen.queryByTestId("advanced-tab-body")).toBeNull();
  });

  it("switches to the Advanced Download tab on change", () => {
    renderMode({
      id: "1",
      downloadType: "reads_non_host",
      status: "SUCCEEDED",
    });
    fireEvent.click(screen.getByTestId("tab-Advanced Download"));
    expect(screen.getByTestId("advanced-tab-body")).toBeTruthy();
    expect(screen.queryByTestId("details-tab-body")).toBeNull();
  });
});

describe("BulkDownloadDetailsMode admin block", () => {
  it("shows the ID and log url for admins", () => {
    renderMode(
      {
        id: "42",
        downloadType: "reads_non_host",
        status: "SUCCEEDED",
        logUrl: "http://x/log",
      },
      { id: "42", admin: true },
    );
    expect(screen.getByText(/ID: 42/)).toBeTruthy();
    const logLink = screen.getByText("log url");
    expect(logLink.getAttribute("href")).toBe("http://x/log");
  });

  it("hides the admin block for non-admins", () => {
    renderMode(
      { id: "42", downloadType: "reads_non_host", status: "SUCCEEDED" },
      { id: "42", admin: false },
    );
    expect(screen.queryByText(/ID: 42/)).toBeNull();
  });

  it("omits the log url span when there is no logUrl", () => {
    renderMode(
      { id: "42", downloadType: "reads_non_host", status: "SUCCEEDED" },
      { id: "42", admin: true },
    );
    expect(screen.getByText(/ID: 42/)).toBeTruthy();
    expect(screen.queryByText("log url")).toBeNull();
  });
});

describe("BulkDownloadDetailsMode notifications", () => {
  it("renders an error notification for a failed download", () => {
    renderMode({
      id: "1",
      downloadType: "reads_non_host",
      status: "FAILED",
    });
    expect(
      screen.getByText(/There was an error generating your download files/),
    ).toBeTruthy();
  });

  it("renders a warning notification for a succeeded download with an errorMessage", () => {
    renderMode({
      id: "1",
      downloadType: "reads_non_host",
      status: "SUCCEEDED",
      errorMessage: "Some samples were skipped",
    });
    expect(screen.getByText("Some samples were skipped")).toBeTruthy();
  });

  it("renders no notification for a clean succeeded download", () => {
    renderMode({
      id: "1",
      downloadType: "reads_non_host",
      status: "SUCCEEDED",
    });
    expect(
      screen.queryByText(/There was an error generating your download files/),
    ).toBeNull();
  });
});
