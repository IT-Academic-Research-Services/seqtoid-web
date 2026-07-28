// Coverage: app/assets/src/components/views/SamplesHeatmapView/components/
//   SamplesHeatmapHeader/SamplesHeatmapHeader.tsx
//
// SamplesHeatmapHeader renders the heatmap toolbar: a filter-panel toggle, an
// editable title (only when a heatmapId is present), a legend, and the
// share/save/download controls. It also owns two helpers - handleHeatmapRename
// (which special-cases the literal "heatmap", sanitizes input, and calls the
// visualization API) and getWarningMessage (special-character warning). The
// "New Presets" button only appears with the feature flag AND non-empty
// presets. The SDS/semantic/layout primitives and children are stubbed so the
// assertions target this file's branch logic; the rename API is mocked.
import { fireEvent, render, screen } from "@testing-library/react";

const mockUpdateHeatmapName = jest.fn();
jest.mock("~/api/visualization", () => ({
  updateHeatmapName: (...args: $TSFixMe[]) => mockUpdateHeatmapName(...args),
}));

jest.mock("~/helpers/strings", () => ({
  replaceSpecialCharacters: (s: string) => s.replace(/[^a-zA-Z0-9 ]/g, "-"),
  testForSpecialCharacters: (s: string) => /[^a-zA-Z0-9 ]/.test(s),
}));

let lastEditableProps: $TSFixMe = null;
jest.mock("~/components/ui/controls/EditableInput", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: (props: $TSFixMe) => {
      lastEditableProps = props;
      return ReactLib.createElement("div", {
        "data-testid": "editable-input",
        "data-value": props.value,
      });
    },
  };
});

jest.mock("@czi-sds/components", () => {
  const ReactLib = require("react");
  return {
    ButtonIcon: (props: $TSFixMe) =>
      ReactLib.createElement("button", {
        "data-testid": "filter-toggle",
        "data-on": String(!!props.on),
        onClick: props.onClick,
      }),
    Icon: () => null,
  };
});

jest.mock("semantic-ui-react", () => {
  const ReactLib = require("react");
  return {
    Popup: (props: $TSFixMe) =>
      ReactLib.createElement(
        "div",
        { "data-testid": "popup", "data-content": props.content },
        props.trigger,
      ),
  };
});

jest.mock("~/components/common/BasicPopup", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: (props: $TSFixMe) =>
      ReactLib.createElement(
        "div",
        { "data-testid": "basic-popup" },
        props.trigger,
      ),
  };
});

jest.mock("~/components/layout", () => {
  const ReactLib = require("react");
  const ViewHeader = (props: $TSFixMe) =>
    ReactLib.createElement(
      "div",
      { "data-testid": "view-header" },
      props.children,
    );
  ViewHeader.Content = (props: $TSFixMe) =>
    ReactLib.createElement("div", null, props.children);
  ViewHeader.Controls = (props: $TSFixMe) =>
    ReactLib.createElement("div", null, props.children);
  ViewHeader.Pretitle = (props: $TSFixMe) =>
    ReactLib.createElement("div", null, props.children);
  ViewHeader.Title = (props: $TSFixMe) =>
    ReactLib.createElement("div", { "data-testid": "view-title" }, props.label);
  return { ViewHeader };
});

jest.mock("~/components/ui/containers/ColumnHeaderTooltip", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: (props: $TSFixMe) =>
      ReactLib.createElement(
        "div",
        { "data-testid": "new-presets" },
        props.trigger,
      ),
  };
});

jest.mock("~ui/controls/buttons", () => {
  const ReactLib = require("react");
  return {
    DownloadButton: (props: $TSFixMe) =>
      ReactLib.createElement("button", {
        "data-testid": "download-btn",
        disabled: props.disabled,
        onClick: props.onClick,
      }),
    PrimaryButton: (props: $TSFixMe) =>
      ReactLib.createElement("button", {
        "data-testid": "primary-btn",
        onClick: props.onClick,
      }),
    SaveButton: (props: $TSFixMe) =>
      ReactLib.createElement("button", {
        "data-testid": "save-btn",
        onClick: props.onClick,
      }),
    ShareButton: (props: $TSFixMe) =>
      ReactLib.createElement("button", {
        "data-testid": "share-btn",
        "data-primary": String(!!props.primary),
        onClick: props.onClick,
      }),
  };
});

jest.mock(
  "~/components/views/SamplesHeatmapView/components/SamplesHeatmapLegend",
  () => {
    const ReactLib = require("react");
    return {
      __esModule: true,
      default: () => ReactLib.createElement("div", { "data-testid": "legend" }),
    };
  },
);

import { UserContext } from "~/components/common/UserContext";
import { SamplesHeatmapHeader } from "~/components/views/SamplesHeatmapView/components/SamplesHeatmapHeader/SamplesHeatmapHeader";

function renderComp(overrides: $TSFixMe = {}, allowedFeatures: string[] = []) {
  const handlers = {
    onDownloadClick: jest.fn(),
    onNewPresetsClick: jest.fn(),
    onShareClick: jest.fn(),
    onSaveClick: jest.fn(),
    onFilterToggleClick: jest.fn(),
  };
  const props = {
    sampleIds: [1, 2, 3],
    loading: false,
    heatmapId: undefined,
    heatmapName: undefined,
    presets: [],
    filterPanelOpen: false,
    data: {},
    selectedOptions: {},
    options: {},
    ...handlers,
    ...overrides,
  };
  const utils = render(
    <UserContext.Provider value={{ allowedFeatures } as $TSFixMe}>
      <SamplesHeatmapHeader {...props} />
    </UserContext.Provider>,
  );
  return { ...handlers, ...utils };
}

