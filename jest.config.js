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
  // The d3 v4+ scoped packages (d3-scale, d3-transition, d3-color, ...) publish
  // ESM-only entry points ("main": "src/index.js"). Jest ignores node_modules
  // when transforming, so importing them from a test blows up with
  // "SyntaxError: Unexpected token 'export'". Two pieces are needed:
  //
  //  1. transformIgnorePatterns must let the d3-* packages through. The bare
  //     "d3" package (v3.5, UMD) is deliberately NOT in this list -- it is
  //     already CommonJS-loadable and running it through babel's commonjs
  //     transform breaks its UMD `this` binding.
  //  2. babel-jest must be given an explicit configFile. This repo keeps its
  //     presets (preset-env / typescript / react) in .babelrc, which babel only
  //     applies to files inside the root package -- so node_modules files would
  //     be transformed with babel.config.js alone and keep their ESM syntax.
  //     Pointing babel-jest at .babelrc applies the same presets everywhere.
  //
  // App code is transformed exactly as before; this only widens what else Jest
  // is willing to transform.
  //
  // This replaces the earlier moduleNameMapper approach of aliasing individual
  // d3-* packages to their UMD dist builds: that needs a new entry for every
  // package added (it did not cover d3-transition/d3-ease/d3-dispatch, which
  // the Dendogram suite pulls in), whereas transforming the source handles the
  // whole family at once.
  transform: {
    "^.+\\.(js|jsx|ts|tsx)$": [
      "babel-jest",
      { configFile: path.join(rootFolder, ".babelrc") },
    ],
  },
  transformIgnorePatterns: [
    "node_modules/(?!(d3-[a-z0-9-]+|internmap|delaunator|robust-predicates)/)",
  ],
  coverageReporters: ["text-summary", "json", "html"],
  // RATCHET, not a target. These floors sit just below the true whole-tree
  // baseline measured with the honest collectCoverageFrom above. Re-measured
  // after the D3 visualization units landed -- Heatmap, then Histogram and
  // Dendogram -- on Node 24.18.0, 2026-07-17: lines 17.56% / branches 13.43% /
  // functions 14.84% / stmts 17.70% (was 14.86 / 11.13 / 12.75 / 15.00 with
  // Heatmap alone, 11.31 / 9.01 / 9.64 / 11.35 after coverage wave 1, and
  // 4.66 / 3.00 / 2.93 / 4.70 at the original honest baseline). The three D3
  // classes were the 1st, 7th and 11th largest uncovered files in the tree.
  // Flooring to the whole number below actual means CI fails only if coverage
  // REGRESSES -- coverage can only go up. Bump these floors upward as new specs
  // land (see COVERAGE-GAP-ANALYSIS-JEST-2026-07-07.md for the path to 90/90).
  // The old 55/35 thresholds "passed" against a biased slice and certified
  // nothing; these honest floors replace that fiction.
  coverageThreshold: {
    global: {
      branches: 13,
      functions: 14,
      lines: 17,
      statements: 17,
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
