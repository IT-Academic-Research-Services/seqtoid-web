// Coverage: app/assets/src/components/views/SampleUploadFlow/components/UploadSampleStep/components/RemoteSampleFileUpload/RemoteSampleFileUpload.tsx
//
// RemoteSampleFileUpload is a class component that lets the user paste an S3
// path and "Connect to Bucket". Its logic is: toggle the info panel, mirror the
// typed path into state, gate the Connect button (empty / already-checked), and
// on connect either (a) reject when there is no target project, or (b) call the
// bulk-import API, strip nil paired files, and hand the samples up. The three
// error branches (backend status / http status / generic) are all exercised.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RemoteSampleFileUpload } from "~/components/views/SampleUploadFlow/components/UploadSampleStep/components/RemoteSampleFileUpload/RemoteSampleFileUpload";

const mockBulkImport = jest.fn();
jest.mock("~/api", () => ({
  bulkImportRemoteSamples: (...args: $TSFixMe[]) => mockBulkImport(...args),
}));

const NO_TARGET_PROJECT_ERROR =
  "Please select a SeqtoID project to upload your samples to.";
const NO_VALID_SAMPLES_FOUND_ERROR = "No valid samples were found.";

const renderUpload = (props: $TSFixMe = {}) => {
  const onChange = props.onChange || jest.fn();
  const onNoProject = props.onNoProject || jest.fn();
  const utils = render(
    <RemoteSampleFileUpload
      onChange={onChange}
      onNoProject={onNoProject}
      {...props}
    />,
  );
  return { ...utils, onChange, onNoProject };
};

const typePath = (value: string) => {
  const input = document.querySelector("input") as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("RemoteSampleFileUpload info toggle", () => {
  it("shows and hides the S3 instructions", () => {
    renderUpload();
    expect(screen.getByText("More Info")).toBeTruthy();
    expect(screen.queryByText("S3 Bucket Instructions")).toBeNull();

    fireEvent.click(screen.getByText("More Info"));
    expect(screen.getByText("S3 Bucket Instructions")).toBeTruthy();
    expect(screen.getByText("Hide Info")).toBeTruthy();

    fireEvent.click(screen.getByText("Hide Info"));
    expect(screen.queryByText("S3 Bucket Instructions")).toBeNull();
  });
});

describe("RemoteSampleFileUpload connect button gating", () => {
  it("is disabled while the path is empty and enables once a path is typed", () => {
    renderUpload();
    const button = screen.getByText("Connect to Bucket").closest("button");
    expect(button?.hasAttribute("disabled")).toBe(true);

    typePath("s3://bucket/data");
    expect(button?.hasAttribute("disabled")).toBe(false);
  });
});

describe("RemoteSampleFileUpload connect with no project", () => {
  it("shows the no-project error and notifies the parent", async () => {
    const { onNoProject, onChange } = renderUpload({ project: null });
    typePath("s3://bucket/data");
    fireEvent.click(screen.getByText("Connect to Bucket"));

    await waitFor(() =>
      expect(screen.getByText(NO_TARGET_PROJECT_ERROR)).toBeTruthy(),
    );
    expect(onNoProject).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(mockBulkImport).not.toHaveBeenCalled();
  });
});

describe("RemoteSampleFileUpload successful connect", () => {
  it("imports samples, strips nil paired files and hands them up", async () => {
    mockBulkImport.mockResolvedValue({
      samples: [
        { name: "s1", input_files_attributes: [{ source: "a" }, null] },
        { name: "s2", input_files_attributes: [{ source: "b" }] },
      ],
    });
    const { onChange } = renderUpload({ project: { id: 7 } });
    typePath("s3://bucket/data");
    fireEvent.click(screen.getByText("Connect to Bucket"));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(mockBulkImport).toHaveBeenCalledWith({
      projectId: 7,
      hostGenomeId: "",
      bulkPath: "s3://bucket/data",
    });
    const samples = onChange.mock.calls[0][0];
    // The nil file in s1 is compacted away.
    expect(samples[0].input_files_attributes).toEqual([{ source: "a" }]);
    expect(samples[1].input_files_attributes).toEqual([{ source: "b" }]);
  });

  it("disables the button after a path is checked until it changes", async () => {
    mockBulkImport.mockResolvedValue({ samples: [] });
    renderUpload({ project: { id: 7 } });
    typePath("s3://bucket/data");
    const button = screen.getByText("Connect to Bucket").closest("button");
    fireEvent.click(button as HTMLElement);
    await waitFor(() => expect(mockBulkImport).toHaveBeenCalled());
    // lastPathChecked now equals the current path -> button disabled again.
    await waitFor(() => expect(button?.hasAttribute("disabled")).toBe(true));
  });
});

describe("RemoteSampleFileUpload error branches", () => {
  it("uses the backend-provided status message", async () => {
    mockBulkImport.mockRejectedValue({ data: { status: "Backend says no" } });
    renderUpload({ project: { id: 7 } });
    typePath("s3://bucket/data");
    fireEvent.click(screen.getByText("Connect to Bucket"));
    await waitFor(() =>
      expect(screen.getByText("Backend says no")).toBeTruthy(),
    );
  });

  it("reports the http status code when there is no backend message", async () => {
    mockBulkImport.mockRejectedValue({ status: 503 });
    renderUpload({ project: { id: 7 } });
    typePath("s3://bucket/data");
    fireEvent.click(screen.getByText("Connect to Bucket"));
    await waitFor(() =>
      expect(
        screen.getByText(
          "Encountered an unexpected error with status code: 503",
        ),
      ).toBeTruthy(),
    );
  });

  it("falls back to the generic no-valid-samples message", async () => {
    mockBulkImport.mockRejectedValue({});
    renderUpload({ project: { id: 7 } });
    typePath("s3://bucket/data");
    fireEvent.click(screen.getByText("Connect to Bucket"));
    await waitFor(() =>
      expect(screen.getByText(NO_VALID_SAMPLES_FOUND_ERROR)).toBeTruthy(),
    );
  });
});

describe("RemoteSampleFileUpload path trimming (SMP-1818)", () => {
  // S3 bucket names cannot start or end with a space, so a stray leading/trailing
  // space (very common from copy-paste) produces an invalid bucket and the import
  // fails. The path must be trimmed before it is sent.
  it("trims leading/trailing whitespace before sending the path to bulk_import", async () => {
    mockBulkImport.mockResolvedValue({ samples: [] });
    renderUpload({ project: { id: 7 } });
    typePath("  s3://bucket/data  ");
    fireEvent.click(screen.getByText("Connect to Bucket"));

    await waitFor(() => expect(mockBulkImport).toHaveBeenCalledTimes(1));
    expect(mockBulkImport).toHaveBeenCalledWith({
      projectId: 7,
      hostGenomeId: "",
      bulkPath: "s3://bucket/data",
    });
  });

  it("normalizes the displayed path to the trimmed value", async () => {
    mockBulkImport.mockResolvedValue({ samples: [] });
    renderUpload({ project: { id: 7 } });
    typePath("\ts3://bucket/data\n");
    fireEvent.click(screen.getByText("Connect to Bucket"));

    await waitFor(() => expect(mockBulkImport).toHaveBeenCalled());
    const input = document.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("s3://bucket/data");
  });
});
