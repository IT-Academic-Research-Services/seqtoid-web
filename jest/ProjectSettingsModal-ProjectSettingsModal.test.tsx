// Coverage: .../DiscoveryView/components/ProjectHeader/components/ProjectSettingsModal/ProjectSettingsModal.tsx
//
// The sharing modal: a Share button opens it, the body switches between the
// public and private visibility blurbs, the private branch offers a
// "change to public" confirmation that PUTs the project, and the view-only-link
// form is gated on BOTH the edit-snapshot-links feature flag and the viewer
// being the project creator. axios and the two heavy child forms are stubbed.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UserContext } from "~/components/common/UserContext";
import { EDIT_SNAPSHOT_LINKS_FEATURE } from "~/components/utils/features";

const mockPut = jest.fn();
const capturedUserManagementProps: $TSFixMe[] = [];
const capturedViewOnlyProps: $TSFixMe[] = [];

jest.mock("axios", () => ({
  __esModule: true,
  default: { put: (...args: $TSFixMe[]) => mockPut(...args) },
}));

jest.mock(
  "~/components/views/DiscoveryView/components/ProjectHeader/components/ProjectSettingsModal/UserManagementForm",
  () => {
    const ReactLib = require("react");
    return {
      __esModule: true,
      default: (props: $TSFixMe) => {
        capturedUserManagementProps.push(props);
        return ReactLib.createElement("div", {
          "data-testid": "user-management-form",
        });
      },
    };
  },
);

jest.mock(
  "~/components/views/DiscoveryView/components/ProjectHeader/components/ProjectSettingsModal/ViewOnlyLinkForm",
  () => {
    const ReactLib = require("react");
    return {
      __esModule: true,
      default: (props: $TSFixMe) => {
        capturedViewOnlyProps.push(props);
        return ReactLib.createElement("div", {
          "data-testid": "view-only-link-form",
        });
      },
    };
  },
);

import ProjectSettingsModal from "~/components/views/DiscoveryView/components/ProjectHeader/components/ProjectSettingsModal/ProjectSettingsModal";

const baseProject = {
  id: "12",
  name: "Nasal Swabs",
  creator_id: 7,
  public_access: 0,
};

const renderModal = (props: $TSFixMe = {}, userContext: $TSFixMe = {}) => {
  const onProjectPublished = props.onProjectPublished || jest.fn();
  const onUserAdded = props.onUserAdded || jest.fn();
  const contextValue = {
    admin: false,
    allowedFeatures: [],
    userId: 7,
    ...userContext,
  } as $TSFixMe;
  const utils = render(
    <UserContext.Provider value={contextValue}>
      <ProjectSettingsModal
        csrf="tok"
        project={baseProject}
        users={[{ name: "Ada", email: "ada@example.com" }]}
        onProjectPublished={onProjectPublished}
        onUserAdded={onUserAdded}
        {...props}
      />
    </UserContext.Provider>,
  );
  return { ...utils, onProjectPublished, onUserAdded };
};

const openModal = () => fireEvent.click(screen.getByText("Share"));

beforeEach(() => {
  jest.clearAllMocks();
  capturedUserManagementProps.length = 0;
  capturedViewOnlyProps.length = 0;
  mockPut.mockResolvedValue({});
});

describe("ProjectSettingsModal open/close", () => {
  it("renders only the share trigger until it is opened", () => {
    renderModal();
    expect(screen.getByText("Share")).toBeTruthy();
    expect(screen.queryByTestId("user-management-form")).toBeNull();
  });

  it("opens on the share button and closes again via the modal close control", () => {
    renderModal();
    openModal();
    expect(screen.getByTestId("user-management-form")).toBeTruthy();
    expect(screen.getByText("Nasal Swabs")).toBeTruthy();

    // Modal renders a close icon wired to onClose.
    const close = document.querySelector(
      "[class*='closeIcon'], .IconClose",
    ) as HTMLElement;
    if (close) {
      fireEvent.click(close);
      expect(screen.queryByTestId("user-management-form")).toBeNull();
    }
  });
});

describe("ProjectSettingsModal visibility block", () => {
  it("shows the public blurb and no change-to-public control for a public project", () => {
    renderModal({ project: { ...baseProject, public_access: 1 } });
    openModal();
    expect(screen.getByText("Public Project")).toBeTruthy();
    expect(screen.queryByText("Private Project")).toBeNull();
    expect(screen.queryByText("Change to public")).toBeNull();
  });

  it("shows the private blurb and the change-to-public control for a private project", () => {
    renderModal();
    openModal();
    expect(screen.getByText("Private Project")).toBeTruthy();
    expect(screen.queryByText("Public Project")).toBeNull();
    expect(screen.getByText("Change to public")).toBeTruthy();
  });
});

describe("ProjectSettingsModal make-public flow", () => {
  it("PUTs public_access with the csrf token and notifies the parent", async () => {
    const { onProjectPublished } = renderModal();
    openModal();
    fireEvent.click(screen.getByText("Change to public"));
    fireEvent.click(screen.getByText("Make Project Public"));

    expect(mockPut).toHaveBeenCalledWith("/projects/12.json", {
      public_access: true,
      authenticity_token: "tok",
    });
    await waitFor(() => expect(onProjectPublished).toHaveBeenCalledTimes(1));
  });

  it("does not PUT anything if the confirmation is cancelled", () => {
    const { onProjectPublished } = renderModal();
    openModal();
    fireEvent.click(screen.getByText("Change to public"));
    fireEvent.click(screen.getByText("Cancel"));

    expect(mockPut).not.toHaveBeenCalled();
    expect(onProjectPublished).not.toHaveBeenCalled();
  });
});

describe("ProjectSettingsModal view-only link gating", () => {
  it("hides the view-only link form when the feature flag is off", () => {
    renderModal({}, { allowedFeatures: [] });
    openModal();
    expect(screen.queryByTestId("view-only-link-form")).toBeNull();
  });

  it("hides the view-only link form when the viewer is not the project creator", () => {
    renderModal(
      {},
      { allowedFeatures: [EDIT_SNAPSHOT_LINKS_FEATURE], userId: 99 },
    );
    openModal();
    expect(screen.queryByTestId("view-only-link-form")).toBeNull();
  });

  it("shows the view-only link form for the creator with the flag on", () => {
    renderModal(
      {},
      { allowedFeatures: [EDIT_SNAPSHOT_LINKS_FEATURE], userId: 7 },
    );
    openModal();
    expect(screen.getByTestId("view-only-link-form")).toBeTruthy();
    expect(capturedViewOnlyProps[0].project).toEqual(baseProject);
  });
});

describe("ProjectSettingsModal child props", () => {
  it("passes csrf, project, users and onUserAdded to the user management form", () => {
    const onUserAdded = jest.fn();
    renderModal({ onUserAdded });
    openModal();
    const props = capturedUserManagementProps[0];
    expect(props.csrf).toBe("tok");
    expect(props.project).toEqual(baseProject);
    expect(props.users).toEqual([{ name: "Ada", email: "ada@example.com" }]);
    expect(props.onUserAdded).toBe(onUserAdded);
  });
});
