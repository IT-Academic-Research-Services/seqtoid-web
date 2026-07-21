// CZID-462 coverage: app/assets/src/components/visualizations/utils.ts
// normalizeData rescales each key to a percent of the row "total".
import { normalizeData } from "../app/assets/src/components/visualizations/utils";

describe("visualizations/utils normalizeData", () => {
  it("rescales each requested key to a percentage of total and pins total to 100", () => {
    const data = [
      { a: 1, b: 3, total: 4 },
      { a: 5, b: 5, total: 10 },
    ];
    expect(normalizeData(data, ["a", "b"])).toEqual([
      { a: 25, b: 75, total: 100 },
      { a: 50, b: 50, total: 100 },
    ]);
  });

  it("does not mutate the source rows", () => {
    const data = [{ a: 2, total: 4 }];
    normalizeData(data, ["a"]);
    expect(data[0].a).toBe(2);
  });

  it("leaves keys outside the provided list unchanged", () => {
    const data = [{ a: 1, keep: 9, total: 2 }];
    const [row] = normalizeData(data, ["a"]);
    expect(row.keep).toBe(9);
    expect(row.a).toBe(50);
  });
});
