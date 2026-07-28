// Coverage: app/assets/src/components/views/PathogenListView/components/AnchorMenu/components/Section/Section.tsx
//
// Section is a tiny presentational wrapper whose only logic is an effect that
// registers/unregisters its DOM node with an IntersectionObserver. Both sides of
// the `current && observer` guard are exercised (a real observer, and a null
// observer), plus the unobserve cleanup on unmount and on observer swap.
import { render, screen } from "@testing-library/react";
import { Section } from "~/components/views/PathogenListView/components/AnchorMenu/components/Section/Section";

const makeObserver = () =>
  ({
    observe: jest.fn(),
    unobserve: jest.fn(),
    disconnect: jest.fn(),
  } as unknown as IntersectionObserver);

describe("PathogenListView AnchorMenu Section", () => {
  it("renders the heading, the id and the children", () => {
    render(
      <Section id="general" name="General Information" observer={null}>
        <p>body copy</p>
      </Section>,
    );

    const heading = screen.getByRole("heading", {
      name: "General Information",
    });
    expect(heading.tagName).toBe("H2");
    expect(screen.getByText("body copy")).toBeTruthy();
    expect(document.getElementById("general")).not.toBeNull();
  });

  it("observes its own node when an observer is supplied", () => {
    const observer = makeObserver();
    render(
      <Section id="s1" name="One" observer={observer}>
        <span>child</span>
      </Section>,
    );

    expect(observer.observe).toHaveBeenCalledTimes(1);
    // The observed element is this section's own container.
    expect(observer.observe).toHaveBeenCalledWith(
      document.getElementById("s1"),
    );
    expect(observer.unobserve).not.toHaveBeenCalled();
  });

  it("does not attempt to observe when the observer is null", () => {
    const { unmount } = render(
      <Section id="s2" name="Two" observer={null}>
        <span>child</span>
      </Section>,
    );
    // Nothing to assert on the observer itself; the point is that neither the
    // effect body nor its cleanup throws when observer is null.
    expect(() => unmount()).not.toThrow();
  });

  it("unobserves the node on unmount", () => {
    const observer = makeObserver();
    const { unmount } = render(
      <Section id="s3" name="Three" observer={observer}>
        <span>child</span>
      </Section>,
    );
    const node = document.getElementById("s3");

    unmount();

    expect(observer.unobserve).toHaveBeenCalledTimes(1);
    expect(observer.unobserve).toHaveBeenCalledWith(node);
  });

  it("re-registers with a new observer when the observer prop changes", () => {
    const first = makeObserver();
    const second = makeObserver();
    const { rerender } = render(
      <Section id="s4" name="Four" observer={first}>
        <span>child</span>
      </Section>,
    );

    rerender(
      <Section id="s4" name="Four" observer={second}>
        <span>child</span>
      </Section>,
    );

    expect(first.unobserve).toHaveBeenCalledTimes(1);
    expect(second.observe).toHaveBeenCalledTimes(1);
    expect(first.observe).toHaveBeenCalledTimes(1);
  });
});
