// Coverage: app/assets/src/helpers/customHooks/usePrevious.ts
// usePrevious returns the value from the prior render: undefined on first
// render, then the previous state on each subsequent render.
import { renderHook } from "@testing-library/react";
import { usePrevious } from "../app/assets/src/helpers/customHooks/usePrevious";

describe("helpers/customHooks/usePrevious", () => {
  it("returns undefined on the first render", () => {
    const { result } = renderHook(() => usePrevious(1));
    expect(result.current).toBeUndefined();
  });

  it("returns the value from the previous render after an update", () => {
    const { result, rerender } = renderHook(({ value }) => usePrevious(value), {
      initialProps: { value: 1 },
    });
    expect(result.current).toBeUndefined();

    rerender({ value: 2 });
    expect(result.current).toBe(1);

    rerender({ value: 3 });
    expect(result.current).toBe(2);
  });

  it("tracks the previous value through repeated identical renders", () => {
    const { result, rerender } = renderHook(({ value }) => usePrevious(value), {
      initialProps: { value: "a" },
    });
    rerender({ value: "b" });
    expect(result.current).toBe("a");
    // Re-rendering with the same prop advances "previous" to that same value.
    rerender({ value: "b" });
    expect(result.current).toBe("b");
  });

  it("supports object references", () => {
    const first = { id: 1 };
    const second = { id: 2 };
    const { result, rerender } = renderHook(({ value }) => usePrevious(value), {
      initialProps: { value: first },
    });
    rerender({ value: second });
    expect(result.current).toBe(first);
  });
});
