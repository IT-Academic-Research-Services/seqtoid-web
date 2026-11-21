// Shared `test` for every spec: Playwright's own, plus the dev WAF CI header (FJ-1265).
//
// GitHub-hosted runners egress from hosting-provider IP ranges that dev's WAF (AnonymousIpList,
// AmazonIpReputationList) blocks with 403. A request carrying header x-seqtoid-ci-key with the value
// in E2E_WAF_CI_KEY skips those two rule groups only (cypherid-web-infra envs/dev/web-waf). When
// E2E_WAF_CI_KEY is unset (local runs, other envs) nothing here does anything.
//
// The header must reach ONLY dev's own origin:
//  - `extraHTTPHeaders` is not usable: Chromium then sends a CORS preflight for every cross-origin
//    fetch (S3, Auth0, third-party APIs), which those hosts reject, and the key would leak to them.
//  - So browser traffic gets it through a context route scoped to the dev origin, and API calls made
//    with `context.request` (page objects use it) get it by wrapping that context's fetch.
// Every context a test can create goes through `browser.newContext` (the default `context` fixture,
// `browser.newPage()`), so wrapping the worker's browser covers them all.
import { Browser, BrowserContext, test as base } from "@playwright/test";

// Specs import these from here alongside `test`; add a name when a spec needs it.
export { expect } from "@playwright/test";
export type { BrowserContext, Download, Locator, Page } from "@playwright/test";

const HEADER = "x-seqtoid-ci-key";
const INSTALLED = Symbol("seqtoidCiHeader");

// Only dev and its preview sandboxes sit behind that WAF; never send the key anywhere else.
function devOrigin(baseURL: string | undefined): string | null {
  if (!process.env.E2E_WAF_CI_KEY || !baseURL) return null;
  const url = new URL(baseURL);
  const host = url.hostname;
  if (url.protocol !== "https:") return null;
  if (host !== "dev.seqtoid.org" && !host.endsWith(".dev.seqtoid.org")) return null;
  return url.origin;
}

export async function addCiHeader(
  context: BrowserContext,
  baseURL: string | undefined,
): Promise<void> {
  const origin = devOrigin(baseURL);
  const key = process.env.E2E_WAF_CI_KEY;
  if (!origin || !key || (context as any)[INSTALLED]) return;
  (context as any)[INSTALLED] = true;

  await context.route(`${origin}/**`, route =>
    route.fallback({ headers: { ...route.request().headers(), [HEADER]: key } }),
  );

  // APIRequestContext.get/post/... all delegate to fetch().
  const request = context.request;
  const fetch = request.fetch.bind(request);
  request.fetch = (urlOrRequest: any, options: any = {}) => {
    const raw = typeof urlOrRequest === "string" ? urlOrRequest : urlOrRequest.url();
    const target = new URL(raw, origin);
    if (target.origin !== origin) return fetch(urlOrRequest, options);
    return fetch(urlOrRequest, {
      ...options,
      headers: { ...(options.headers || {}), [HEADER]: key },
    });
  };
}

function wrapBrowser(browser: Browser, baseURL: string | undefined): void {
  if ((browser as any)[INSTALLED]) return;
  (browser as any)[INSTALLED] = true;
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (options?: any) => {
    const context = await newContext(options);
    await addCiHeader(context, options?.baseURL ?? baseURL);
    return context;
  };
}

export const test = base.extend<object, { _ciHeaderBrowser: void }>({
  _ciHeaderBrowser: [
    async ({ browser }, use, workerInfo) => {
      wrapBrowser(browser, workerInfo.project.use.baseURL);
      await use();
    },
    { scope: "worker", auto: true },
  ],
});
