// Coverage: app/assets/src/components/utils/tooltip.ts
// getTooltipStyle flips the tooltip to the right/above depending on where the
// cursor sits relative to the viewport, so every branch is a viewport-edge case.
import { FIELDS_METADATA, getTooltipStyle } from "~/components/utils/tooltip";

const setViewport = (width: number, height: number) => {
  Object.defineProperty(window, "innerWidth", {
    value: width,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(window, "innerHeight", {
    value: height,
    writable: true,
    configurable: true,
  });
};

describe("utils/tooltip getTooltipStyle", () => {
  beforeEach(() => {
    // 1000 wide => the "too close to the right edge" cutoff is left > 600.
    setViewport(1000, 800);
  });

  it("positions to the left of the cursor with the default 10px buffer, offset upward", () => {
    expect(getTooltipStyle({ top: 100, left: 50 })).toEqual({
      left: 60,
      top: 90,
    });
  });

  it("offsets downward instead when below is true", () => {
    expect(getTooltipStyle({ top: 100, left: 50 }, { below: true })).toEqual({
      left: 60,
      top: 110,
    });
  });

  it("honours a custom buffer", () => {
    expect(getTooltipStyle({ top: 100, left: 50 }, { buffer: 25 })).toEqual({
      left: 75,
      top: 75,
    });
  });

  it("falls back to the default buffer when buffer is 0 (falsy)", () => {
    expect(getTooltipStyle({ top: 100, left: 50 }, { buffer: 0 })).toEqual({
      left: 60,
      top: 90,
    });
  });

  it("anchors to the right edge when the cursor is within the max tooltip width of it", () => {
    // left 700 > 1000 - 400 => right-anchored, right = 1000 - 700 + buffer.
    expect(getTooltipStyle({ top: 200, left: 700 })).toEqual({
      right: 310,
      top: 190,
    });
  });

  it("still anchors left exactly at the cutoff (left === innerWidth - maxWidth)", () => {
    expect(getTooltipStyle({ top: 200, left: 600 })).toEqual({
      left: 610,
      top: 190,
    });
  });

  it("shifts the tooltip up by its own height when it would overflow the bottom", () => {
    // top 750 + height 100 = 850 > 800 => top becomes 650, then -10 buffer.
    expect(getTooltipStyle({ top: 750, left: 50 }, { height: 100 })).toEqual({
      left: 60,
      top: 640,
    });
  });

  it("leaves top alone when the tooltip fits above the bottom edge", () => {
    expect(getTooltipStyle({ top: 100, left: 50 }, { height: 100 })).toEqual({
      left: 60,
      top: 90,
    });
  });

  it("applies both the bottom-overflow shift and the right-edge anchoring together", () => {
    expect(
      getTooltipStyle({ top: 780, left: 900 }, { height: 200, buffer: 5 }),
    ).toEqual({
      right: 105,
      top: 575,
    });
  });

  it("ignores the height adjustment when height is not supplied", () => {
    // top 780 would overflow a 200px tooltip, but with no height there is
    // nothing to measure against so the raw top is used.
    expect(getTooltipStyle({ top: 780, left: 50 })).toEqual({
      left: 60,
      top: 770,
    });
  });
});

describe("utils/tooltip FIELDS_METADATA", () => {
  it("gives every field a non-empty label and tooltip", () => {
    const entries = Object.entries(FIELDS_METADATA);
    expect(entries.length).toBeGreaterThan(0);
    entries.forEach(([key, value]) => {
      expect(typeof value.label).toBe("string");
      expect(value.label.length).toBeGreaterThan(0);
      expect(typeof value.tooltip).toBe("string");
      expect(value.tooltip.length).toBeGreaterThan(0);
      expect(key).not.toContain(" ");
    });
  });

  it("exposes the known consensus-genome field labels", () => {
    expect(FIELDS_METADATA.totalReadsCg.label).toBe("Total Reads");
    expect(FIELDS_METADATA.gcPercent.label).toBe("GC Content");
    expect(FIELDS_METADATA.refSnps.label).toBe("SNPs");
    expect(FIELDS_METADATA.percentIdentity.label).toBe("%id");
  });

  it("attaches help links only to the fields that document an external resource", () => {
    expect(FIELDS_METADATA.medakaModel.link).toBeTruthy();
    expect(FIELDS_METADATA.wildcardDatabaseVersion.link).toBeTruthy();
    expect(FIELDS_METADATA.coverageDepth).not.toHaveProperty("link");
  });
});
