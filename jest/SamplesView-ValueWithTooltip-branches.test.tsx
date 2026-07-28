// Coverage: app/assets/src/components/views/DiscoveryView/components/SamplesView/components/ValueWithTooltip/ValueWithTooltip.tsx
//
// Tiny wrapper, but every one of its branches is a fallback: the `??` on the
// tooltip title, the `||` on the cell body and the defaulted className. Each is
// exercised with the value present and absent.
import { render, screen } from "@testing-library/react";
import { ValueWithTooltip } from "~/components/views/DiscoveryView/components/SamplesView/components/ValueWithTooltip/ValueWithTooltip";

// The SDS Tooltip only mounts its title into the DOM on hover, so expose it as
// its own node instead -- the point of these tests is which value is passed.
jest.mock("@czi-sds/components", () => ({
  Tooltip: ({
    title,
    children,
  }: {
    title: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <div>
      <div data-testid="tooltip-title">{title}</div>
      <div data-testid="tooltip-body">{children}</div>
    </div>
  ),
}));

const title = () => screen.getByTestId("tooltip-title").textContent;
const body = () =>
  screen.getByTestId("tooltip-body").firstElementChild as HTMLElement;

describe("ValueWithTooltip branches", () => {
  it("prefers an explicit tooltipTitle over the children", () => {
    render(
      <ValueWithTooltip tooltipTitle="Full sample name" cellData="Sample A">
        fallback children
      </ValueWithTooltip>,
    );

    expect(title()).toBe("Full sample name");
  });

  it("falls back to the children when tooltipTitle is undefined", () => {
    render(
      <ValueWithTooltip cellData="Sample A">Tooltip body</ValueWithTooltip>,
    );

    expect(title()).toBe("Tooltip body");
  });

  it("honours an empty-string tooltipTitle instead of falling through", () => {
    // `??` (not `||`) means an empty-string title is used as-is.
    render(<ValueWithTooltip tooltipTitle="">Tooltip body</ValueWithTooltip>);

    expect(title()).toBe("");
  });

  it("renders cellData as the body when it is non-empty", () => {
    render(<ValueWithTooltip cellData="42">ignored</ValueWithTooltip>);

    expect(body().textContent).toBe("42");
  });

  it("falls back to the children when cellData is an empty string", () => {
    render(<ValueWithTooltip cellData="">child body</ValueWithTooltip>);

    expect(body().textContent).toBe("child body");
  });

  it("falls back to the children when cellData is missing entirely", () => {
    render(<ValueWithTooltip>child body</ValueWithTooltip>);

    expect(body().textContent).toBe("child body");
  });

  // The scss module is stubbed out in this suite, so cs.base resolves to
  // undefined and cx drops it -- what is observable is whether the caller's
  // className made it through.
  it("applies the supplied className", () => {
    render(<ValueWithTooltip className="extra-class" cellData="x" />);

    expect(body().className).toBe("extra-class");
  });

  it("uses the default empty className when none is supplied", () => {
    render(<ValueWithTooltip cellData="x" />);

    expect(body().className).toBe("");
  });
});
