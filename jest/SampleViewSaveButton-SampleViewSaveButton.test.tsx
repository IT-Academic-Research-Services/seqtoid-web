// Frontend coverage: SampleViewSaveButton is a gate plus a save handler. The
// gate has two independent conditions -- the viewer must be an admin and the
// workflow must be one the save button supports -- and the handler itself
// guards on `view`. All four gate combinations are exercised (including the
// `useContext(...) || {}` fallback when the provider supplies no value), plus
// the save call with and without a view.
import { fireEvent, render, screen } from "@testing-library/react";

const mockSaveVisualization = jest.fn();
const mockParseUrlParams = jest.fn();

jest.mock("~/api", () => ({
  saveVisualization: (...args: $TSFixMe[]) => mockSaveVisualization(...args),
}));

jest.mock("~/helpers/url", () => ({
  parseUrlParams: (...args: $TSFixMe[]) => mockParseUrlParams(...args),
}));

jest.mock("~/components/ui/controls/buttons", () => ({
  SaveButton: (props: $TSFixMe) => (
    <button
      data-testid="save-button"
      data-classname={props.className}
      onClick={props.onClick}
    >
      Save
    </button>
  ),
}));

import { UserContext } from "~/components/common/UserContext";
import { WorkflowType } from "~/components/utils/workflows";
import { SampleViewSaveButton } from "~/components/views/SampleView/components/SampleViewHeader/components/PrimaryHeaderControls/components/SampleViewSaveButton/SampleViewSaveButton";

const baseProps = {
  view: "table",
  sampleId: 123,
  className: "save-btn",
  workflow: WorkflowType.SHORT_READ_MNGS,
};

const renderButton = (
  overrides: $TSFixMe = {},
  contextValue: $TSFixMe = { admin: true },
) =>
  render(
    <UserContext.Provider value={contextValue}>
      <SampleViewSaveButton {...(baseProps as $TSFixMe)} {...overrides} />
    </UserContext.Provider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockParseUrlParams.mockReturnValue({ background: "9" });
  mockSaveVisualization.mockResolvedValue({ id: 1 });
});

describe("SampleViewSaveButton", () => {
  it("renders the save button for an admin on a supported workflow", () => {
    renderButton();
    const btn = screen.getByTestId("save-button");
    expect(btn).toBeTruthy();
    expect(btn.getAttribute("data-classname")).toBe("save-btn");
  });

  it("renders nothing for a non-admin, even on a supported workflow", () => {
    const { container } = renderButton({}, { admin: false });
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("save-button")).toBeNull();
  });

  it("renders nothing when the user context has no value at all", () => {
    // Exercises the `useContext(UserContext) || {}` fallback.
    const { container } = renderButton({}, null);
    expect(container.firstChild).toBeNull();
  });

  it.each([
    WorkflowType.AMR,
    WorkflowType.CONSENSUS_GENOME,
    WorkflowType.BENCHMARK,
  ])(
    "renders nothing for an admin on the unsupported %s workflow",
    workflow => {
      const { container } = renderButton({ workflow }, { admin: true });
      expect(container.firstChild).toBeNull();
      expect(screen.queryByTestId("save-button")).toBeNull();
    },
  );

  it.each([
    WorkflowType.SHORT_READ_MNGS,
    WorkflowType.LONG_READ_MNGS,
    WorkflowType.AMR_DEPRECATED,
  ])("renders for an admin on the supported %s workflow", workflow => {
    renderButton({ workflow }, { admin: true });
    expect(screen.getByTestId("save-button")).toBeTruthy();
  });

  it("saves the visualization with the sample id merged into the url params", async () => {
    renderButton();
    fireEvent.click(screen.getByTestId("save-button"));
    expect(mockParseUrlParams).toHaveBeenCalledTimes(1);
    expect(mockSaveVisualization).toHaveBeenCalledWith("table", {
      background: "9",
      sampleIds: 123,
    });
  });

  it("does not save when there is no view to save", () => {
    renderButton({ view: "" });
    fireEvent.click(screen.getByTestId("save-button"));
    expect(mockSaveVisualization).not.toHaveBeenCalled();
    expect(mockParseUrlParams).not.toHaveBeenCalled();
  });
});
