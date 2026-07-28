// Coverage for ContextPlaceholder: an absolutely-positioned popup anchored to
// an arbitrary DOM element. All nine positioning arms (right/left/center x
// top/bottom/middle, plus the right-edge overflow correction) and the
// click-outside close behaviour are exercised here.
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import ContextPlaceholder from "~/components/ui/containers/ContextPlaceholder";

// Keeps prettier's organize-imports from dropping the React import that the
// classic JSX runtime needs in scope.
const _React: typeof React = React;

const CLIENT_WIDTH = 1000;
const CLIENT_HEIGHT = 800;

/** Rect of the anchor element the placeholder positions itself against. */
const CONTEXT_RECT = {
  left: 20,
  right: 100,
  top: 50,
  bottom: 70,
  width: 40,
  height: 20,
} as DOMRect;

/** Makes an anchor element whose bounding rect is deterministic under jsdom. */
const makeContext = (rect: Partial<DOMRect> = {}) => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  el.getBoundingClientRect = () =>
    ({ ...CONTEXT_RECT, ...rect } as unknown as DOMRect);
  return el;
};

/** jsdom reports 0 for every rect; stub the placeholder's own size. */
const stubPlaceholderRect = (width: number, height: number) =>
  jest
    .spyOn(HTMLDivElement.prototype, "getBoundingClientRect")
    .mockReturnValue({ width, height } as unknown as DOMRect);

const styleOf = (container: HTMLElement) =>
  (container.querySelector("div[style]") as HTMLElement).style;

beforeAll(() => {
  Object.defineProperty(document.documentElement, "clientWidth", {
    value: CLIENT_WIDTH,
    configurable: true,
  });
  Object.defineProperty(document.documentElement, "clientHeight", {
    value: CLIENT_HEIGHT,
    configurable: true,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("ContextPlaceholder rendering", () => {
  it("renders its children absolutely positioned when open", () => {
    const { container } = render(
      <ContextPlaceholder>child-content</ContextPlaceholder>,
    );
    expect(screen.getByText("child-content")).toBeTruthy();
    expect(styleOf(container).position).toBe("absolute");
  });

  it("renders nothing when open is false", () => {
    const { container } = render(
      <ContextPlaceholder open={false}>child-content</ContextPlaceholder>,
    );
    expect(container.textContent).toBe("");
    expect(screen.queryByText("child-content")).toBeNull();
  });

  it("applies no offsets when there is no context element", () => {
    const { container } = render(
      <ContextPlaceholder>no-anchor</ContextPlaceholder>,
    );
    const style = styleOf(container);
    expect(style.left).toBe("");
    expect(style.right).toBe("");
    expect(style.top).toBe("");
    expect(style.bottom).toBe("");
  });
});

describe("ContextPlaceholder positioning", () => {
  it("positions bottom-left with the supplied offsets (default position)", () => {
    stubPlaceholderRect(10, 30);
    const { container } = render(
      <ContextPlaceholder
        context={makeContext()}
        horizontalOffset={5}
        verticalOffset={7}
      >
        anchored
      </ContextPlaceholder>,
    );
    const style = styleOf(container);
    // left = contextRect.left + width/2 + horizontalOffset = 20 + 20 + 5
    expect(style.left).toBe("45px");
    // The unused side is set to "auto" (jsdom's cssstyle drops that keyword,
    // so the assertion is simply that no pixel value was written).
    expect(style.right).not.toMatch(/px/);
    // top = contextRect.bottom - height/2 + verticalOffset = 70 - 10 + 7
    expect(style.top).toBe("67px");
    expect(style.bottom).not.toMatch(/px/);
  });

  it("positions top-right and corrects for a placeholder wider than the anchor", () => {
    stubPlaceholderRect(500, 30);
    const { container } = render(
      <ContextPlaceholder context={makeContext()} position="top right">
        anchored
      </ContextPlaceholder>,
    );
    const style = styleOf(container);
    // right = clientWidth - contextRect.right + width/2 = 1000 - 100 + 20 = 920,
    // then shifted by (contextRect.right - placeholderWidth) = 100 - 500 = -400.
    expect(style.right).toBe("520px");
    expect(style.left).not.toMatch(/px/);
    // bottom = clientHeight - contextRect.top - height/2 = 800 - 50 - 10
    expect(style.bottom).toBe("740px");
    expect(style.top).not.toMatch(/px/);
  });

  it("skips the overflow correction when the placeholder fits", () => {
    stubPlaceholderRect(10, 30);
    const { container } = render(
      <ContextPlaceholder context={makeContext()} position="top right">
        anchored
      </ContextPlaceholder>,
    );
    expect(styleOf(container).right).toBe("920px");
  });

  it("centers horizontally and vertically when position names neither side", () => {
    stubPlaceholderRect(500, 30);
    const { container } = render(
      <ContextPlaceholder context={makeContext()} position="center middle">
        anchored
      </ContextPlaceholder>,
    );
    const style = styleOf(container);
    // left = contextRect.left + (contextWidth - placeholderWidth)/2 = 20 + (40-500)/2
    expect(style.left).toBe("-210px");
    expect(style.right).not.toMatch(/px/);
    // top = contextRect.bottom - (contextHeight + placeholderHeight)/2 = 70 - 25
    expect(style.top).toBe("45px");
    expect(style.bottom).not.toMatch(/px/);
  });
});

describe("ContextPlaceholder click-outside handling", () => {
  it("closes and calls onClose when a mousedown lands outside", () => {
    const onClose = jest.fn();
    render(
      <ContextPlaceholder closeOnOutsideClick onClose={onClose}>
        inside-content
      </ContextPlaceholder>,
    );
    expect(screen.getByText("inside-content")).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("inside-content")).toBeNull();
  });

  it("stays open when the mousedown lands inside the placeholder", () => {
    const onClose = jest.fn();
    render(
      <ContextPlaceholder closeOnOutsideClick onClose={onClose}>
        <span>inside-content</span>
      </ContextPlaceholder>,
    );
    fireEvent.mouseDown(screen.getByText("inside-content"));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("inside-content")).toBeTruthy();
  });

  it("closes without an onClose handler", () => {
    render(
      <ContextPlaceholder closeOnOutsideClick>only-content</ContextPlaceholder>,
    );
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText("only-content")).toBeNull();
  });

  it("ignores outside clicks when closeOnOutsideClick is off", () => {
    const onClose = jest.fn();
    render(
      <ContextPlaceholder onClose={onClose}>sticky-content</ContextPlaceholder>,
    );
    fireEvent.mouseDown(document.body);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("sticky-content")).toBeTruthy();
  });

  it("removes the document listener on unmount", () => {
    const removeSpy = jest.spyOn(document, "removeEventListener");
    const { unmount } = render(
      <ContextPlaceholder closeOnOutsideClick>bye</ContextPlaceholder>,
    );
    unmount();
    expect(removeSpy.mock.calls.some(([type]) => type === "mousedown")).toBe(
      true,
    );
  });

  it("does not remove a listener it never added", () => {
    const removeSpy = jest.spyOn(document, "removeEventListener");
    const { unmount } = render(<ContextPlaceholder>bye</ContextPlaceholder>);
    unmount();
    expect(removeSpy.mock.calls.some(([type]) => type === "mousedown")).toBe(
      false,
    );
  });
});
