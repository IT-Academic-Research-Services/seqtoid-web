// Coverage for BulkDownloadDataField, which decides -- per bulk download field
// -- whether to render nothing, a forced ".fasta" placeholder, a checkbox, a
// taxon picker, a threshold filter, a background picker or a plain dropdown.
// It is almost entirely branch logic, so each switch arm and each side of the
// conditional-field guards is exercised.
//
// The leaf inputs (Dropdown, BackgroundModelFilter, TaxonHitSelect,
// ThresholdFilterModal) are replaced with thin stubs: they are separately
// tested, and stubbing them lets us drive their onChange callbacks directly to
// reach the "reset dependent conditional fields" logic in this component.
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

let mockDropdownValue: $TSFixMe = "NT.rpm";

jest.mock("~/components/ui/controls/dropdowns", () => ({
  __esModule: true,
  Dropdown: (props: $TSFixMe) => (
    <button
      data-testid="dropdown"
      data-placeholder={props.placeholder}
      data-options={JSON.stringify(props.options)}
      data-value={String(props.value)}
      onClick={() => props.onChange(mockDropdownValue, "chosen-display-name")}
    />
  ),
}));

jest.mock(
  "~/components/views/SampleView/components/MngsReport/components/ReportFilters/components/BackgroundModelFilter",
  () => ({
    __esModule: true,
    default: (props: $TSFixMe) => (
      <button
        data-testid="background-filter"
        data-placeholder={props.placeholder}
        data-mass-normalized={String(props.enableMassNormalizedBackgrounds)}
        data-num-backgrounds={String(props.allBackgrounds?.length)}
        onClick={() => props.onChange(mockDropdownValue, "background-display")}
      />
    ),
  }),
);

jest.mock(
  "~/components/views/DiscoveryView/components/SamplesView/components/BulkDownloadModal/components/BulkDownloadModalOptions/components/TaxonHitSelect",
  () => ({
    __esModule: true,
    TaxonHitSelect: (props: $TSFixMe) => (
      <button
        data-testid="taxon-hit-select"
        data-hit-type={props.hitType}
        data-value={String(props.value)}
        data-num-samples={String(props.sampleIds?.size)}
        onClick={() => props.onChange(573, "Klebsiella")}
      />
    ),
  }),
);

jest.mock(
  "~/components/views/DiscoveryView/components/SamplesView/components/BulkDownloadModal/components/BulkDownloadModalOptions/components/ThresholdFilterModal",
  () => ({
    __esModule: true,
    ThresholdFilterModal: (props: $TSFixMe) => (
      <button
        data-testid="threshold-filter-modal"
        onClick={() => props.addFilterList("filters")}
      />
    ),
  }),
);

import { BulkDownloadDataField } from "~/components/views/DiscoveryView/components/SamplesView/components/BulkDownloadModal/components/BulkDownloadModalOptions/components/BulkDownloadDataField/BulkDownloadDataField";

// Keeps prettier's organize-imports from dropping the React import that the
// classic JSX runtime needs in scope.
const _React: typeof React = React;

const renderField = (props: $TSFixMe) => {
  const onSelectField = props.onSelectField || jest.fn();
  const result = render(
    <BulkDownloadDataField
      backgroundOptions={[
        { text: "Background A", value: 1, mass_normalized: false },
      ]}
      metricsOptions={[{ text: "NT rPM", value: "NT.rpm" }]}
      onSelectField={onSelectField}
      selectedFields={{}}
      validObjectIds={new Set(["1", "2", "3"])}
      {...props}
    />,
  );
  return { ...result, onSelectField };
};

beforeEach(() => {
  mockDropdownValue = "NT.rpm";
});

