// Frontend coverage:
// app/assets/src/components/views/BulkDownloadListView/BulkDownloadList/BulkDownloadList.tsx
//
// BulkDownloadList wraps a Relay-backed list component. The interesting logic
// is in the inner component: the empty-vs-populated branch, the details-click
// handler that opens the sidebar, and processBulkDownloads (which derives
// status/tooltip fields per row). react-relay is stubbed (relay-test-utils is
// not installed) so useLazyLoadQuery returns controllable data. The Table and
// DetailsSidebar are stubbed too -- they have their own suites and pull in
// heavy machinery -- and the Table stub exposes the derived rows plus a hook to
// fire a row's onDetailsClick.
import { fireEvent, render, screen } from "@testing-library/react";
import { UserContext } from "~/components/common/UserContext";
import {
  BulkDownloadList,
  default as BulkDownloadListDefault,
} from "~/components/views/BulkDownloadListView/BulkDownloadList/BulkDownloadList";

// The "~/"-aliased scss imports resolve through the alias before jest's
// "\.scss$" -> styleMock rule, so the raw scss would reach the transform. Stub
// them explicitly (same workaround the DetailsTab suite uses).
jest.mock("~/styles/themes/_elements.scss", () => ({}));

// --- Relay stubs ------------------------------------------------------------
let mockQueryData: $TSFixMe = { fedBulkDownloads: [] };
jest.mock("react-relay", () => ({
  __esModule: true,
  graphql: () => ({}),
  useLazyLoadQuery: () => mockQueryData,
  useRelayEnvironment: () => ({}),
}));
jest.mock("relay-runtime", () => ({
  __esModule: true,
  graphql: () => ({}),
  // subscribe immediately reports completion so refresh() settles.
  fetchQuery: () => ({
    subscribe: ({ complete }: $TSFixMe) => {
      complete && complete();
      return { unsubscribe: jest.fn() };
    },
  }),
}));

// --- Heavy child stubs ------------------------------------------------------
jest.mock("~/components/visualizations/table", () => ({
  Table: ({ data }: $TSFixMe) => (
    <div data-testid="table">
      <span data-testid="row-count">{data ? data.length : 0}</span>
      {data && data[0] && (
        <>
          <span data-testid="row0-status">{data[0].statusDisplay}</span>
          <button data-testid="row0-details" onClick={data[0].onDetailsClick}>
            details
          </button>
        </>
      )}
    </div>
  ),
}));

jest.mock("~/components/common/DetailsSidebar", () => ({
  __esModule: true,
  default: ({ visible }: $TSFixMe) => (
    <div data-testid="sidebar" data-visible={String(visible)} />
  ),
}));

const renderList = (data: $TSFixMe, admin = false) => {
  mockQueryData = data;
  return render(
    <UserContext.Provider value={{ admin } as $TSFixMe}>
      <BulkDownloadList />
    </UserContext.Provider>,
  );
};

describe("BulkDownloadList", () => {
  it("exposes the same component as the default export", () => {
    expect(BulkDownloadListDefault).toBe(BulkDownloadList);
  });

  it("renders the Downloads view header and back breadcrumb", () => {
    renderList({ fedBulkDownloads: [] });
    expect(screen.getByText("Downloads")).toBeTruthy();
    expect(screen.getByText("Back")).toBeTruthy();
  });

  it("shows the blank screen message when there are no downloads", () => {
    renderList({ fedBulkDownloads: [] });
    expect(
      screen.getByText("You don't have any bulk downloads right now."),
    ).toBeTruthy();
    // The table is not rendered in the empty state.
    expect(screen.queryByTestId("table")).toBeNull();
  });

  it("renders the table with processed rows when downloads exist", () => {
    renderList({
      fedBulkDownloads: [
        {
          id: "dl-1",
          status: "SUCCEEDED",
          startedAt: "2024-01-02T03:04:05.000Z",
          downloadType: "sample_metadata",
          ownerUserId: 1,
        },
      ],
    });
    expect(screen.getByTestId("row-count").textContent).toBe("1");
    // processBulkDownloads derives statusDisplay = "complete" for SUCCEEDED.
    expect(screen.getByTestId("row0-status").textContent).toBe("complete");
    // Blank screen suppressed once there is data.
    expect(
      screen.queryByText("You don't have any bulk downloads right now."),
    ).toBeNull();
  });

  it("opens the details sidebar when a row's details handler fires", () => {
    renderList({
      fedBulkDownloads: [
        {
          id: "dl-1",
          status: "SUCCEEDED",
          startedAt: "2024-01-02T03:04:05.000Z",
          downloadType: "sample_metadata",
          ownerUserId: 1,
        },
      ],
    });
    // Sidebar starts closed.
    expect(screen.getByTestId("sidebar").getAttribute("data-visible")).toBe(
      "false",
    );
    fireEvent.click(screen.getByTestId("row0-details"));
    // handleDetailsClick flips it open.
    expect(screen.getByTestId("sidebar").getAttribute("data-visible")).toBe(
      "true",
    );
  });
});
