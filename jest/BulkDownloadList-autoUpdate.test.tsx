// Additional coverage for
// app/assets/src/components/views/BulkDownloadListView/BulkDownloadList/BulkDownloadList.tsx
//
// BulkDownloadList-BulkDownloadList.test.tsx covers the empty/populated render
// and the details sidebar. This suite drives the polling machinery that only
// runs when a download is still in progress:
//   - the auto-update effect (setTimeout -> refresh -> autoUpdateCount++),
//   - the re-entrancy guard in refresh() (a second tick while a fetch is still
//     in flight must be a no-op),
//   - the fetchQuery error callback (clears isRefreshing so polling resumes),
//   - the give-up notification once autoUpdateCount hits AUTO_UPDATE_MAX_COUNT,
//     and the "Click here" button that resets the counter and restarts polling.
//
// react-relay / relay-runtime are stubbed (relay-test-utils is not installed),
// and the fetchQuery stub is switchable per test so the subscription can
// complete, fail, or stay pending.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { UserContext } from "~/components/common/UserContext";
import { BulkDownloadList } from "~/components/views/BulkDownloadListView/BulkDownloadList/BulkDownloadList";
import {
  AUTO_UPDATE_DELAY,
  AUTO_UPDATE_MAX_COUNT,
} from "~/components/views/BulkDownloadListView/constants";

jest.mock("~/styles/themes/_elements.scss", () => ({}));

let mockQueryData: $TSFixMe = { fedBulkDownloads: [] };
// "complete" | "error" | "pending"
let mockSubscribeMode: "complete" | "error" | "pending" = "complete";
const mockFetchQuery = jest.fn();

// The environment object must be referentially stable: refresh() is a
// useCallback keyed on it, and the auto-update effect is keyed on refresh, so a
// fresh object per render would reschedule the poll timer on every render.
const mockEnvironment = {};
jest.mock("react-relay", () => ({
  __esModule: true,
  graphql: () => ({}),
  useLazyLoadQuery: () => mockQueryData,
  useRelayEnvironment: () => mockEnvironment,
}));

jest.mock("relay-runtime", () => ({
  __esModule: true,
  graphql: () => ({}),
  fetchQuery: (...args: $TSFixMe[]) => {
    mockFetchQuery(...args);
    return {
      subscribe: ({ complete, error }: $TSFixMe) => {
        if (mockSubscribeMode === "complete") complete && complete();
        if (mockSubscribeMode === "error") error && error(new Error("boom"));
        return { unsubscribe: jest.fn() };
      },
    };
  },
}));

jest.mock("~/components/visualizations/table", () => ({
  Table: ({ data }: $TSFixMe) => (
    <div data-testid="table">
      <span data-testid="row-count">{data ? data.length : 0}</span>
    </div>
  ),
}));

jest.mock("~/components/common/DetailsSidebar", () => ({
  __esModule: true,
  default: () => <div data-testid="sidebar" />,
}));

const inProgressDownload = {
  id: "dl-running",
  status: "RUNNING",
  startedAt: "2024-01-02T03:04:05.000Z",
  downloadType: "sample_metadata",
  ownerUserId: 1,
};

const finishedDownload = {
  id: "dl-done",
  status: "SUCCEEDED",
  startedAt: "2024-01-02T03:04:05.000Z",
  downloadType: "sample_metadata",
  ownerUserId: 1,
};

const renderList = (data: $TSFixMe) => {
  mockQueryData = data;
  return render(
    <UserContext.Provider value={{ admin: false } as $TSFixMe}>
      <BulkDownloadList />
    </UserContext.Provider>,
  );
};

const tick = (times = 1) => {
  for (let i = 0; i < times; i++) {
    act(() => {
      jest.advanceTimersByTime(AUTO_UPDATE_DELAY);
    });
  }
};

const warningText = "This page is no longer auto-updating.";

describe("BulkDownloadList auto-update", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockFetchQuery.mockClear();
    mockSubscribeMode = "complete";
  });

  afterEach(() => {
    // The poll effect has no teardown, so a timer scheduled by one test would
    // still fire (and issue a fetch) during the next one. Drop them.
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("does not poll when no download is in progress", () => {
    renderList({ fedBulkDownloads: [finishedDownload] });
    tick(3);
    expect(mockFetchQuery).not.toHaveBeenCalled();
    expect(screen.queryByText(warningText)).toBeNull();
  });

  it("refreshes on each tick while a download is in progress", () => {
    renderList({ fedBulkDownloads: [inProgressDownload] });
    expect(mockFetchQuery).not.toHaveBeenCalled();
    tick(1);
    expect(mockFetchQuery).toHaveBeenCalledTimes(1);
    tick(1);
    expect(mockFetchQuery).toHaveBeenCalledTimes(2);
  });

  it("skips the refresh while a previous fetch is still in flight", () => {
    mockSubscribeMode = "pending";
    renderList({ fedBulkDownloads: [inProgressDownload] });
    tick(1);
    expect(mockFetchQuery).toHaveBeenCalledTimes(1);
    // isRefreshing is still true -- refresh() returns early, so no second fetch
    // is issued even though the effect re-scheduled another tick.
    tick(3);
    expect(mockFetchQuery).toHaveBeenCalledTimes(1);
  });

  it("keeps polling after a failed refresh", () => {
    mockSubscribeMode = "error";
    renderList({ fedBulkDownloads: [inProgressDownload] });
    tick(1);
    expect(mockFetchQuery).toHaveBeenCalledTimes(1);
    // The error handler clears isRefreshing, so the next tick fetches again.
    tick(1);
    expect(mockFetchQuery).toHaveBeenCalledTimes(2);
  });

  it("stops polling and offers a restart once the update budget is spent", () => {
    renderList({ fedBulkDownloads: [inProgressDownload] });
    expect(screen.queryByText(warningText)).toBeNull();

    tick(AUTO_UPDATE_MAX_COUNT);
    expect(screen.getByText(warningText)).toBeTruthy();
    const fetchesBeforeGivingUp = mockFetchQuery.mock.calls.length;
    expect(fetchesBeforeGivingUp).toBe(AUTO_UPDATE_MAX_COUNT);

    // One more scheduled tick is allowed to land (count === MAX passes the
    // <= guard), after which polling stops for good.
    tick(5);
    expect(mockFetchQuery.mock.calls.length).toBe(fetchesBeforeGivingUp + 1);

    // The restart button zeroes the counter, hiding the warning and resuming.
    fireEvent.click(screen.getByText("Click here to see additional updates."));
    expect(screen.queryByText(warningText)).toBeNull();
    tick(1);
    expect(mockFetchQuery.mock.calls.length).toBe(fetchesBeforeGivingUp + 2);
  });

  it("never shows the give-up warning when nothing is in progress", () => {
    renderList({ fedBulkDownloads: [finishedDownload] });
    tick(AUTO_UPDATE_MAX_COUNT + 2);
    expect(screen.queryByText(warningText)).toBeNull();
    expect(screen.getByTestId("row-count").textContent).toBe("1");
  });
});
