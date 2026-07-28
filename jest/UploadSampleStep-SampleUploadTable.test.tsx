// Frontend coverage: SampleUploadTable lists the samples staged for upload.
// The logic worth testing is around the table rather than in it: which columns
// each upload type gets, collapsing concatenation groups ("1,2") into a single
// selectable row, removing the unselected samples, per-row click selection,
// disabling rows that are still validating or invalid, and sizing the table
// from the number of rows (capped).
//
// The virtualized Table is stubbed so its props (columns, height, callbacks)
// can be inspected and invoked directly -- react-virtualized renders no rows in
// jsdom because AutoSizer measures a zero-width container.
import { fireEvent } from "@testing-library/dom";
import { render, screen } from "@testing-library/react";
import { SampleUploadTable } from "~/components/views/SampleUploadFlow/components/UploadSampleStep/components/SampleUploadTable/SampleUploadTable";

let mockTableProps: $TSFixMe = null;

// scss modules resolve to an empty object under jest, so the `disabled` class
// name itself is undefined and cannot be observed on the rendered row. Spying on
// `cx` instead lets the "row is disabled" branch be told apart from the
// "row is enabled" branch, which is the behaviour under test.
const mockCx = jest.fn((...args: $TSFixMe[]) => args.filter(Boolean).join(" "));
jest.mock("@emotion/css", () => ({
  cx: (...args: $TSFixMe[]) => mockCx(...args),
}));

jest.mock("~/components/visualizations/table", () => ({
  __esModule: true,
  Table: (props: $TSFixMe) => {
    mockTableProps = props;
    return <div data-testid="upload-table" />;
  },
}));

const localSample = (overrides: $TSFixMe = {}) => ({
  name: "sampleA",
  _selectId: "1",
  file_names_R1: ["sampleA_R1.fastq.gz"],
  file_names_R2: ["sampleA_R2.fastq.gz"],
  finishedValidating: { "sampleA_R1.fastq.gz": true },
  isValid: { "sampleA_R1.fastq.gz": true },
  ...overrides,
});

const renderTable = (props: $TSFixMe) =>
  render(
    <SampleUploadTable
      samples={[localSample()]}
      selectedSampleIds={new Set(["1"])}
      onSamplesRemove={jest.fn()}
      onSampleSelect={jest.fn()}
      onAllSamplesSelect={jest.fn()}
      sampleUploadType="local"
      {...props}
    />,
  );

