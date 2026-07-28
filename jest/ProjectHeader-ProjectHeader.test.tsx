// Coverage: app/assets/src/components/views/DiscoveryView/components/ProjectHeader/ProjectHeader.tsx
//
// ProjectHeader renders the project title bar and owns a handful of callbacks:
// renaming (validate -> save -> notify, plus the no-op and error branches),
// adding a user (dedupe by email), publishing, and a special-character warning.
// The dropdown children (EditableInput, ProjectSettingsModal, ProjectUploadMenu)
// are stubbed so the assertions land on the branch/notify logic in this file.
const mockValidateProjectName = jest.fn();
const mockSaveProjectName = jest.fn();

jest.mock("~/api", () => ({
  validateProjectName: (...args: unknown[]) => mockValidateProjectName(...args),
  saveProjectName: (...args: unknown[]) => mockSaveProjectName(...args),
}));

let lastEditableInputProps: $TSFixMe = null;
jest.mock("~/components/ui/controls/EditableInput", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: (props: $TSFixMe) => {
      lastEditableInputProps = props;
      return ReactLib.createElement("div", {
        "data-testid": "editable-input",
        "data-value": String(props.value),
      });
    },
  };
});

let lastSettingsModalProps: $TSFixMe = null;
jest.mock(
  "~/components/views/DiscoveryView/components/ProjectHeader/components/ProjectSettingsModal",
  () => {
    const ReactLib = require("react");
    return {
      __esModule: true,
      default: (props: $TSFixMe) => {
        lastSettingsModalProps = props;
        return ReactLib.createElement("div", {
          "data-testid": "settings-modal",
        });
      },
    };
  },
);

jest.mock(
  "~/components/views/DiscoveryView/components/ProjectHeader/components/ProjectUploadMenu/ProjectUploadMenu",
  () => {
    const ReactLib = require("react");
    return {
      __esModule: true,
      default: () =>
        ReactLib.createElement("div", { "data-testid": "upload-menu" }),
    };
  },
);

jest.mock("~/components/common/ProjectInfoIconTooltip", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: (props: $TSFixMe) =>
      ReactLib.createElement("div", {
        "data-testid": "info-tooltip",
        "data-ispublic": String(props.isPublic),
      }),
  };
});

import { render, screen } from "@testing-library/react";
import React from "react";
import { ProjectHeader } from "~/components/views/DiscoveryView/components/ProjectHeader/ProjectHeader";

const _React: typeof React = React;

beforeEach(() => {
  jest.clearAllMocks();
  lastEditableInputProps = null;
  lastSettingsModalProps = null;
  // ProjectHeader reads document.getElementsByName("csrf-token")[0].content
  // whenever the project is editable.
  const meta = document.createElement("meta");
  meta.setAttribute("name", "csrf-token");
  (meta as $TSFixMe).content = "test-csrf";
  document.head.appendChild(meta);
});

afterEach(() => {
  document
    .getElementsByName("csrf-token")
    .forEach(node => node.parentNode?.removeChild(node));
});

const baseProject = (overrides: $TSFixMe = {}) => ({
  id: 7,
  name: "My Project",
  editable: false,
  public_access: 0,
  users: [],
  ...overrides,
});

describe("ProjectHeader render branches", () => {
  it("renders a private, non-editable project as plain text", () => {
    render(<ProjectHeader project={baseProject()} />);
    expect(screen.getByText("My Project")).toBeTruthy();
    expect(screen.getByText("Private project")).toBeTruthy();
    expect(screen.queryByTestId("editable-input")).toBeNull();
  });

  it("renders the public-project label when public_access is set", () => {
    render(<ProjectHeader project={baseProject({ public_access: 1 })} />);
    expect(screen.getByText("Public project")).toBeTruthy();
  });

  it("renders the view-only label and snapshot name for snapshots", () => {
    render(
      <ProjectHeader
        project={baseProject({ name: "" })}
        snapshotProjectName="Snapshot Name"
      />,
    );
    expect(screen.getByText("View-only version")).toBeTruthy();
    expect(screen.getByText("Snapshot Name")).toBeTruthy();
  });

  it("shows editable controls and singular member count", () => {
    render(
      <ProjectHeader
        project={baseProject({
          editable: true,
          public_access: 1,
          users: [{ name: "A", email: "a@b.com" }],
        })}
      />,
    );
    expect(screen.getByTestId("editable-input")).toBeTruthy();
    expect(screen.getByTestId("settings-modal")).toBeTruthy();
    expect(screen.getByTestId("upload-menu")).toBeTruthy();
    expect(screen.getByText("1 member")).toBeTruthy();
    expect(
      screen.getByTestId("info-tooltip").getAttribute("data-ispublic"),
    ).toBe("true");
  });

  it("pluralizes the member count and shows the no-members branch", () => {
    const { rerender } = render(
      <ProjectHeader
        project={baseProject({
          editable: true,
          users: [
            { name: "A", email: "a@b.com" },
            { name: "B", email: "b@b.com" },
          ],
        })}
      />,
    );
    expect(screen.getByText("2 members")).toBeTruthy();

    rerender(
      <ProjectHeader project={baseProject({ editable: true, users: [] })} />,
    );
    expect(screen.getByText("No members")).toBeTruthy();
  });
});

