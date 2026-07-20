// CZID-462 coverage: app/assets/src/components/views/SamplesHeatmapView/utils.ts
// Pure label/metric helpers plus the throttle wrapper (driven with fake timers).
import {
  getTruncatedLabel,
  metricIsZscore,
  throttle,
} from "../app/assets/src/components/views/SamplesHeatmapView/utils";

describe("SamplesHeatmapView/utils", () => {
  describe("getTruncatedLabel", () => {
    it("leaves short labels (<= 20 chars) untouched", () => {
      expect(getTruncatedLabel("Escherichia coli")).toBe("Escherichia coli");
      // Exactly 20 characters is the boundary and must not be truncated.
      expect(getTruncatedLabel("12345678901234567890")).toBe(
        "12345678901234567890",
      );
    });

    it("truncates long labels to first 9 + ... + last 7", () => {
      const label = "Severe acute respiratory syndrome coronavirus 2";
      // slice(0, 9) = "Severe ac", slice(-7) = "virus 2"
      expect(getTruncatedLabel(label)).toBe("Severe ac...virus 2");
    });
  });

  describe("metricIsZscore", () => {
    it("recognizes both the dotted value form and the underscored threshold form", () => {
      expect(metricIsZscore("NT.zscore")).toBe(true);
      expect(metricIsZscore("NR.zscore")).toBe(true);
      expect(metricIsZscore("NT_zscore")).toBe(true);
      expect(metricIsZscore("NR_zscore")).toBe(true);
    });

    it("returns false for non-zscore metrics", () => {
      expect(metricIsZscore("NT.rpm")).toBe(false);
      expect(metricIsZscore("")).toBe(false);
    });
  });

  describe("throttle", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it("invokes immediately, then suppresses calls until the window elapses", () => {
      const fn = jest.fn();
      const throttled = throttle(fn, 100);

      throttled();
      throttled();
      throttled();
      expect(fn).toHaveBeenCalledTimes(1);

      // After the limit passes the gate re-opens for the next call.
      jest.advanceTimersByTime(100);
      throttled();
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });
});