describe("SamplesHeatmapHeader", () => {
  beforeEach(() => {
    mockUpdateHeatmapName.mockReset();
    mockUpdateHeatmapName.mockResolvedValue(undefined);
    lastEditableProps = null;
  });

  it("shows the sample count in the pretitle", () => {
    renderComp({ sampleIds: [10, 20] });
    expect(screen.getByText(/Comparing/).textContent).toContain("2");
  });

  it("renders a static Heatmap title when no heatmapId is present", () => {
    renderComp({ heatmapId: undefined });
    expect(screen.queryByTestId("editable-input")).toBeNull();
    expect(screen.getByTestId("view-title").textContent).toContain("Heatmap");
  });

  it("renders an editable title when a heatmapId is present", () => {
    renderComp({ heatmapId: 42, heatmapName: "My Map" });
    const editable = screen.getByTestId("editable-input");
    expect(editable.getAttribute("data-value")).toBe("My Map");
  });

  it("falls back to 'Heatmap' as the editable default when no name given", () => {
    renderComp({ heatmapId: 42, heatmapName: undefined });
    expect(
      screen.getByTestId("editable-input").getAttribute("data-value"),
    ).toBe("Heatmap");
  });

  it("fires the filter toggle handler and reflects the open state", () => {
    const { onFilterToggleClick } = renderComp({ filterPanelOpen: true });
    const toggle = screen.getByTestId("filter-toggle");
    expect(toggle.getAttribute("data-on")).toBe("true");
    fireEvent.click(toggle);
    expect(onFilterToggleClick).toHaveBeenCalled();
  });

  it("labels the popup 'Open Controls' when the panel is closed", () => {
    renderComp({ filterPanelOpen: false });
    expect(screen.getByTestId("popup").getAttribute("data-content")).toBe(
      "Open Controls",
    );
  });

  it("fires share, save and download handlers", () => {
    const { onShareClick, onSaveClick, onDownloadClick } = renderComp();
    fireEvent.click(screen.getByTestId("share-btn"));
    fireEvent.click(screen.getByTestId("save-btn"));
    fireEvent.click(screen.getByTestId("download-btn"));
    expect(onShareClick).toHaveBeenCalled();
    expect(onSaveClick).toHaveBeenCalled();
    expect(onDownloadClick).toHaveBeenCalled();
  });

  it("hides the New Presets button without the feature flag", () => {
    renderComp({ presets: [{ id: 1 }] }, []);
    expect(screen.queryByTestId("new-presets")).toBeNull();
  });

  it("hides the New Presets button when presets are empty even with the flag", () => {
    renderComp({ presets: [] }, ["taxon_heatmap_presets"]);
    expect(screen.queryByTestId("new-presets")).toBeNull();
  });

  it("shows the New Presets button with the flag and non-empty presets", () => {
    const { onNewPresetsClick } = renderComp({ presets: [{ id: 1 }] }, [
      "taxon_heatmap_presets",
    ]);
    const presetsBtn = screen.getByTestId("new-presets");
    expect(presetsBtn).toBeTruthy();
    fireEvent.click(screen.getByTestId("primary-btn"));
    expect(onNewPresetsClick).toHaveBeenCalled();
    // Share button is non-primary when New Presets is shown
    expect(screen.getByTestId("share-btn").getAttribute("data-primary")).toBe(
      "false",
    );
  });

  it("makes the Share button primary when New Presets is hidden", () => {
    renderComp({ presets: [] }, []);
    expect(screen.getByTestId("share-btn").getAttribute("data-primary")).toBe(
      "true",
    );
  });

  it("renames the heatmap through the API and sanitizes special characters", async () => {
    renderComp({ heatmapId: 7 });
    const result = await lastEditableProps.onDoneEditing("Cool*Name");
    expect(mockUpdateHeatmapName).toHaveBeenCalledWith(7, "Cool-Name");
    expect(result).toEqual(["", "Cool-Name"]);
  });

  it("returns an empty string without calling the API for the literal 'heatmap'", async () => {
    renderComp({ heatmapId: 7 });
    const result = await lastEditableProps.onDoneEditing("heatmap");
    expect(result).toBe("");
    expect(mockUpdateHeatmapName).not.toHaveBeenCalled();
  });

  it("surfaces an error message when the rename API rejects", async () => {
    mockUpdateHeatmapName.mockRejectedValueOnce(new Error("boom"));
    renderComp({ heatmapId: 7 });
    const result = await lastEditableProps.onDoneEditing("NewName");
    expect(result[0]).toBe("There was an error renaming your heatmap");
  });

  it("warns about special characters via getWarningMessage", () => {
    renderComp({ heatmapId: 7 });
    expect(lastEditableProps.getWarningMessage("has*star")).toContain(
      "special character",
    );
    expect(lastEditableProps.getWarningMessage("cleanname")).toBe("");
  });

  it("disables the download button while loading", () => {
    renderComp({ loading: true });
    expect(
      (screen.getByTestId("download-btn") as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
