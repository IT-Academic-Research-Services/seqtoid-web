// Branch coverage for
// app/assets/src/components/views/DiscoveryView/components/SamplesView/components/StackedBasicValues/StackedBasicValues.tsx
//
// Three arms: the isEmpty guard's early return, the single-value passthrough,
// and the two-value stacked layout.
import { render, screen } from "@testing-library/react";
import { StackedBasicValues } from "~/components/views/DiscoveryView/components/SamplesView/components/StackedBasicValues/StackedBasicValues";

describe("StackedBasicValues", () => {
  it("renders nothing for an empty array", () => {
    const { container } = render(<StackedBasicValues cellData={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing for a nullish cellData", () => {
    const { container } = render(
      <StackedBasicValues cellData={undefined as $TSFixMe} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("returns the bare value when there is exactly one entry", () => {
    const { container } = render(<StackedBasicValues cellData={["only"]} />);

    expect(container.textContent).toBe("only");
    // The single-value arm short-circuits before the stacked wrapper markup.
    expect(container.querySelectorAll("div").length).toBe(0);
  });

  it("stacks the first two values with a separator when there are several", () => {
    const { container } = render(
      <StackedBasicValues cellData={[12, 34, 56] as $TSFixMe} />,
    );

    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("34")).toBeTruthy();
    // The third value is intentionally dropped by the component.
    expect(screen.queryByText("56")).toBeNull();
    expect(container.querySelectorAll("div").length).toBe(4);
  });
});
