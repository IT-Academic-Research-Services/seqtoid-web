// Frontend coverage:
// app/assets/src/components/views/SampleUploadFlow/components/UploadSampleStep/
//   components/SampleUploadTable/components/SampleUploadTableRenderers/
//   SampleUploadTableRenderers.tsx
//
// Three static renderers used as react-virtualized column callbacks:
//   * getCellData -- pulls the per-row fields out of the raw sample object.
//   * renderFileNames -- one <div> per file name, greyed out (and given an
//     info tooltip carrying the validation error) only when that file is
//     explicitly invalid. Both guards matter: a missing `isValid` map and an
//     empty file name must NOT produce a tooltip.
//   * renderSelectableCell -- a spinner while any file is still validating,
//     otherwise a checkbox that is disabled (and carries the sentinel value
//     -1) unless at least one file of the sample is valid.
//
// react-virtualized's CellMeasurer measures DOM it cannot measure in jsdom, so
// it is stubbed down to "render the children". scss modules resolve to {} under
// jest, so `cs.disabled` is undefined and cannot be observed on the node --
// spying on emotion's `cx` is what makes the disabled/enabled branches
// distinguishable, matching the approach in UploadSampleStep-SampleUploadTable.
import { render, screen } from "@testing-library/react";

const mockCx = jest.fn((...args: $TSFixMe[]) => args.filter(Boolean).join(" "));
jest.mock("@emotion/css", () => ({
  cx: (...args: $TSFixMe[]) => mockCx(...args),
}));

jest.mock("react-virtualized", () => ({
  __esModule: true,
  CellMeasurer: (props: $TSFixMe) => (
    <div data-testid="cell-measurer" data-row-index={String(props.rowIndex)}>
      {props.children}
    </div>
  ),
  CellMeasurerCache: class {
    opts: $TSFixMe;
    constructor(opts: $TSFixMe) {
      this.opts = opts;
    }
  },
}));

jest.mock("~/components/ui/containers/ColumnHeaderTooltip", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => (
    <span data-testid="file-error-tooltip">
      {props.trigger}
      {String(props.content)}
    </span>
  ),
}));

jest.mock("@czi-sds/components", () => ({
  __esModule: true,
  Icon: (props: $TSFixMe) => <i data-testid={`icon-${props.sdsIcon}`} />,
}));

import { SampleUploadTableRenderers } from "~/components/views/SampleUploadFlow/components/UploadSampleStep/components/SampleUploadTable/components/SampleUploadTableRenderers/SampleUploadTableRenderers";

const renderFileNames = (cellData: $TSFixMe) =>
  render(
    <>
      {SampleUploadTableRenderers.renderFileNames({
        cellData,
        dataKey: "files",
        parent: {},
        rowIndex: 3,
      })}
    </>,
  );

const renderSelectableCell = (args: $TSFixMe) =>
  render(
    <>
      {SampleUploadTableRenderers.renderSelectableCell({
        selectableCellClassName: "cellClass",
        onSelectRow: jest.fn(),
        ...args,
      })}
    </>,
  );

