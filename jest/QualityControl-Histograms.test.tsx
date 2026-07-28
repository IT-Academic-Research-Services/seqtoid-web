// Coverage: app/assets/src/components/views/DiscoveryView/components/SamplesView/components/QualityControl/components/Histograms/Histograms.tsx
//
// The component owns the binning maths for the four QC histograms and the
// callbacks each D3 Histogram fires. The D3 class itself is stubbed so we can
// (a) inspect the bins it is handed and (b) invoke the callbacks directly,
// which is the only way to reach handleHistogramBarClick / BarEnter for each of
// the four datasets and the empty-space click.
import { act, render, screen, waitFor } from "@testing-library/react";
import { Histograms } from "~/components/views/DiscoveryView/components/SamplesView/components/QualityControl/components/Histograms/Histograms";

type HistogramOptions = Record<string, any>;

interface StubInstance {
  container: HTMLElement | null;
  data: { x0: number; x1: number; length: number }[];
  options: HistogramOptions;
  update: jest.Mock;
}

const instances: StubInstance[] = [];

jest.mock("~/components/visualizations/Histogram", () => {
  return {
    __esModule: true,
    default: class HistogramStub {
      constructor(container, data, options) {
        const instance = {
          container,
          data,
          options,
          update: jest.fn(),
        };
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        (global as any).__histogramInstances.push(instance);
        Object.assign(this, instance);
      }
    },
  };
});

(global as any).__histogramInstances = instances;

const makeSample = (
  id: string,
  {
    totalReads,
    qcPercent,
    compressionRatio,
    insertSizeMean,
  }: {
    totalReads?: number;
    qcPercent?: number;
    compressionRatio?: number;
    insertSizeMean?: number;
  },
) =>
  ({
    id,
    name: `sample-${id}`,
    details: {
      derivedSampleOutput: {
        pipelineRun: { totalReads },
        summaryStats: { qcPercent, compressionRatio, insertSizeMean },
      },
    },
  } as any);

// Three samples with insert-size data, one without, so the
// "showing N of M samples" warning branch is reachable.
const samplesDict = {
  "1": makeSample("1", {
    totalReads: 1000,
    qcPercent: 5,
    compressionRatio: 1,
    insertSizeMean: 100,
  }),
  "2": makeSample("2", {
    totalReads: 9000,
    qcPercent: 55,
    compressionRatio: 3,
    insertSizeMean: 320,
  }),
  "3": makeSample("3", {
    totalReads: 10000,
    qcPercent: 100,
    compressionRatio: 5,
    insertSizeMean: 500,
  }),
  "4": makeSample("4", {
    totalReads: 4000,
    qcPercent: 40,
    compressionRatio: 2,
  }),
};

const validSamples = Object.values(samplesDict);

const renderHistograms = async (overrides: Record<string, any> = {}) => {
  const props = {
    filters: { visibility: "public" },
    validSamples,
    samplesDict,
    fetchProjectData: jest.fn().mockResolvedValue(undefined),
    handleBarClick: jest.fn(),
    handleChartElementHover: jest.fn(),
    handleChartElementExit: jest.fn(),
    setChartTooltipData: jest.fn(),
    ...overrides,
  };
  const utils = render(<Histograms {...(props as any)} />);
  // The mount effect awaits fetchProjectData() before drawing.
  await waitFor(() => expect(props.fetchProjectData).toHaveBeenCalled());
  await act(async () => {
    await Promise.resolve();
  });
  return { ...utils, props };
};

beforeEach(() => {
  instances.length = 0;
});

