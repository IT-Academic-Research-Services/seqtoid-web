import { defaultAppTheme, makeThemeOptions } from "@czi-sds/components";
import { createTheme } from "@mui/material/styles";

// REBRAND: UCSF primary palette for the @czi-sds design system.
//
// The SDS library bakes CZ blue (#3867fa) into its component styles and does not
// read our SCSS $primary variable (see app/assets/src/styles/themes/_colors.scss).
// SDS builds its theme as `createTheme(makeThemeOptions(defaultAppTheme))`; we
// rebuild it the same way after overriding the primary/info color shades so SDS
// React components (primary buttons, toggles, links, etc.) render in UCSF blue.
//
// Shades mirror _colors.scss: 400 = UCSF CTA blue, 600 = UCSF navy.
const UCSF_PRIMARY = {
  100: "#f5faff",
  200: "#e2f4fc",
  300: "#8cb4f5",
  400: "#006be9", // UCSF CTA blue
  500: "#0055ba",
  600: "#052049", // UCSF navy
};

// AppTheme types `borders` as optional, so `defaultAppTheme.borders` is `Borders | undefined`.
// Spreading a possibly-undefined value would demote every required Borders field (error, gray,
// link, success, warning) to optional and break makeThemeOptions' AppTheme contract. Assert the
// SDS invariant once so the spread below narrows to a full Borders.
const baseBorders = defaultAppTheme.borders;
if (!baseBorders) {
  throw new Error("SDS defaultAppTheme.borders is unexpectedly undefined");
}

const ucsfAppTheme = {
  ...defaultAppTheme,
  colors: {
    ...defaultAppTheme.colors,
    primary: UCSF_PRIMARY,
    info: {
      ...defaultAppTheme.colors.info,
      400: "#006be9",
      600: "#052049",
    },
  },
  borders: {
    ...baseBorders,
    primary: {
      ...baseBorders.primary,
      400: "1px solid #006be9",
    },
  },
};

export const ucsfTheme = createTheme(makeThemeOptions(ucsfAppTheme));
