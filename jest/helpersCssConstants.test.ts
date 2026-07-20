// Coverage: app/assets/src/helpers/cssConstants.ts
// These string constants are shared across inline-style call sites (e.g.
// visualizations/TidyTree). The exact SVG/CSS property names are load-bearing,
// so this suite locks them against accidental edits.
import {
  FILL_OPACITY,
  FONT_WEIGHT,
  TEXT_ANCHOR,
  TRANSFORM,
  TRANSLATE,
} from "../app/assets/src/helpers/cssConstants";

describe("helpers/cssConstants.ts", () => {
  it("exposes the SVG/CSS property names verbatim", () => {
    expect(FILL_OPACITY).toBe("fill-opacity");
    expect(FONT_WEIGHT).toBe("font-weight");
    expect(TEXT_ANCHOR).toBe("text-anchor");
    expect(TRANSFORM).toBe("transform");
    expect(TRANSLATE).toBe("translate");
  });
});
