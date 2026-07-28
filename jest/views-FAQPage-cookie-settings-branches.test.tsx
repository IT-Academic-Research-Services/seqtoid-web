// Coverage: app/assets/src/components/views/FAQPage/FAQPage.tsx
//
// The only executable logic on this otherwise-static legal page lives on the
// "Cookie Settings" span inside the collapsed cookies accordion:
//   onClick   -> window.OneTrust?.ToggleInfoDisplay?.()
//   onKeyDown -> if (e.key === "Enter" || e.key === " ") { same optional chain }
// That is two optional-chain short circuits plus the two sides of the `||` and
// the guard's false path. All of them are driven below.
import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("~/components/common/LandingHeader", () => ({
  LandingHeader: () => <div data-testid="landing-header" />,
}));

jest.mock("~/components/common/Footer", () => ({
  Footer: () => <div data-testid="footer" />,
}));

import { FAQPage } from "~/components/views/FAQPage/FAQPage";

const COOKIE_CHOICES_QUESTION = "Do I have choices with respect to cookies?";

// The Cookie Settings span lives inside a collapsed Accordion, so the accordion
// has to be opened before the span exists in the DOM.
const openCookieSettings = () => {
  render(<FAQPage />);
  fireEvent.click(screen.getByText(COOKIE_CHOICES_QUESTION));
  return screen.getByText("Cookie Settings");
};

describe("FAQPage cookie settings control", () => {
  afterEach(() => {
    delete (window as $TSFixMe).OneTrust;
  });

  it("keeps the cookie settings control out of the DOM until the accordion is opened", () => {
    render(<FAQPage />);

    expect(screen.queryByText("Cookie Settings")).toBeNull();

    fireEvent.click(screen.getByText(COOKIE_CHOICES_QUESTION));

    expect(screen.getByText("Cookie Settings")).toBeTruthy();
  });

  it("opens the OneTrust preference centre on click", () => {
    const toggleInfoDisplay = jest.fn();
    (window as $TSFixMe).OneTrust = { ToggleInfoDisplay: toggleInfoDisplay };

    fireEvent.click(openCookieSettings());

    expect(toggleInfoDisplay).toHaveBeenCalledTimes(1);
  });

  it("does not throw on click when the OneTrust script never loaded", () => {
    // window.OneTrust is undefined -> the first `?.` short circuits.
    expect(() => fireEvent.click(openCookieSettings())).not.toThrow();
  });

  it("does not throw on click when OneTrust exists without ToggleInfoDisplay", () => {
    // Exercises the second `?.` in the chain.
    (window as $TSFixMe).OneTrust = {};

    expect(() => fireEvent.click(openCookieSettings())).not.toThrow();
  });

  it("opens the preference centre on Enter", () => {
    const toggleInfoDisplay = jest.fn();
    (window as $TSFixMe).OneTrust = { ToggleInfoDisplay: toggleInfoDisplay };

    fireEvent.keyDown(openCookieSettings(), { key: "Enter" });

    expect(toggleInfoDisplay).toHaveBeenCalledTimes(1);
  });

  it("opens the preference centre on Space", () => {
    // Second arm of the `||` -- Enter is false, Space is true.
    const toggleInfoDisplay = jest.fn();
    (window as $TSFixMe).OneTrust = { ToggleInfoDisplay: toggleInfoDisplay };

    fireEvent.keyDown(openCookieSettings(), { key: " " });

    expect(toggleInfoDisplay).toHaveBeenCalledTimes(1);
  });

  it("ignores every other key", () => {
    const toggleInfoDisplay = jest.fn();
    (window as $TSFixMe).OneTrust = { ToggleInfoDisplay: toggleInfoDisplay };

    const span = openCookieSettings();
    fireEvent.keyDown(span, { key: "a" });
    fireEvent.keyDown(span, { key: "Tab" });
    fireEvent.keyDown(span, { key: "Escape" });

    expect(toggleInfoDisplay).not.toHaveBeenCalled();
  });

  it("does not throw on Enter when the OneTrust script never loaded", () => {
    expect(() =>
      fireEvent.keyDown(openCookieSettings(), { key: "Enter" }),
    ).not.toThrow();
  });

  it("exposes the control as a keyboard-reachable button", () => {
    const span = openCookieSettings();

    expect(span.getAttribute("role")).toBe("button");
    expect(span.getAttribute("tabindex")).toBe("0");
    expect(span.className).toContain("optanon-show-settings");
  });
});
