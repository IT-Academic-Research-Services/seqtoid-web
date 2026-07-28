// Second-wave coverage for the in-app SupportPortal (#440). The existing
// SupportPortal.test.tsx covers the happy path; this spec drives the paths it
// leaves untouched: the failed-submission branch, the close/cancel/done
// affordances, collapsing "More details" again, the free-text description, the
// `openSupportPortal()` event bus entry point (with and without a note), and
// the global error listener that feeds `recentError`.
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createSupportRequest } from "~/api/support";
import SupportPortal from "~/components/common/SupportPortal/SupportPortal";
import { openSupportPortal } from "~/components/common/SupportPortal/openSupportPortal";
import { UserContext } from "~/components/common/UserContext";
import { logError } from "~/components/utils/logUtil";

jest.mock("~/api/support", () => ({
  createSupportRequest: jest.fn(),
}));

jest.mock("~/components/utils/logUtil", () => ({
  logError: jest.fn(),
}));

const mockedCreate = createSupportRequest as jest.MockedFunction<
  typeof createSupportRequest
>;
const mockedLogError = logError as jest.MockedFunction<typeof logError>;

const signedInContext = {
  admin: true,
  firstSignIn: false,
  allowedFeatures: [],
  appConfig: {},
  userSignedIn: true,
  userId: 7,
  userName: "Ada Lovelace",
  userEmail: "ada@example.com",
  profileCompleted: true,
};

const renderPortal = (context = signedInContext) =>
  render(
    <UserContext.Provider value={context}>
      <SupportPortal />
    </UserContext.Provider>,
  );

const openPanel = () =>
  fireEvent.click(screen.getByTestId("support-portal-button"));

