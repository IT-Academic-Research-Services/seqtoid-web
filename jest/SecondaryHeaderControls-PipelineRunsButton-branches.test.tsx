// Branch coverage for
// app/assets/src/components/views/SampleView/components/SampleViewHeader/components/SecondaryHeaderControls/components/PipelineRunsButton/PipelineRunsButton.tsx
//
// Conditionals: the `useContext(UserContext) || {}` fallback when the context
// value is nullish, the `userIsAdmin &&` gate around the whole control, and
// the `sample?.id` optional chain in the navigation target.
import { fireEvent, render, screen } from "@testing-library/react";
import { UserContext } from "~/components/common/UserContext";
import { PipelineRunsButton } from "~/components/views/SampleView/components/SampleViewHeader/components/SecondaryHeaderControls/components/PipelineRunsButton/PipelineRunsButton";

const originalLocation = window.location;

beforeAll(() => {
  // Assigning location.href in jsdom throws "not implemented"; swap in a
  // plain object so the navigation target can be asserted instead.
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { href: "" },
  });
});

afterAll(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: originalLocation,
  });
});

beforeEach(() => {
  window.location.href = "";
});

const sample = { id: 4321 } as $TSFixMe;

describe("PipelineRunsButton", () => {
  it("renders the button for admins and navigates to the sample's pipeline runs", () => {
    render(
      <UserContext.Provider value={{ admin: true } as $TSFixMe}>
        <PipelineRunsButton sample={sample} />
      </UserContext.Provider>,
    );

    fireEvent.click(screen.getByText("Pipeline Runs"));
    expect(window.location.href).toBe("/samples/4321/pipeline_runs");
  });

  it("falls back to an undefined id when the sample is nullish", () => {
    render(
      <UserContext.Provider value={{ admin: true } as $TSFixMe}>
        <PipelineRunsButton sample={null as $TSFixMe} />
      </UserContext.Provider>,
    );

    fireEvent.click(screen.getByText("Pipeline Runs"));
    expect(window.location.href).toBe("/samples/undefined/pipeline_runs");
  });

  it("renders nothing for a non-admin user", () => {
    const { container } = render(
      <UserContext.Provider value={{ admin: false } as $TSFixMe}>
        <PipelineRunsButton sample={sample} />
      </UserContext.Provider>,
    );

    expect(container.innerHTML).toBe("");
    expect(screen.queryByText("Pipeline Runs")).toBeNull();
  });

  it("renders nothing when the user context value itself is nullish", () => {
    const { container } = render(
      <UserContext.Provider value={null as $TSFixMe}>
        <PipelineRunsButton sample={sample} />
      </UserContext.Provider>,
    );

    // `useContext(UserContext) || {}` -- the right-hand fallback arm.
    expect(container.innerHTML).toBe("");
  });
});
