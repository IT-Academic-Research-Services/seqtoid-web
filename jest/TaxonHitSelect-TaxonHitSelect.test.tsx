// Coverage: app/assets/src/components/views/DiscoveryView/components/SamplesView/
//   components/BulkDownloadModal/components/BulkDownloadModalOptions/components/
//   TaxonHitSelect/TaxonHitSelect.tsx
//
// TaxonHitSelect is a search dropdown of taxa that had hits in a sample set. It
// picks the reads vs contigs suggestions endpoint by hitType, debounces the
// query, discards stale responses, maps results into dropdown options (sorted
// by sample count desc then title asc), and always prepends an "All taxa" row
// whose count is the sample-set size. The Dropdown leaf is stubbed and the two
// api endpoints are mocked so the assertions land on this component's own
// mapping / stale-guard / sort logic.
import { act, render, screen } from "@testing-library/react";
import React from "react";

const _React: typeof React = React;

const mockGetReads = jest.fn();
const mockGetContigs = jest.fn();

jest.mock("~/api", () => ({
  getTaxaWithReadsSuggestions: (...args: $TSFixMe[]) => mockGetReads(...args),
  getTaxaWithContigsSuggestions: (...args: $TSFixMe[]) =>
    mockGetContigs(...args),
}));

const mockLogError = jest.fn();
const mockIsTransient = jest.fn(() => false);
jest.mock("~/components/utils/logUtil", () => ({
  logError: (...args: $TSFixMe[]) => mockLogError(...args),
  isTransientNetworkError: (...args: $TSFixMe[]) => mockIsTransient(...args),
}));

// Capture the props handed to the Dropdown so we can inspect the option list and
// drive onFilterChange without depending on the real (heavy) dropdown widget.
let lastDropdownProps: $TSFixMe = null;
jest.mock("~ui/controls/dropdowns/Dropdown", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => {
    lastDropdownProps = props;
    return (
      <button
        data-testid="dropdown"
        data-loading={String(props.isLoadingSearchOptions)}
        data-num-options={String(props.options.length)}
        data-value={String(props.value)}
        onClick={() =>
          props.onChange && props.onChange(props.options[0]?.value)
        }
      />
    );
  },
}));

import { TaxonHitSelect } from "~/components/views/DiscoveryView/components/SamplesView/components/BulkDownloadModal/components/BulkDownloadModalOptions/components/TaxonHitSelect/TaxonHitSelect";

beforeEach(() => {
  lastDropdownProps = null;
  mockGetReads.mockReset();
  mockGetContigs.mockReset();
  mockLogError.mockReset();
  mockIsTransient.mockReset();
  mockIsTransient.mockReturnValue(false);
});

// lodash's debounce captured the real setTimeout at import time, so fake timers
// cannot drive it. Use a real 250ms wait (> the 200ms debounce) and let the
// awaited endpoint promise settle.
const wait = (ms: number) => new Promise(res => setTimeout(res, ms));
const runFilter = async (query: string) => {
  await act(async () => {
    lastDropdownProps.onFilterChange(query);
    await wait(250);
    await Promise.resolve();
  });
};

describe("TaxonHitSelect rendering", () => {
  it("always renders an All Taxa option with the sample-set size", () => {
    render(<TaxonHitSelect sampleIds={new Set([1, 2, 3])} hitType="read" />);
    const dropdown = screen.getByTestId("dropdown");
    // Only the "All Taxa" row before any query.
    expect(dropdown.getAttribute("data-num-options")).toBe("1");
    const allOption = lastDropdownProps.options[0];
    expect(allOption.value).toBe("all");
  });

  it("forwards the current value to the dropdown", () => {
    render(
      <TaxonHitSelect sampleIds={new Set([1])} hitType="read" value={573} />,
    );
    expect(screen.getByTestId("dropdown").getAttribute("data-value")).toBe(
      "573",
    );
  });
});

