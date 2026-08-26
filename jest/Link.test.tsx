// SW-2 coverage for app/assets/src/components/ui/controls/Link.tsx
//
// Link is the single place the environment-specific help-center host is applied.
// Help links are authored as "helpcenter:" sentinel paths and resolved against
// helpCenterHost from UserContext; everything else (internal routes, absolute
// external URLs) must pass through untouched. The named prop allowlist
// (aria-label/id/data-testid/style) must reach the underlying <a>.
import { render, screen } from "@testing-library/react";
import React from "react";
import { UserContext } from "~/components/common/UserContext";
import Link from "~/components/ui/controls/Link";

const renderWithHost = (host: string | undefined, ui: React.ReactElement) =>
  host === undefined
    ? render(ui) // no provider -> Link uses its createContext default (prod host)
    : render(
        <UserContext.Provider value={{ helpCenterHost: host } as $TSFixMe}>
          {ui}
        </UserContext.Provider>,
      );

const hrefOf = (text: string) =>
  screen.getByText(text).getAttribute("href");

describe("Link help-center resolution", () => {
  it("resolves a 'helpcenter:' sentinel against helpCenterHost from context", () => {
    renderWithHost(
      "https://helpcenter.dev.seqtoid.org",
      <Link href="helpcenter:/articles/sample-qc">qc</Link>,
    );
    expect(hrefOf("qc")).toBe(
      "https://helpcenter.dev.seqtoid.org/articles/sample-qc",
    );
  });

  it("preserves an anchor fragment on the sentinel path", () => {
    renderWithHost(
      "https://helpcenter.test",
      <Link href="helpcenter:/articles/sample-report-table/#e-value">r</Link>,
    );
    expect(hrefOf("r")).toBe(
      "https://helpcenter.test/articles/sample-report-table/#e-value",
    );
  });

  it("falls back to the prod host when rendered outside a provider", () => {
    // The createContext default carries the prod host, so out-of-provider renders
    // (e.g. an unpopulated tree) still produce a working absolute URL.
    renderWithHost(undefined, <Link href="helpcenter:/contact">c</Link>);
    expect(hrefOf("c")).toBe("https://helpcenter.seqtoid.org/contact");
  });

  it("leaves an internal Rails route (bare path) untouched", () => {
    renderWithHost(
      "https://helpcenter.dev.seqtoid.org",
      <Link external href="/terms">
        terms
      </Link>,
    );
    // Must NOT acquire the help host - this is the outage the sentinel prevents.
    expect(hrefOf("terms")).toBe("/terms");
  });

  it("leaves an absolute external URL untouched", () => {
    renderWithHost(
      "https://helpcenter.dev.seqtoid.org",
      <Link external href="https://github.com/chanzuckerberg/czid-workflows">
        gh
      </Link>,
    );
    expect(hrefOf("gh")).toBe(
      "https://github.com/chanzuckerberg/czid-workflows",
    );
  });

  it("forwards the named allowlist (aria-label, id, data-testid) to the anchor", () => {
    renderWithHost(
      "https://helpcenter.test",
      <Link
        href="helpcenter:/"
        aria-label="help"
        id="help-link"
        data-testid="help-testid"
      >
        h
      </Link>,
    );
    const a = screen.getByTestId("help-testid");
    expect(a.getAttribute("aria-label")).toBe("help");
    expect(a.getAttribute("id")).toBe("help-link");
    expect(a.getAttribute("href")).toBe("https://helpcenter.test/");
  });
});
