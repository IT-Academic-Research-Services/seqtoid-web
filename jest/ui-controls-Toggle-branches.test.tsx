// BRANCH coverage: app/assets/src/components/ui/controls/Toggle.tsx
//
// Toggle is a semantic-ui Radio wrapper that is *semi*-controlled. Its
// branching is dense for its size:
//   - three defaulted props (onLabel / offLabel / initialChecked)
//   - the derived-state guard `if (prevChecked !== initialChecked)` that lets a
//     parent's "apply to all" push a new value through local state
//   - `isChecked ?? inputProps.checked` in the change handler and
//     `isChecked ?? internalChecked` in render, which behave differently for
//     `undefined` (uncontrolled) than for an explicit `false`
//   - `checked ? onLabel : offLabel`
//   - the `onChange && onChange(...)` short-circuit when no handler is passed
// Each of those is driven from both sides here.
import { fireEvent, render, screen } from "@testing-library/react";
import Toggle from "~/components/ui/controls/Toggle";

// semantic-ui renders <div class="ui toggle checkbox"><input/><label/></div> and
// installs its click handling on the wrapping div. It also gates the change on
// an `isClickFromMouse` flag that only a real mouseup sets, so a bare click
// event is swallowed -- mouseup then click on the root node is what actually
// toggles it.
const toggleBox = (container: HTMLElement) =>
  container.querySelector(".checkbox") as HTMLElement;

const clickToggle = (container: HTMLElement) => {
  const box = toggleBox(container);
  fireEvent.mouseUp(box);
  fireEvent.click(box);
};

const labelText = (container: HTMLElement) =>
  (container.querySelector("label") as HTMLLabelElement).textContent;

const radioInput = (container: HTMLElement) =>
  container.querySelector("input") as HTMLInputElement;

describe("Toggle -- defaulted props", () => {
  it("falls back to On/Off labels and an unchecked start when nothing is passed", () => {
    // @ts-expect-error onLabel/offLabel/initialChecked are declared required
    const { container } = render(<Toggle />);
    expect(labelText(container)).toBe("Off");
    expect(radioInput(container).checked).toBe(false);
  });

  it("uses the supplied labels and honours initialChecked", () => {
    const { container } = render(
      <Toggle onLabel="Enabled" offLabel="Disabled" initialChecked={true} />,
    );
    expect(labelText(container)).toBe("Enabled");
    expect(radioInput(container).checked).toBe(true);
  });
});

describe("Toggle -- uncontrolled toggling", () => {
  it("flips off -> on and reports the on label", () => {
    const onChange = jest.fn();
    const { container } = render(
      <Toggle
        onLabel="On"
        offLabel="Off"
        initialChecked={false}
        onChange={onChange}
      />,
    );

    clickToggle(container);

    expect(onChange).toHaveBeenCalledWith("On");
    expect(labelText(container)).toBe("On");
  });

  it("flips on -> off and reports the off label", () => {
    const onChange = jest.fn();
    const { container } = render(
      <Toggle
        onLabel="On"
        offLabel="Off"
        initialChecked={true}
        onChange={onChange}
      />,
    );

    clickToggle(container);

    expect(onChange).toHaveBeenCalledWith("Off");
    expect(labelText(container)).toBe("Off");
  });

  it("does not blow up when no onChange handler is supplied", () => {
    const { container } = render(
      <Toggle onLabel="On" offLabel="Off" initialChecked={false} />,
    );

    expect(() => clickToggle(container)).not.toThrow();
    // The short-circuited handler still advanced local state.
    expect(labelText(container)).toBe("On");
  });
});

describe("Toggle -- isChecked overrides the input's own checked value", () => {
  it("renders from isChecked=true even though local state starts unchecked", () => {
    const { container } = render(
      <Toggle
        onLabel="On"
        offLabel="Off"
        initialChecked={false}
        isChecked={true}
      />,
    );
    expect(radioInput(container).checked).toBe(true);
    // The *label* still comes from internal state, which has not moved yet.
    expect(labelText(container)).toBe("Off");
  });

  it("reports the on label on change because isChecked=true wins over the input", () => {
    const onChange = jest.fn();
    const { container } = render(
      <Toggle
        onLabel="On"
        offLabel="Off"
        initialChecked={false}
        isChecked={true}
        onChange={onChange}
      />,
    );

    clickToggle(container);

    expect(onChange).toHaveBeenCalledWith("On");
    // Internal state caught up with the forced value.
    expect(labelText(container)).toBe("On");
  });

  it("reports the off label on change because an explicit isChecked=false is not nullish", () => {
    const onChange = jest.fn();
    const { container } = render(
      <Toggle
        onLabel="On"
        offLabel="Off"
        initialChecked={true}
        isChecked={false}
        onChange={onChange}
      />,
    );
    expect(radioInput(container).checked).toBe(false);

    clickToggle(container);

    expect(onChange).toHaveBeenCalledWith("Off");
    expect(labelText(container)).toBe("Off");
  });
});

describe("Toggle -- initialChecked changing after mount", () => {
  it("adopts a new initialChecked pushed down by the parent", () => {
    const { container, rerender } = render(
      <Toggle onLabel="On" offLabel="Off" initialChecked={false} />,
    );
    expect(labelText(container)).toBe("Off");

    rerender(<Toggle onLabel="On" offLabel="Off" initialChecked={true} />);
    expect(labelText(container)).toBe("On");
    expect(radioInput(container).checked).toBe(true);
  });

  it("leaves a user-made choice alone when initialChecked is re-rendered unchanged", () => {
    const { container, rerender } = render(
      <Toggle onLabel="On" offLabel="Off" initialChecked={false} />,
    );

    clickToggle(container);
    expect(labelText(container)).toBe("On");

    // Same initialChecked -> the derived-state guard must NOT reset the toggle.
    rerender(
      <Toggle
        onLabel="On"
        offLabel="Off"
        initialChecked={false}
        className="extra"
      />,
    );
    expect(labelText(container)).toBe("On");
  });
});

describe("Toggle -- className", () => {
  it("merges a caller-supplied className with the module class", () => {
    const { container } = render(
      <Toggle
        onLabel="On"
        offLabel="Off"
        initialChecked={false}
        className="my-toggle"
      />,
    );
    expect(toggleBox(container).className).toContain("my-toggle");
  });
});

describe("Toggle -- accessibility handle", () => {
  it("exposes the radio input semantic-ui builds", () => {
    const { container } = render(
      <Toggle onLabel="On" offLabel="Off" initialChecked={false} />,
    );
    expect(radioInput(container).type).toBe("radio");
    expect(screen.getByText("Off")).toBeTruthy();
  });
});
