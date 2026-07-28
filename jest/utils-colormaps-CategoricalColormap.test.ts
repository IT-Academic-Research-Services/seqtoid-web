// Coverage: app/assets/src/components/utils/colormaps/CategoricalColormap.ts
// CategoricalColormap hands out N visually distinct categorical colors, used by
// the heatmap / phylo tree legends. Pure arithmetic, so every arm is testable:
// the default vs supplied gradient limits, the n === 0 short circuit, the
// "fewer colors requested than gradient stops" path, and the interpolation loop
// including both sides of the `interval < extraColors` remainder branch.
import { CategoricalColormap } from "../app/assets/src/components/utils/colormaps/CategoricalColormap";

const HEX = /^#[0-9a-f]{1,6}$/;

describe("CategoricalColormap constructor", () => {
  it("converts the default hex gradient stops to decimal triples", () => {
    const cmap = new CategoricalColormap();
    expect(cmap.gradients).toHaveLength(6);
    expect(cmap.gradients[0]).toEqual([0x48, 0x27, 0x78]);
    expect(cmap.gradients[1]).toEqual([0x1f, 0x96, 0x8b]);
    expect(cmap.gradients[5]).toEqual([0xab, 0x4e, 0xcc]);
  });

  it("uses caller supplied gradient limits when given", () => {
    const cmap = new CategoricalColormap(["000000", "ffffff"]);
    expect(cmap.gradients).toEqual([
      [0, 0, 0],
      [255, 255, 255],
    ]);
  });
});

describe("CategoricalColormap hexToDec / decToHex", () => {
  const cmap = new CategoricalColormap();

  it("parses a 6 digit hex string into three channel values", () => {
    expect(cmap.hexToDec("0a141e")).toEqual([10, 20, 30]);
  });

  it("renders a decimal triple back to a hex string", () => {
    expect(cmap.decToHex([0x48, 0x27, 0x78])).toBe("#482778");
  });

  it("round trips a color through dec and back to hex", () => {
    expect(cmap.decToHex(cmap.hexToDec("1f968b"))).toBe("#1f968b");
  });
});

describe("CategoricalColormap getLinearColor", () => {
  const cmap = new CategoricalColormap();

  it("returns the start color at k = 0", () => {
    expect(cmap.getLinearColor([0, 10, 20], [100, 110, 120], 0)).toEqual([
      0, 10, 20,
    ]);
  });

  it("returns the end color at k = 1", () => {
    expect(cmap.getLinearColor([0, 10, 20], [100, 110, 120], 1)).toEqual([
      100, 110, 120,
    ]);
  });

  it("floors the interpolated midpoint", () => {
    // 0 + 0.5 * 101 = 50.5 -> 50
    expect(cmap.getLinearColor([0, 0, 0], [101, 101, 101], 0.5)).toEqual([
      50, 50, 50,
    ]);
  });
});

describe("CategoricalColormap getNScale", () => {
  it("returns an empty array for n = 0", () => {
    expect(new CategoricalColormap().getNScale(0)).toEqual([]);
  });

  it("returns the leading gradient stops when n is below the stop count", () => {
    expect(new CategoricalColormap().getNScale(3)).toEqual([
      "#482778",
      "#1f968b",
      "#55c567",
    ]);
  });

  it("returns exactly the gradient stops when n equals the stop count", () => {
    const colors = new CategoricalColormap().getNScale(6);
    expect(colors).toHaveLength(6);
    expect(colors[5]).toBe("#ab4ecc");
  });

  it("interpolates extra colors when n exceeds the stop count", () => {
    const colors = new CategoricalColormap().getNScale(8);
    expect(colors).toHaveLength(8);
    // The first six are still the raw stops.
    expect(colors.slice(0, 6)).toEqual([
      "#482778",
      "#1f968b",
      "#55c567",
      "#bf1464",
      "#e58740",
      "#ab4ecc",
    ]);
    // colors[6] is the midpoint of stops 0 and 1:
    // floor(72 + .5*(31-72)) = 51 (0x33), floor(39 + .5*(150-39)) = 94 (0x5e),
    // floor(120 + .5*(139-120)) = 129 (0x81)
    expect(colors[6]).toBe("#335e81");
    expect(colors[7]).toMatch(HEX);
  });

  it("produces n distinct-format colors for a large n (both remainder arms)", () => {
    // n = 12 gives colorsPerInterval = 1 and extraColors = 1, so the loop hits
    // both `interval < extraColors` (true for interval 0) and the false side.
    const colors = new CategoricalColormap().getNScale(12);
    expect(colors).toHaveLength(12);
    colors.forEach(c => expect(c).toMatch(HEX));
    // Interpolated entries differ from each other.
    expect(new Set(colors).size).toBeGreaterThan(6);
  });

  it("interpolates across a two-stop custom gradient", () => {
    const cmap = new CategoricalColormap(["000000", "ffffff"]);
    const colors = cmap.getNScale(4);
    expect(colors).toHaveLength(4);
    expect(colors[0]).toBe("#000");
    expect(colors[1]).toBe("#ffffff");
    // colorsPerInterval = 2, extraColors = 0 -> steps 1/3 and 2/3
    // floor(255/3) = 85 (0x55), floor(2*255/3) = 170 (0xaa)
    expect(colors[2]).toBe("#555555");
    expect(colors[3]).toBe("#aaaaaa");
  });
});
