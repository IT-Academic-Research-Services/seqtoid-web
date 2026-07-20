// CZID-586 (#586) frontend coverage: Footer is the shared site footer with
// static navigation and legal links.
import { render, screen } from "@testing-library/react";
import React from "react";
import { Footer } from "~/components/common/Footer/Footer";

describe("Footer", () => {
  it("renders the legal and contact links", () => {
    render(React.createElement(Footer));

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
    expect(contact.getAttribute("href")).toBe(
      "https://helpcenter.seqtoid.org/contact",
    );
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
