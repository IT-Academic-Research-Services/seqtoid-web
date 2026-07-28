// Coverage: app/assets/src/components/views/DiscoveryView/components/SamplesView/
//   components/BulkSamplesActionsMenu/BulkSamplesActionsMenu.tsx
//
// BulkSamplesActionsMenu is the "More Actions" overflow menu. It opens/closes an
// anchored menu, and conditionally wraps the AMR and Retry-Upload items in a
// disabled-explaining tooltip, renders the benchmark item only for admins with
// the feature flag, and wires each item's onClick to close-then-delegate. The
// czi-sds Menu/MenuItem/Tooltip/Icon primitives and the two custom children
// (toolbar button, benchmark item) are stubbed to thin elements so the
// assertions land on this component's own open/close + gating logic.
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { UserContext } from "~/components/common/UserContext";

const _React: typeof React = React;

jest.mock("@czi-sds/components", () => {
  const ReactLib = require("react");
  return {
    Icon: (props: $TSFixMe) =>
      ReactLib.createElement("span", {
        "data-testid": `icon-${props.sdsIcon}`,
      }),
    Menu: (props: $TSFixMe) =>
      props.open
        ? ReactLib.createElement(
            "div",
            { "data-testid": "menu" },
            props.children,
          )
        : null,
    MenuItem: (props: $TSFixMe) =>
      ReactLib.createElement(
        "div",
        {
          role: "menuitem",
          "data-disabled": String(!!props.disabled),
          onClick: props.disabled ? undefined : props.onClick,
        },
        props.children,
      ),
    Tooltip: (props: $TSFixMe) =>
      ReactLib.createElement(
        "div",
        { "data-testid": "tooltip", "data-title": props.title },
        props.children,
      ),
  };
});

let lastToolbarProps: $TSFixMe = null;
jest.mock(
  "~/components/views/DiscoveryView/components/SamplesView/components/ToolbarButtonIcon/ToolbarButtonIcon",
  () => ({
    __esModule: true,
    default: (props: $TSFixMe) => {
      lastToolbarProps = props;
      const ReactLib = require("react");
      return ReactLib.createElement("button", {
        "data-testid": "toolbar-button",
        "data-subtitle": props.popupSubtitle,
        "data-disabled": String(!!props.disabled),
        onClick: props.onClick,
      });
    },
  }),
);

let lastBenchmarkProps: $TSFixMe = null;
jest.mock(
  "~/components/views/DiscoveryView/components/SamplesView/components/BenchmarkSamplesMenuItem",
  () => ({
    __esModule: true,
    BenchmarkSamplesMenuItem: (props: $TSFixMe) => {
      lastBenchmarkProps = props;
      const ReactLib = require("react");
      return ReactLib.createElement("div", {
        "data-testid": "benchmark-item",
        "data-disabled": String(!!props.disabled),
        onClick: props.onClick,
      });
    },
  }),
);

// features constant is a plain string; import indirectly via the real module.
import { BENCHMARKING_FEATURE } from "~/components/utils/features";
import BulkSamplesActionsMenu from "~/components/views/DiscoveryView/components/SamplesView/components/BulkSamplesActionsMenu/BulkSamplesActionsMenu";

const baseProps = () => ({
  noObjectsSelected: false,
  handleBulkKickoffAmr: jest.fn(),
  handleClickBenchmark: jest.fn(),
  handleClickPhyloTree: jest.fn(),
  canRetryUpload: false,
  onRetryUpload: jest.fn(),
});

const renderMenu = (ctx: $TSFixMe, overrides: $TSFixMe = {}) => {
  const props = { ...baseProps(), ...overrides };
  const result = render(
    <UserContext.Provider value={ctx}>
      <BulkSamplesActionsMenu {...props} />
    </UserContext.Provider>,
  );
  return { ...result, props };
};

const openMenu = () => fireEvent.click(screen.getByTestId("toolbar-button"));

beforeEach(() => {
  lastToolbarProps = null;
  lastBenchmarkProps = null;
});

