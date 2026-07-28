// Frontend coverage: app/assets/src/components/views/BulkDownloadListView/downloadTypeInfo.ts
// This is the catalogue that drives the bulk-download modal: every entry's
// shape (type key matching its map key, fields, option values) is what the
// form renderer relies on, so the invariants are pinned here rather than the
// prose of each description.
import { BULK_DOWNLOAD_TYPE_INFO } from "~/components/views/BulkDownloadListView/downloadTypeInfo";

describe("BULK_DOWNLOAD_TYPE_INFO", () => {
  it("keys every entry by its own `type` and always gives it a displayName", () => {
    const entries = Object.entries(BULK_DOWNLOAD_TYPE_INFO);
    expect(entries.length).toBeGreaterThan(10);

    entries.forEach(([key, info]) => {
      expect(info.type).toBe(key);
      expect(typeof info.displayName).toBe("string");
      expect(info.displayName.length).toBeGreaterThan(0);
    });
  });

  it("covers the download types referenced by the rest of the app", () => {
    [
      "sample_metadata",
      "sample_overview",
      "sample_taxon_report",
      "combined_sample_taxon_results",
      "contig_summary_report",
      "amr_results_bulk_download",
      "amr_combined_results_bulk_download",
      "amr_contigs_bulk_download",
      "consensus_genome",
      "consensus_genome_intermediate_output_files",
      "host_gene_counts",
      "contigs_non_host",
      "reads_non_host",
      "unmapped_reads",
      "biom_format",
      "customer_support_request",
    ].forEach(type => {
      expect(BULK_DOWNLOAD_TYPE_INFO[type]).toBeDefined();
    });
  });

  it("describes the samples overview include-metadata field with a No default", () => {
    const overview = BULK_DOWNLOAD_TYPE_INFO["sample_overview"];
    expect(overview.fileTypeDisplay).toBe(".csv");
    expect(overview.fields).toHaveLength(1);
    const field = overview.fields[0];
    expect(field.type).toBe("include_metadata");
    expect(field.displayName).toBe("Include Metadata");
    expect(field.default_value).toEqual({ value: false, displayName: "No" });
  });

  it("gates the biom format download behind the microbiome feature flag", () => {
    const biom = BULK_DOWNLOAD_TYPE_INFO["biom_format"];
    expect(biom.required_allowed_feature).toBe("microbiome");
    expect(biom.category).toBe("reports");
    expect(biom.fileTypeDisplay).toBe(".biom");
    expect(biom.fields.map(f => f.type)).toEqual([
      "metric",
      "filter_by",
      "background",
    ]);
  });

  it("offers fasta and fastq for non-host reads and a taxon selector", () => {
    const reads = BULK_DOWNLOAD_TYPE_INFO["reads_non_host"];
    expect(reads.category).toBe("raw_data");
    const fieldTypes = reads.fields.map(f => f.type);
    expect(fieldTypes).toEqual(["taxa_with_reads", "file_format"]);
    const fileFormat = reads.fields.find(f => f.type === "file_format");
    expect(fileFormat.options).toEqual([".fasta", ".fastq"]);
  });

  it("offers separate-files and concatenated consensus genome formats whose optionValues agree with the labels", () => {
    const cg = BULK_DOWNLOAD_TYPE_INFO["consensus_genome"];
    expect(cg.fileTypeDisplay).toBe("consensus.fa");
    const downloadFormat = cg.fields[0];
    expect(downloadFormat.type).toBe("download_format");
    expect(downloadFormat.options).toEqual([
      "Separate Files",
      "Single File (Concatenated)",
    ]);
    expect(downloadFormat.optionValues.zip).toEqual({
      label: "Separate Files",
      value: "zip",
    });
    expect(downloadFormat.optionValues.concatenate).toEqual({
      label: "Single File (Concatenated)",
      value: "concatenate",
    });
    // Every listed label must have a matching optionValue entry.
    const labels = Object.values(downloadFormat.optionValues).map(
      (v: $TSFixMe) => v.label,
    );
    expect(labels.sort()).toEqual([...downloadFormat.options].sort());
  });

  it("marks report-style downloads with the reports category", () => {
    ["contig_summary_report", "sample_taxon_report", "biom_format"].forEach(
      type => {
        expect(BULK_DOWNLOAD_TYPE_INFO[type].category).toBe("reports");
      },
    );
    ["contigs_non_host", "reads_non_host", "unmapped_reads"].forEach(type => {
      expect(BULK_DOWNLOAD_TYPE_INFO[type].category).toBe("raw_data");
    });
  });

  it("leaves fields undefined for the parameterless download types", () => {
    ["unmapped_reads", "host_gene_counts", "customer_support_request"].forEach(
      type => {
        expect(BULK_DOWNLOAD_TYPE_INFO[type].fields).toBeUndefined();
      },
    );
  });

  it("gives the AMR downloads their file type displays", () => {
    expect(
      BULK_DOWNLOAD_TYPE_INFO["amr_results_bulk_download"].fileTypeDisplay,
    ).toBe(".tar.gz");
    expect(
      BULK_DOWNLOAD_TYPE_INFO["amr_combined_results_bulk_download"]
        .fileTypeDisplay,
    ).toBe(".csv");
  });
});
