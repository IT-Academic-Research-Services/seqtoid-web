// Coverage: app/assets/src/components/utils/d3/scales/compound.ts
// compound() stitches several d3 scales into one piecewise scale (used by the
// coverage viz / histogram axes). Tests use small hand rolled fake scales so
// the domains and ranges are exact and every arm is reachable: the empty-args
// null return, in-domain dispatch, the out-of-domain fallback to the last
// scale, the ascending/descending reversal in domain()/range(), the
// setter-throws guards, copy(), and the scales() getter/setter pair.
import compound from "../app/assets/src/components/utils/d3/scales/compound";

type FakeScale = ((x: number) => number) & {
  domain: () => number[];
  range: () => number[];
  copy: () => FakeScale;
};

// Linear scale mapping [d0, d1] onto [r0, r1].
function makeScale(domain: number[], range: number[]): FakeScale {
  const fn = ((x: number) => {
    const [d0, d1] = domain;
    const [r0, r1] = range;
    return r0 + ((x - d0) / (d1 - d0)) * (r1 - r0);
  }) as FakeScale;
  fn.domain = () => domain;
  fn.range = () => range;
  fn.copy = () => makeScale(domain, range);
  return fn;
}

describe("compound with no scales", () => {
  it("returns null", () => {
    expect(compound()).toBeNull();
  });
});

describe("compound scale dispatch", () => {
  const a = makeScale([0, 10], [0, 100]);
  const b = makeScale([10, 20], [100, 300]);
  const scale = compound(a, b) as $TSFixMe;

  it("uses the first scale whose domain contains the value", () => {
    expect(scale(0)).toBe(0);
    expect(scale(5)).toBe(50);
  });

  it("prefers the earlier scale at a shared boundary", () => {
    // 10 is in both domains; the first match wins.
    expect(scale(10)).toBe(100);
  });

  it("uses the later scale for values only it covers", () => {
    expect(scale(15)).toBe(200);
    expect(scale(20)).toBe(300);
  });

  it("falls back to the last scale for values outside every domain", () => {
    // 30 is past both domains -> extrapolated by scale b.
    expect(scale(30)).toBe(500);
    // -5 is before both domains -> still the last scale (fallback arm).
    expect(scale(-5)).toBe(-200);
  });
});

describe("compound domain() and range()", () => {
  it("spans the min and max of all sub-scale domains and ranges", () => {
    const scale = compound(
      makeScale([0, 10], [0, 100]),
      makeScale([10, 20], [100, 300]),
    ) as $TSFixMe;
    expect(scale.domain()).toEqual([0, 20]);
    expect(scale.range()).toEqual([0, 300]);
  });

  it("reverses the reported domain/range for descending scales", () => {
    const scale = compound(
      makeScale([20, 10], [300, 100]),
      makeScale([10, 0], [100, 0]),
    ) as $TSFixMe;
    expect(scale.domain()).toEqual([20, 0]);
    expect(scale.range()).toEqual([300, 0]);
  });

  it("throws when a domain is set", () => {
    const scale = compound(makeScale([0, 1], [0, 1])) as $TSFixMe;
    expect(() => scale.domain([0, 5])).toThrow(
      "Setting a domain is not supported on compound scales",
    );
  });

  it("throws when a range is set", () => {
    const scale = compound(makeScale([0, 1], [0, 1])) as $TSFixMe;
    expect(() => scale.range([0, 5])).toThrow(
      "Setting a range is not supported on compound scales",
    );
  });
});

describe("compound copy()", () => {
  it("returns an independent compound scale with the same behaviour", () => {
    const original = compound(
      makeScale([0, 10], [0, 100]),
      makeScale([10, 20], [100, 300]),
    ) as $TSFixMe;
    const copy = original.copy();

    expect(copy).not.toBe(original);
    expect(copy(5)).toBe(original(5));
    expect(copy.domain()).toEqual(original.domain());
    expect(copy.range()).toEqual(original.range());
    // The copied sub-scales are new objects, not the originals.
    expect(copy.scales()[0]).not.toBe(original.scales()[0]);
  });
});

describe("compound scales() accessor", () => {
  it("returns the current sub-scales when called with no arguments", () => {
    const a = makeScale([0, 10], [0, 100]);
    const scale = compound(a) as $TSFixMe;
    expect(scale.scales()).toEqual([a]);
  });

  it("replaces the sub-scales and returns the scale when called with a value", () => {
    const a = makeScale([0, 10], [0, 100]);
    const b = makeScale([0, 10], [0, 1]);
    const scale = compound(a) as $TSFixMe;

    expect(scale(5)).toBe(50);
    const returned = scale.scales([b]);
    expect(returned).toBe(scale);
    expect(scale(5)).toBe(0.5);
    expect(scale.range()).toEqual([0, 1]);
  });
});
