// CZID-586 (#586) frontend coverage: Footer is the shared site footer with
// static navigation and legal links.
import { render, screen } from "@testing-library/react";
import React from "react";
import { Footer } from "~/components/common/Footer/Footer";
import { UserContext } from "~/components/common/UserContext";

// SW-2: help links render the "helpcenter:" sentinel; Link.tsx resolves it against
// helpCenterHost from UserContext. Render under a known host so the resolved URL is
// deterministic.
const HELP_HOST = "https://helpcenter.test";

describe("Footer", () => {
  it("renders the legal and contact links", () => {
    render(
      <UserContext.Provider value={{ helpCenterHost: HELP_HOST } as $TSFixMe}>
        <Footer />
      </UserContext.Provider>,
    );

    const privacy = screen.getByText("Privacy");
    expect(privacy.getAttribute("href")).toBe("/privacy");
    expect(privacy.getAttribute("aria-label")).toBe(
      "View the SeqtoID privacy notice",
    );

    const terms = screen.getByText("Terms");
    expect(terms.getAttribute("href")).toBe("/terms");
    expect(terms.getAttribute("aria-label")).toBe(
      "View the SeqtoID terms of use",
    );

    const contact = screen.getByText("Contact us");
    expect(contact.getAttribute("href")).toBe(`${HELP_HOST}/contact`);
    expect(contact.getAttribute("aria-label")).toBe(
      "Contact the SeqtoID team (opens in new window)",
    );

    expect(screen.getByText("Cookie Settings")).toBeTruthy();
  });

  it("links to the homepage via the logo", () => {
    render(React.createElement(Footer));
    expect(
      screen.getByLabelText("Go to the SeqtoID homepage").getAttribute("href"),
    ).toBe("/");
  });
});
