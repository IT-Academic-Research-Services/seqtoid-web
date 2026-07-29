// Coverage: app/assets/src/theme/ucsfTheme.ts
//
// The UCSF rebrand rebuilds the SDS app theme with a UCSF primary palette. The
// module is a top-level side effect, so it is exercised through isolated
// re-imports: once against the real SDS defaults (happy path) and once against
// an SDS default that is missing `borders`, which the module asserts against.

describe("ucsfTheme", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("builds a MUI theme whose primary palette is UCSF CTA blue", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ucsfTheme } = require("~/theme/ucsfTheme");

    expect(ucsfTheme).toBeDefined();
    expect(ucsfTheme.palette).toBeDefined();
    // makeThemeOptions maps SDS shade 400 onto the MUI primary main color.
    expect(ucsfTheme.palette.primary.main.toLowerCase()).toBe("#006be9");
  });

  it("keeps the UCSF navy and CTA blue on the SDS app color scale", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ucsfTheme } = require("~/theme/ucsfTheme");

    const primary = ucsfTheme.app.colors.primary;
    expect(primary[400]).toBe("#006be9");
    expect(primary[600]).toBe("#052049");
    expect(primary[100]).toBe("#f5faff");

    // info shades are overridden to the same UCSF pair...
    expect(ucsfTheme.app.colors.info[400]).toBe("#006be9");
    expect(ucsfTheme.app.colors.info[600]).toBe("#052049");
    // ...and the primary border shorthand follows the CTA blue.
    expect(ucsfTheme.app.borders.primary[400]).toBe("1px solid #006be9");
  });

  it("preserves the non-overridden SDS defaults (no CZ blue left on primary)", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { defaultAppTheme } = require("@czi-sds/components");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ucsfTheme } = require("~/theme/ucsfTheme");

    // Untouched color families come straight from the SDS defaults.
    expect(ucsfTheme.app.colors.gray).toEqual(defaultAppTheme.colors.gray);
    // Border families other than `primary` are untouched.
    expect(ucsfTheme.app.borders.error).toEqual(defaultAppTheme.borders.error);
    // The CZ blue that SDS ships must no longer appear on the primary scale.
    expect(Object.values(ucsfTheme.app.colors.primary)).not.toContain(
      "#3867fa",
    );
  });

  it("throws when the SDS default theme is missing its borders", () => {
    jest.doMock("@czi-sds/components", () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const actual = jest.requireActual("@czi-sds/components");
      return {
        ...actual,
        defaultAppTheme: { ...actual.defaultAppTheme, borders: undefined },
      };
    });

    expect(() => require("~/theme/ucsfTheme")).toThrow(
      "SDS defaultAppTheme.borders is unexpectedly undefined",
    );

    jest.dontMock("@czi-sds/components");
  });
});