describe("BulkSamplesActionsMenu open/close", () => {
  it("keeps the menu closed until the toolbar button is clicked", () => {
    renderMenu({ admin: false });
    expect(screen.queryByTestId("menu")).toBeNull();
    openMenu();
    expect(screen.getByTestId("menu")).toBeTruthy();
  });

  it("shows the select-at-least-1 subtitle only when nothing is selected", () => {
    const { rerender } = renderMenu(
      { admin: false },
      { noObjectsSelected: true },
    );
    expect(lastToolbarProps.popupSubtitle).toBe("Select at least 1 sample");
    rerender(
      <UserContext.Provider value={{ admin: false }}>
        <BulkSamplesActionsMenu {...baseProps()} noObjectsSelected={false} />
      </UserContext.Provider>,
    );
    expect(lastToolbarProps.popupSubtitle).toBe("");
  });
});

describe("BulkSamplesActionsMenu retry upload item", () => {
  it("wraps retry in a tooltip and disables it when retry is unavailable", () => {
    renderMenu({ admin: false }, { canRetryUpload: false });
    openMenu();
    const tooltips = screen.getAllByTestId("tooltip");
    const retryTip = tooltips.find(t =>
      (t.getAttribute("data-title") || "").includes("upload failed"),
    );
    expect(retryTip).toBeTruthy();
  });

  it("fires onRetryUpload (and closes) when retry is available", () => {
    const onRetryUpload = jest.fn();
    renderMenu({ admin: false }, { canRetryUpload: true, onRetryUpload });
    openMenu();
    expect(screen.getByText("Retry Upload")).toBeTruthy();
    fireEvent.click(screen.getByText("Retry Upload"));
    expect(onRetryUpload).toHaveBeenCalledTimes(1);
    // Clicking a menu item closes the menu.
    expect(screen.queryByTestId("menu")).toBeNull();
  });
});

describe("BulkSamplesActionsMenu AMR + phylo items", () => {
  it("fires phylo tree kickoff and closes the menu", () => {
    const handleClickPhyloTree = jest.fn();
    renderMenu({ admin: false }, { handleClickPhyloTree });
    openMenu();
    fireEvent.click(screen.getByText("Create Phylogenetic Tree"));
    expect(handleClickPhyloTree).toHaveBeenCalledTimes(1);
  });

  it("wraps the AMR item in a tooltip when no objects are selected", () => {
    renderMenu({ admin: false }, { noObjectsSelected: true });
    openMenu();
    const tooltips = screen.getAllByTestId("tooltip");
    const amrTip = tooltips.find(t =>
      (t.getAttribute("data-title") || "").includes("mNGS run"),
    );
    expect(amrTip).toBeTruthy();
  });

  it("fires AMR kickoff when objects are selected", () => {
    const handleBulkKickoffAmr = jest.fn();
    renderMenu(
      { admin: false },
      { noObjectsSelected: false, handleBulkKickoffAmr },
    );
    openMenu();
    fireEvent.click(screen.getByText("Run Antimicrobial Resistance Pipeline"));
    expect(handleBulkKickoffAmr).toHaveBeenCalledTimes(1);
  });
});

describe("BulkSamplesActionsMenu benchmark gating", () => {
  it("hides the benchmark item for a non-admin", () => {
    renderMenu({ admin: false, allowedFeatures: [BENCHMARKING_FEATURE] });
    openMenu();
    expect(screen.queryByTestId("benchmark-item")).toBeNull();
  });

  it("hides the benchmark item for an admin without the feature flag", () => {
    renderMenu({ admin: true, allowedFeatures: [] });
    openMenu();
    expect(screen.queryByTestId("benchmark-item")).toBeNull();
  });

  it("shows the benchmark item and delegates its click for a flagged admin", () => {
    const handleClickBenchmark = jest.fn();
    renderMenu(
      { admin: true, allowedFeatures: [BENCHMARKING_FEATURE] },
      { handleClickBenchmark },
    );
    openMenu();
    const item = screen.getByTestId("benchmark-item");
    expect(item).toBeTruthy();
    fireEvent.click(item);
    expect(handleClickBenchmark).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("menu")).toBeNull();
  });

  it("tolerates a missing UserContext (empty fallback, no benchmark)", () => {
    render(
      <UserContext.Provider value={undefined as $TSFixMe}>
        <BulkSamplesActionsMenu {...baseProps()} />
      </UserContext.Provider>,
    );
    openMenu();
    expect(screen.queryByTestId("benchmark-item")).toBeNull();
  });
});
