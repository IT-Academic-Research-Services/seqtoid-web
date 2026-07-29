// Frontend coverage: symlog() builds the "symmetric log" scale the heatmaps
// use for their colour ramp. It stitches together up to three d3 pieces --
// a negative log scale over (-inf, -1], a linear scale over [-1, 1], and a
// positive log scale over [1, +inf) -- and hangs them off a compound scale.
// These tests drive every arm of the internal intersection()/rescale() logic:
// domains that hit all three pieces, one piece only, reversed domains, and a
// zero-width domain that produces no pieces at all.
import symlog from "~/components/utils/d3/scales/symlog";

// Each piece exposes d3's own domain()/range() accessors.
const pieces = (scale: $TSFixMe) =>
  scale
    .scales()
    .map((s: $TSFixMe) => ({ domain: s.domain(), range: s.range() }));

describe("symlog", () => {
  it("starts out as a single linear piece over the unit interval", () => {
    const scale: $TSFixMe = symlog();
    expect(scale.domain()).toEqual([0, 1]);
    expect(scale.range()).toEqual([0, 1]);
    expect(scale.scales()).toHaveLength(1);
  });

  it("splits a symmetric domain into negative-log, linear and positive-log pieces", () => {
    const scale: $TSFixMe = symlog();
    scale.range([0, 100]);
    scale.domain([-100, 100]);

    const parts = pieces(scale);
    expect(parts).toHaveLength(3);
    expect(parts.map((p: $TSFixMe) => p.domain)).toEqual([
      [-100, -1],
      [-1, 1],
      [1, 100],
    ]);

    // The pieces tile the output range end to end, with no gaps.
    expect(parts[0].range[0]).toBe(0);
    expect(parts[0].range[1]).toBe(parts[1].range[0]);
    expect(parts[1].range[1]).toBe(parts[2].range[0]);
    expect(parts[2].range[1]).toBe(100);

    // The aggregate accessors report the full domain/range, not a piece.
    expect(scale.domain()).toEqual([-100, 100]);
    expect(scale.range()).toEqual([0, 100]);
  });

  it("maps a symmetric domain symmetrically about the range midpoint", () => {
    const scale: $TSFixMe = symlog();
    scale.range([0, 100]);
    scale.domain([-100, 100]);

    expect(scale(-100)).toBeCloseTo(0);
    expect(scale(0)).toBeCloseTo(50);
    expect(scale(100)).toBeCloseTo(100);
    // -1 and 1 sit an equal distance either side of the midpoint.
    expect(50 - scale(-1)).toBeCloseTo(scale(1) - 50);
  });

  it("compresses the positive tail logarithmically", () => {
    const scale: $TSFixMe = symlog();
    scale.range([0, 100]);
    scale.domain([-100, 100]);

    // A log piece puts 10 exactly halfway between 1 and 100 in output space.
    expect(scale(10)).toBeCloseTo((scale(1) + scale(100)) / 2);
  });

  it("keeps only the positive log piece when the domain sits above 1", () => {
    const scale: $TSFixMe = symlog();
    scale.range([0, 10]);
    scale.domain([1, 1000]);

    const parts = pieces(scale);
    expect(parts).toHaveLength(1);
    expect(parts[0].domain).toEqual([1, 1000]);
    expect(scale(1)).toBeCloseTo(0);
    expect(scale(1000)).toBeCloseTo(10);
    // Log spacing: 10 is a third of the way from 1 to 1000.
    expect(scale(10)).toBeCloseTo(10 / 3);
  });

  it("keeps only the negative log piece when the domain sits below -1", () => {
    const scale: $TSFixMe = symlog();
    scale.range([0, 10]);
    scale.domain([-1000, -2]);

    const parts = pieces(scale);
    expect(parts).toHaveLength(1);
    expect(parts[0].domain).toEqual([-1000, -2]);
    expect(scale(-1000)).toBeCloseTo(0);
    expect(scale(-2)).toBeCloseTo(10);
  });

  it("keeps only the linear piece when the domain is inside [-1, 1]", () => {
    const scale: $TSFixMe = symlog();
    scale.range([0, 10]);
    scale.domain([-1, 1]);

    expect(pieces(scale)).toHaveLength(1);
    // Linear, so zero lands exactly on the range midpoint.
    expect(scale(-1)).toBeCloseTo(0);
    expect(scale(0)).toBeCloseTo(5);
    expect(scale(1)).toBeCloseTo(10);
  });

  it("reverses each piece when the domain is given high-to-low", () => {
    const scale: $TSFixMe = symlog();
    scale.range([0, 10]);
    scale.domain([100, -100]);

    const parts = pieces(scale);
    expect(parts).toHaveLength(3);
    // Every piece domain comes back reversed relative to the ascending case.
    expect(parts.map((p: $TSFixMe) => p.domain)).toEqual([
      [-1, -100],
      [1, -1],
      [100, 1],
    ]);
    expect(scale.domain()).toEqual([100, -100]);
    // The linear middle still puts zero at the centre of the output range.
    expect(scale(0)).toBeCloseTo(5);
  });

  it("produces no pieces for a zero-width domain", () => {
    const scale: $TSFixMe = symlog();
    scale.range([0, 10]);
    scale.domain([0.5, 0.5]);

    // Every intersection collapses to a point, so nothing is emitted.
    expect(scale.scales()).toHaveLength(0);
    expect(scale.domain()).toEqual([Infinity, -Infinity]);
  });

  it("recomputes the pieces when the range is set after the domain", () => {
    const scale: $TSFixMe = symlog();
    scale.domain([-100, 100]);
    scale.range([0, 50]);

    expect(scale.range()).toEqual([0, 50]);
    expect(scale.domain()).toEqual([-100, 100]);
    expect(scale(0)).toBeCloseTo(25);
    expect(scale(100)).toBeCloseTo(50);
  });

  it("extrapolates past the top of the domain using the last piece", () => {
    const scale: $TSFixMe = symlog();
    scale.range([0, 100]);
    scale.domain([-100, 100]);

    // 1000 is outside every piece domain, so the final log piece is used and
    // the output runs past the end of the declared range.
    expect(scale(1000)).toBeGreaterThan(100);
  });
});
