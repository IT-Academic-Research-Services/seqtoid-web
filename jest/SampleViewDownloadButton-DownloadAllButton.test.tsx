// Frontend coverage: DownloadAllButton runs a Relay query for a zip-download
// link and drives it to completion. react-relay's fetchQuery is stubbed with a
// fake observable so the subscribe callbacks (next / complete) can be invoked
// synchronously, letting us exercise every branch of the response handler: the
// gate that renders nothing until readyToDownload, the error path that logs and
// bails, the success path that opens the URL, and the disabled/loading state
// toggled around the request. The tracking call is asserted too.
import { act, fireEvent, render, screen } from "@testing-library/react";

const mockTrackEvent = jest.fn();
const mockOpenUrl = jest.fn();
const mockLogError = jest.fn();
const mockFetchQuery = jest.fn();
const mockEnvironment = { name: "fake-env" };

jest.mock("~/api/analytics", () => ({
  useTrackEvent: () => mockTrackEvent,
}));

jest.mock("react-relay", () => ({
  graphql: () => "DownloadAllButtonQuery",
  useRelayEnvironment: () => mockEnvironment,
  fetchQuery: (...args: $TSFixMe[]) => mockFetchQuery(...args),
}));

jest.mock("~/components/utils/links", () => ({
  openUrl: (...args: $TSFixMe[]) => mockOpenUrl(...args),
}));

jest.mock("~/components/utils/logUtil", () => ({
  logError: (...args: $TSFixMe[]) => mockLogError(...args),
}));

jest.mock("~/components/ui/controls/buttons", () => ({
  DownloadButton: (props: $TSFixMe) => (
    <button
      data-testid="download-button"
      data-disabled={String(props.disabled)}
      data-starticon={props.startIcon}
      onClick={props.onClick}
    >
      {props.text}
    </button>
  ),
}));

import { WorkflowType } from "~/components/utils/workflows";
import { DownloadAllButton } from "~/components/views/SampleView/components/SampleViewHeader/components/PrimaryHeaderControls/components/SampleViewDownloadButton/components/DownloadAllButton/DownloadAllButton";

// fetchQuery(...).subscribe(observer) -- capture the observer so the test can
// push next/complete events at will.
let capturedObserver: $TSFixMe;
const setupFetchQuery = () => {
  capturedObserver = undefined;
  mockFetchQuery.mockReturnValue({
    subscribe: (observer: $TSFixMe) => {
      capturedObserver = observer;
      return { unsubscribe: jest.fn() };
    },
  });
};

const baseProps = {
  sample: { id: 77 } as $TSFixMe,
  workflowRun: { id: 88 } as $TSFixMe,
  workflowType: WorkflowType.CONSENSUS_GENOME,
  readyToDownload: true,
};

const renderButton = (overrides: $TSFixMe = {}) =>
  render(<DownloadAllButton {...(baseProps as $TSFixMe)} {...overrides} />);

beforeEach(() => {
  jest.clearAllMocks();
  setupFetchQuery();
});

describe("DownloadAllButton", () => {
  it("renders nothing when the run is not ready to download", () => {
    const { container } = renderButton({ readyToDownload: false });
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("download-button")).toBeNull();
  });

  it("renders an enabled Download All button when ready", () => {
    renderButton();
    const btn = screen.getByTestId("download-button");
    expect(btn.textContent).toBe("Download All");
    expect(btn.getAttribute("data-disabled")).toBe("false");
    expect(btn.getAttribute("data-starticon")).toBe("download");
  });

  it("fires the Relay query and tracks the click when pressed", () => {
    renderButton();
    fireEvent.click(screen.getByTestId("download-button"));
    expect(mockFetchQuery).toHaveBeenCalledTimes(1);
    const [env, , variables] = mockFetchQuery.mock.calls[0];
    expect(env).toBe(mockEnvironment);
    expect(variables).toEqual({ workflowRunId: "88" });
    expect(mockTrackEvent).toHaveBeenCalledWith(
      `SampleViewHeader_${WorkflowType.CONSENSUS_GENOME}-download-all-button_clicked`,
      { sampleId: 77 },
    );
  });

  it("shows the loading state while a download is in flight and re-enables on complete", () => {
    renderButton();
    fireEvent.click(screen.getByTestId("download-button"));
    // While the observable is open, the button is disabled + shows a spinner.
    let btn = screen.getByTestId("download-button");
    expect(btn.getAttribute("data-disabled")).toBe("true");
    expect(btn.getAttribute("data-starticon")).toBe("loading");
    // Completing the observable restores the idle state.
    act(() => capturedObserver.complete());
    btn = screen.getByTestId("download-button");
    expect(btn.getAttribute("data-disabled")).toBe("false");
    expect(btn.getAttribute("data-starticon")).toBe("download");
  });

  it("opens the returned URL on a successful response", () => {
    renderButton();
    fireEvent.click(screen.getByTestId("download-button"));
    act(() =>
      capturedObserver.next({
        ZipLink: { url: "https://example.com/all.zip" },
      }),
    );
    expect(mockOpenUrl).toHaveBeenCalledWith("https://example.com/all.zip");
    expect(mockLogError).not.toHaveBeenCalled();
  });

  it("logs and bails when the response contains an error", () => {
    renderButton();
    fireEvent.click(screen.getByTestId("download-button"));
    act(() => capturedObserver.next({ ZipLink: { error: "boom" } }));
    expect(mockLogError).toHaveBeenCalledWith({
      message: "Zip file retrieval failed with error: boom",
    });
    expect(mockOpenUrl).not.toHaveBeenCalled();
  });

  it("does nothing on a response with neither url nor error", () => {
    renderButton();
    fireEvent.click(screen.getByTestId("download-button"));
    act(() => capturedObserver.next({ ZipLink: {} }));
    expect(mockOpenUrl).not.toHaveBeenCalled();
    expect(mockLogError).not.toHaveBeenCalled();
  });
});
