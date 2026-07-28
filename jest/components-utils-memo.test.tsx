// Coverage for app/assets/src/components/utils/memo.ts
//
// This is a thin wrapper around React.memo whose only real behaviour is the
// displayName accessor pair it installs on the memoized component: reading
// displayName proxies through to the *inner* component, and writing it sets the
// inner component's displayName rather than the memo wrapper's. That indirection
// exists so devtools/name-based lookups keep working through the memo boundary.
import { render, screen } from "@testing-library/react";
import { memo } from "~/components/utils/memo";

describe("memo", () => {
  it("returns a working memoized component that renders its props", () => {
    const Base = ({ label }: { label: string }) => <span>{label}</span>;
    const Memoized = memo<{ label: string }>(Base);

    render(<Memoized label="hello" />);
    expect(screen.getByText("hello")).toBeTruthy();
  });

  it("produces a React.memo element type (not the raw component)", () => {
    const Base = () => <div />;
    const Memoized = memo(Base);

    expect(Memoized).not.toBe(Base);
    // React.memo objects carry the memo symbol and hold the original in .type.
    expect((Memoized as any).type).toBe(Base);
    expect(String((Memoized as any).$$typeof)).toContain("memo");
  });

  it("reads displayName through to the wrapped component", () => {
    const Base = () => <div />;
    Base.displayName = "InnerName";
    const Memoized = memo(Base);

    expect(Memoized.displayName).toBe("InnerName");
  });

  it("writing displayName on the memo assigns it to the wrapped component", () => {
    const Base = () => <div />;
    const Memoized = memo(Base);

    Memoized.displayName = "AssignedName";

    expect(Base.displayName).toBe("AssignedName");
    // ...and reading back through the getter reflects the same value.
    expect(Memoized.displayName).toBe("AssignedName");
  });

  it("is undefined when the wrapped component has no displayName", () => {
    const Memoized = memo(() => <div />);
    expect(Memoized.displayName).toBeUndefined();
  });

  it("honors a custom propsAreEqual comparator (equal props skip re-render)", () => {
    const renderSpy = jest.fn();
    const Base = ({ value }: { value: number }) => {
      renderSpy(value);
      return <span data-testid="val">{value}</span>;
    };
    // Treat every prop set as equal -> React should never re-render on update.
    const Memoized = memo<{ value: number }>(Base, () => true);

    const { rerender } = render(<Memoized value={1} />);
    expect(renderSpy).toHaveBeenCalledTimes(1);

    rerender(<Memoized value={2} />);
    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("val").textContent).toBe("1");
  });

  it("re-renders when the comparator reports the props differ", () => {
    const renderSpy = jest.fn();
    const Base = ({ value }: { value: number }) => {
      renderSpy(value);
      return <span data-testid="val">{value}</span>;
    };
    const Memoized = memo<{ value: number }>(Base, () => false);

    const { rerender } = render(<Memoized value={1} />);
    rerender(<Memoized value={2} />);

    expect(renderSpy).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("val").textContent).toBe("2");
  });
});
