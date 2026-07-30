// Playwright config for the STAGING PROMOTION GAUNTLET (SMP).
//
// The gauntlet vets a promotable dev image against an isolated, staging-shaped candidate env in the
// dev cluster (see .github/workflows/staging-gauntlet.yml + bin/gauntlet_env) BEFORE the image is
// allowed to promote to env-staging. The E2E tier must run the exact same suite staging runs -- only
// pointed at the ephemeral candidate URL, never at real staging.
//
// So we reuse staging.config.ts verbatim (every smoke/e2e project, globalSetup auth, timeouts,
// retries, workers) and override ONLY `baseURL`, to the candidate URL the gauntlet injects via
// GAUNTLET_BASE_URL (e2e-automation.yml's `base-url` input -> this env var). This keeps the gauntlet
// in automatic lockstep with the staging suite: add a staging project, the gauntlet runs it too.
//
// globalSetup reads baseURL/storageState from the resolved config.projects[0].use (Playwright merges
// this top-level `use` into every project), so overriding baseURL here retargets auth AND all tests.
import { PlaywrightTestConfig } from "@playwright/test";

import stagingConfig from "@e2e/setup/staging.config";

// The ephemeral gauntlet-candidate env URL (e.g. https://gauntlet-abc12345.dev.seqtoid.org), injected
// by the staging gauntlet. Fail LOUD if it is missing: the gauntlet must never silently fall back to
// a hardcoded environment -- running the suite against real staging is exactly what this gate exists
// to prevent.
const baseURL = process.env.GAUNTLET_BASE_URL;
if (!baseURL) {
  throw new Error(
    "gauntlet.config.ts: GAUNTLET_BASE_URL is required (the isolated gauntlet-candidate env URL). " +
      "It is injected by .github/workflows/staging-gauntlet.yml; refusing to fall back to a default env.",
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
