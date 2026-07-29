// Frontend coverage:
// app/assets/src/components/views/BulkDownloadListView/BulkDownloadList/components/BulkDownloadTableRenderers/BulkDownloadTableRenderers.tsx
//
// These are the static cell renderers for the Bulk Downloads table. Each one
// branches on the row data (admin vs not, succeeded-with-url vs in-progress vs
// failed, metadata vs workflow counts, numeric vs missing file size). The
// tests below drive both sides of every branch and assert on the rendered
// output. openUrl is mocked so the "Download File" click is observable without
// touching window.location.
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { openUrl } from "~/components/utils/links";
import { BulkDownloadTableRenderers } from "~/components/views/BulkDownloadListView/BulkDownloadList/components/BulkDownloadTableRenderers/BulkDownloadTableRenderers";
import { BulkDownloadStatus } from "~/interface/shared";

jest.mock("~/components/utils/links", () => ({
  openUrl: jest.fn(),
}));

const renderNode = (node: React.ReactNode) => render(<div>{node}</div>);

describe("BulkDownloadTableRenderers", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("renderDownload", () => {
    it("returns null when there is no row data", () => {
      expect(BulkDownloadTableRenderers.renderDownload({ rowData: null })).toBe(
        null,
      );
    });

    it("renders the display name and fires the details callback", () => {
      const onDetailsClick = jest.fn();
      renderNode(
        BulkDownloadTableRenderers.renderDownload({
          rowData: {
            id: "dl-1",
            downloadType: "sample_metadata",
            status: BulkDownloadStatus.SUCCEEDED,
            statusType: "success",
            tooltipText: "",
            ownerUserId: 42,
            onDetailsClick,
          },
        }),
      );
      expect(screen.getByTestId("download-name").textContent).toBe(
        "Sample Metadata",
      );
      fireEvent.click(screen.getByTestId("download-details-link"));
      expect(onDetailsClick).toHaveBeenCalledTimes(1);
      // Non-admin -> no user id string is rendered.
      expect(screen.queryByText(/User Id:/)).toBeNull();
    });

    it("renders the owner user id only in the admin variant", () => {
      renderNode(
        BulkDownloadTableRenderers.renderDownload(
          {
            rowData: {
              id: "dl-2",
              downloadType: "sample_metadata",
              status: BulkDownloadStatus.SUCCEEDED,
              statusType: "success",
              tooltipText: "",
              ownerUserId: 99,
              onDetailsClick: jest.fn(),
            },
          },
          true,
        ),
      );
      expect(screen.getByText(/User Id: 99/)).toBeTruthy();
    });
  });

  describe("renderCount", () => {
    it("uses Sample/Samples for the metadata download type", () => {
      renderNode(
        BulkDownloadTableRenderers.renderCount({
          rowData: { downloadType: "sample_metadata", analysisCount: 1 },
        }),
      );
      expect(screen.getByText("1 Sample")).toBeTruthy();
    });

    it("pluralizes the metadata count when more than one", () => {
      renderNode(
        BulkDownloadTableRenderers.renderCount({
          rowData: { downloadType: "sample_metadata", analysisCount: 3 },
        }),
      );
      expect(screen.getByText("3 Samples")).toBeTruthy();
    });

    it("uses the singular workflow label for a non-metadata single count", () => {
      renderNode(
        BulkDownloadTableRenderers.renderCount({
          rowData: {
            downloadType: "consensus_genome",
            entityInputFileType: "consensus-genome",
            analysisCount: 1,
          },
        }),
      );
      expect(screen.getByText("1 Consensus Genome")).toBeTruthy();
    });

    it("uses the pluralized workflow label for a non-metadata multi count", () => {
      renderNode(
        BulkDownloadTableRenderers.renderCount({
          rowData: {
            downloadType: "consensus_genome",
            entityInputFileType: "consensus-genome",
            analysisCount: 4,
          },
        }),
      );
      expect(screen.getByText("4 Consensus Genomes")).toBeTruthy();
    });

    it("returns null and logs when no analysis type string can be resolved", () => {
      const spy = jest.spyOn(console, "error").mockImplementation(() => null);
      const result = BulkDownloadTableRenderers.renderCount({
        rowData: {
          downloadType: "consensus_genome",
          entityInputFileType: "not-a-real-workflow",
          analysisCount: 2,
        },
      });
      expect(result).toBe(null);
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe("renderStatus", () => {
    it("renders a working Download File link for a succeeded download with a url", () => {
      renderNode(
        BulkDownloadTableRenderers.renderStatus({
          rowData: {
            id: "dl-3",
            status: BulkDownloadStatus.SUCCEEDED,
            url: "https://example.com/file.zip",
          },
        }),
      );
      const link = screen.getByText("Download File");
      fireEvent.click(link);
      expect(openUrl).toHaveBeenCalledWith("https://example.com/file.zip");
    });

    it("renders a loading bar for in-progress downloads", () => {
      const { container } = renderNode(
        BulkDownloadTableRenderers.renderStatus({
          rowData: { id: "dl-4", status: BulkDownloadStatus.RUNNING },
        }),
      );
      expect(screen.queryByText("Download File")).toBeNull();
      expect(screen.queryByText("Contact us")).toBeNull();
      // The in-progress branch renders the LoadingBar cell keyed by row id.
      expect(container.querySelector("#dl-4")).toBeTruthy();
    });

    it("falls back to a Contact us link for other statuses", () => {
      renderNode(
        BulkDownloadTableRenderers.renderStatus({
          rowData: { id: "dl-5", status: BulkDownloadStatus.FAILED },
        }),
      );
      const link = screen.getByText("Contact us");
      expect(link).toBeTruthy();
      expect(link.getAttribute("target")).toBe("_blank");
    });

    it("falls back to Contact us when succeeded but no url is present", () => {
      renderNode(
        BulkDownloadTableRenderers.renderStatus({
          rowData: { id: "dl-6", status: BulkDownloadStatus.SUCCEEDED },
        }),
      );
      expect(screen.getByText("Contact us")).toBeTruthy();
      expect(screen.queryByText("Download File")).toBeNull();
    });
  });

  describe("renderFileSize", () => {
    it("returns null when the file size is not a number", () => {
      expect(
        BulkDownloadTableRenderers.renderFileSize({
          rowData: { fileSize: undefined },
        }),
      ).toBe(null);
    });

    it("returns null for NaN file sizes", () => {
      expect(
        BulkDownloadTableRenderers.renderFileSize({
          rowData: { fileSize: NaN },
        }),
      ).toBe(null);
    });

    it("formats a numeric byte count into a human readable size", () => {
      renderNode(
        BulkDownloadTableRenderers.renderFileSize({
          rowData: { fileSize: 2048 },
        }),
      );
      // 2048 bytes -> 2 KB via formatFileSize.
      expect(screen.getByText(/KB/)).toBeTruthy();
    });
  });
});