describe("SampleUploadTable", () => {
  beforeEach(() => {
    mockTableProps = null;
    mockCx.mockClear();
  });

  it("renders nothing when there are no samples", () => {
    const { container } = renderTable({ samples: [] });
    expect(container.firstChild).toBeNull();
  });

  it("renders the selected-of-total count and the remove link", () => {
    renderTable({
      samples: [
        localSample(),
        localSample({ name: "sampleB", _selectId: "2" }),
      ],
      selectedSampleIds: new Set(["1"]),
    });
    expect(screen.getByText(/1 of 2 samples selected/)).toBeTruthy();
    expect(screen.getByText("Click to remove unselected samples")).toBeTruthy();
  });

  it("collapses a concatenation group into a single selected row", () => {
    renderTable({
      samples: [localSample({ _selectId: "1,2" })],
      selectedSampleIds: new Set(["1", "2"]),
    });
    // Both member ids map to the same group, so only one row counts as selected.
    expect(screen.getByText(/1 of 1 samples selected/)).toBeTruthy();
    expect(Array.from(mockTableProps.selected)).toEqual(["1,2"]);
  });

  it("uses the local/remote columns for local uploads", () => {
    renderTable({ sampleUploadType: "local" });
    expect(mockTableProps.columns.map((c: $TSFixMe) => c.dataKey)).toEqual([
      "name",
      "file_names_R1",
      "file_names_R2",
    ]);
    expect(mockTableProps.selectableCellRenderer).toBeTruthy();
  });

  it("uses the local/remote columns for remote uploads and no selectable cell renderer", () => {
    renderTable({ sampleUploadType: "remote" });
    expect(mockTableProps.columns.map((c: $TSFixMe) => c.dataKey)).toEqual([
      "name",
      "file_names_R1",
      "file_names_R2",
    ]);
    expect(mockTableProps.selectableCellRenderer).toBeNull();
  });

  it("uses the basespace columns for basespace uploads", () => {
    renderTable({
      sampleUploadType: "basespace",
      samples: [
        {
          name: "bs",
          _selectId: "1",
          basespace_project_name: "BS Project",
          file_size: 2048,
          file_type: "fastq",
        },
      ],
    });
    const columns = mockTableProps.columns;
    expect(columns.map((c: $TSFixMe) => c.dataKey)).toEqual([
      "name",
      "basespace_project_name",
      "file_size",
      "file_type",
    ]);
    // The file-size column renders a human readable size.
    const sizeColumn = columns.find((c: $TSFixMe) => c.dataKey === "file_size");
    expect(sizeColumn.cellRenderer({ cellData: 2048 })).toBe("2.0 kB");
  });

  it("returns undefined columns for an unrecognised upload type", () => {
    renderTable({ sampleUploadType: "unknown" as $TSFixMe });
    expect(mockTableProps.columns).toBeUndefined();
  });

  it("removes the ids that are not selected, expanding concat groups", () => {
    const onSamplesRemove = jest.fn();
    renderTable({
      samples: [
        localSample({ _selectId: "1,2" }),
        localSample({ name: "sampleC", _selectId: "3" }),
      ],
      selectedSampleIds: new Set(["1", "2"]),
      onSamplesRemove,
    });

    fireEvent.click(screen.getByText("Click to remove unselected samples"));

    expect(onSamplesRemove).toHaveBeenCalledWith(["3"]);
  });

  it("toggles every id in the row on row click", () => {
    const onSampleSelect = jest.fn();
    renderTable({
      samples: [localSample({ _selectId: "1,2" })],
      selectedSampleIds: new Set(["1"]),
      onSampleSelect,
    });

    mockTableProps.onRowClick({ rowData: { _selectId: "1,2" } });

    expect(onSampleSelect).toHaveBeenCalledTimes(2);
    // "1" is already selected -> deselect; "2" is not -> select.
    expect(onSampleSelect).toHaveBeenNthCalledWith(1, "1", false);
    expect(onSampleSelect).toHaveBeenNthCalledWith(2, "2", true);
  });

  it("fans a header-checkbox selection out to every id in the group", () => {
    const onSampleSelect = jest.fn();
    renderTable({ onSampleSelect });

    mockTableProps.onSelectRow("4,5", true);

    expect(onSampleSelect).toHaveBeenNthCalledWith(1, "4", true);
    expect(onSampleSelect).toHaveBeenNthCalledWith(2, "5", true);
  });

  it("exposes validation state through selectRowDataGetter for local uploads", () => {
    renderTable({ sampleUploadType: "local" });
    const rowData = localSample();
    expect(mockTableProps.selectRowDataGetter({ rowData })).toEqual({
      finishedValidating: rowData.finishedValidating,
      id: "1",
      isValid: rowData.isValid,
    });
  });

  it("exposes only the select id through selectRowDataGetter for basespace uploads", () => {
    renderTable({
      sampleUploadType: "basespace",
      samples: [{ name: "bs", _selectId: "9" }],
      selectedSampleIds: new Set(["9"]),
    });
    expect(
      mockTableProps.selectRowDataGetter({ rowData: { _selectId: "9" } }),
    ).toBe("9");
  });

  it("sizes rows from the number of R1 files and falls back to one line", () => {
    renderTable({});
    expect(
      mockTableProps.defaultRowHeight({ row: { file_names_R1: ["a", "b"] } }),
    ).toBe(70);
    expect(mockTableProps.defaultRowHeight({ row: {} })).toBe(40);
  });

  it("grows the table height with the sample count and caps it", () => {
    const { container: small } = renderTable({});
    expect((small.querySelector("[style]") as HTMLElement).style.height).toBe(
      "90px",
    );

    const manySamples = Array.from({ length: 50 }, (_, i) =>
      localSample({ name: `s${i}`, _selectId: String(i) }),
    );
    const { container: big } = renderTable({
      samples: manySamples,
      selectedSampleIds: new Set(["0"]),
    });
    expect((big.querySelector("[style]") as HTMLElement).style.height).toBe(
      "400px",
    );
  });

  it("disables the row while any local file is still validating", () => {
    renderTable({ sampleUploadType: "local" });
    const rowProps: $TSFixMe = {
      className: "base",
      columns: [<div key="c" />],
      index: 0,
      key: "row-0",
      rowData: {
        finishedValidating: { a: true, b: false },
        isValid: { a: true },
      },
      style: {},
    };
    mockTableProps.rowRenderer(rowProps);
    expect(mockCx).toHaveBeenCalledTimes(1);
    expect(mockCx.mock.calls[0][0]).toBe("base");
    expect(rowProps.style.alignItems).toBe("start");
    expect(rowProps.style.paddingTop).toBe("10px");
  });

  it("disables the row when no local file is valid", () => {
    renderTable({ sampleUploadType: "local" });
    const rowProps: $TSFixMe = {
      className: "base",
      columns: [<div key="c" />],
      index: 0,
      key: "row-0",
      rowData: {
        finishedValidating: { a: true },
        isValid: { a: false, b: false },
      },
      style: {},
    };
    mockTableProps.rowRenderer(rowProps);
    expect(mockCx).toHaveBeenCalledTimes(1);
  });

  it("leaves a fully validated local row enabled", () => {
    renderTable({ sampleUploadType: "local" });
    const rowProps: $TSFixMe = {
      className: "base",
      columns: [<div key="c" />],
      index: 0,
      key: "row-0",
      rowData: { finishedValidating: { a: true }, isValid: { a: true } },
      style: {},
    };
    mockTableProps.rowRenderer(rowProps);
    expect(mockCx).not.toHaveBeenCalled();
    expect(rowProps.className).toBe("base");
  });

  it("does not inspect validation state for non-local uploads", () => {
    renderTable({
      sampleUploadType: "basespace",
      samples: [{ name: "bs", _selectId: "1" }],
    });
    const rowProps: $TSFixMe = {
      className: "base",
      columns: [<div key="c" />],
      index: 0,
      key: "row-0",
      // No finishedValidating / isValid keys at all -- must not throw.
      rowData: { name: "bs", _selectId: "1" },
      style: {},
    };
    expect(mockTableProps.rowRenderer(rowProps)).toBeTruthy();
    expect(mockCx).not.toHaveBeenCalled();
    expect(rowProps.className).toBe("base");
  });
});