describe("TaxonHitSelect query loading", () => {
  it("uses the reads endpoint and maps + sorts results", async () => {
    mockGetReads.mockResolvedValue([
      { taxid: 1, title: "Zeta", sample_count: 1 },
      { taxid: 2, title: "Alpha", sample_count: 5 },
      { taxid: 3, title: "Beta", sample_count: 5 },
    ]);
    render(<TaxonHitSelect sampleIds={new Set([9, 8])} hitType="read" />);
    await runFilter("a");

    expect(mockGetReads).toHaveBeenCalledWith("a", [9, 8]);
    expect(mockGetContigs).not.toHaveBeenCalled();

    const options = lastDropdownProps.options;
    // All Taxa first, then sorted by count desc then title asc.
    expect(options[0].value).toBe("all");
    expect(options.slice(1).map((o: $TSFixMe) => o.value)).toEqual([2, 3, 1]);
    expect(screen.getByTestId("dropdown").getAttribute("data-loading")).toBe(
      "false",
    );
  });

  it("uses the contigs endpoint when hitType is contig", async () => {
    mockGetContigs.mockResolvedValue([
      { taxid: 7, title: "Klebsiella", sample_count: 2 },
    ]);
    render(<TaxonHitSelect sampleIds={new Set([1])} hitType="contig" />);
    await runFilter("kle");

    expect(mockGetContigs).toHaveBeenCalledWith("kle", [1]);
    expect(mockGetReads).not.toHaveBeenCalled();
    expect(
      lastDropdownProps.options.slice(1).map((o: $TSFixMe) => o.value),
    ).toEqual([7]);
  });

  it("sets the loading flag immediately on filter change", async () => {
    mockGetReads.mockResolvedValue([]);
    render(<TaxonHitSelect sampleIds={new Set([1])} hitType="read" />);
    act(() => {
      lastDropdownProps.onFilterChange("x");
    });
    expect(screen.getByTestId("dropdown").getAttribute("data-loading")).toBe(
      "true",
    );
    // Let the debounced call fire so no state update lands after the test ends.
    await act(async () => {
      await wait(250);
    });
  });

  it("discards a stale response when the query changed mid-flight", async () => {
    // First query resolves slowly; before it settles a second query overwrites
    // _lastQuery, so the first response must be dropped. The two filter changes
    // are spaced beyond the debounce window so BOTH endpoint calls actually run.
    let resolveFirst: (v: $TSFixMe) => void = () => undefined;
    mockGetReads.mockImplementationOnce(
      () => new Promise(res => (resolveFirst = res)),
    );
    mockGetReads.mockResolvedValueOnce([
      { taxid: 42, title: "Fresh", sample_count: 3 },
    ]);

    render(<TaxonHitSelect sampleIds={new Set([1])} hitType="read" />);

    // Kick off the first (pending) query -- it fires but never settles yet.
    await act(async () => {
      lastDropdownProps.onFilterChange("stale");
      await wait(250);
    });
    // Kick off + settle the second query, which advances _lastQuery to "fresh".
    await runFilter("fresh");

    // Now settle the first, stale query -- it must be ignored.
    await act(async () => {
      resolveFirst([{ taxid: 99, title: "StaleHit", sample_count: 99 }]);
      await Promise.resolve();
    });

    const values = lastDropdownProps.options
      .slice(1)
      .map((o: $TSFixMe) => o.value);
    expect(values).toEqual([42]);
    expect(values).not.toContain(99);
  });

  it("clears the loading flag and logs when the request fails", async () => {
    // The suggestions endpoint can 502 on a slow request. The rejection must be
    // caught so the loading spinner is cleared instead of spinning forever, and
    // the error is reported rather than left as an unhandled rejection.
    mockGetReads.mockRejectedValue(new Error("502 Bad Gateway"));
    render(<TaxonHitSelect sampleIds={new Set([1])} hitType="read" />);
    await runFilter("slow");

    expect(screen.getByTestId("dropdown").getAttribute("data-loading")).toBe(
      "false",
    );
    expect(mockLogError).toHaveBeenCalledTimes(1);
    expect(mockLogError.mock.calls[0][0].message).toContain(
      "failed to load taxon suggestions",
    );
  });

  it("does not report a transient connectivity blip to Sentry", async () => {
    // A client-side network blip (axios ERR_NETWORK or a canceled request) is
    // not an application error. The spinner must still clear, but the error must
    // NOT reach logError/Sentry, matching the SMP-1494 convention.
    mockIsTransient.mockReturnValue(true);
    mockGetReads.mockRejectedValue(new Error("Network Error"));
    render(<TaxonHitSelect sampleIds={new Set([1])} hitType="read" />);
    await runFilter("blip");

    expect(screen.getByTestId("dropdown").getAttribute("data-loading")).toBe(
      "false",
    );
    expect(mockIsTransient).toHaveBeenCalled();
    expect(mockLogError).not.toHaveBeenCalled();
  });
});
