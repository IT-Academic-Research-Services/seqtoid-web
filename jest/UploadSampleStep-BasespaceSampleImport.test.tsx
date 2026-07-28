// Frontend coverage: BasespaceSampleImport is the Basespace branch of the
// upload step. It either shows a "connect" button (no access token) or a
// project picker (token present), fetches the user's Basespace projects, then
// fetches the samples for the chosen project and hands them upward with the
// target project id stamped on. Error/warning notifications cover the
// no-projects, no-target-project, API-error and no-valid-samples cases.
//
// The two API calls and the OAuth popup helper are stubbed; the leaf Dropdown /
// PrimaryButton are stubbed so the container's own wiring is what is asserted.
import { fireEvent } from "@testing-library/dom";
import { act, render, screen, waitFor } from "@testing-library/react";
import {
  getBasespaceProjects,
  getSamplesForBasespaceProject,
} from "~/api/basespace";
import { BasespaceSampleImport } from "~/components/views/SampleUploadFlow/components/UploadSampleStep/components/BasespaceSampleImport/BasespaceSampleImport";
import { NO_TARGET_PROJECT_ERROR } from "~/components/views/SampleUploadFlow/constants";
import { openBasespaceOAuthPopup } from "~/components/views/SampleUploadFlow/utils";

jest.mock("~/api/basespace", () => ({
  getBasespaceProjects: jest.fn(),
  getSamplesForBasespaceProject: jest.fn(),
}));

jest.mock("~/components/views/SampleUploadFlow/utils", () => ({
  openBasespaceOAuthPopup: jest.fn(),
}));

jest.mock("~ui/controls/dropdowns/Dropdown", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => (
    <div
      data-testid="project-dropdown"
      data-disabled={String(Boolean(props.disabled))}
      data-placeholder={props.placeholder}
      data-value={String(props.value)}
    >
      {(props.options || []).map((option: $TSFixMe) => (
        <button
          key={option.value}
          data-testid={`project-option-${option.value}`}
          onClick={() => props.onChange(option.value)}
        >
          {option.text}
        </button>
      ))}
    </div>
  ),
}));

jest.mock("~/components/ui/controls/buttons/PrimaryButton", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => (
    <button
      data-testid={props.text}
      disabled={Boolean(props.disabled)}
      onClick={props.onClick}
    >
      {props.text}
    </button>
  ),
}));

const mockedGetProjects = getBasespaceProjects as unknown as jest.Mock;
const mockedGetSamples = getSamplesForBasespaceProject as unknown as jest.Mock;
const mockedOpenPopup = openBasespaceOAuthPopup as unknown as jest.Mock;

const PROJECTS = [
  { id: 11, name: "Project Eleven" },
  { id: 22, name: "Project Twenty Two" },
];

const baseProps = () => ({
  onChange: jest.fn(),
  onAccessTokenChange: jest.fn(),
  onNoProject: jest.fn(),
  basespaceClientId: "client-id",
  basespaceOauthRedirectUri: "https://example.test/redirect",
});

const renderImport = (props: $TSFixMe) =>
  render(<BasespaceSampleImport {...props} />);