describe("SampleUploadTableRenderers", () => {
  beforeEach(() => {
    mockCx.mockClear();
  });

  describe("getCellData", () => {
    it("projects the row fields the renderers need", () => {
      const rowData = {
        file_names_R1: ["a_R1.fastq"],
        finishedValidating: { "a_R1.fastq": true },
        _selectId: "42",
        isValid: { "a_R1.fastq": true },
        error: { "a_R1.fastq": "" },
      };

      expect(
        SampleUploadTableRenderers.getCellData({
          dataKey: "file_names_R1",
          rowData,
        }),
      ).toEqual({
        fileName: ["a_R1.fastq"],
        finishedValidating: { "a_R1.fastq": true },
        id: "42",
        isValid: { "a_R1.fastq": true },
        error: { "a_R1.fastq": "" },
      });
    });

    it("returns undefined fields for a row missing them entirely", () => {
      expect(
        SampleUploadTableRenderers.getCellData({
          dataKey: "file_names_R2",
          rowData: {},
        }),
      ).toEqual({
        fileName: undefined,
        finishedValidating: undefined,
        id: undefined,
        isValid: undefined,
        error: undefined,
      });
    });
  });

  describe("renderFileNames", () => {
    it("renders one entry per file inside the measured cell", () => {
      renderFileNames({
        fileName: ["a_R1.fastq", "a_R2.fastq"],
        isValid: { "a_R1.fastq": true, "a_R2.fastq": true },
        error: {},
      });

      expect(screen.getByTestId("cell-measurer").dataset.rowIndex).toBe("3");
      expect(screen.getByText("a_R1.fastq")).toBeTruthy();
      expect(screen.getByText("a_R2.fastq")).toBeTruthy();
      // Valid files get no info tooltip.
      expect(screen.queryByTestId("file-error-tooltip")).toBeNull();
    });

    it("marks an invalid file as disabled and shows its error tooltip", () => {
      const cxCallsBefore = mockCx.mock.calls.length;
      expect(cxCallsBefore).toBe(0);
      renderFileNames({
        fileName: ["bad.fastq"],
        isValid: { "bad.fastq": false },
        error: { "bad.fastq": "File is truncated" },
      });

      expect(screen.getByTestId("file-error-tooltip").textContent).toBe(
        "File is truncated",
      );
      expect(screen.getByTestId("icon-infoCircle")).toBeTruthy();
      // The class-name chain ran for this file (rather than being skipped),
      // i.e. the disabled styling branch was taken.
      expect(mockCx).toHaveBeenCalled();
    });

    it("does not tooltip a file when the isValid map is absent", () => {
      renderFileNames({
        fileName: ["unknown.fastq"],
        isValid: undefined,
        error: undefined,
      });

      expect(screen.getByText("unknown.fastq")).toBeTruthy();
      expect(screen.queryByTestId("file-error-tooltip")).toBeNull();
      expect(screen.queryByTestId("icon-infoCircle")).toBeNull();
    });

    it("does not tooltip an empty file name even when marked invalid", () => {
      renderFileNames({
        fileName: [""],
        isValid: { "": false },
        error: { "": "should not surface" },
      });

      expect(screen.queryByTestId("file-error-tooltip")).toBeNull();
      expect(screen.queryByText("should not surface")).toBeNull();
    });

    it("renders an empty cell for a sample with no files", () => {
      renderFileNames({ fileName: [], isValid: {}, error: {} });

      expect(screen.getByTestId("cell-measurer").textContent).toBe("");
    });
  });

  describe("renderSelectableCell", () => {
    it("shows a spinner while any file is still validating", () => {
      const { container } = renderSelectableCell({
        cellData: {
          id: "1",
          finishedValidating: { "a.fastq": true, "b.fastq": false },
          isValid: { "a.fastq": true, "b.fastq": true },
        },
        selected: new Set(),
      });

      expect(container.querySelector(".fa-spinner")).toBeTruthy();
      expect(screen.queryByTestId("row-select-checkbox")).toBeNull();
    });

    it("renders an enabled, unchecked checkbox for a valid unselected row", () => {
      renderSelectableCell({
        cellData: {
          id: "1",
          finishedValidating: { "a.fastq": true },
          isValid: { "a.fastq": true },
        },
        selected: new Set(["2"]),
      });

      const checkbox = screen
        .getByTestId("row-select-checkbox")
        .querySelector("input") as HTMLInputElement;
      expect(checkbox.disabled).toBe(false);
      expect(checkbox.checked).toBe(false);
      expect(checkbox.value).toBe("1");
    });

    it("checks the box when the row id is in the selected set", () => {
      renderSelectableCell({
        cellData: {
          id: "7",
          finishedValidating: { "a.fastq": true },
          isValid: { "a.fastq": true },
        },
        selected: new Set(["7"]),
      });

      const checkbox = screen
        .getByTestId("row-select-checkbox")
        .querySelector("input") as HTMLInputElement;
      expect(checkbox.checked).toBe(true);
    });

    it("stays enabled when only some of the files are valid", () => {
      renderSelectableCell({
        cellData: {
          id: "3",
          finishedValidating: { "a.fastq": true, "b.fastq": true },
          isValid: { "a.fastq": false, "b.fastq": true },
        },
        selected: new Set(),
      });

      const checkbox = screen
        .getByTestId("row-select-checkbox")
        .querySelector("input") as HTMLInputElement;
      expect(checkbox.disabled).toBe(false);
      expect(checkbox.value).toBe("3");
    });

    it("disables the row and uses the -1 sentinel when no file is valid", () => {
      renderSelectableCell({
        cellData: {
          id: "4",
          finishedValidating: { "a.fastq": true },
          isValid: { "a.fastq": false },
        },
        selected: new Set(),
      });

      const checkbox = screen
        .getByTestId("row-select-checkbox")
        .querySelector("input") as HTMLInputElement;
      expect(checkbox.disabled).toBe(true);
      expect(checkbox.value).toBe("-1");
    });

    it("does not fire onSelectRow for a disabled row", () => {
      const onSelectRow = jest.fn();
      renderSelectableCell({
        cellData: {
          id: "5",
          finishedValidating: { "a.fastq": true },
          isValid: { "a.fastq": false },
        },
        selected: new Set(),
        onSelectRow,
      });

      screen.getByTestId("row-select-checkbox").click();
      expect(onSelectRow).not.toHaveBeenCalled();
    });
  });

  it("exposes a shared CellMeasurerCache", () => {
    expect(SampleUploadTableRenderers.cache).toBeTruthy();
  });
});
