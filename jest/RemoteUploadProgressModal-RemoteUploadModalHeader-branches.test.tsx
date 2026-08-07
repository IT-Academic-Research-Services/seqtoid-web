// Coverage: app/assets/src/components/views/SampleUploadFlow/components/UploadProgressModal/components/RemoteUploadProgressModal/components/RemoteUploadModalHeader/RemoteUploadModalHeader.tsx
//
// The header is a pile of mutually exclusive render gates (in-progress /
// complete-clean / complete-with-errors) plus three pluralisation ternaries and
// the basespace-vs-S3 copy switch. Each gate is driven from both sides here.
import { render, screen } from "@testing-library/react";

// The `~/...` alias wins over jest's stylesheet moduleNameMapper entry, so an
// aliased .scss import is handed to the real (un-transformable) file. Stub it.
jest.mock(
  "~/components/views/SampleUploadFlow/components/UploadProgressModal/upload_progress_modal.scss",
  () => ({}),
  { virtual: true },
);

import { UserContext } from "~/components/common/UserContext";
import { RemoteUploadModalHeader } from "~/components/views/SampleUploadFlow/components/UploadProgressModal/components/RemoteUploadProgressModal/components/RemoteUploadModalHeader/RemoteUploadModalHeader";

// SW-2: the contact link is authored as the "helpcenter:" sentinel and resolved
// against helpCenterHost by Link.tsx. Render under a known host for determinism.
const HELP_HOST = "https://helpcenter.test";

const renderHeader = (props: {
  isUploadComplete: boolean;
  nFailedSamples: number;
  nSamples: number;
  uploadType: string;
}) => {
  const { container } = render(
    <UserContext.Provider value={{ helpCenterHost: HELP_HOST } as $TSFixMe}>
      <RemoteUploadModalHeader projectName="My Project" {...props} />
    </UserContext.Provider>,
  );
  return (container.textContent ?? "").replace(/\s+/g, " ").trim();
};

describe("RemoteUploadModalHeader branches", () => {
  describe("upload still in progress", () => {
    it("uses the singular noun for a one-sample upload", () => {
      const text = renderHeader({
        isUploadComplete: false,
        nFailedSamples: 0,
        nSamples: 1,
        uploadType: "basespace",
      });

      expect(text).toContain("Creating 1 sample in My Project");
      expect(text).toContain("Stay on this page until upload completes.");
      // None of the completion copy may leak into the in-progress state.
      expect(text).not.toContain("successfully created");
      expect(text).not.toContain("All uploads failed");
    });

    it("uses the plural noun for a multi-sample upload", () => {
      const text = renderHeader({
        isUploadComplete: false,
        nFailedSamples: 0,
        nSamples: 4,
        uploadType: "s3",
      });

      expect(text).toContain("Creating 4 samples in My Project");
    });
  });

  describe("upload complete with no failures", () => {
    it("names Basespace as the file source for a basespace upload", () => {
      const text = renderHeader({
        isUploadComplete: true,
        nFailedSamples: 0,
        nSamples: 3,
        uploadType: "basespace",
      });

      expect(text).toContain("3 samples successfully created");
      expect(text).toContain(
        "We have started uploading your sample files from Basespace.",
      );
      expect(text).not.toContain("Stay on this page");
    });

    it("names S3 as the file source for any other upload type", () => {
      const text = renderHeader({
        isUploadComplete: true,
        nFailedSamples: 0,
        nSamples: 3,
        uploadType: "s3",
      });

      expect(text).toContain(
        "We have started uploading your sample files from S3.",
      );
      expect(text).not.toContain("Basespace");
    });
  });

  describe("upload complete with failures", () => {
    it("reports a single error in the singular and offers no help link", () => {
      const text = renderHeader({
        isUploadComplete: true,
        nFailedSamples: 1,
        nSamples: 3,
        uploadType: "s3",
      });

      expect(text).toContain("Uploads completed with 1 error");
      expect(text).not.toContain("1 errors");
      expect(screen.queryByText("Contact us for help")).toBeNull();
      expect(text).not.toContain("successfully created");
    });

    it("reports multiple errors in the plural", () => {
      const text = renderHeader({
        isUploadComplete: true,
        nFailedSamples: 2,
        nSamples: 3,
        uploadType: "s3",
      });

      expect(text).toContain("Uploads completed with 2 errors");
      expect(screen.queryByText("Contact us for help")).toBeNull();
    });

    it("switches to the total-failure headline and help link when every sample failed", () => {
      const text = renderHeader({
        isUploadComplete: true,
        nFailedSamples: 3,
        nSamples: 3,
        uploadType: "s3",
      });

      expect(text).toContain("All uploads failed");
      expect(text).not.toContain("Uploads completed with");

      const link = screen.getByText("Contact us for help");
      expect(link.getAttribute("href")).toBe(`${HELP_HOST}/contact`);
      expect(link.getAttribute("target")).toBe("_blank");
      // Routing through ExternalLink/Link normalises rel to "noopener noreferrer".
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    });
  });
});
