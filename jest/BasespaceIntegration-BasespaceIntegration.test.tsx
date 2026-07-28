// Coverage for
// app/assets/src/components/views/BasespaceIntegration/BasespaceIntegration.tsx
//
// The OAuth callback landing page. Two pieces of behaviour: on mount it hands
// the access token back to the window that opened it (but only when BOTH an
// opener and a token exist -- the && guard is the whole point, since posting to
// a missing opener would throw), and it renders either the success copy or the
// "contact us" error copy depending on whether a token came back.
import { fireEvent, render, screen } from "@testing-library/react";
import { CONTACT_US_LINK } from "~/components/utils/documentationLinks";
import { BasespaceIntegration } from "~/components/views/BasespaceIntegration/BasespaceIntegration";

const setOpener = (opener: $TSFixMe) => {
  Object.defineProperty(window, "opener", {
    value: opener,
    writable: true,
    configurable: true,
  });
};

describe("BasespaceIntegration", () => {
  afterEach(() => {
    setOpener(null);
    jest.restoreAllMocks();
  });

  it("posts the access token back to the opener on mount", () => {
    const postMessage = jest.fn();
    setOpener({ postMessage });
    render(<BasespaceIntegration accessToken="tok-123" />);
    expect(postMessage).toHaveBeenCalledWith(
      { basespaceAccessToken: "tok-123" },
      window.location.origin,
    );
  });

  it("does not post when there is no access token", () => {
    const postMessage = jest.fn();
    setOpener({ postMessage });
    render(<BasespaceIntegration />);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("does not throw when there is no opener window", () => {
    setOpener(null);
    expect(() =>
      render(<BasespaceIntegration accessToken="tok-123" />),
    ).not.toThrow();
  });

  it("shows the success copy when a token was returned", () => {
    setOpener(null);
    render(<BasespaceIntegration accessToken="tok-123" />);
    expect(
      screen.getByText(
        "You've successfully authorized SeqtoID to connect to Basespace!",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("contact us")).toBeNull();
  });

  it("shows the error copy with a contact-us link when no token was returned", () => {
    setOpener(null);
    render(<BasespaceIntegration />);
    expect(
      screen.queryByText(
        "You've successfully authorized SeqtoID to connect to Basespace!",
      ),
    ).toBeNull();
    const link = screen.getByText("contact us") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(CONTACT_US_LINK);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("closes the window from the Close Window button in both states", () => {
    const close = jest.spyOn(window, "close").mockImplementation(() => {
      /* jsdom no-op */
    });
    setOpener(null);
    const { unmount } = render(<BasespaceIntegration accessToken="tok-123" />);
    fireEvent.click(screen.getByText("Close Window"));
    expect(close).toHaveBeenCalledTimes(1);
    unmount();

    render(<BasespaceIntegration />);
    fireEvent.click(screen.getByText("Close Window"));
    expect(close).toHaveBeenCalledTimes(2);
  });
});
