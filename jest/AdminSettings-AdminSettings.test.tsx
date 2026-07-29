// Coverage for app/assets/src/components/views/AdminSettings/AdminSettings.tsx
//
// AdminSettings is the admin page shell. Its own logic is (a) an on-mount fetch
// that partitions the app-config list into "workflow versions" (key contains
// "version") and everything else, and (b) handleSetAppConfig, which forwards a
// key/value pair to the API and returns only the response status to the child
// forms.
//
// The five child sections are stubbed so this suite asserts the partitioning
// and the callback plumbing rather than re-testing the children (each of which
// has its own suite).
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AdminSettings } from "~/components/views/AdminSettings/AdminSettings";

const mockGetAppConfigs = jest.fn();
const mockSetAppConfig = jest.fn();
// Captures whatever handleSetAppConfig resolves to, as observed by the child.
const mockStatusSink = jest.fn();

jest.mock("~/api/index", () => ({
  getAppConfigs: (...args: $TSFixMe[]) => mockGetAppConfigs(...args),
  setAppConfig: (...args: $TSFixMe[]) => mockSetAppConfig(...args),
}));

jest.mock(
  "~/components/views/AdminSettings/components/GenerateEnrichedUserToken",
  () => ({
    GenerateEnrichedUserToken: () => <div data-testid="token-section" />,
  }),
);

jest.mock(
  "~/components/views/AdminSettings/components/FeatureFlagControls",
  () => ({
    FeatureFlagControls: () => <div data-testid="feature-flag-section" />,
  }),
);

jest.mock(
  "~/components/views/AdminSettings/components/WorkflowVersions",
  () => ({
    WorkflowVersions: ({ workflowVersions }: $TSFixMe) => (
      <ul data-testid="workflow-versions">
        {workflowVersions.map((c: $TSFixMe) => (
          <li key={c.key}>{c.key}</li>
        ))}
      </ul>
    ),
  }),
);

jest.mock(
  "~/components/views/AdminSettings/components/UpdateAppConfig",
  () => ({
    UpdateAppConfig: ({ appConfigs }: $TSFixMe) => (
      <ul data-testid="other-configs">
        {appConfigs.map((c: $TSFixMe) => (
          <li key={c.key}>{c.key}</li>
        ))}
      </ul>
    ),
  }),
);

jest.mock(
  "~/components/views/AdminSettings/components/CreateAppConfig",
  () => ({
    CreateAppConfig: ({ handleSetAppConfig }: $TSFixMe) => (
      <button
        data-testid="create-config"
        onClick={async () => {
          const status = await handleSetAppConfig({ key: "NEW", value: "1" });
          mockStatusSink(status);
        }}
      >
        create
      </button>
    ),
  }),
);

const textsIn = (testId: string) =>
  Array.from(screen.getByTestId(testId).children).map(n => n.textContent);

describe("AdminSettings", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("splits fetched configs into workflow versions and everything else", async () => {
    mockGetAppConfigs.mockResolvedValue([
      { id: "1", key: "short-read-mngs-version", value: "8.0.0" },
      { id: "2", key: "auto_account_creation_enabled", value: "true" },
      { id: "3", key: "consensus-genome-version", value: "3.4.0" },
    ]);

    render(<AdminSettings />);

    await waitFor(() =>
      expect(textsIn("workflow-versions")).toEqual([
        "short-read-mngs-version",
        "consensus-genome-version",
      ]),
    );
    expect(textsIn("other-configs")).toEqual(["auto_account_creation_enabled"]);
  });

  it("renders every admin section and its heading", async () => {
    mockGetAppConfigs.mockResolvedValue([]);
    render(<AdminSettings />);

    expect(screen.getByText("Admin Settings")).toBeTruthy();
    expect(screen.getByTestId("token-section")).toBeTruthy();
    expect(screen.getByTestId("feature-flag-section")).toBeTruthy();
    await waitFor(() => expect(mockGetAppConfigs).toHaveBeenCalledTimes(1));
    // Nothing matched "version", so both lists come back empty.
    expect(textsIn("workflow-versions")).toEqual([]);
    expect(textsIn("other-configs")).toEqual([]);
  });

  it("routes every config into the non-version list when no key mentions a version", async () => {
    mockGetAppConfigs.mockResolvedValue([
      { id: "1", key: "max_samples", value: "100" },
      { id: "2", key: "maintenance_banner", value: "" },
    ]);

    render(<AdminSettings />);

    await waitFor(() =>
      expect(textsIn("other-configs")).toEqual([
        "max_samples",
        "maintenance_banner",
      ]),
    );
    expect(textsIn("workflow-versions")).toEqual([]);
  });

  it("hands children a setter that returns only the response status", async () => {
    mockGetAppConfigs.mockResolvedValue([]);
    mockSetAppConfig.mockResolvedValue({ status: "App config saved", id: 9 });

    render(<AdminSettings />);
    await waitFor(() => expect(mockGetAppConfigs).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId("create-config"));

    // Only the `status` field crosses back to the child -- not the whole
    // response object.
    await waitFor(() =>
      expect(mockStatusSink).toHaveBeenCalledWith("App config saved"),
    );
    // The API takes positional args, not the object the child passes in.
    expect(mockSetAppConfig).toHaveBeenCalledWith("NEW", "1");
  });
});
