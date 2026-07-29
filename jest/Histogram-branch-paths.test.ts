// Branch coverage: app/assets/src/components/visualizations/Histogram.ts
//
// Companion to Histogram.test.ts. That suite exercises the class with its
// default options; this one turns on the options whose ternaries and
// short-circuits are otherwise never taken -- the large/bold axis label
// modifiers, the log y-scale floor, the spaced-bar offset -- plus the
// "every log tick fits inside the domain" arm of the symlog tick fix.

// The repo maps every .scss import to an empty object, which erases the class
// names cx() composes. Handing back real names makes the label modifiers
// observable in the emitted SVG.
jest.mock("./__mocks__/styleMock", () => ({
  __esModule: true,
  default: {
    labelX: "labelX",
    labelY: "labelY",
    large: "large",
    bold: "bold",
  },
  labelX: "labelX",
  labelY: "labelY",
  large: "large",
  bold: "bold",
}));

import Histogram, {
  HISTOGRAM_SCALE,
} from "~/components/visualizations/Histogram";

function makeContainer(width = 500, height = 300) {
  const container = document.createElement("div");
  Object.defineProperty(container, "clientWidth", { value: width });
  Object.defineProperty(container, "clientHeight", { value: height });
  document.body.appendChild(container);
  return container;
}

function build(data: unknown, options: Record<string, unknown> = {}) {
  const container = makeContainer();
  const histogram = new Histogram(container, data, options);
  return { container, histogram };
}

const classesOf = (container: HTMLElement, selector: string) =>
  Array.from(container.querySelectorAll(selector)).map(el =>
    el.getAttribute("class"),
  );

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("Histogram axis label modifiers", () => {
  it("adds the large and bold classes to both axis labels", () => {
    const { container, histogram } = build([[1, 2, 3, 4, 5]], {
      labelX: "Reads",
      labelY: "Samples",
      labelsLarge: true,
      labelsBold: true,
      showStatistics: false,
    });
    histogram.update();

    const labelClasses = classesOf(container, "text").filter(
      cls => cls?.includes("labelX") || cls?.includes("labelY"),
    );
    expect(labelClasses).toHaveLength(2);
    for (const cls of labelClasses) {
      expect(cls).toContain("large");
      expect(cls).toContain("bold");
    }
  });

  it("leaves both axis labels unmodified by default", () => {
    const { container, histogram } = build([[1, 2, 3, 4, 5]], {
      labelX: "Reads",
      labelY: "Samples",
      showStatistics: false,
    });
    histogram.update();

    const labelClasses = classesOf(container, "text").filter(
      cls => cls?.includes("labelX") || cls?.includes("labelY"),
    );
    expect(labelClasses).toHaveLength(2);
    for (const cls of labelClasses) {
      expect(cls).not.toContain("large");
      expect(cls).not.toContain("bold");
    }
  });
});

describe("Histogram spacedBars offset", () => {
  const firstBarX = (options: Record<string, unknown>) => {
    const { container, histogram } = build([[1, 2, 3, 4, 5]], {
      showStatistics: false,
      ...options,
    });
    histogram.update();
    const bar = container.querySelector("g.bar-0 rect");
    expect(bar).not.toBeNull();
    return Number(bar?.getAttribute("x"));
  };

  it("shifts bars inward by a pixel when spacedBars is set", () => {
    const flush = firstBarX({});
    const spaced = firstBarX({ spacedBars: true });
    expect(spaced).toBe(flush + 1);
  });
});

describe("Histogram log y scale", () => {
  // The x data avoids 0 so any "0" tick text can only have come from the y axis.
  const tickTexts = (yScaleType?: string) => {
    const { container, histogram } = build([[5, 6, 7, 7, 7]], {
      ...(yScaleType ? { yScaleType } : {}),
      showStatistics: false,
    });
    histogram.update();
    return Array.from(container.querySelectorAll(".tick text")).map(
      el => el.textContent,
    );
  };

  const hasZeroTick = (yScaleType?: string) =>
    tickTexts(yScaleType).some(text => Number(text) === 0 && text !== "");

  it("floors the y domain at 1 on a log scale", () => {
    expect(hasZeroTick(HISTOGRAM_SCALE.LOG)).toBe(false);
  });

  it("floors the y domain at 0 on the default linear scale", () => {
    expect(hasZeroTick()).toBe(true);
  });
});

describe("Histogram.fixSymLogScaleTicks with ticks inside the domain", () => {
  it("keeps every log tick when none of them reach the domain max", () => {
    const { histogram } = build([1, 2, 3]);
    let currentDomain = [0, 4];
    const scale = {
      domain: jest.fn((d?: number[]) => {
        if (d) {
          currentDomain = d;
          return { nice: () => undefined };
        }
        return currentDomain;
      }),
      ticks: () => [] as number[],
    };

    // The log scale is built from [1, 4], so it emits 1..10. Widening the
    // domain afterwards means no tick reaches the max and none are trimmed.
    histogram.fixSymLogScaleTicks(scale);
    currentDomain = [0, 1000];
    const ticks = scale.ticks(2);

    expect(ticks).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // The domain max wins over the last surviving tick.
    expect(currentDomain).toEqual([0, 1000]);
  });
});
