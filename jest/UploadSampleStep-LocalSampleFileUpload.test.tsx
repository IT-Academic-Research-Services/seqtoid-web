// Frontend coverage: LocalSampleFileUpload owns the "select local files" part
// of the upload step. Its real logic is (a) grouping dropped files into samples
// by base name, keeping R1 before R2 and at most two files per sample, (b)
// building a human-readable rejection message for empty / oversized / wrongly
// named files, and (c) computing the file-picker title from validation state.
//
// FilePicker is stubbed so the onChange/onRejected callbacks can be driven
// directly (the real one is a drag-and-drop zone).
import { fireEvent } from "@testing-library/dom";
import { render, screen } from "@testing-library/react";
import { LocalSampleFileUpload } from "~/components/views/SampleUploadFlow/components/UploadSampleStep/components/LocalSampleFileUpload/LocalSampleFileUpload";

let mockFilePickerProps: $TSFixMe = null;

jest.mock("~ui/controls/FilePicker", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => {
    mockFilePickerProps = props;
    return (
      <div
        data-testid="file-picker"
        data-title={String(props.title)}
        data-classname={String(props.className)}
        data-finished={String(props.finishedValidating)}
        data-accept={props.accept}
      />
    );
  },
}));

jest.mock("~/api/analytics", () => ({
  useTrackEvent: () => jest.fn(),
}));

const renderUpload = (props: $TSFixMe) =>
  render(
    <LocalSampleFileUpload samples={[]} onChange={jest.fn()} {...props} />,
  );

const pickerTitle = () =>
  screen.getByTestId("file-picker").getAttribute("data-title");

