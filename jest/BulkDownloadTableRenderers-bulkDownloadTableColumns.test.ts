// Frontend coverage:
// app/assets/src/components/views/BulkDownloadListView/BulkDownloadList/components/BulkDownloadTableRenderers/bulkDownloadTableColumns.ts
// The column factory decides which renderer each Bulk Downloads table column
// uses and -- importantly -- closes over `isAdmin` for the download name
// column, so both the admin and non-admin closures are exercised here.
// The renderer module is mocked so the assertions are about wiring, not about
// the SDS components it renders.
import { TableRenderers } from "~/components/common/TableRenderers";
import { BulkDownloadTableRenderers } from "~/components/views/BulkDownloadListView/BulkDownloadList/components/BulkDownloadTableRenderers/BulkDownloadTableRenderers";
import { getBulkDownloadTableColumns } from "~/components/views/BulkDownloadListView/BulkDownloadList/components/BulkDownloadTableRenderers/bulkDownloadTableColumns";

jest.mock(
  "~/components/views/BulkDownloadListView/BulkDownloadList/components/BulkDownloadTableRenderers/BulkDownloadTableRenderers",
  () => ({
    BulkDownloadTableRenderers: {
      renderDownload: jest.fn(() => "download-cell"),
      renderCount: jest.fn(() => "count-cell"),
      renderFileSize: jest.fn(() => "file-size-cell"),
      renderStatus: jest.fn(() => "status-cell"),
    },
  }),
);

jest.mock("~/components/common/TableRenderers", () => ({
  TableRenderers: {
    renderDateWithElapsed: jest.fn(() => "date-cell"),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe("getBulkDownloadTableColumns", () => {
  it("returns the five bulk download columns in order with their labels and widths", () => {
    const columns = getBulkDownloadTableColumns({ isAdmin: false });

    expect(columns.map(c => c.dataKey)).toEqual([
      "downloadDisplayName",
      "startedAt",
      "analysisCount",
      "fileSize",
      "status",
    ]);
    expect(columns.map(c => c.label)).toEqual([
      "Download",
      "Date",
      "Count",
      "File Size",
      "",
    ]);
    expect(columns.map(c => c.width)).toEqual([500, 200, 180, 200, 120]);
  });

  it("lets only the download name column grow, and disables sorting only on status", () => {
    const columns = getBulkDownloadTableColumns({ isAdmin: false });

    expect(columns[0].flexGrow).toBe(1);
    columns.slice(1).forEach(column => {
      expect(column.flexGrow).toBeUndefined();
    });

    expect(columns[4].disableSort).toBe(true);
    columns.slice(0, 4).forEach(column => {
      expect(column.disableSort).toBeUndefined();
    });
  });

  it("wires each column to its renderer", () => {
    const columns = getBulkDownloadTableColumns({ isAdmin: false });
    const cellData = { rowData: { id: 1 } } as $TSFixMe;

    expect(columns[1].cellRenderer).toBe(TableRenderers.renderDateWithElapsed);
    expect(columns[2].cellRenderer).toBe(
      BulkDownloadTableRenderers.renderCount,
    );
    expect(columns[3].cellRenderer).toBe(
      BulkDownloadTableRenderers.renderFileSize,
    );
    expect(columns[4].cellRenderer).toBe(
      BulkDownloadTableRenderers.renderStatus,
    );

    // The download column is a closure rather than a direct reference.
    expect(columns[0].cellRenderer(cellData)).toBe("download-cell");
    expect(BulkDownloadTableRenderers.renderDownload).toHaveBeenCalledWith(
      cellData,
      false,
    );
  });

  it("passes isAdmin=true through the download cell closure", () => {
    const columns = getBulkDownloadTableColumns({ isAdmin: true });
    const cellData = { rowData: { id: 2 } } as $TSFixMe;

    columns[0].cellRenderer(cellData);

    expect(BulkDownloadTableRenderers.renderDownload).toHaveBeenCalledWith(
      cellData,
      true,
    );
  });

  it("returns a fresh array each call so callers cannot mutate shared column state", () => {
    const first = getBulkDownloadTableColumns({ isAdmin: false });
    const second = getBulkDownloadTableColumns({ isAdmin: false });

    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);
  });
});
