// Coverage: app/assets/src/components/views/SampleView/components/AmrView/
//   components/AmrSampleReport/columnDefinitions/components/GeneCell/GeneCell.tsx
//
// GeneCell renders the gene name button plus a download dropdown trigger. The
// name button forwards clicks to setDetailsSidebarGeneName. The download
// ButtonIcon is disabled (and tooltip-explained) for pipeline versions before
// v1.1, and toggles an anchored DropdownMenu open/closed on click. Escape and
// click-away both close the menu. The SDS primitives, the pipeline-version
// check, and the RenderedGeneLevelDownloadOption child are stubbed so the
// assertions target GeneCell's own open/close + delegation logic, including the
// renderOption factory it hands to the menu.
import { act, fireEvent, render, screen } from "@testing-library/react";

// This scss is imported through a "~/" alias, which the moduleNameMapper
// resolves before the css/scss style-mock rule, so it must be stubbed here.
jest.mock(
  "~/components/views/SampleView/components/AmrView/components/AmrSampleReport/components/StyledTableRow/styled_table_row.scss",
  () => ({}),
  { virtual: true },
);

const mockIsAmrGeneLevelDownloadAvailable = jest.fn();
jest.mock("~/components/utils/pipeline_versions", () => ({
  isAmrGeneLevelDownloadAvailable: (v: $TSFixMe) =>
    mockIsAmrGeneLevelDownloadAvailable(v),
}));

let lastMenuProps: $TSFixMe = null;
jest.mock("@czi-sds/components", () => {
  const ReactLib = require("react");
  return {
    Button: (props: $TSFixMe) =>
      ReactLib.createElement(
        "button",
        { "data-testid": "gene-name-button", onClick: props.onClick },
        props.children,
      ),
    ButtonIcon: (props: $TSFixMe) =>
      ReactLib.createElement("button", {
        "data-testid": "download-icon",
        "data-disabled": String(!!props.disabled),
        disabled: props.disabled,
        onClick: props.onClick,
      }),
    Tooltip: (props: $TSFixMe) =>
      ReactLib.createElement(
        "span",
        { "data-testid": "tooltip", "data-title": props.title },
        props.children,
      ),
    DropdownMenu: (props: $TSFixMe) => {
      lastMenuProps = props;
      return props.open
        ? ReactLib.createElement(
            "div",
            { "data-testid": "dropdown-menu" },
            // exercise the renderOption factory that GeneCell passes down
            props.renderOption(null, props.options[0]),
          )
        : null;
    },
  };
});

let lastRenderedOptionProps: $TSFixMe = null;
jest.mock(
  "~/components/views/SampleView/components/AmrView/components/AmrSampleReport/columnDefinitions/components/GeneCell/components/RenderedGeneLevelDownloadOption",
  () => ({
    geneLevelDownloadOptions: [{ name: "Contigs (.fasta)" }],
    RenderedGeneLevelDownloadOption: (props: $TSFixMe) => {
      lastRenderedOptionProps = props;
      const ReactLib = require("react");
      return ReactLib.createElement(
        "div",
        { "data-testid": "rendered-option" },
        props.geneName,
      );
    },
  }),
);

import { GeneCell } from "~/components/views/SampleView/components/AmrView/components/AmrSampleReport/columnDefinitions/components/GeneCell/GeneCell";

const baseProps = {
  aroAccession: "ARO:1",
  contigs: "3",
  geneName: "aadA",
  setDetailsSidebarGeneName: jest.fn(),
  geneId: "gene-1",
  reads: "9",
  workflowRunId: "wf-1",
  workflowWdlVersion: "1.3.0",
};

const renderCell = (overrides: $TSFixMe = {}) => {
  const setDetailsSidebarGeneName = jest.fn();
  const utils = render(
    <GeneCell
      {...baseProps}
      setDetailsSidebarGeneName={setDetailsSidebarGeneName}
      {...overrides}
    />,
  );
  return { setDetailsSidebarGeneName, ...utils };
};

beforeEach(() => {
  jest.clearAllMocks();
  lastMenuProps = null;
  lastRenderedOptionProps = null;
  mockIsAmrGeneLevelDownloadAvailable.mockReturnValue(true);
});

describe("GeneCell", () => {
  it("renders the gene name", () => {
    renderCell();
    expect(screen.getByTestId("gene-name-button").textContent).toContain(
      "aadA",
    );
  });

  it("forwards a gene-name click to setDetailsSidebarGeneName", () => {
    const { setDetailsSidebarGeneName } = renderCell();
    fireEvent.click(screen.getByTestId("gene-name-button"));
    expect(setDetailsSidebarGeneName).toHaveBeenCalledWith("aadA");
  });

  it("enables the download icon with an empty tooltip when downloads are available", () => {
    renderCell();
    expect(screen.getByTestId("download-icon").dataset.disabled).toBe("false");
    // the download tooltip (last tooltip rendered) has no explanatory title
    const tooltips = screen.getAllByTestId("tooltip");
    expect(tooltips[tooltips.length - 1].dataset.title).toBe("");
  });

  it("disables the download icon with a version tooltip for old pipelines", () => {
    mockIsAmrGeneLevelDownloadAvailable.mockReturnValue(false);
    renderCell({ workflowWdlVersion: "1.0.0" });
    expect(screen.getByTestId("download-icon").dataset.disabled).toBe("true");
    const tooltips = screen.getAllByTestId("tooltip");
    expect(tooltips[tooltips.length - 1].dataset.title).toBe(
      "Downloads are not available for pipeline runs before v1.1",
    );
  });

  it("opens the dropdown menu on download-icon click and closes it on a second click", () => {
    renderCell();
    expect(screen.queryByTestId("dropdown-menu")).toBeNull();

    fireEvent.click(screen.getByTestId("download-icon"));
    expect(screen.getByTestId("dropdown-menu")).toBeTruthy();

    fireEvent.click(screen.getByTestId("download-icon"));
    expect(screen.queryByTestId("dropdown-menu")).toBeNull();
  });

  it("passes the gene identity through the renderOption factory to the child", () => {
    renderCell();
    fireEvent.click(screen.getByTestId("download-icon"));
    expect(screen.getByTestId("rendered-option").textContent).toContain("aadA");
    expect(lastRenderedOptionProps.aroAccession).toBe("ARO:1");
    expect(lastRenderedOptionProps.geneId).toBe("gene-1");
    expect(lastRenderedOptionProps.workflowRunId).toBe("wf-1");
  });

  it("closes the menu on click-away", () => {
    renderCell();
    fireEvent.click(screen.getByTestId("download-icon"));
    expect(screen.getByTestId("dropdown-menu")).toBeTruthy();

    act(() => lastMenuProps.onClickAway());
    expect(screen.queryByTestId("dropdown-menu")).toBeNull();
  });

  it("closes the menu when Escape is pressed and ignores other keys", () => {
    renderCell();
    fireEvent.click(screen.getByTestId("download-icon"));
    expect(screen.getByTestId("dropdown-menu")).toBeTruthy();

    // a non-Escape key leaves the menu open
    act(() => lastMenuProps.onKeyDown({ key: "Enter" }));
    expect(screen.getByTestId("dropdown-menu")).toBeTruthy();

    // Escape closes the menu
    act(() => lastMenuProps.onKeyDown({ key: "Escape" }));
    expect(screen.queryByTestId("dropdown-menu")).toBeNull();
  });
});
