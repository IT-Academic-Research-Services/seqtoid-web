// Coverage: app/assets/src/components/views/LandingPage/components/Content/components/WhitePaper.tsx
// WhitePaper renders the GigaScience paper CTA plus a "Copy Citation" control.
// The interesting logic is copyCitation (writes to the clipboard) and
// citationAlert, whose setTimeout body and timeoutActive branch toggle the
// hidden confirmation span's opacity. Both the click and keyboard (Enter / non
// Enter) paths funnel through the same handlers, so we drive each one.
import { fireEvent, render, screen } from "@testing-library/react";
import WhitePaper from "~/components/views/LandingPage/components/Content/components/WhitePaper";

jest.mock("~/images/landing_page/white-paper.svg", () => "white-paper.svg");

const writeText = jest.fn();

beforeAll(() => {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

beforeEach(() => {
  jest.useFakeTimers();
  writeText.mockClear();
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

const copyRow = () =>
  screen.getByText("Copy Citation").closest('[role="button"]') as HTMLElement;

const alertSpan = () => document.querySelector("span") as HTMLSpanElement;

describe("WhitePaper", () => {
  it("renders the heading, blurb and both CTA links", () => {
    render(<WhitePaper />);
    expect(screen.getByText("Check out Our Paper in GigaScience")).toBeTruthy();
    const readPaper = screen.getByText("Read Paper");
    expect(readPaper.getAttribute("href")).toBeTruthy();
    expect(screen.getByText("Copy Citation")).toBeTruthy();
    expect(screen.getByText("Citation is copied to clipboard")).toBeTruthy();
  });

  it("copies the citation text to the clipboard on click and reveals the alert", () => {
    render(<WhitePaper />);
    fireEvent.click(copyRow());
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toContain("Kalantar, Katrina L.");
    // citationAlert set opacity to "1" via the timeoutActive=false branch.
    expect(alertSpan().style.opacity).toBe("1");
  });

  it("hides the alert again once the 1500ms timeout fires", () => {
    render(<WhitePaper />);
    fireEvent.click(copyRow());
    expect(alertSpan().style.opacity).toBe("1");
    jest.advanceTimersByTime(1500);
    expect(alertSpan().style.opacity).toBe("0");
  });

  it("takes the timeoutActive=true branch on a second click before the timeout", () => {
    render(<WhitePaper />);
    // First click sets timeoutActive true.
    fireEvent.click(copyRow());
    // Second click hits the `if (timeoutActive)` clearTimeout branch, then
    // re-shows the alert.
    fireEvent.click(copyRow());
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(alertSpan().style.opacity).toBe("1");
  });

  it("copies via the Enter key but ignores other keys", () => {
    render(<WhitePaper />);
    fireEvent.keyDown(copyRow(), { key: "a" });
    expect(writeText).not.toHaveBeenCalled();

    fireEvent.keyDown(copyRow(), { key: "Enter" });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(alertSpan().style.opacity).toBe("1");
  });
});