describe("SupportPortal (submission, dismissal and event-bus paths)", () => {
  beforeEach(() => {
    mockedCreate.mockReset();
    mockedLogError.mockReset();
    // @ts-expect-error minimal stub for the global set by the Rails layout
    window.GIT_RELEASE_SHA = "deadbee";
    // @ts-expect-error minimal stub for the global set by the Rails layout
    window.ENVIRONMENT = "test";
  });

  it("shows an error message and logs when the request fails", async () => {
    mockedCreate.mockRejectedValueOnce(new Error("500 from rails"));
    renderPortal();
    openPanel();

    fireEvent.click(screen.getByTestId("support-portal-submit"));

    await screen.findByText(/couldn't send your report/i);
    expect(mockedLogError).toHaveBeenCalledTimes(1);
    expect(mockedLogError.mock.calls[0][0].message).toBe(
      "Failed to submit support request",
    );
    // The panel stays open with its actions re-enabled so the user can retry.
    expect(screen.getByTestId("support-portal-submit").textContent).toBe(
      "Report an issue",
    );
  });

  it("lets the user retry successfully after a failure", async () => {
    mockedCreate.mockRejectedValueOnce(new Error("boom"));
    mockedCreate.mockResolvedValueOnce({ status: "ok" });
    renderPortal();
    openPanel();

    fireEvent.click(screen.getByTestId("support-portal-submit"));
    await screen.findByText(/couldn't send your report/i);

    fireEvent.click(screen.getByTestId("support-portal-submit"));
    await screen.findByText(/your report was sent/i);

    expect(mockedCreate).toHaveBeenCalledTimes(2);
    // On success the error banner is replaced, not merely appended.
    expect(screen.queryByText(/couldn't send your report/i)).toBeNull();
  });

  it("swaps the two-button footer for a single Done button on success", async () => {
    mockedCreate.mockResolvedValueOnce({ status: "ok" });
    renderPortal();
    openPanel();

    expect(screen.getByText("Cancel")).toBeTruthy();
    fireEvent.click(screen.getByTestId("support-portal-submit"));

    await screen.findByText("Done");
    expect(screen.queryByText("Cancel")).toBeNull();
    expect(screen.queryByTestId("support-portal-submit")).toBeNull();

    fireEvent.click(screen.getByText("Done"));
    expect(screen.queryByTestId("support-portal-panel")).toBeNull();
  });

  it("closes the panel without submitting when Cancel is clicked", () => {
    renderPortal();
    openPanel();
    expect(screen.getByTestId("support-portal-panel")).toBeTruthy();

    fireEvent.click(screen.getByText("Cancel"));

    expect(screen.queryByTestId("support-portal-panel")).toBeNull();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("collapses the details section again when the toggle is clicked twice", () => {
    renderPortal();
    openPanel();
    const toggle = screen.getByTestId("support-portal-details-toggle");

    expect(toggle.textContent).toBe("More details");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle);
    expect(toggle.textContent).toBe("Hide details");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("support-portal-diagnostics")).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle.textContent).toBe("More details");
    expect(screen.queryByTestId("support-portal-diagnostics")).toBeNull();
  });

  it("reports the admin role in the diagnostics for an admin user", () => {
    renderPortal();
    openPanel();
    fireEvent.click(screen.getByTestId("support-portal-details-toggle"));

    const diagnostics = screen.getByTestId("support-portal-diagnostics");
    expect(diagnostics.textContent).toContain("admin");
    expect(diagnostics.textContent).toContain("deadbee");
  });

  it("submits the free-text description the user typed", async () => {
    mockedCreate.mockResolvedValueOnce({ status: "ok" });
    renderPortal();
    openPanel();

    // The modal renders through a portal, so query the document, not the
    // render container.
    const textarea = screen.getByTestId(
      "support-portal-description",
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: { value: "The heatmap never finished loading." },
    });

    fireEvent.click(screen.getByTestId("support-portal-submit"));
    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    expect(mockedCreate.mock.calls[0][0].description).toBe(
      "The heatmap never finished loading.",
    );
  });

  it("opens itself and pre-fills the description when openSupportPortal passes a note", async () => {
    renderPortal();
    expect(screen.queryByTestId("support-portal-panel")).toBeNull();

    act(() => {
      openSupportPortal({ note: "Report failed to render" });
    });

    await screen.findByTestId("support-portal-panel");
    const textarea = screen.getByTestId(
      "support-portal-description",
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe("Report failed to render. ");
  });

  it("opens with an empty description when openSupportPortal passes no note", async () => {
    renderPortal();

    act(() => {
      openSupportPortal();
    });

    await screen.findByTestId("support-portal-panel");
    const textarea = screen.getByTestId(
      "support-portal-description",
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe("");
  });

  it("resets a previous success state when re-opened via the event bus", async () => {
    mockedCreate.mockResolvedValueOnce({ status: "ok" });
    renderPortal();
    openPanel();
    fireEvent.click(screen.getByTestId("support-portal-submit"));
    await screen.findByText(/your report was sent/i);
    fireEvent.click(screen.getByText("Done"));

    act(() => {
      openSupportPortal({ note: "Second attempt" });
    });

    await screen.findByTestId("support-portal-panel");
    expect(screen.queryByText(/your report was sent/i)).toBeNull();
    expect(screen.getByTestId("support-portal-submit")).toBeTruthy();
  });

  it("attaches the most recent window error to the report", async () => {
    mockedCreate.mockResolvedValueOnce({ status: "ok" });
    renderPortal();

    // The portal installs a one-time global listener on mount.
    act(() => {
      window.dispatchEvent(
        new ErrorEvent("error", {
          message: "TypeError: x is not a function",
          filename: "app.js",
          lineno: 12,
          colno: 5,
        }),
      );
    });

    openPanel();
    // The user-facing quick report shows the distilled error name only.
    expect(
      screen.getByTestId("support-portal-quick-report").textContent,
    ).toContain("TypeError: x is not a function");

    fireEvent.click(screen.getByTestId("support-portal-submit"));
    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    // The support-side diagnostics keep the full location suffix.
    expect(mockedCreate.mock.calls[0][0].diagnostics.recentError).toBe(
      "TypeError: x is not a function @ app.js:12:5",
    );
  });

  it("records an unhandled rejection whose reason is an Error", () => {
    renderPortal();

    const event = new Event("unhandledrejection");
    // jsdom does not implement PromiseRejectionEvent, so attach the reason.
    (event as Event & { reason: unknown }).reason = new Error("fetch aborted");
    window.dispatchEvent(event);

    openPanel();
    fireEvent.click(screen.getByTestId("support-portal-details-toggle"));
    expect(
      screen.getByTestId("support-portal-diagnostics").textContent,
    ).toContain("Unhandled promise rejection: fetch aborted");
  });

  it("records an unhandled rejection whose reason is not an Error", () => {
    renderPortal();

    const event = new Event("unhandledrejection");
    (event as Event & { reason: unknown }).reason = "plain string reason";
    window.dispatchEvent(event);

    openPanel();
    fireEvent.click(screen.getByTestId("support-portal-details-toggle"));
    expect(
      screen.getByTestId("support-portal-diagnostics").textContent,
    ).toContain("Unhandled promise rejection: plain string reason");
  });

  it("does not react to open events once unmounted", async () => {
    const { unmount } = renderPortal();
    unmount();

    act(() => {
      openSupportPortal({ note: "nobody home" });
    });

    await waitFor(() =>
      expect(screen.queryByTestId("support-portal-panel")).toBeNull(),
    );
  });
});
