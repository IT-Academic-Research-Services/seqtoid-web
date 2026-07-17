const path = require("path");
const webpackConfig = require("./webpack.config.common");

const rootFolder = __dirname;

// Read aliases from webpack configuration and convert to a format that jest understands
const mappedModuleAliases = Object.entries(webpackConfig.resolve.alias)
  .map(([key, value]) => [`^${key}/(.*)$`, `${value}/$1`])
  .reduce((acc, [key, value]) => {
    acc[key] = value;
    return acc;
  }, {});

// This is needed, otherwise Jest gives an error when it tries importing css/scss files.
mappedModuleAliases["\\.(css|scss)$"] = "jest/__mocks__/styleMock.ts";

// The d3-scale family resolves its "main"/"module" entry to ESM source
// (src/index.js, bare `export` statements). Webpack consumes that natively, but
// Jest 26 runs CommonJS and does not transform node_modules, so importing
// anything that pulls in d3-scale dies on "Unexpected token 'export'". Babel
// cannot rescue this either: .babelrc (which carries preset-env and the
// commonjs transform) is file-relative and does not apply inside node_modules,
// and the root babel.config.js has no module transform. Both packages already
// publish a self-contained UMD build, which CommonJS can require directly, so
// point Jest at those. This affects the test runtime only -- webpack still
// takes the ESM path in the real bundle. d3-array and internmap are absent from
// the list below because they already default to CommonJS.
[
  "d3-scale",
  "d3-scale-chromatic",
  "d3-interpolate",
  "d3-format",
  "d3-time",
  "d3-time-format",
  "d3-color",
].forEach(pkg => {
  mappedModuleAliases[
    `^${pkg}$`
  ] = `<rootDir>/node_modules/${pkg}/dist/${pkg}.js`;
});

module.exports = {
  verbose: true,
  moduleNameMapper: mappedModuleAliases,
  coverageDirectory: "<rootDir>/client-coverage",
  // Instrument the WHOLE frontend tree, not just files a test happens to
  // import. Without collectCoverageFrom, Jest only counts files reached by an
  // import chain, so the reported number is a cherry-picked slice (~51% line)
  // rather than true whole-tree coverage. This makes the denominator honest.
  // Exclusions below are limited to non-executable / generated / test-support
  // code -- do NOT add real components here to inflate the number (#584).
  collectCoverageFrom: [
    "app/assets/src/**/*.{ts,tsx,js,jsx}",
    // Type-only declarations (no executable code).
    "!app/assets/src/**/*.d.ts",
    // Relay/GraphQL codegen artifacts -- never hand-written or tested.
    "!app/assets/src/**/__generated__/**",
    // Test files and Storybook stories are test-support, not app code.
    "!app/assets/src/**/*.test.{ts,tsx,js,jsx}",
    "!app/assets/src/**/*.stories.{ts,tsx,js,jsx}",
    // Test mocks/fixtures directories.
    "!app/assets/src/**/__mocks__/**",
    // Pure re-export barrels carry no logic worth covering.
    "!app/assets/src/**/index.{ts,js}",
    // Static image assets (non-TS, but guard anyway).
    "!app/assets/src/images/**",
  ],
  coveragePathIgnorePatterns: ["<rootDir>/node_modules/", "<rootDir>/build/"],
  coverageReporters: ["text-summary", "json", "html"],
  // RATCHET, not a target. These floors sit just below the true whole-tree
  // baseline measured with the honest collectCoverageFrom above. Re-measured
  // after the Heatmap unit suite landed, 2026-07-17: lines 14.86% /
  // branches 11.13% / functions 12.75% / stmts 15.00% (was 11.29 / 8.97 / 9.62
  // / 11.33 immediately before it, and 4.66 / 3.00 / 2.93 / 4.70 at the #240
  // baseline). Covering the single largest uncovered file in the frontend
  // (visualizations/heatmap/Heatmap.ts, 794 lines at 0%) moved the whole-tree
  // line number by ~3.6 points on its own.
  // Flooring to the whole number below actual means CI fails only if coverage
  // REGRESSES -- coverage can only go up. Bump these floors upward as new specs
  // land (see COVERAGE-GAP-ANALYSIS-JEST-2026-07-07.md for the path to 90/90).
  // The old 55/35 thresholds "passed" against a biased slice and certified
  // nothing; these honest floors replace that fiction.
  coverageThreshold: {
    global: {
      branches: 11,
      functions: 12,
      lines: 14,
      statements: 14,
    },
  },
  globals: {},
  moduleDirectories: ["node_modules", "src"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx"],
  modulePaths: ["<rootDir>/"],
  rootDir: "./",
  testMatch: ["<rootDir>/**/**/*.test.{js,jsx,ts,tsx}"],
  testPathIgnorePatterns: ["<rootDir>/node_modules/", "<rootDir>/build/"],
};