describe("BulkDownloadDataField conditional fields", () => {
  const readsNonHost = { type: "reads_non_host" } as $TSFixMe;
  const fileFormatField = {
    type: "file_format",
    display_name: "File Format",
    options: [".fasta", ".fastq"],
  } as $TSFixMe;

  it("forces .fasta when a single taxon is selected for reads_non_host", () => {
    const { container } = renderField({
      downloadType: readsNonHost,
      field: fileFormatField,
      selectedDownloadTypeName: "reads_non_host",
      selectedFields: { reads_non_host: { taxa_with_reads: 573 } },
    });
    expect(container.textContent).toContain("File Format:");
    expect(container.textContent).toContain(".fasta");
    expect(container.textContent).toContain(
      "Only .fasta is available when selecting one taxon.",
    );
    expect(screen.queryByTestId("dropdown")).toBeNull();
  });

  it("renders the real file format dropdown when all taxa are selected", () => {
    renderField({
      downloadType: readsNonHost,
      field: fileFormatField,
      selectedDownloadTypeName: "reads_non_host",
      selectedFields: { reads_non_host: { taxa_with_reads: "all" } },
    });
    const dropdown = screen.getByTestId("dropdown");
    expect(dropdown.getAttribute("data-placeholder")).toBe(
      "Select file format",
    );
    expect(JSON.parse(dropdown.getAttribute("data-options") as string)).toEqual(
      [
        { text: ".fasta", value: ".fasta" },
        { text: ".fastq", value: ".fastq" },
      ],
    );
  });

  it("renders nothing for an untriggered non-file-format conditional field", () => {
    const { container } = renderField({
      downloadType: { type: "combined_sample_taxon_results" },
      field: { type: "background", display_name: "Background" },
      selectedDownloadTypeName: "combined_sample_taxon_results",
      selectedFields: {
        combined_sample_taxon_results: { metric: "NT.rpm" },
      },
    });
    expect(container.innerHTML).toBe("");
  });

  it("renders the background picker once a z-score metric triggers it", () => {
    renderField({
      downloadType: { type: "combined_sample_taxon_results" },
      field: { type: "background", display_name: "Background" },
      selectedDownloadTypeName: "combined_sample_taxon_results",
      selectedFields: {
        combined_sample_taxon_results: { metric: "NT.zscore" },
      },
    });
    const bg = screen.getByTestId("background-filter");
    expect(bg.getAttribute("data-placeholder")).toBe("Select background");
    expect(bg.getAttribute("data-num-backgrounds")).toBe("1");
  });

  it("shows a Loading... placeholder while background options are absent", () => {
    renderField({
      backgroundOptions: null,
      downloadType: { type: "combined_sample_taxon_results" },
      field: { type: "background", display_name: "Background" },
      selectedDownloadTypeName: "combined_sample_taxon_results",
      selectedFields: {
        combined_sample_taxon_results: { metric: "NR.zscore" },
      },
    });
    expect(
      screen.getByTestId("background-filter").getAttribute("data-placeholder"),
    ).toBe("Loading...");
  });

  it("treats a missing selectedDownloadTypeName as no selected fields", () => {
    // With no per-type selections the file_format conditional field IS
    // triggered (undefined is one of its trigger values), so the dropdown --
    // not the forced .fasta placeholder -- renders.
    renderField({
      downloadType: readsNonHost,
      field: fileFormatField,
      selectedDownloadTypeName: null,
    });
    expect(screen.getByTestId("dropdown").getAttribute("data-value")).toBe(
      "undefined",
    );
  });
});