describe("Histograms", () => {
  it("renders the four QC prompts and their chart containers", async () => {
    await renderHistograms();
    expect(
      screen.getByText("Do my samples have enough total reads?"),
    ).toBeTruthy();
    expect(
      screen.getByText("Do my samples have enough quality reads?"),
    ).toBeTruthy();
    expect(
      screen.getByText("Are there too many duplicate reads in my library?"),
    ).toBeTruthy();
    expect(
      screen.getByText("Do my samples have sufficient insert lengths?"),
    ).toBeTruthy();
    expect(screen.getByTestId("total-read-histogram")).toBeTruthy();
    expect(screen.getByTestId("mean-insert-size-histogram")).toBeTruthy();
  });

  it("fetches project data on mount and draws all four histograms", async () => {
    const { props } = await renderHistograms();
    expect(props.fetchProjectData).toHaveBeenCalledTimes(1);
    expect(instances).toHaveLength(4);
    instances.forEach(inst => expect(inst.update).toHaveBeenCalled());
  });

  it("bins total reads into MIN_NUM_BINS contiguous bins covering the max value", async () => {
    await renderHistograms();
    const totalReads = instances[0];
    expect(totalReads.data).toHaveLength(10);
    // Max total reads is 10000, min bin width 1000 * 10 bins = 10000, so the
    // bin width is exactly 1000.
    expect(totalReads.data[0]).toEqual({ x0: 0, x1: 1000, length: 0 });
    // 1000 falls into [1000, 2000); 4000 into [4000, 5000).
    expect(totalReads.data[1].length).toBe(1);
    expect(totalReads.data[4].length).toBe(1);
    // The final bin is inclusive of its upper limit, so 10000 lands there.
    expect(totalReads.data[9]).toEqual({ x0: 9000, x1: 10000, length: 2 });
    // Bins are contiguous.
    totalReads.data.slice(1).forEach((bin, i) => {
      expect(bin.x0).toBe(totalReads.data[i].x1);
    });
  });

  it("bins the QC percentage series over its own minimum bin width", async () => {
    await renderHistograms();
    const qc = instances[1];
    expect(qc.data).toHaveLength(10);
    expect(qc.data[0].x0).toBe(0);
    expect(qc.data[9].x1).toBe(100);
    // 5, 40, 55 and 100 -> one sample per occupied bin, four samples total.
    expect(qc.data.reduce((sum, bin) => sum + bin.length, 0)).toBe(4);
  });

  it("rounds a non-integer bin width up to the next half unit", async () => {
    await renderHistograms();
    const dcr = instances[2];
    // Max compression ratio 5 vs the 0.5*10 = 5 floor -> bin width 0.5.
    expect(dcr.data[0]).toEqual({ x0: 0, x1: 0.5, length: 0 });
    expect(dcr.data[9].x1).toBe(5);
  });

  it("only counts samples that reported an insert size", async () => {
    await renderHistograms();
    const insertSize = instances[3];
    expect(insertSize.data.reduce((sum, bin) => sum + bin.length, 0)).toBe(3);
    // 3 of 4 samples have insert-size data, so the shortfall warning renders.
    expect(screen.getByText(/Showing/).textContent).toContain(
      "Showing 3 of 4 samples.",
    );
  });

  it("shows the 'not available' note and no shortfall warning when no sample has an insert size", async () => {
    const noInsertSizes = {
      a: makeSample("a", {
        totalReads: 2000,
        qcPercent: 20,
        compressionRatio: 1,
      }),
      b: makeSample("b", {
        totalReads: 3000,
        qcPercent: 30,
        compressionRatio: 2,
      }),
    };
    await renderHistograms({
      samplesDict: noInsertSizes,
      validSamples: Object.values(noInsertSizes),
    });
    // The mean-insert-size histogram is never constructed.
    expect(instances).toHaveLength(3);
    expect(screen.getByText(/Mean Insert Size is not available/)).toBeTruthy();
    expect(screen.queryByText(/Showing/)).toBeNull();
  });

  it("draws nothing at all when there are no valid samples", async () => {
    await renderHistograms({ validSamples: [], samplesDict: {} });
    expect(instances).toHaveLength(0);
    // The static scaffolding still renders.
    expect(screen.getByTestId("total-read-histogram")).toBeTruthy();
  });

  it("routes a bar click to the sample ids of the matching series", async () => {
    const { props } = await renderHistograms();
    const [totalReads, qc, dcr, insertSize] = instances;

    // Bin 1 of the total-reads series holds sample 1 (1000 reads).
    totalReads.options.onHistogramBarClick(totalReads.data, 1);
    expect(props.handleBarClick).toHaveBeenLastCalledWith(["1"]);

    // Bin 0 of the QC series holds sample 1 (5%).
    qc.options.onHistogramBarClick(qc.data, 0);
    expect(props.handleBarClick).toHaveBeenLastCalledWith(["1"]);

    // Bin 9 of the DCR series holds sample 3 (ratio 5, inclusive upper edge).
    dcr.options.onHistogramBarClick(dcr.data, 9);
    expect(props.handleBarClick).toHaveBeenLastCalledWith(["3"]);

    // Bin width is 50 bp, so sample 1 (100 bp) lands in bin 2 and bin 1 is empty.
    insertSize.options.onHistogramBarClick(insertSize.data, 2);
    expect(props.handleBarClick).toHaveBeenLastCalledWith(["1"]);
    insertSize.options.onHistogramBarClick(insertSize.data, 1);
    expect(props.handleBarClick).toHaveBeenLastCalledWith([]);
  });

  it("passes an empty selection when the clicked data set is not one of the four", async () => {
    const { props } = await renderHistograms();
    instances[0].options.onHistogramBarClick([{ x0: 0, x1: 1, length: 0 }], 0);
    expect(props.handleBarClick).toHaveBeenLastCalledWith([]);
  });

  it("clears the selection when empty chart space is clicked", async () => {
    const { props } = await renderHistograms();
    instances[0].options.onHistogramEmptyClick();
    expect(props.handleBarClick).toHaveBeenLastCalledWith([]);
  });

  it("builds a labelled tooltip payload per series on bar enter", async () => {
    const { props } = await renderHistograms();
    const [totalReads, qc, dcr, insertSize] = instances;

    totalReads.options.onHistogramBarEnter(
      { x0: 0, x1: 1000, length: 2 },
      totalReads.data,
    );
    let payload = props.setChartTooltipData.mock.calls.at(-1)[0];
    expect(payload[0].name).toBe("Info");
    // 0 is special-cased, 1000 is SI-formatted by d3.
    expect(payload[0].data[0]).toEqual(["Total Reads", "0-1.0k"]);
    expect(payload[0].data[1]).toEqual(["Number", "2 samples"]);

    qc.options.onHistogramBarEnter({ x0: 0, x1: 10, length: 1 }, qc.data);
    payload = props.setChartTooltipData.mock.calls.at(-1)[0];
    expect(payload[0].data[0]).toEqual(["Passed QC", "0%-10%"]);
    // A single sample uses the singular noun.
    expect(payload[0].data[1]).toEqual(["Number", "1 sample"]);

    dcr.options.onHistogramBarEnter({ x0: 0, x1: 0.5, length: 3 }, dcr.data);
    payload = props.setChartTooltipData.mock.calls.at(-1)[0];
    expect(payload[0].data[0]).toEqual(["Ratio Number", "0-0.5"]);

    insertSize.options.onHistogramBarEnter(
      { x0: 0, x1: 50, length: 0 },
      insertSize.data,
    );
    payload = props.setChartTooltipData.mock.calls.at(-1)[0];
    expect(payload[0].data[0]).toEqual(["Base Pairs", "0-50"]);
  });

  it("sends a null tooltip payload for an unrecognised data set", async () => {
    const { props } = await renderHistograms();
    instances[0].options.onHistogramBarEnter({ x0: 0, x1: 1, length: 0 }, []);
    expect(props.setChartTooltipData).toHaveBeenLastCalledWith(null);
  });

  it("wires hover and exit straight through to the parent handlers", async () => {
    const { props } = await renderHistograms();
    instances[0].options.onHistogramBarHover(12, 34);
    expect(props.handleChartElementHover).toHaveBeenCalledWith(12, 34);
    instances[0].options.onHistogramBarExit();
    expect(props.handleChartElementExit).toHaveBeenCalled();
  });

  it("configures each histogram with a domain and tick values derived from its bins", async () => {
    await renderHistograms();
    const totalReads = instances[0];
    expect(totalReads.options.domain).toEqual([0, 10000]);
    // One tick per bin start plus the final bin's upper edge.
    expect(totalReads.options.tickValues).toHaveLength(11);
    expect(totalReads.options.tickValues.at(-1)).toBe(10000);
    expect(totalReads.options.labelX).toBe("Total Reads");
    expect(totalReads.options.labelY).toBe("Number of Samples");
    // The total-reads axis formatter special-cases zero and uses SI units.
    expect(totalReads.options.xTickFormat(0)).toBe(0);
    expect(totalReads.options.xTickFormat(2500)).toBe("2.5k");
    // The QC axis formatter renders percentages.
    expect(instances[1].options.xTickFormat(25)).toBe("25%");
    // DCR and insert size have no custom formatter.
    expect(instances[2].options.xTickFormat).toBeUndefined();
  });
});
