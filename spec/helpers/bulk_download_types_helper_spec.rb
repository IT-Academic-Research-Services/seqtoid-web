require "rails_helper"

RSpec.describe BulkDownloadTypesHelper, type: :helper do
  describe ".bulk_download_type_display_name" do
    it "returns the configured display name for a known type" do
      expect(described_class.bulk_download_type_display_name("reads_non_host"))
        .to eq(BulkDownloadTypesHelper::BULK_DOWNLOAD_TYPE_NAME_TO_DATA["reads_non_host"][:display_name])
    end

    # SMP-1638: a retired/unknown/nil download_type must NOT raise -- fed_bulk_downloads maps over
    # every download, so one legacy row (e.g. the removed original_input_file) would 500 the whole
    # Downloads page. It should fall back to a humanized label instead.
    it "falls back to a humanized label for a retired/unknown type instead of raising" do
      expect { described_class.bulk_download_type_display_name("original_input_file") }.not_to raise_error
      expect(described_class.bulk_download_type_display_name("original_input_file")).to eq("Original Input File")
    end

    it "returns 'Unknown' for a nil type instead of raising" do
      expect { described_class.bulk_download_type_display_name(nil) }.not_to raise_error
      expect(described_class.bulk_download_type_display_name(nil)).to eq("Unknown")
    end
  end
end
