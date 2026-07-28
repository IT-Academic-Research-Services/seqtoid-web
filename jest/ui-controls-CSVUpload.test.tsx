// Coverage for CSVUpload: it wraps FilePicker, reads the dropped file with a
// FileReader, parses it, optionally drops the all-empty rows Excel leaves
// behind on delete, and hands the parsed CSV to its onCSV callback.
import { act, render, screen, waitFor } from "@testing-library/react";
import CSVUpload from "~/components/ui/controls/CSVUpload";

// FilePicker is a react-dropzone wrapper; stub it so the drop can be simulated
// directly and so the `file` prop CSVUpload feeds back down is observable.
let filePickerProps: {
  onChange: (accepted: File[]) => void;
  file?: File | null;
  title?: string;
  className?: string;
};

jest.mock("~ui/controls/FilePicker", () => ({
  __esModule: true,
  default: (props: {
    onChange: (accepted: File[]) => void;
    file?: File | null;
    title?: string;
    className?: string;
  }) => {
    filePickerProps = props;
    return (
      <div data-testid="file-picker" className={props.className}>
        <span data-testid="file-picker-title">{props.title ?? ""}</span>
        <span data-testid="file-picker-file">{props.file?.name ?? "none"}</span>
      </div>
    );
  },
}));

const csvFile = (contents: string, name = "metadata.csv") =>
  new File([contents], name, { type: "text/csv" });

describe("CSVUpload", () => {
  it("renders FilePicker with the title/className and no file selected yet", () => {
    render(<CSVUpload onCSV={jest.fn()} title="Upload CSV" className="wide" />);

    expect(screen.getByTestId("file-picker-title").textContent).toBe(
      "Upload CSV",
    );
    expect(screen.getByTestId("file-picker-file").textContent).toBe("none");
    expect(screen.getByTestId("file-picker").className).toBe("wide");
  });

  it("parses the dropped CSV into headers + rows and reports the file back", async () => {
    const onCSV = jest.fn();
    render(<CSVUpload onCSV={onCSV} />);

    act(() => {
      filePickerProps.onChange([
        csvFile("Sample Name,Host\nsample_one,Human\nsample_two,Mosquito\n"),
      ]);
    });

    await waitFor(() => expect(onCSV).toHaveBeenCalledTimes(1));
    expect(onCSV.mock.calls[0][0]).toEqual({
      headers: ["Sample Name", "Host"],
      rows: [
        ["sample_one", "Human"],
        ["sample_two", "Mosquito"],
      ],
    });
    // The chosen file is pushed back down so FilePicker can show it as loaded.
    await waitFor(() =>
      expect(screen.getByTestId("file-picker-file").textContent).toBe(
        "metadata.csv",
      ),
    );
  });

  it("keeps Excel's blank rows when removeEmptyRows is not set", async () => {
    const onCSV = jest.fn();
    render(<CSVUpload onCSV={onCSV} />);

    act(() => {
      filePickerProps.onChange([
        csvFile('Name,Host\nsample_one,Human\n"",""\n'),
      ]);
    });

    await waitFor(() => expect(onCSV).toHaveBeenCalledTimes(1));
    expect(onCSV.mock.calls[0][0].rows).toEqual([
      ["sample_one", "Human"],
      ["", ""],
    ]);
  });

  it("drops all-empty rows when removeEmptyRows is set", async () => {
    const onCSV = jest.fn();
    render(<CSVUpload onCSV={onCSV} removeEmptyRows />);

    act(() => {
      filePickerProps.onChange([
        csvFile('Name,Host\nsample_one,Human\n"",""\nsample_two,Mosquito\n'),
      ]);
    });

    await waitFor(() => expect(onCSV).toHaveBeenCalledTimes(1));
    const csv = onCSV.mock.calls[0][0];
    expect(csv.headers).toEqual(["Name", "Host"]);
    expect(csv.rows).toEqual([
      ["sample_one", "Human"],
      ["sample_two", "Mosquito"],
    ]);
  });

  it("keeps a partially-filled row when removeEmptyRows is set", async () => {
    // `some(val => val !== "")` must keep rows where at least one cell is
    // populated -- only fully blank rows are Excel deletion residue.
    const onCSV = jest.fn();
    render(<CSVUpload onCSV={onCSV} removeEmptyRows />);

    act(() => {
      filePickerProps.onChange([csvFile('Name,Host\nsample_one,""\n"",""\n')]);
    });

    await waitFor(() => expect(onCSV).toHaveBeenCalledTimes(1));
    expect(onCSV.mock.calls[0][0].rows).toEqual([["sample_one", ""]]);
  });

  it("yields a header-only CSV with no rows when the file has just a header", async () => {
    const onCSV = jest.fn();
    render(<CSVUpload onCSV={onCSV} removeEmptyRows />);

    act(() => {
      filePickerProps.onChange([csvFile("Name,Host\n")]);
    });

    await waitFor(() => expect(onCSV).toHaveBeenCalledTimes(1));
    expect(onCSV.mock.calls[0][0]).toEqual({
      headers: ["Name", "Host"],
      rows: [],
    });
  });
});