describe("BasespaceSampleImport", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetProjects.mockResolvedValue(PROJECTS);
    mockedGetSamples.mockResolvedValue([]);
  });

  it("renders the connect button (and no project picker) without an access token", () => {
    renderImport(baseProps());

    expect(screen.getByText("Connect to Basespace")).toBeTruthy();
    expect(screen.queryByTestId("project-dropdown")).toBeNull();
    expect(mockedGetProjects).not.toHaveBeenCalled();
  });

  it("opens the Basespace OAuth popup with the configured client id and scope", () => {
    const props = baseProps();
    renderImport(props);

    fireEvent.click(screen.getByText("Connect to Basespace"));

    expect(mockedOpenPopup).toHaveBeenCalledWith({
      client_id: "client-id",
      redirect_uri: "https://example.test/redirect",
      scope: "browse+global",
    });
  });

  it("fetches projects on mount when a token is present and preselects the first", async () => {
    renderImport({ ...baseProps(), accessToken: "tok" });

    await waitFor(() =>
      expect(screen.getByTestId("project-option-11")).toBeTruthy(),
    );
    expect(mockedGetProjects).toHaveBeenCalledWith("tok");
    expect(screen.getByTestId("project-option-22").textContent).toBe(
      "Project Twenty Two",
    );
    // First project id is preselected.
    expect(
      screen.getByTestId("project-dropdown").getAttribute("data-value"),
    ).toBe("11");
    expect(
      screen.getByTestId("project-dropdown").getAttribute("data-disabled"),
    ).toBe("false");
  });

  it("selecting a different project updates the dropdown value", async () => {
    renderImport({ ...baseProps(), accessToken: "tok" });
    await waitFor(() =>
      expect(screen.getByTestId("project-option-22")).toBeTruthy(),
    );

    fireEvent.click(screen.getByTestId("project-option-22"));

    expect(
      screen.getByTestId("project-dropdown").getAttribute("data-value"),
    ).toBe("22");
  });

  it("shows an error and disables the picker when the account has no projects", async () => {
    mockedGetProjects.mockResolvedValue([]);
    renderImport({ ...baseProps(), accessToken: "tok" });

    await waitFor(() =>
      expect(
        screen.getByText(
          "No projects found in logged-in Basespace account. Please contact us for help.",
        ),
      ).toBeTruthy(),
    );
    const dropdown = screen.getByTestId("project-dropdown");
    expect(dropdown.getAttribute("data-disabled")).toBe("true");
    expect(dropdown.getAttribute("data-placeholder")).toBe("No projects found");
    expect(
      (screen.getByTestId("Connect to Project") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("shows the loading placeholder before projects have arrived", () => {
    let resolveProjects: (value: unknown) => void = () => undefined;
    mockedGetProjects.mockReturnValue(
      new Promise(resolve => {
        resolveProjects = resolve;
      }),
    );
    renderImport({ ...baseProps(), accessToken: "tok" });

    const dropdown = screen.getByTestId("project-dropdown");
    // basespaceProjects is still null -> not "no projects found", just loading.
    expect(dropdown.getAttribute("data-disabled")).toBe("false");
    expect(dropdown.getAttribute("data-placeholder")).toBe(
      "Loading projects...",
    );
    resolveProjects(PROJECTS);
  });

  it("errors and calls onNoProject when no target project is selected", async () => {
    const props = { ...baseProps(), accessToken: "tok", project: null };
    renderImport(props);
    await waitFor(() =>
      expect(screen.getByTestId("project-option-11")).toBeTruthy(),
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("Connect to Project"));
    });

    expect(props.onNoProject).toHaveBeenCalled();
    expect(screen.getByText(NO_TARGET_PROJECT_ERROR)).toBeTruthy();
    expect(mockedGetSamples).not.toHaveBeenCalled();
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("clears the no-target-project error once a project is supplied", async () => {
    const props = { ...baseProps(), accessToken: "tok", project: null };
    const { rerender } = renderImport(props);
    await waitFor(() =>
      expect(screen.getByTestId("project-option-11")).toBeTruthy(),
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("Connect to Project"));
    });
    expect(screen.getByText(NO_TARGET_PROJECT_ERROR)).toBeTruthy();

    await act(async () => {
      rerender(
        <BasespaceSampleImport
          {...props}
          project={{ id: 3, name: "Target" }}
        />,
      );
    });

    expect(screen.queryByText(NO_TARGET_PROJECT_ERROR)).toBeNull();
  });

  it("stamps the target project id onto fetched samples and passes them up", async () => {
    mockedGetSamples.mockResolvedValue([
      { basespace_dataset_id: "a" },
      { basespace_dataset_id: "b" },
    ]);
    const props = {
      ...baseProps(),
      accessToken: "tok",
      project: { id: 3, name: "Target" },
    };
    renderImport(props);
    await waitFor(() =>
      expect(screen.getByTestId("project-option-11")).toBeTruthy(),
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("Connect to Project"));
    });

    expect(mockedGetSamples).toHaveBeenCalledWith("tok", 11);
    expect(props.onChange).toHaveBeenCalledWith([
      { basespace_dataset_id: "a", project_id: 3 },
      { basespace_dataset_id: "b", project_id: 3 },
    ]);
    // Successful fetch leaves no notification behind.
    expect(props.onNoProject).not.toHaveBeenCalled();
  });

  it("surfaces an API error for the selected project by name and does not call onChange", async () => {
    mockedGetSamples.mockResolvedValue({ error: "boom" });
    const props = {
      ...baseProps(),
      accessToken: "tok",
      project: { id: 3, name: "Target" },
    };
    renderImport(props);
    await waitFor(() =>
      expect(screen.getByTestId("project-option-22")).toBeTruthy(),
    );
    fireEvent.click(screen.getByTestId("project-option-22"));

    await act(async () => {
      fireEvent.click(screen.getByTestId("Connect to Project"));
    });

    expect(
      screen.getByText(
        "There was an error accessing project Project Twenty Two. Please contact us for help.",
      ),
    ).toBeTruthy();
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("warns when the selected project yields no valid samples but still calls onChange", async () => {
    mockedGetSamples.mockResolvedValue([]);
    const props = {
      ...baseProps(),
      accessToken: "tok",
      project: { id: 3, name: "Target" },
    };
    renderImport(props);
    await waitFor(() =>
      expect(screen.getByTestId("project-option-11")).toBeTruthy(),
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("Connect to Project"));
    });

    expect(
      screen.getByText(
        "No valid samples could be found in project Project Eleven",
      ),
    ).toBeTruthy();
    expect(props.onChange).toHaveBeenCalledWith([]);
  });

  it("consumes the OAuth popup message and reports the new access token", async () => {
    const fakePopup = { name: "popup" };
    mockedOpenPopup.mockReturnValue(fakePopup);
    const props = baseProps();
    renderImport(props);

    fireEvent.click(screen.getByText("Connect to Basespace"));

    const event: $TSFixMe = new Event("message");
    event.source = fakePopup;
    event.origin = window.location.origin;
    event.data = { basespaceAccessToken: "new-token" };
    await act(async () => {
      window.dispatchEvent(event);
    });

    expect(props.onAccessTokenChange).toHaveBeenCalledWith("new-token");
    expect(mockedGetProjects).toHaveBeenCalledWith("new-token");
  });

  it("ignores messages from a different window or origin", async () => {
    const fakePopup = { name: "popup" };
    mockedOpenPopup.mockReturnValue(fakePopup);
    const props = baseProps();
    renderImport(props);
    fireEvent.click(screen.getByText("Connect to Basespace"));

    const wrongSource: $TSFixMe = new Event("message");
    wrongSource.source = { name: "other" };
    wrongSource.origin = window.location.origin;
    wrongSource.data = { basespaceAccessToken: "nope" };

    const wrongOrigin: $TSFixMe = new Event("message");
    wrongOrigin.source = fakePopup;
    wrongOrigin.origin = "https://evil.test";
    wrongOrigin.data = { basespaceAccessToken: "nope" };

    const noToken: $TSFixMe = new Event("message");
    noToken.source = fakePopup;
    noToken.origin = window.location.origin;
    noToken.data = {};

    await act(async () => {
      window.dispatchEvent(wrongSource);
      window.dispatchEvent(wrongOrigin);
      window.dispatchEvent(noToken);
    });

    expect(props.onAccessTokenChange).not.toHaveBeenCalled();
    expect(mockedGetProjects).not.toHaveBeenCalled();
  });

  it("stops listening for OAuth messages after unmount", async () => {
    const fakePopup = { name: "popup" };
    mockedOpenPopup.mockReturnValue(fakePopup);
    const props = baseProps();
    const { unmount } = renderImport(props);
    fireEvent.click(screen.getByText("Connect to Basespace"));
    unmount();

    const event: $TSFixMe = new Event("message");
    event.source = fakePopup;
    event.origin = window.location.origin;
    event.data = { basespaceAccessToken: "new-token" };
    await act(async () => {
      window.dispatchEvent(event);
    });

    expect(props.onAccessTokenChange).not.toHaveBeenCalled();
  });
});