describe("BulkDownloadDataField field types", () => {
  const sampleMetadata = { type: "sample_metadata" } as $TSFixMe;

  it("renders an unchecked metadata checkbox and reports checking it", () => {
    const onSelectField = jest.fn();
    renderField({
      downloadType: sampleMetadata,
      field: { type: "include_metadata", display_name: "Include Metadata" },
      selectedDownloadTypeName: "sample_metadata",
      onSelectField,
    });
    const input = document.querySelector(
      "input[type=checkbox]",
    ) as HTMLInputElement;
    expect(input.checked).toBe(false);
    fireEvent.click(screen.getByTestId("check-box"));
    expect(onSelectField).toHaveBeenCalledWith(
      "sample_metadata",
      "include_metadata",
      true,
      "Yes",
    );
  });

  it("renders a checked metadata checkbox and reports unchecking it", () => {
    const onSelectField = jest.fn();
    renderField({
      downloadType: sampleMetadata,
      field: { type: "include_metadata", display_name: "Include Metadata" },
      selectedDownloadTypeName: "sample_metadata",
      selectedFields: { sample_metadata: { include_metadata: true } },
      onSelectField,
    });
    const input = document.querySelector(
      "input[type=checkbox]",
    ) as HTMLInputElement;
    expect(input.checked).toBe(true);
    fireEvent.click(screen.getByTestId("check-box"));
    expect(onSelectField).toHaveBeenCalledWith(
      "sample_metadata",
      "include_metadata",
      false,
      "No",
    );
  });

  it("renders a read taxon picker and forwards its selection", () => {
    const onSelectField = jest.fn();
    const { container } = renderField({
      downloadType: { type: "reads_non_host" },
      field: { type: "taxa_with_reads", display_name: "Taxon" },
      selectedDownloadTypeName: "reads_non_host",
      selectedFields: { reads_non_host: { taxa_with_reads: 42 } },
      onSelectField,
    });
    const picker = screen.getByTestId("taxon-hit-select");
    expect(picker.getAttribute("data-hit-type")).toBe("read");
    expect(picker.getAttribute("data-value")).toBe("42");
    expect(picker.getAttribute("data-num-samples")).toBe("3");
    expect(container.textContent).toContain("Taxon:");
    fireEvent.click(picker);
    expect(onSelectField).toHaveBeenCalledWith(
      "reads_non_host",
      "taxa_with_reads",
      573,
      "Klebsiella",
    );
  });

  it("renders a contig taxon picker and forwards its selection", () => {
    const onSelectField = jest.fn();
    renderField({
      downloadType: { type: "contigs_non_host" },
      field: { type: "taxa_with_contigs", display_name: "Taxon" },
      selectedDownloadTypeName: "contigs_non_host",
      onSelectField,
    });
    const picker = screen.getByTestId("taxon-hit-select");
    expect(picker.getAttribute("data-hit-type")).toBe("contig");
    fireEvent.click(picker);
    expect(onSelectField).toHaveBeenCalledWith(
      "contigs_non_host",
      "taxa_with_contigs",
      573,
      "Klebsiella",
    );
  });

  it("uses the microbiome metric list for biom_format downloads", () => {
    renderField({
      downloadType: { type: "biom_format" },
      field: { type: "metric", display_name: "Metric" },
      selectedDownloadTypeName: "biom_format",
      selectedFields: { biom_format: { metric: "NT.rpm" } },
    });
    const options = JSON.parse(
      screen.getByTestId("dropdown").getAttribute("data-options") as string,
    );
    expect(options).toHaveLength(4);
    expect(options.map((o: $TSFixMe) => o.value)).toEqual([
      "NT.rpm",
      "NT.r",
      "NR.rpm",
      "NR.r",
    ]);
  });

  it("uses the supplied metrics for other download types", () => {
    renderField({
      downloadType: { type: "combined_sample_taxon_results" },
      field: { type: "metric", display_name: "Metric" },
      selectedDownloadTypeName: "combined_sample_taxon_results",
    });
    const dropdown = screen.getByTestId("dropdown");
    expect(dropdown.getAttribute("data-placeholder")).toBe("Select metric");
    expect(JSON.parse(dropdown.getAttribute("data-options") as string)).toEqual(
      [{ text: "NT rPM", value: "NT.rpm" }],
    );
  });

  it("shows Loading... and an empty metric list while metrics are absent", () => {
    renderField({
      metricsOptions: null,
      downloadType: { type: "combined_sample_taxon_results" },
      field: { type: "metric", display_name: "Metric" },
      selectedDownloadTypeName: "combined_sample_taxon_results",
    });
    const dropdown = screen.getByTestId("dropdown");
    expect(dropdown.getAttribute("data-placeholder")).toBe("Loading...");
    expect(JSON.parse(dropdown.getAttribute("data-options") as string)).toEqual(
      [],
    );
  });

  it("renders the optional threshold filter for filter_by", () => {
    const onSelectField = jest.fn();
    const { container } = renderField({
      downloadType: { type: "biom_format" },
      field: { type: "filter_by", display_name: "Filter by" },
      selectedDownloadTypeName: "biom_format",
      selectedFields: { biom_format: { metric: "NT.rpm" } },
      onSelectField,
    });
    expect(container.textContent).toContain("Filter by:");
    expect(container.textContent).toContain("optional");
    fireEvent.click(screen.getByTestId("threshold-filter-modal"));
    expect(onSelectField).toHaveBeenCalledWith("filters");
  });

  it("renders the CG download format dropdown", () => {
    renderField({
      downloadType: { type: "consensus_genome" },
      field: {
        type: "download_format",
        display_name: "Download Format",
        options: ["Single File", "Separate Files"],
      },
      selectedDownloadTypeName: "consensus_genome",
    });
    const dropdown = screen.getByTestId("dropdown");
    expect(dropdown.getAttribute("data-placeholder")).toBe("Select format");
    expect(JSON.parse(dropdown.getAttribute("data-options") as string)).toEqual(
      [
        { text: "Single File", value: "Single File" },
        { text: "Separate Files", value: "Separate Files" },
      ],
    );
  });

  it("renders nothing for a field type it does not know about", () => {
    const { container } = renderField({
      downloadType: { type: "sample_metadata" },
      field: { type: "mystery_field", display_name: "Mystery" },
      selectedDownloadTypeName: "sample_metadata",
    });
    expect(container.innerHTML).toBe("");
  });
});

