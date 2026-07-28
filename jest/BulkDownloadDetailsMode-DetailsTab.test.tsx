// Coverage: app/assets/src/components/common/DetailsSidebar/BulkDownloadDetailsMode/components/DetailsTab/DetailsTab.tsx
//
// DetailsTab reads a Relay fragment (stubbed here so useFragment returns the raw
// array it is handed), finds the matching bulk download, and builds a FieldList
// from the download-type config: a Samples count, a File Format, and one row per
// configured field. The field-value logic has three branches - a params
// displayName, a string value mapped through optionValues, and a JSON.stringify
// fallback for non-string values - all of which are exercised. It returns null
// when there is no matching download.
import { render, screen } from "@testing-library/react";

// relay-test-utils is not installed; stub react-relay so useFragment simply
// returns the array of download items passed in as the fragment ref.
jest.mock("react-relay", () => ({
  __esModule: true,
  graphql: () => ({}),
  useFragment: (_frag: unknown, data: unknown) => data,
}));

// This scss is imported through the "~/" alias, which the jest moduleNameMapper
// resolves before its "\.scss$" -> styleMock rule, so the raw scss would reach
// the transform. Stub it explicitly.
jest.mock(
  "~/components/common/DetailsSidebar/BulkDownloadDetailsMode/bulk_download_details_mode.scss",
  () => ({}),
);

import { DetailsTab } from "~/components/common/DetailsSidebar/BulkDownloadDetailsMode/components/DetailsTab/DetailsTab";

const renderTab = (items: $TSFixMe[], bulkDownloadId?: string) =>
  render(
    <DetailsTab
      bulkDownloadData={items as $TSFixMe}
      bulkDownloadId={bulkDownloadId}
    />,
  );

describe("DetailsTab null guards", () => {
  it("renders nothing when no download matches the id", () => {
    const { container } = renderTab(
      [{ id: "1", downloadType: "sample_metadata" }],
      "does-not-exist",
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when the matched download has no downloadType", () => {
    const { container } = renderTab([{ id: "1" }], "1");
    expect(container.firstChild).toBeNull();
  });
});

describe("DetailsTab common fields", () => {
  it("renders the Samples count and File Format, plus the samples list header", () => {
    renderTab(
      [
        {
          id: "1",
          downloadType: "sample_metadata",
          params: [],
          entityInputs: [
            { id: "a", name: "Sample A" },
            { id: "b", name: "Sample B" },
          ],
        },
      ],
      "1",
    );
    expect(screen.getByTestId("samples-value").textContent).toBe("2");
    expect(screen.getByTestId("file-format-value").textContent).toBe(
      "sample_metadata.csv",
    );
    // The "Samples in this Download" accordion header is present (collapsed).
    expect(screen.getByText("Samples in this Download")).toBeTruthy();
  });

  it("omits the Samples row and list when there are no entity inputs", () => {
    renderTab(
      [
        {
          id: "1",
          downloadType: "sample_metadata",
          params: [],
          entityInputs: [],
        },
      ],
      "1",
    );
    expect(screen.queryByTestId("samples-value")).toBeNull();
    expect(screen.queryByText("Samples in this Download")).toBeNull();
    // File Format still renders.
    expect(screen.getByTestId("file-format-value").textContent).toBe(
      "sample_metadata.csv",
    );
  });
});

describe("DetailsTab configured field values", () => {
  it("maps a string param value through the config optionValues label", () => {
    renderTab(
      [
        {
          id: "1",
          downloadType: "consensus_genome",
          params: [
            {
              paramType: "downloadFormat",
              value: "concatenate",
              displayName: null,
            },
          ],
          entityInputs: [],
        },
      ],
      "1",
    );
    expect(screen.getByTestId("download-format-value").textContent).toBe(
      "Single File (Concatenated)",
    );
  });

  it("prefers the param displayName when present, unmapped", () => {
    renderTab(
      [
        {
          id: "1",
          downloadType: "consensus_genome",
          params: [
            {
              paramType: "downloadFormat",
              value: "zip",
              displayName: "My Custom Label",
            },
          ],
          entityInputs: [],
        },
      ],
      "1",
    );
    expect(screen.getByTestId("download-format-value").textContent).toBe(
      "My Custom Label",
    );
  });

  it("stringifies a non-string param value with no displayName", () => {
    renderTab(
      [
        {
          id: "1",
          downloadType: "consensus_genome",
          params: [
            {
              paramType: "downloadFormat",
              value: { nested: 1 },
              displayName: null,
            },
          ],
          entityInputs: [],
        },
      ],
      "1",
    );
    expect(screen.getByTestId("download-format-value").textContent).toBe(
      JSON.stringify({ nested: 1 }),
    );
  });
});
