// CZID-462 coverage: app/assets/src/components/views/PathogenListView/utils.ts
// categorizeItems alphabetizes by name and then groups by category.
import { categorizeItems } from "../app/assets/src/components/views/PathogenListView/utils";

describe("PathogenListView/utils categorizeItems", () => {
  it("alphabetizes by name and groups the result by category", () => {
    const items = [
      { name: "Zika", category: "viral" },
      { name: "Anthrax", category: "bacterial" },
      { name: "Ebola", category: "viral" },
    ];

    // Items are sorted by name first (Anthrax, Ebola, Zika), so within each
    // category bucket insertion order reflects the alphabetized ordering.
    expect(categorizeItems(items)).toEqual({
      bacterial: [{ name: "Anthrax", category: "bacterial" }],
      viral: [
        { name: "Ebola", category: "viral" },
        { name: "Zika", category: "viral" },
      ],
    });
  });

  it("returns an empty object for an empty list", () => {
    expect(categorizeItems([])).toEqual({});
  });

  it("does not mutate the input array", () => {
    const items = [
      { name: "Beta", category: "b" },
      { name: "Alpha", category: "a" },
    ];
    categorizeItems(items);
    expect(items[0].name).toBe("Beta");
  });
});
