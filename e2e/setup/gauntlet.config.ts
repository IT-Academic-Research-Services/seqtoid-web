// Playwright config that runs the STAGING suite against an ephemeral environment.
//
// Used by e2e-pr-gate.yml to run the exact suite staging runs against a per-PR preview sandbox --
// only pointed at the ephemeral URL, never at real staging. (The name is historical: it was written
// for the staging promotion gauntlet, which has since been retired.)
//
// So we reuse staging.config.ts verbatim (every smoke/e2e project, globalSetup auth, timeouts,
// retries, workers) and override ONLY `baseURL`, to the URL the caller injects via
// GAUNTLET_BASE_URL (e2e-automation.yml's `base-url` input -> this env var). This keeps it in
// automatic lockstep with the staging suite: add a staging project, this runs it too.
//
// globalSetup reads baseURL/storageState from the resolved config.projects[0].use (Playwright merges
// this top-level `use` into every project), so overriding baseURL here retargets auth AND all tests.
import { PlaywrightTestConfig } from "@playwright/test";

import stagingConfig from "@e2e/setup/staging.config";

// The ephemeral env URL (e.g. a per-PR preview sandbox), injected by the caller. Fail LOUD if it is
// missing: this must never silently fall back to a hardcoded environment -- running the suite against
// real staging is exactly what this config exists to prevent.
const baseURL = process.env.GAUNTLET_BASE_URL;
if (!baseURL) {
  throw new Error(
    "gauntlet.config.ts: GAUNTLET_BASE_URL is required (the ephemeral env URL). " +
      "It is injected via e2e-automation.yml's base-url input; refusing to fall back to a default env.",
  );
}

const config: PlaywrightTestConfig = {
  ...stagingConfig,
  use: {
    ...stagingConfig.use,
    baseURL,
  },
};

export default config;