describe("LocalSampleFileUpload", () => {
  beforeEach(() => {
    mockFilePickerProps = null;
    jest.restoreAllMocks();
  });

  describe("file picker title", () => {
    it("is null when no files are selected and samples have not loaded", () => {
      renderUpload({ samples: [], hasSamplesLoaded: false });
      expect(pickerTitle()).toBe("null");
      expect(
        screen.getByTestId("file-picker").getAttribute("data-accept"),
      ).toBe(".fastq, .fq, .gz");
    });

    it("says no files are selected once samples have loaded", () => {
      renderUpload({ samples: [], hasSamplesLoaded: true });
      expect(pickerTitle()).toBe("No Files Selected For Upload");
    });

    it("uses the singular form for a single validated file", () => {
      renderUpload({
        samples: [
          {
            input_files_attributes: [{ source: "a.fastq" }],
            finishedValidating: true,
          },
        ],
      });
      expect(pickerTitle()).toBe("1 File Selected For Upload");
      expect(
        screen.getByTestId("file-picker").getAttribute("data-finished"),
      ).toBe("true");
    });

    it("uses the plural form for several validated files", () => {
      renderUpload({
        samples: [
          {
            input_files_attributes: [{ source: "a.fastq" }, { source: "b" }],
            finishedValidating: true,
          },
          {
            input_files_attributes: [{ source: "c.fastq" }],
            finishedValidating: true,
          },
        ],
      });
      expect(pickerTitle()).toBe("3 Files Selected For Upload");
    });

    it("reports a singular in-progress validation", () => {
      renderUpload({
        samples: [
          {
            input_files_attributes: [{ source: "a.fastq" }],
            finishedValidating: false,
          },
          {
            input_files_attributes: [{ source: "b.fastq" }],
            finishedValidating: true,
          },
        ],
      });
      expect(pickerTitle()).toBe("Validating 1 File");
      expect(
        screen.getByTestId("file-picker").getAttribute("data-finished"),
      ).toBe("false");
    });

    it("reports a plural in-progress validation", () => {
      renderUpload({
        samples: [
          {
            input_files_attributes: [{ source: "a.fastq" }],
            finishedValidating: false,
          },
          {
            input_files_attributes: [{ source: "b.fastq" }],
            finishedValidating: false,
          },
        ],
      });
      expect(pickerTitle()).toBe("Validating 2 Files");
    });
  });

  describe("info toggle", () => {
    it("shows and hides the file instructions", () => {
      renderUpload({});
      expect(screen.getByText(/More/)).toBeTruthy();
      expect(screen.queryByText("File Instructions")).toBeNull();

      fireEvent.click(screen.getByText(/More/));
      expect(screen.getByText("File Instructions")).toBeTruthy();
      expect(
        screen.getByText(
          "Accepted file formats: .fastq, .fastq.gz, .fq, .fq.gz",
        ),
      ).toBeTruthy();

      fireEvent.click(screen.getByText(/Hide/));
      expect(screen.queryByText("File Instructions")).toBeNull();
    });
  });

  describe("onDrop", () => {
    it("groups files into samples by base name with R1 before R2", () => {
      const onChange = jest.fn();
      renderUpload({ onChange, project: { id: 42 } });

      mockFilePickerProps.onChange([
        { name: "sampleA_R2.fastq.gz" },
        { name: "sampleA_R1.fastq.gz" },
        { name: "sampleB.fastq" },
      ]);

      expect(onChange).toHaveBeenCalledTimes(1);
      const samples = onChange.mock.calls[0][0];
      expect(samples.map((s: $TSFixMe) => s.name).sort()).toEqual([
        "sampleA",
        "sampleB",
      ]);

      const sampleA = samples.find((s: $TSFixMe) => s.name === "sampleA");
      expect(sampleA.project_id).toBe(42);
      expect(sampleA.host_genome_id).toBe("");
      expect(sampleA.status).toBe("created");
      expect(sampleA.client).toBe("web");
      expect(
        sampleA.input_files_attributes.map((f: $TSFixMe) => f.source),
      ).toEqual(["sampleA_R1.fastq.gz", "sampleA_R2.fastq.gz"]);
      expect(sampleA.input_files_attributes[0]).toEqual({
        source_type: "local",
        source: "sampleA_R1.fastq.gz",
        parts: "sampleA_R1.fastq.gz",
        upload_client: "web",
        file_type: "fastq",
      });
      expect(Object.keys(sampleA.files).sort()).toEqual([
        "sampleA_R1.fastq.gz",
        "sampleA_R2.fastq.gz",
      ]);
    });

    it("keeps at most two files per sample and leaves project_id undefined without a project", () => {
      const onChange = jest.fn();
      renderUpload({ onChange });

      mockFilePickerProps.onChange([
        { name: "sampleA_R1.fastq.gz" },
        { name: "sampleA_R2.fastq.gz" },
        { name: "sampleA_R1_extra.fastq.gz" },
      ]);

      const samples = onChange.mock.calls[0][0];
      expect(samples).toHaveLength(1);
      expect(samples[0].input_files_attributes).toHaveLength(2);
      expect(samples[0].project_id).toBeUndefined();
    });
  });

  describe("onRejected", () => {
    it("lists empty, oversized and invalid-format files separately", () => {
      const alertSpy = jest
        .spyOn(window, "alert")
        .mockImplementation(() => undefined);
      renderUpload({});

      mockFilePickerProps.onRejected([
        { name: "empty.fastq", size: 0 },
        { name: "huge.fastq", size: 40e9 },
        { name: "notes.txt", size: 100 },
        { name: "notes2.doc", size: 200 },
      ]);

      expect(alertSpy).toHaveBeenCalledTimes(1);
      const msg = alertSpy.mock.calls[0][0] as string;
      expect(msg).toContain("Some of your files cannot be uploaded.");
      expect(msg).toContain("- Empty files: empty.fastq");
      expect(msg).toContain("- Too large: huge.fastq");
      expect(msg).toContain("Size must be under 35 GB");
      expect(msg).toContain(
        "- Files with invalid formats: notes.txt, notes2.doc",
      );
    });

    it("omits the sections that do not apply", () => {
      const alertSpy = jest
        .spyOn(window, "alert")
        .mockImplementation(() => undefined);
      renderUpload({});

      mockFilePickerProps.onRejected([{ name: "huge.fastq", size: 35e9 }]);

      const msg = alertSpy.mock.calls[0][0] as string;
      expect(msg).toContain("- Too large: huge.fastq");
      expect(msg).not.toContain("Empty files");
      expect(msg).not.toContain("invalid formats");
    });
  });
});
