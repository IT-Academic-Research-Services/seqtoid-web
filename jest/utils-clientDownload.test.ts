// Coverage: app/assets/src/components/utils/clientDownload.ts
// Turns an API response into a Blob and triggers a browser download by
// synthesizing a temporary <a> element, so the assertions are on the DOM node
// that gets clicked and then removed.
import { postWithCSRF } from "~/api/core";
import {
  generateClientDownloadFromEndpoint,
  triggerFileDownload,
} from "~/components/utils/clientDownload";

jest.mock("~/api/core", () => ({
  postWithCSRF: jest.fn(),
}));

const mockedPost = postWithCSRF as jest.Mock;

let createObjectURL: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  createObjectURL = jest.fn(() => "blob:mock-url");
  // jsdom does not implement the URL.createObjectURL half of the File API.
  (URL as $TSFixMe).createObjectURL = createObjectURL;
  document.body.innerHTML = "";
});

describe("triggerFileDownload", () => {
  it("appends, clicks and removes a hidden anchor carrying the download attributes", () => {
    const appendSpy = jest.spyOn(document.body, "appendChild");
    const removeSpy = jest.spyOn(document.body, "removeChild");
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click");

    triggerFileDownload({
      downloadUrl: "blob:some-url",
      fileName: "report.csv",
    });

    expect(appendSpy).toHaveBeenCalledTimes(1);
    const link = appendSpy.mock.calls[0][0] as HTMLAnchorElement;
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("blob:some-url");
    expect(link.getAttribute("download")).toBe("report.csv");
    expect(link.getAttribute("visibility")).toBe("hidden");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.getAttribute("target")).toBe("_blank");

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledWith(link);
    // The anchor must not be left behind in the document.
    expect(document.body.querySelector("a")).toBeNull();

    appendSpy.mockRestore();
    removeSpy.mockRestore();
    clickSpy.mockRestore();
  });
});

describe("generateClientDownloadFromEndpoint", () => {
  it("posts to the endpoint, wraps the response in a typed Blob and downloads it", async () => {
    mockedPost.mockResolvedValue("a,b\n1,2\n");
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click");
    const appendSpy = jest.spyOn(document.body, "appendChild");

    await generateClientDownloadFromEndpoint({
      endpoint: "/samples/1/report_csv",
      params: { id: 1 },
      fileName: "sample_report.csv",
      fileType: "text/csv",
    });

    expect(mockedPost).toHaveBeenCalledWith("/samples/1/report_csv", { id: 1 });

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("text/csv");

    const link = appendSpy.mock.calls[0][0] as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("blob:mock-url");
    expect(link.getAttribute("download")).toBe("sample_report.csv");
    expect(clickSpy).toHaveBeenCalledTimes(1);

    clickSpy.mockRestore();
    appendSpy.mockRestore();
  });

  it("posts with undefined params when none are supplied", async () => {
    mockedPost.mockResolvedValue("payload");

    await generateClientDownloadFromEndpoint({
      endpoint: "/bulk_downloads/metadata",
      fileName: "metadata.tsv",
      fileType: "text/tab-separated-values",
    });

    expect(mockedPost).toHaveBeenCalledWith(
      "/bulk_downloads/metadata",
      undefined,
    );
    expect(createObjectURL.mock.calls[0][0].type).toBe(
      "text/tab-separated-values",
    );
  });

  it("propagates a failure from the endpoint and never starts a download", async () => {
    mockedPost.mockRejectedValue(new Error("500 Internal Server Error"));
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click");

    await expect(
      generateClientDownloadFromEndpoint({
        endpoint: "/samples/1/report_csv",
        fileName: "sample_report.csv",
        fileType: "text/csv",
      }),
    ).rejects.toThrow("500 Internal Server Error");

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(clickSpy).not.toHaveBeenCalled();
    expect(document.body.querySelector("a")).toBeNull();

    clickSpy.mockRestore();
  });
});
