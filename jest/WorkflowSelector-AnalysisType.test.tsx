// Frontend coverage:
// app/assets/src/components/views/SampleUploadFlow/components/WorkflowSelector/
//   components/AnalysisType/AnalysisType.tsx
//
// AnalysisType is one "Analysis Type" card in the upload flow. Everything it
// does is conditional: the checkbox stage follows isSelected, the click handler
// is swallowed when the card is disabled, the "cannot be run" tooltip only
// listens for hover while disabled, a caller-supplied customIcon replaces the
// generated SDS icon, and the sequencing-platform options are only mounted once
// the card is selected (defaulting to null when the caller omits them).
//
// The three SDS primitives are stubbed so the props AnalysisType computes are
// directly observable -- the scss modules are mapped to an empty object in this
// repo, so class-name assertions would certify nothing.
import { fireEvent, render, screen } from "@testing-library/react";
import { AnalysisType } from "~/components/views/SampleUploadFlow/components/WorkflowSelector/components/AnalysisType/AnalysisType";
import { UploadWorkflows } from "~/components/views/SampleUploadFlow/constants";

// scss imported through the `~/` alias bypasses jest's style mock (the alias
// mapping wins), so it has to be stubbed explicitly.
jest.mock(
  "~/components/views/SampleUploadFlow/components/WorkflowSelector/workflow_selector.scss",
  () => ({}),
  { virtual: true },
);

jest.mock("@czi-sds/components", () => ({
  __esModule: true,
  Icon: (props: $TSFixMe) => (
    <span
      data-testid="sds-icon"
      data-icon={String(props.sdsIcon)}
      data-size={props.sdsSize}
      data-classname={String(props.className)}
    />
  ),
  InputCheckbox: (props: $TSFixMe) => (
    <span
      data-testid="input-checkbox"
      data-stage={props.stage}
      data-disabled={String(props.disabled)}
    />
  ),
  Tooltip: (props: $TSFixMe) => (
    <span
      data-testid="disabled-tooltip"
      data-title={props.title}
      data-disable-hover={String(props.disableHoverListener)}
    >
      {props.children}
    </span>
  ),
}));

const baseProps = {
  description: <span data-testid="description">Run mNGS</span>,
  isDisabled: false,
  isSelected: false,
  onClick: jest.fn(),
  sdsIcon: "dna" as $TSFixMe,
  testKey: UploadWorkflows.MNGS,
  title: "Metagenomics",
};

const renderCard = (overrides: $TSFixMe = {}) =>
  render(<AnalysisType {...baseProps} {...overrides} />);

describe("AnalysisType -- selection state", () => {
  it("renders an unchecked, unselected card and forwards the title/description", () => {
    renderCard({ isSelected: false });

    const card = screen.getByTestId(`analysis-type-${UploadWorkflows.MNGS}`);
    expect(card.getAttribute("aria-checked")).toBe("false");
    expect(card.getAttribute("role")).toBe("checkbox");
    expect(
      screen.getByTestId("input-checkbox").getAttribute("data-stage"),
    ).toBe("unchecked");
    expect(screen.getByText("Metagenomics")).toBeTruthy();
    expect(screen.getByTestId("description").textContent).toBe("Run mNGS");
  });

  it("marks the checkbox checked and the card aria-checked when selected", () => {
    renderCard({ isSelected: true });

    const card = screen.getByTestId(`analysis-type-${UploadWorkflows.MNGS}`);
    expect(card.getAttribute("aria-checked")).toBe("true");
    expect(
      screen.getByTestId("input-checkbox").getAttribute("data-stage"),
    ).toBe("checked");
  });
});

describe("AnalysisType -- click handling", () => {
  it("calls onClick when the card is enabled", () => {
    const onClick = jest.fn();
    renderCard({ onClick });

    fireEvent.click(
      screen.getByTestId(`analysis-type-${UploadWorkflows.MNGS}`),
    );
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("swallows the click when the card is disabled", () => {
    const onClick = jest.fn();
    renderCard({ onClick, isDisabled: true });

    fireEvent.click(
      screen.getByTestId(`analysis-type-${UploadWorkflows.MNGS}`),
    );
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("AnalysisType -- disabled tooltip and checkbox", () => {
  it("disables the hover listener and enables the checkbox while selectable", () => {
    renderCard({ isDisabled: false });

    expect(
      screen.getByTestId("disabled-tooltip").getAttribute("data-disable-hover"),
    ).toBe("true");
    expect(
      screen.getByTestId("input-checkbox").getAttribute("data-disabled"),
    ).toBe("false");
  });

  it("enables the hover listener and explains why the card is disabled", () => {
    renderCard({ isDisabled: true });

    const tooltip = screen.getByTestId("disabled-tooltip");
    expect(tooltip.getAttribute("data-disable-hover")).toBe("false");
    expect(tooltip.getAttribute("data-title")).toContain(
      "cannot be run with the current selection",
    );
    expect(
      screen.getByTestId("input-checkbox").getAttribute("data-disabled"),
    ).toBe("true");
  });
});

describe("AnalysisType -- icon selection", () => {
  it("generates an SDS icon from sdsIcon when no custom icon is given", () => {
    renderCard({ sdsIcon: "bacteria" });

    const icon = screen.getByTestId("sds-icon");
    expect(icon.getAttribute("data-icon")).toBe("bacteria");
    expect(icon.getAttribute("data-size")).toBe("xl");
    // isDisabled is false, so `isDisabled && cs.disabledIcon` short-circuits.
    expect(icon.getAttribute("data-classname")).toBe("false");
  });

  it("passes the disabled icon class through when the card is disabled", () => {
    renderCard({ isDisabled: true });

    // The scss module is mocked to {}, so cs.disabledIcon is undefined -- what
    // matters is that the `isDisabled && ...` branch was taken, not `false`.
    expect(screen.getByTestId("sds-icon").getAttribute("data-classname")).toBe(
      "undefined",
    );
  });

  it("renders the custom icon instead of an SDS icon when one is supplied", () => {
    renderCard({ customIcon: <span data-testid="custom-icon">CG</span> });

    expect(screen.getByTestId("custom-icon")).toBeTruthy();
    expect(screen.queryByTestId("sds-icon")).toBeNull();
  });
});

describe("AnalysisType -- sequencing platform options", () => {
  it("hides the platform options while the card is unselected", () => {
    renderCard({
      isSelected: false,
      sequencingPlatformOptions: (
        <div data-testid="platform-options">Illumina</div>
      ),
    });

    expect(screen.queryByTestId("platform-options")).toBeNull();
  });

  it("shows the platform options once the card is selected", () => {
    renderCard({
      isSelected: true,
      sequencingPlatformOptions: (
        <div data-testid="platform-options">Illumina</div>
      ),
    });

    expect(screen.getByTestId("platform-options")).toBeTruthy();
  });

  it("renders nothing extra when a selected card omits platform options", () => {
    renderCard({ isSelected: true });

    expect(screen.queryByTestId("platform-options")).toBeNull();
    expect(screen.getByText("Metagenomics")).toBeTruthy();
  });
});