describe("ProjectHeader callbacks", () => {
  it("getWarningMessage flags special characters only", () => {
    render(<ProjectHeader project={baseProject({ editable: true })} />);
    const getWarningMessage = lastEditableInputProps.getWarningMessage;
    expect(getWarningMessage("clean name")).toBe("");
    expect(getWarningMessage("bad!name")).toContain("special character");
  });

  it("handleProjectRename short-circuits when the name is unchanged", async () => {
    render(<ProjectHeader project={baseProject({ editable: true })} />);
    const result = await lastEditableInputProps.onDoneEditing("My Project");
    expect(result).toEqual(["", "My Project"]);
    expect(mockValidateProjectName).not.toHaveBeenCalled();
  });

  it("handleProjectRename returns the validation message when invalid", async () => {
    mockValidateProjectName.mockResolvedValue({
      valid: false,
      sanitizedName: "New",
      message: "bad name",
    });
    render(<ProjectHeader project={baseProject({ editable: true })} />);
    const result = await lastEditableInputProps.onDoneEditing("New Name");
    expect(result).toEqual(["bad name", "New Name"]);
    expect(mockSaveProjectName).not.toHaveBeenCalled();
  });

  it("handleProjectRename saves and notifies on success", async () => {
    mockValidateProjectName.mockResolvedValue({
      valid: true,
      sanitizedName: "New-Name",
      message: "",
    });
    mockSaveProjectName.mockResolvedValue(undefined);
    const onMetadataUpdated = jest.fn();
    render(
      <ProjectHeader
        project={baseProject({ editable: true })}
        onMetadataUpdated={onMetadataUpdated}
      />,
    );
    const result = await lastEditableInputProps.onDoneEditing("New Name");
    expect(mockSaveProjectName).toHaveBeenCalledWith(7, "New-Name");
    expect(onMetadataUpdated).toHaveBeenCalled();
    expect(result).toEqual(["", "New-Name"]);
  });

  it("handleProjectRename returns an error message when the save throws", async () => {
    mockValidateProjectName.mockResolvedValue({
      valid: true,
      sanitizedName: "New-Name",
      message: "",
    });
    mockSaveProjectName.mockRejectedValue(new Error("boom"));
    render(
      <ProjectHeader
        project={baseProject({ editable: true })}
        onMetadataUpdated={jest.fn()}
      />,
    );
    const result = await lastEditableInputProps.onDoneEditing("New Name");
    expect(result).toEqual([
      "There was an error renaming your project.",
      "New-Name",
    ]);
  });

  it("handleProjectUserAdded appends only unseen emails", () => {
    const onProjectUpdated = jest.fn();
    render(
      <ProjectHeader
        project={baseProject({
          editable: true,
          users: [{ name: "A", email: "a@b.com" }],
        })}
        onProjectUpdated={onProjectUpdated}
      />,
    );
    // New email is added.
    lastSettingsModalProps.onUserAdded("Bob", "bob@b.com");
    expect(onProjectUpdated).toHaveBeenCalledTimes(1);
    const updated = onProjectUpdated.mock.calls[0][0].project;
    expect(updated.users).toHaveLength(2);

    // Existing email is ignored (no additional call).
    lastSettingsModalProps.onUserAdded("A again", "a@b.com");
    expect(onProjectUpdated).toHaveBeenCalledTimes(1);
  });

  it("handleProjectPublished flips public_access and notifies", () => {
    const onProjectUpdated = jest.fn();
    render(
      <ProjectHeader
        project={baseProject({ editable: true })}
        onProjectUpdated={onProjectUpdated}
      />,
    );
    lastSettingsModalProps.onProjectPublished();
    expect(onProjectUpdated).toHaveBeenCalledWith({
      project: expect.objectContaining({ public_access: 1 }),
    });
  });
});
