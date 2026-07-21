# frozen_string_literal: true

require "rails_helper"
require Rails.root.join("lib/alignment_config_builder").to_s

RSpec.describe AlignmentConfigBuilder do
  let(:bucket) { "seqtoid-public-references" }
  let(:base) { "s3://#{bucket}/ncbi-indexes-prod/2026-07-09/index-generation-2" }

  describe ".base_uri" do
    it "builds the index-generation-2 base URI" do
      expect(described_class.base_uri(bucket: bucket, version: "2026-07-09")).to eq(base)
    end
  end

  describe ".derive_attributes (full)" do
    subject(:attrs) { described_class.derive_attributes(version: "2026-07-09", bucket: bucket) }

    it "sets name + lineage_version to the version" do
      expect(attrs[:name]).to eq("2026-07-09")
      expect(attrs[:lineage_version]).to eq("2026-07-09")
    end

    it "derives every file + directory path under index-generation-2" do
      expect(attrs[:s3_nt_db_path]).to eq("#{base}/nt_compressed_shuffled.fa")
      expect(attrs[:s3_lineage_path]).to eq("#{base}/taxid-lineages.marisa")
      expect(attrs[:s3_accession2taxid_path]).to eq("#{base}/accession2taxid.marisa")
      expect(attrs[:diamond_db_path]).to eq("#{base}/diamond_index_chunksize_5500000000/")
      expect(attrs[:minimap2_short_db_path]).to eq("#{base}/nt_k14_w8_20/")
    end

    it "covers every AlignmentConfig path column" do
      expected = described_class::FILE_ATTRS.keys + described_class::DIR_ATTRS.keys
      expect(expected).to all(satisfy { |k| attrs[k].present? })
    end
  end

  describe ".lineage_only_attributes (quarterly)" do
    let(:base_attrs) do
      {
        s3_nt_db_path: "s3://b/ncbi-indexes-prod/2024-02-06/index-generation-2/nt_compressed_shuffled.fa",
        s3_nr_db_path: "s3://b/ncbi-indexes-prod/2024-02-06/index-generation-2/nr_compressed_shuffled.fa",
        diamond_db_path: "s3://b/OLD/diamond_index_chunksize_5500000000/",
        s3_lineage_path: "s3://b/OLD/taxid-lineages.marisa",
        s3_accession2taxid_path: "s3://b/OLD/accession2taxid.marisa",
        index_dir_suffix: nil,
      }
    end
    subject(:attrs) do
      described_class.lineage_only_attributes(version: "2026-07-09", bucket: bucket, base_attrs: base_attrs)
    end

    it "reuses the base config's NT/NR sequence paths unchanged" do
      expect(attrs[:s3_nt_db_path]).to eq(base_attrs[:s3_nt_db_path])
      expect(attrs[:s3_nr_db_path]).to eq(base_attrs[:s3_nr_db_path])
      expect(attrs[:diamond_db_path]).to eq(base_attrs[:diamond_db_path])
    end

    it "overrides only the lineage paths + version to the new version" do
      expect(attrs[:s3_lineage_path]).to eq("#{base}/taxid-lineages.marisa")
      expect(attrs[:s3_accession2taxid_path]).to eq("#{base}/accession2taxid.marisa")
      expect(attrs[:lineage_version]).to eq("2026-07-09")
      expect(attrs[:name]).to eq("2026-07-09")
    end
  end

  describe ".required_object_keys / .lineage_object_keys" do
    it "lists file-artifact keys for existence validation (relative to bucket)" do
      keys = described_class.required_object_keys(version: "2026-07-09")
      expect(keys).to include("ncbi-indexes-prod/2026-07-09/index-generation-2/nt_compressed_shuffled.fa")
      expect(keys).to include("ncbi-indexes-prod/2026-07-09/index-generation-2/taxid-lineages.marisa")
    end

    it "narrows to just the lineage keys for a quarterly refresh" do
      keys = described_class.lineage_object_keys(version: "2026-07-09")
      expect(keys).to contain_exactly(
        "ncbi-indexes-prod/2026-07-09/index-generation-2/taxid-lineages.marisa",
        "ncbi-indexes-prod/2026-07-09/index-generation-2/accession2taxid.marisa"
      )
    end
  end
end
