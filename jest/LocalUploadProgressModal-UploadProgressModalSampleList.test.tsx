// Coverage: .../LocalUploadProgressModal/components/UploadProgressModalSampleList/UploadProgressModalSampleList.tsx
//
// UploadProgressModalSampleList renders one row per sample with a status region
// that switches on the per-sample upload status (error / success / in-progress /
// undefined) and a "Uploaded X of Y" progress line derived from the file sizes
// and the reported percentage. The icons and LoadingBar are stubbed so the
// assertions land on this file's own status branching and byte math.
import { fireEvent, render, screen } from "@testing-library/react";
import { UploadProgressModalSampleList } from "~/components/views/SampleUploadFlow/components/UploadProgressModal/components/LocalUploadProgressModal/components/UploadProgressModalSampleList/UploadProgressModalSampleList";

jest.mock("~/components/ui/controls/LoadingBar", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: ({ percentage, error }: { percentage?: number; error: boolean }) =>
      ReactLib.createElement("div", {
        "data-testid": "loading-bar",
        "data-percentage": String(percentage),
        "data-error": String(error),
      }),
  };
});

jest.mock("~/components/ui/icons/IconAlert", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: () =>
      ReactLib.createElement("span", { "data-testid": "icon-alert" }),
  };
});

jest.mock("~/components/ui/icons/IconCheckSmall", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: () =>
      ReactLib.createElement("span", { "data-testid": "icon-check" }),
  };
});

const makeSample = (name: string, size: number) => ({
  name,
  files: [{ size } as File],
});

const renderList = (overrides: Record<string, unknown> = {}) =>
  render(
    <UploadProgressModalSampleList
      samples={[makeSample("alpha", 1000)]}
      sampleUploadPercentages={{ alpha: 0.5 }}
      sampleUploadStatuses={{ alpha: "in progress" as any }}
      onRetryUpload={jest.fn()}
      {...(overrides as any)}
    />,
  );

describe("UploadProgressModalSampleList status branches", () => {
  it("renders nothing but the container when samples is null", () => {
    const { container } = render(
      <UploadProgressModalSampleList
        samples={null}
        sampleUploadPercentages={{}}
        sampleUploadStatuses={{}}
        onRetryUpload={jest.fn()}
      />,
    );
    // No sample rows and no status text.
    expect(container.querySelector('[data-testid="loading-bar"]')).toBeNull();
  });

  it("shows the error state with a retry control that reports the sample", () => {
    const onRetryUpload = jest.fn();
    const sample = makeSample("bad", 500);
    renderList({
      samples: [sample],
      sampleUploadStatuses: { bad: "error" as any },
      sampleUploadPercentages: { bad: 0.2 },
      onRetryUpload,
    });

    expect(screen.getByText("Upload failed")).toBeTruthy();
    expect(screen.getByTestId("icon-alert")).toBeTruthy();
    fireEvent.click(screen.getByText("Retry"));
    expect(onRetryUpload).toHaveBeenCalledWith([sample]);
    // error flag threaded into the LoadingBar.
    expect(screen.getByTestId("loading-bar").getAttribute("data-error")).toBe(
      "true",
    );
  });

  it("shows the success state", () => {
    renderList({
      sampleUploadStatuses: { alpha: "success" as any },
    });
    expect(screen.getByText("Sent to pipeline")).toBeTruthy();
    expect(screen.getByTestId("icon-check")).toBeTruthy();
  });

  it("shows the uploaded-of-total text for an in-progress sample", () => {
    renderList({
      samples: [makeSample("alpha", 1000)],
      sampleUploadPercentages: { alpha: 0.5 },
      sampleUploadStatuses: { alpha: "in progress" as any },
    });
    // 1000 bytes total, 50% -> "Uploaded 500 B of 1 KB" (formatFileSize).
    expect(screen.getByText(/Uploaded .* of /)).toBeTruthy();
    expect(screen.getByText(/500 B/)).toBeTruthy();
  });

  it("shows the waiting text when the sample has no reported percentage", () => {
    renderList({
      samples: [makeSample("alpha", 1000)],
      sampleUploadPercentages: {},
      sampleUploadStatuses: {},
    });
    expect(screen.getByText("Waiting to upload...")).toBeTruthy();
    // undefined percentage is passed through to the bar.
    expect(
      screen.getByTestId("loading-bar").getAttribute("data-percentage"),
    ).toBe("undefined");
  });

  it("renders a row per sample", () => {
    renderList({
      samples: [makeSample("a", 100), makeSample("b", 200)],
      sampleUploadPercentages: { a: 1, b: 1 },
      sampleUploadStatuses: { a: "success" as any, b: "success" as any },
    });
    expect(screen.getByText("a")).toBeTruthy();
    expect(screen.getByText("b")).toBeTruthy();
    expect(screen.getAllByTestId("loading-bar")).toHaveLength(2);
  });
});
