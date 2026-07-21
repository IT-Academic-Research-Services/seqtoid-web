// CZID-462 coverage: app/assets/src/components/ui/Table/tableUtils.ts
// Width-style generators read getSize() off a tanstack column / header.
import {
  generateHeaderWidthStyles,
  generateWidthStyles,
} from "../app/assets/src/components/ui/Table/tableUtils";

describe("ui/Table/tableUtils", () => {
  it("generateWidthStyles sets both width and maxWidth from the column size", () => {
    const column = { getSize: () => 120 } as $TSFixMe;
    expect(generateWidthStyles(column)).toEqual({
      width: "120px",
      maxWidth: "120px",
    });
  });

  it("generateHeaderWidthStyles sets only width from the header size", () => {
    const header = { getSize: () => 64 } as $TSFixMe;
    expect(generateHeaderWidthStyles(header)).toEqual({ width: "64px" });
  });
});
