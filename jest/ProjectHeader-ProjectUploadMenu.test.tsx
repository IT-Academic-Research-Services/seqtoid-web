// Coverage: app/assets/src/components/views/DiscoveryView/components/
//   ProjectHeader/components/ProjectUploadMenu/ProjectUploadMenu.tsx
//
// The menu owns two behaviours: the "Upload Samples" item navigates to the
// project-scoped upload page, and the "Edit Metadata" item toggles a piece of
// local state that mounts/unmounts MetadataUploadModal. Both arms of that
// modalOpen conditional are exercised (closed on mount, open after click,
// closed again after the modal's onClose), plus the onComplete wiring.
import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("~ui/controls/dropdowns/BareDropdown", () => {
  const ReactLib = require("react");
  const Item = (props: $TSFixMe) =>
    ReactLib.createElement(
      "button",
      { type: "button", onClick: props.onClick },
      props.text,
    );
  const BareDropdown = (props: $TSFixMe) =>
    ReactLib.createElement(
      "div",
      {
        "data-testid": "bare-dropdown",
        "data-direction": props.direction,
        "data-hide-arrow": String(!!props.hideArrow),
      },
      props.trigger,
      props.items,
    );
  BareDropdown.Item = Item;
  return { __esModule: true, default: BareDropdown };
});

let lastModalProps: $TSFixMe = null;
jest.mock(
  "~/components/views/DiscoveryView/components/SamplesView/components/MetadataUploadModal",
  () => ({
    __esModule: true,
    default: (props: $TSFixMe) => {
      lastModalProps = props;
      const ReactLib = require("react");
      return ReactLib.createElement(
        "div",
        {
          "data-testid": "metadata-upload-modal",
          "data-workflow": props.workflow,
          "data-project": props.project && props.project.name,
        },
        ReactLib.createElement(
          "button",
          { type: "button", onClick: props.onClose },
          "close-modal",
        ),
      );
    },
  }),
);

import ProjectUploadMenu from "~/components/views/DiscoveryView/components/ProjectHeader/components/ProjectUploadMenu/ProjectUploadMenu";

const renderMenu = (props: $TSFixMe = {}) =>
  render(
    <ProjectUploadMenu
      project={{ id: "77", name: "My Project" }}
      workflow="short-read-mngs"
      {...props}
    />,
  );

beforeEach(() => {
  lastModalProps = null;
});

describe("ProjectUploadMenu rendering", () => {
  it("renders the Add Data trigger and both dropdown items", () => {
    renderMenu();
    expect(screen.getByText("Add Data")).toBeTruthy();
    expect(screen.getByText("Upload Samples")).toBeTruthy();
    expect(screen.getByText("Edit Metadata")).toBeTruthy();
  });

  it("opens the dropdown to the left without an arrow", () => {
    renderMenu();
    const dropdown = screen.getByTestId("bare-dropdown");
    expect(dropdown.getAttribute("data-direction")).toBe("left");
    expect(dropdown.getAttribute("data-hide-arrow")).toBe("true");
  });

  it("does not mount the metadata modal before Edit Metadata is clicked", () => {
    renderMenu();
    expect(screen.queryByTestId("metadata-upload-modal")).toBeNull();
  });
});

describe("ProjectUploadMenu navigation", () => {
  const originalLocation = window.location;

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
  });

  const stubLocation = () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { href: "" },
    });
  };

  it("navigates to the project-scoped upload page", () => {
    stubLocation();
    renderMenu({ project: { id: "42", name: "P" } });
    fireEvent.click(screen.getByText("Upload Samples"));
    expect(window.location.href).toBe("/samples/upload?projectId=42");
  });

  it("still builds a URL when the project has no id", () => {
    stubLocation();
    renderMenu({ project: {} });
    fireEvent.click(screen.getByText("Upload Samples"));
    expect(window.location.href).toBe("/samples/upload?projectId=undefined");
  });
});

describe("ProjectUploadMenu metadata modal", () => {
  it("mounts the modal with the project and workflow on Edit Metadata", () => {
    renderMenu({
      project: { id: "9", name: "Malaria" },
      workflow: "amr",
    });
    fireEvent.click(screen.getByText("Edit Metadata"));
    const modal = screen.getByTestId("metadata-upload-modal");
    expect(modal.getAttribute("data-workflow")).toBe("amr");
    expect(modal.getAttribute("data-project")).toBe("Malaria");
  });

  it("unmounts the modal when it reports onClose", () => {
    renderMenu();
    fireEvent.click(screen.getByText("Edit Metadata"));
    expect(screen.getByTestId("metadata-upload-modal")).toBeTruthy();
    fireEvent.click(screen.getByText("close-modal"));
    expect(screen.queryByTestId("metadata-upload-modal")).toBeNull();
  });

  it("passes onMetadataUpdated straight through as the modal's onComplete", () => {
    const onMetadataUpdated = jest.fn();
    renderMenu({ onMetadataUpdated });
    fireEvent.click(screen.getByText("Edit Metadata"));
    expect(lastModalProps.onComplete).toBe(onMetadataUpdated);
    lastModalProps.onComplete();
    expect(onMetadataUpdated).toHaveBeenCalledTimes(1);
  });

  it("passes an undefined onComplete when no callback is supplied", () => {
    renderMenu({ onMetadataUpdated: undefined });
    fireEvent.click(screen.getByText("Edit Metadata"));
    expect(lastModalProps.onComplete).toBeUndefined();
  });
});
