// Coverage for
// app/assets/src/components/views/ImpactPage/components/ImpactVideoSection/ImpactVideoSection.tsx
//
// A small stateful presentational component: three toggle buttons switch a
// single "video" state between "video" / "360" / "vr", and each value renders
// a different block (a YouTube iframe, the 360 iframe + description, or the
// ImpactVRSection). The tests drive every branch of that switch and check the
// active-class toggle. ImpactVRSection is stubbed since it is tested elsewhere.
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

// Keeps organize-imports from dropping the React import the classic JSX
// runtime needs in scope.
const _React: typeof React = React;

jest.mock(
  "~/components/views/ImpactPage/components/ImpactVideoSection/components/ImpactVRSection",
  () => ({
    ImpactVRSection: () => <div data-testid="vr-section">VR SECTION</div>,
  }),
);

import { ImpactVideoSection } from "~/components/views/ImpactPage/components/ImpactVideoSection/ImpactVideoSection";

const getIframe = (): HTMLIFrameElement | null =>
  document.querySelector("iframe");

describe("ImpactVideoSection", () => {
  it("defaults to the regular video with its description and no VR section", () => {
    render(<ImpactVideoSection />);
    expect(screen.getByText("Take the Video Tour")).toBeTruthy();
    expect(getIframe()?.getAttribute("src")).toBe(
      "https://www.youtube.com/embed/XA63ld-VT7o",
    );
    expect(
      screen.getByText("Infectious Disease Detectives - Bangladesh"),
    ).toBeTruthy();
    expect(screen.queryByTestId("vr-section")).toBeNull();
  });

  it("switches to the 360 video and swaps the description headline", () => {
    render(<ImpactVideoSection />);
    fireEvent.click(screen.getByRole("button", { name: "360°" }));
    expect(getIframe()?.getAttribute("src")).toBe(
      "https://www.youtube.com/embed/dnf63o22CWA",
    );
    // The 360 headline replaces the regular one.
    expect(screen.getByText(/360° Video Tour with/)).toBeTruthy();
    expect(
      screen.queryByText("Infectious Disease Detectives - Bangladesh"),
    ).toBeNull();
  });

  it("switches to VR, hiding both the iframe and the description block", () => {
    render(<ImpactVideoSection />);
    fireEvent.click(screen.getByRole("button", { name: "VR" }));
    expect(screen.getByTestId("vr-section")).toBeTruthy();
    expect(getIframe()).toBeNull();
    expect(
      screen.queryByText("Infectious Disease Detectives - Bangladesh"),
    ).toBeNull();
  });

  it("marks only the currently selected button as active", () => {
    render(<ImpactVideoSection />);
    const videoBtn = screen.getByRole("button", { name: "Video" });
    const vrBtn = screen.getByRole("button", { name: "VR" });
    // cs.active resolves to undefined under the style mock, so the active
    // button carries the literal "undefined" class and inactive ones "null".
    expect(videoBtn.className).toBe("undefined");
    expect(vrBtn.className).toBe("null");

    fireEvent.click(vrBtn);
    expect(vrBtn.className).toBe("undefined");
    expect(videoBtn.className).toBe("null");
  });

  it("returns to the regular video from another tab", () => {
    render(<ImpactVideoSection />);
    fireEvent.click(screen.getByRole("button", { name: "VR" }));
    expect(screen.getByTestId("vr-section")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Video" }));
    expect(screen.queryByTestId("vr-section")).toBeNull();
    expect(getIframe()?.getAttribute("src")).toBe(
      "https://www.youtube.com/embed/XA63ld-VT7o",
    );
  });
});
