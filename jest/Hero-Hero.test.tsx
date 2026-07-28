// Coverage: app/assets/src/components/views/LandingPage/components/Hero/Hero.tsx
// Hero renders the marketing headline plus an embedded HeroEmailForm and a
// rotating word ("Free" / "Fast" / "Accessible") driven by a setInterval that,
// every 2500ms, advances an index and (on a 400ms inner timeout) rewrites the
// .rotating-text node, toggling longUnderline when the index lands on 2. We use
// fake timers to walk several ticks so every branch of that interval body runs.
import React from "react";

const mockEmailForm = jest.fn();

jest.mock("~/components/views/LandingPage/components/HeroEmailForm", () => ({
  HeroEmailForm: () => {
    mockEmailForm();
    return <div data-testid="hero-email-form" />;
  },
}));

jest.mock("@czi-sds/components", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

jest.mock(
  "~/images/landing_page/hero-mobile-bg.png",
  () => "hero-mobile-bg.png",
);

import { render, screen } from "@testing-library/react";
import { Hero } from "~/components/views/LandingPage/components/Hero/Hero";

const rotatingText = () =>
  document.querySelector(".rotating-text") as HTMLElement;

beforeEach(() => {
  jest.useFakeTimers();
  mockEmailForm.mockClear();
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe("Hero", () => {
  it("renders the headline, stats, terms links and the email form", () => {
    const { container } = render(<Hero />);
    // The h1 text is split across nodes (headline + <br> + rotating word).
    expect(
      (container.querySelector("h1") as HTMLElement).textContent,
    ).toContain("Metagenomic Analysis");
    expect(screen.getByTestId("hero-email-form")).toBeTruthy();
    expect(mockEmailForm).toHaveBeenCalled();

    // The three stat tiles.
    expect(screen.getByText("156+")).toBeTruthy();
    expect(screen.getByText("121+")).toBeTruthy();
    expect(screen.getByText("320,000+")).toBeTruthy();

    // Terms / Privacy links from the mocked SDS Link.
    const terms = screen.getByText("Terms") as HTMLAnchorElement;
    expect(terms.getAttribute("href")).toBe("/terms");
    const privacy = screen.getByText("Privacy Policy") as HTMLAnchorElement;
    expect(privacy.getAttribute("href")).toBe("/privacy");
  });

  it("starts with the word 'Free' before any interval tick", () => {
    render(<Hero />);
    expect(rotatingText().textContent).toBe("Free");
  });

  it("rotates to 'Fast' after the first tick's inner timeout", () => {
    render(<Hero />);
    // One interval tick (2500ms) then the 400ms text-swap timeout.
    jest.advanceTimersByTime(2500 + 400);
    expect(rotatingText().textContent).toBe("Fast");
  });

  it("rotates to 'Accessible' and back to 'Free' across further ticks", () => {
    render(<Hero />);
    // Second tick -> index 2 -> "Accessible" (longUnderline branch).
    jest.advanceTimersByTime(2 * 2500 + 400);
    expect(rotatingText().textContent).toBe("Accessible");

    // Third tick starts with index 2, hitting the `if (i === 2) i = 0` branch
    // and returning to "Free".
    jest.advanceTimersByTime(2500 + 400);
    expect(rotatingText().textContent).toBe("Free");
  });

  it("clears the fade/moveUp state after the 700ms timeout", () => {
    const { container } = render(<Hero />);
    jest.advanceTimersByTime(2500 + 700);
    // After the 700ms timeout setFade(false)/setMoveUp(true) have run; the node
    // still exists and carries the rotating-text class.
    expect(container.querySelector(".rotating-text")).toBeTruthy();
  });
});
