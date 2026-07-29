// Coverage: app/assets/src/components/views/SampleUploadFlow/components/ReviewStep/components/SampleInfo/components/ReviewTable/ReviewTable.tsx
//
// ReviewTable maps the upload's samples + metadata into columns/rows for a
// DataTable. DataTable is stubbed to capture the exact columns, per-column
// widths and row data it receives so the assertions land on this file's
// getDataHeaders / getDataRows / getColumnWidth logic. Branches walked:
// missing projectMetadataFields (Loading state), local vs basespace upload
// (different header sets + row assembly), the Human "Host Age" HIPAA scrub,
// getFieldDisplayName's known-vs-unknown key lookup, and every arm of the
// getColumnWidth switch (via the widths DataTable is asked to compute).
import { render, screen } from "@testing-library/react";
import { ReviewTable } from "~/components/views/SampleUploadFlow/components/ReviewStep/components/SampleInfo/components/ReviewTable/ReviewTable";

let lastColumns: string[] = [];
let lastData: $TSFixMe[] = [];
let lastGetColumnWidth: ((c: string) => number) | null = null;

jest.mock("~/components/visualizations/table/DataTable", () => ({
  __esModule: true,
  default: ({ columns, data, getColumnWidth }: $TSFixMe) => {
    lastColumns = columns;
    lastData = data;
    lastGetColumnWidth = getColumnWidth;
    return require("react").createElement(
      "div",
      { "data-testid": "data-table" },
      require("react").createElement(
        "span",
        { "data-testid": "row-count" },
        String(data.length),
      ),
    );
  },
}));

// returnHipaaCompliantMetadata is exercised for real; stubbing would hide the
// Human/Host Age branch. formatFileSize is real too.

const projectMetadataFields = {
  collection_date: { name: "Collection Date" },
  host_age: { name: "Host Age" },
};

const hostGenomes = [
  { id: 1, name: "Human" },
  { id: 2, name: "Mosquito" },
];

beforeEach(() => {
  lastColumns = [];
  lastData = [];
  lastGetColumnWidth = null;
});

describe("ReviewTable", () => {
  it("renders a Loading placeholder when projectMetadataFields is null", () => {
    render(
      <ReviewTable
        hostGenomes={hostGenomes as $TSFixMe}
        metadata={{ headers: [], rows: [] } as $TSFixMe}
        projectMetadataFields={null}
        samples={[] as $TSFixMe}
        uploadType="local"
      />,
    );
    expect(screen.getByText("Loading...")).toBeTruthy();
    expect(screen.queryByTestId("data-table")).toBeNull();
  });

  it("builds local-upload headers, input-file rows and scrubs Human Host Age", () => {
    const metadata = {
      headers: ["sample_name", "host_age", "collection_date"],
      rows: [
        {
          sample_name: "S1",
          host_age: "95",
          collection_date: "2021-01-01",
        },
      ],
    };
    const samples = [
      {
        name: "S1",
        host_genome_id: 1, // Human
        input_files_attributes: [{ concatenated: ["S1_R1.fastq"] }],
      },
    ];

    render(
      <ReviewTable
        hostGenomes={hostGenomes as $TSFixMe}
        metadata={metadata as $TSFixMe}
        projectMetadataFields={projectMetadataFields as $TSFixMe}
        samples={samples as $TSFixMe}
        uploadType="local"
      />,
    );

    // Non-basespace header set, sample_name omitted, display names mapped.
    expect(lastColumns).toEqual([
      "Sample Name",
      "Input Files",
      "Host Organism",
      "Host Age",
      "Collection Date",
    ]);

    expect(lastData).toHaveLength(1);
    const row = lastData[0];
    expect(row["Host Organism"]).toBe("Human");
    // Human + Host Age -> HIPAA compliant scrub turns 95 into the 90+ bucket.
    expect(row["Host Age"]).not.toBe("95");
    // Input Files column is a rendered node (present for local uploads).
    expect(row["Input Files"]).toBeTruthy();
  });

  it("builds basespace headers and file-size/type/project rows", () => {
    const metadata = {
      headers: ["sample_name", "collection_date"],
      rows: [{ sample_name: "S2", collection_date: "2021-02-02" }],
    };
    const samples = [
      {
        name: "S2",
        host_genome_id: 2, // Mosquito -> no HIPAA scrub
        file_size: 1024,
        file_type: "fastq",
        basespace_project_name: "BSProj",
      },
    ];

    render(
      <ReviewTable
        hostGenomes={hostGenomes as $TSFixMe}
        metadata={metadata as $TSFixMe}
        projectMetadataFields={projectMetadataFields as $TSFixMe}
        samples={samples as $TSFixMe}
        uploadType="basespace"
      />,
    );

    expect(lastColumns).toEqual([
      "Sample Name",
      "Basespace Project",
      "File Size",
      "File Type",
      "Host Organism",
      "Collection Date",
    ]);

    const row = lastData[0];
    expect(row["Host Organism"]).toBe("Mosquito");
    expect(row["File Type"]).toBe("fastq");
    expect(row["Basespace Project"]).toBe("BSProj");
    // formatFileSize converts 1024 bytes -> "1.0 kB".
    expect(row["File Size"]).toContain("kB");
  });

  it("returns the correct width for each getColumnWidth branch", () => {
    render(
      <ReviewTable
        hostGenomes={hostGenomes as $TSFixMe}
        metadata={{ headers: ["sample_name"], rows: [] } as $TSFixMe}
        projectMetadataFields={projectMetadataFields as $TSFixMe}
        samples={[] as $TSFixMe}
        uploadType="local"
      />,
    );
    const getColumnWidth = lastGetColumnWidth as (c: string) => number;
    expect(getColumnWidth("Sample Name")).toBe(200);
    expect(getColumnWidth("Input Files")).toBe(300);
    expect(getColumnWidth("Water Control")).toBe(80);
    expect(getColumnWidth("Nucleotide Type")).toBe(100);
    expect(getColumnWidth("Collection Date")).toBe(100);
    expect(getColumnWidth("Anything Else")).toBe(140);
  });

  it("falls back to the raw key when a metadata field has no display name", () => {
    const metadata = {
      headers: ["sample_name", "unknown_field"],
      rows: [{ sample_name: "S3", unknown_field: "x" }],
    };
    const samples = [
      {
        name: "S3",
        host_genome_id: 2,
        input_files_attributes: [{ concatenated: ["S3.fastq"] }],
      },
    ];
    render(
      <ReviewTable
        hostGenomes={hostGenomes as $TSFixMe}
        metadata={metadata as $TSFixMe}
        projectMetadataFields={projectMetadataFields as $TSFixMe}
        samples={samples as $TSFixMe}
        uploadType="local"
      />,
    );
    // unknown_field has no entry in projectMetadataFields -> raw key kept.
    expect(lastColumns).toContain("unknown_field");
  });
});