describe("BulkDownloadDataField dependent-field resets", () => {
  it("clears the background when a non-z-score metric is chosen", () => {
    const onSelectField = jest.fn();
    mockDropdownValue = "NT.rpm";
    renderField({
      downloadType: { type: "combined_sample_taxon_results" },
      field: { type: "metric", display_name: "Metric" },
      selectedDownloadTypeName: "combined_sample_taxon_results",
      onSelectField,
    });
    fireEvent.click(screen.getByTestId("dropdown"));
    expect(onSelectField).toHaveBeenNthCalledWith(
      1,
      "combined_sample_taxon_results",
      "metric",
      "NT.rpm",
      "chosen-display-name",
    );
    expect(onSelectField).toHaveBeenNthCalledWith(
      2,
      "combined_sample_taxon_results",
      "background",
      undefined,
      undefined,
    );
    expect(onSelectField).toHaveBeenCalledTimes(2);
  });

  it("keeps the background when a z-score metric is chosen", () => {
    const onSelectField = jest.fn();
    mockDropdownValue = "NT.zscore";
    renderField({
      downloadType: { type: "combined_sample_taxon_results" },
      field: { type: "metric", display_name: "Metric" },
      selectedDownloadTypeName: "combined_sample_taxon_results",
      onSelectField,
    });
    fireEvent.click(screen.getByTestId("dropdown"));
    expect(onSelectField).toHaveBeenCalledTimes(1);
    expect(onSelectField).toHaveBeenCalledWith(
      "combined_sample_taxon_results",
      "metric",
      "NT.zscore",
      "chosen-display-name",
    );
  });

  it("does not reset anything when the download type has no conditional field", () => {
    const onSelectField = jest.fn();
    mockDropdownValue = "NT.rpm";
    renderField({
      downloadType: { type: "sample_taxon_report" },
      field: { type: "metric", display_name: "Metric" },
      selectedDownloadTypeName: "sample_taxon_report",
      onSelectField,
    });
    fireEvent.click(screen.getByTestId("dropdown"));
    expect(onSelectField).toHaveBeenCalledTimes(1);
  });

  it("reports a background selection without resetting other fields", () => {
    const onSelectField = jest.fn();
    mockDropdownValue = 7;
    renderField({
      downloadType: { type: "combined_sample_taxon_results" },
      field: { type: "background", display_name: "Background" },
      selectedDownloadTypeName: "combined_sample_taxon_results",
      selectedFields: {
        combined_sample_taxon_results: { metric: "NT.zscore" },
      },
      shouldEnableMassNormalizedBackgrounds: true,
      onSelectField,
    });
    const bg = screen.getByTestId("background-filter");
    expect(bg.getAttribute("data-mass-normalized")).toBe("true");
    fireEvent.click(bg);
    expect(onSelectField).toHaveBeenCalledTimes(1);
    expect(onSelectField).toHaveBeenCalledWith(
      "combined_sample_taxon_results",
      "background",
      7,
      "background-display",
    );
  });
});
