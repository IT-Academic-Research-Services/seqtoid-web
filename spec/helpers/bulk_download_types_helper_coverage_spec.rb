require "rails_helper"

# Characterization specs for BulkDownloadTypesHelper's module-level lookup
# methods and the derived constant data. The existing bulk_download specs stub
# these methods (`receive(:bulk_download_type)`), so the real implementations
# are otherwise unexercised. Spec-only: pins current behavior, changes no app code.
RSpec.describe BulkDownloadTypesHelper do
  describe ".bulk_download_types" do
    it "returns the frozen BULK_DOWNLOAD_TYPES array" do
      expect(described_class.bulk_download_types).to be(BulkDownloadTypesHelper::BULK_DOWNLOAD_TYPES)
      expect(described_class.bulk_download_types).to be_frozen
    end

    it "every entry has a :type key" do
      expect(described_class.bulk_download_types).to all(include(:type))
    end
  end

  describe ".bulk_download_type" do
    it "returns the type object for a known type name" do
      result = described_class.bulk_download_type(
        BulkDownloadTypesHelper::AMR_RESULTS_BULK_DOWNLOAD
      )

      expect(result).to be_a(Hash)
      expect(result[:type]).to eq(BulkDownloadTypesHelper::AMR_RESULTS_BULK_DOWNLOAD)
      expect(result[:display_name]).to eq("Antimicrobial Resistance Results")
    end

    it "returns the sample metadata type object, which applies to all workflows" do
      result = described_class.bulk_download_type(
        BulkDownloadTypesHelper::SAMPLE_METADATA_BULK_DOWNLOAD_TYPE
      )

      expect(result[:workflows]).to eq(BulkDownloadTypesHelper::ALL_WORKFLOWS)
    end

    it "returns nil for an unknown type name" do
      expect(described_class.bulk_download_type("not_a_real_type")).to be_nil
    end
  end

  describe ".bulk_download_type_display_name" do
    it "returns the display name for a known type name" do
      expect(
        described_class.bulk_download_type_display_name(
          BulkDownloadTypesHelper::CONSENSUS_GENOME_DOWNLOAD_TYPE
        )
      ).to eq("Consensus Genome")
    end

    # SMP-1638: an unknown/retired download_type (e.g. legacy records whose type was removed from
    # BULK_DOWNLOAD_TYPES, like the commented-out original_input_file) must NOT raise --
    # fed_bulk_downloads maps over every download, so one bad row would 500 the whole Downloads page.
    # It now falls back to a humanized label (and "Unknown" for nil) instead of nil[:display_name].
    it "falls back to a humanized label for an unknown type instead of raising" do
      expect do
        described_class.bulk_download_type_display_name("not_a_real_type")
      end.not_to raise_error
      expect(described_class.bulk_download_type_display_name("not_a_real_type")).to eq("Not A Real Type")
    end

    it "returns 'Unknown' for a nil type instead of raising" do
      expect(described_class.bulk_download_type_display_name(nil)).to eq("Unknown")
    end
  end

  describe "BULK_DOWNLOAD_TYPE_NAME_TO_DATA" do
    it "maps every type name to its own type object" do
      BulkDownloadTypesHelper::BULK_DOWNLOAD_TYPES.each do |type_obj|
        mapped = BulkDownloadTypesHelper::BULK_DOWNLOAD_TYPE_NAME_TO_DATA[type_obj[:type]]
        expect(mapped[:type]).to eq(type_obj[:type])
      end
    end
  end
end
