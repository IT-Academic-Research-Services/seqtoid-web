// Coverage:
// app/assets/src/components/common/DetailsSidebar/TaxonDetailsMode/TaxonHistogram/TaxonHistogram.tsx
//
// TaxonHistogram fetches a taxon's rPM distribution for the chosen background,
// and only when both NT and NR rpm_list arrays come back does it flip
// shouldShowHistogram and instantiate the D3 Histogram. It renders null when
// there is no background, when the guard (missing background/taxonId/values)
// short-circuits the fetch, and it logs on rejection. The Histogram viz is
// stubbed so we can assert construction/update without touching D3 innards.
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { getTaxonDistributionForBackground } from "~/api";
import { TaxonHistogram } from "~/components/common/DetailsSidebar/TaxonDetailsMode/TaxonHistogram/TaxonHistogram";

const _React: typeof React = React;

jest.mock("~/api", () => ({
  getTaxonDistributionForBackground: jest.fn(),
}));

// Capture Histogram construction so we can assert on it.
const histogramInstances: $TSFixMe[] = [];
jest.mock("~/components/visualizations/Histogram", () => {
  class MockHistogram {
    container: $TSFixMe;
    data: $TSFixMe;
    options: $TSFixMe;
    update = jest.fn();
    constructor(container: $TSFixMe, data: $TSFixMe, options: $TSFixMe) {
      this.container = container;
      this.data = data;
      this.options = options;
      histogramInstances.push(this);
    }
  }
  return {
    __esModule: true,
    default: MockHistogram,
    HISTOGRAM_SCALE: { SYM_LOG: "symlog" },
  };
});

// ColumnHeaderTooltip + Icon are SDS-heavy; render their trigger inline.
jest.mock("~/components/ui/containers/ColumnHeaderTooltip", () => ({
  __esModule: true,
  default: ({ trigger }: $TSFixMe) => <div>{trigger}</div>,
}));
jest.mock("@czi-sds/components", () => ({
  Icon: () => <span data-testid="icon" />,
}));

const mockedGet = getTaxonDistributionForBackground as jest.MockedFunction<
  typeof getTaxonDistributionForBackground
>;

const background = { id: 7, name: "Human CSF" } as $TSFixMe;
const taxonValues = {
  NT: { rpm: 5 },
  NR: { rpm: 3 },
} as $TSFixMe;

describe("TaxonHistogram", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    histogramInstances.length = 0;
  });

  it("renders nothing when there is no background", () => {
    const { container } = render(
      <TaxonHistogram
        background={null}
        taxonId={562}
        taxonValues={taxonValues}
      />,
    );
    expect(container.firstChild).toBeNull();
    // Guard short-circuits before any fetch.
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it("stays null when the background is present but the fetch is skipped", async () => {
    // No taxonValues -> loadBackgroundInfo returns early, histogram never shows.
    const { container } = render(
      <TaxonHistogram
        background={background}
        taxonId={562}
        taxonValues={null as $TSFixMe}
      />,
    );
    await waitFor(() => expect(mockedGet).not.toHaveBeenCalled());
    expect(
      container.querySelector('[data-testid="taxon-histogram"]'),
    ).toBeNull();
  });

  it("renders the histogram once NT and NR rpm lists arrive", async () => {
    mockedGet.mockResolvedValue({
      NT: { rpm_list: [1, 2, 3] },
      NR: { rpm_list: [4, 5, 6] },
    } as $TSFixMe);

    render(
      <TaxonHistogram
        background={background}
        taxonId={562}
        taxonValues={taxonValues}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("taxon-histogram")).toBeTruthy(),
    );
    expect(screen.getByText(/Reference Background: Human CSF/)).toBeTruthy();
    // The viz got constructed with both series and updated once.
    expect(histogramInstances.length).toBe(1);
    expect(histogramInstances[0].data).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    expect(histogramInstances[0].options.seriesNames).toEqual(["NT", "NR"]);
    expect(histogramInstances[0].update).toHaveBeenCalled();
  });

  it("stays null and logs when the fetch rejects", async () => {
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockedGet.mockRejectedValue(new Error("boom"));

    const { container } = render(
      <TaxonHistogram
        background={background}
        taxonId={562}
        taxonValues={taxonValues}
      />,
    );

    await waitFor(() => expect(errSpy).toHaveBeenCalled());
    expect(
      container.querySelector('[data-testid="taxon-histogram"]'),
    ).toBeNull();
    errSpy.mockRestore();
  });

  it("stays null when only one of NT/NR rpm lists is present", async () => {
    // Data present but NR missing -> the shouldShow guard is not met.
    mockedGet.mockResolvedValue({ NT: { rpm_list: [1, 2] } } as $TSFixMe);

    const { container } = render(
      <TaxonHistogram
        background={background}
        taxonId={562}
        taxonValues={taxonValues}
      />,
    );

    await waitFor(() => expect(mockedGet).toHaveBeenCalled());
    expect(
      container.querySelector('[data-testid="taxon-histogram"]'),
    ).toBeNull();
    expect(histogramInstances.length).toBe(0);
  });
});
