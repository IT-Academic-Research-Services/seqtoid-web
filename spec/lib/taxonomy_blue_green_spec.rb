# frozen_string_literal: true

require "rails_helper"
require Rails.root.join("lib/taxonomy_blue_green").to_s

RSpec.describe TaxonomyBlueGreen do
  describe ".slug" do
    it "turns a version into a safe identifier fragment" do
      expect(described_class.slug("2026-07-09")).to eq("2026_07_09")
      expect(described_class.slug("  2026.07/09 ")).to eq("2026_07_09")
    end
  end

  describe "name derivation" do
    it "derives collision-free staging/backup/index names" do
      expect(described_class.staging_table("2026-07-09")).to eq("taxon_lineages_v2026_07_09")
      expect(described_class.backup_table("20260720T0148Z")).to eq("taxon_lineages_bak_20260720T0148Z")
      # ES index names must be lowercase -- the uppercase T/Z in the timestamp is downcased.
      expect(described_class.index_name("2026-07-09", "20260720T0148Z"))
        .to eq("taxon_lineages_v2026_07_09_20260720t0148z")
    end
  end

  describe ".swap_sql / .rollback_sql" do
    it "swaps stage in and live out atomically in one statement" do
      sql = described_class.swap_sql("taxon_lineages_v2026_07_09", "taxon_lineages_bak_ts")
      expect(sql).to eq(
        "RENAME TABLE `taxon_lineages` TO `taxon_lineages_bak_ts`, " \
        "`taxon_lineages_v2026_07_09` TO `taxon_lineages`"
      )
    end

    it "reverses the swap on rollback, parking the current live table" do
      sql = described_class.rollback_sql("taxon_lineages_bak_ts", "taxon_lineages_parked_ts2")
      expect(sql).to eq(
        "RENAME TABLE `taxon_lineages` TO `taxon_lineages_parked_ts2`, " \
        "`taxon_lineages_bak_ts` TO `taxon_lineages`"
      )
    end
  end

  describe ".managed_name?" do
    it "recognizes only names this module mints (guards rollback against a typo'd table)" do
      expect(described_class.managed_name?("taxon_lineages")).to be(true)
      expect(described_class.managed_name?("taxon_lineages_v2026_07_09")).to be(true)
      expect(described_class.managed_name?("taxon_lineages_bak_20260720T0148Z")).to be(true)
      expect(described_class.managed_name?("taxon_lineages_parked_x")).to be(true)
      expect(described_class.managed_name?("users")).to be(false)
      expect(described_class.managed_name?("taxon_counts")).to be(false)
    end
  end

  describe ".backup_timestamp" do
    it "extracts the timestamp only from backup table names" do
      expect(described_class.backup_timestamp("taxon_lineages_bak_20260720T0148Z")).to eq("20260720T0148Z")
      expect(described_class.backup_timestamp("taxon_lineages")).to be_nil
      expect(described_class.backup_timestamp("taxon_lineages_v2026_07_09")).to be_nil
    end
  end

  describe ".latest_backup" do
    it "picks the newest backup by (lexical == chronological) UTC timestamp, ignoring non-backups" do
      names = %w[
        taxon_lineages
        taxon_lineages_bak_20260720T0148Z
        taxon_lineages_bak_20260722T1500Z
        taxon_lineages_bak_20260101T0000Z
        taxon_lineages_v2026_07_09
      ]
      expect(described_class.latest_backup(names)).to eq("taxon_lineages_bak_20260722T1500Z")
    end

    it "returns nil when there are no backups" do
      expect(described_class.latest_backup(%w[taxon_lineages users])).to be_nil
      expect(described_class.latest_backup([])).to be_nil
    end
  end

  describe "fingerprint SQL" do
    it "builds a whole-table CHECKSUM statement (content-based, name-independent)" do
      expect(described_class.checksum_sql).to eq("CHECKSUM TABLE `taxon_lineages`")
      expect(described_class.checksum_sql("taxon_lineages_bak_ts")).to eq("CHECKSUM TABLE `taxon_lineages_bak_ts`")
    end

    it "builds a stats statement covering count, distinct taxid and version range" do
      expect(described_class.stats_sql("taxon_lineages_bak_ts")).to eq(
        "SELECT COUNT(*) AS row_count, COUNT(DISTINCT taxid) AS distinct_taxid, " \
        "MIN(version_start) AS min_version_start, MAX(version_end) AS max_version_end " \
        "FROM `taxon_lineages_bak_ts`"
      )
    end

    it "filters SHOW TABLES to preserved backups" do
      expect(described_class.show_backups_sql).to eq("SHOW TABLES LIKE 'taxon_lineages_bak_%'")
    end
  end

  describe ".fingerprint_match?" do
    let(:base) do
      { "checksum" => 123, "row_count" => 10, "distinct_taxid" => 9,
        "min_version_start" => "2020-01-01", "max_version_end" => "2026-07-09", }
    end

    it "is true only when checksum, count, distinct and version range all agree" do
      expect(described_class.fingerprint_match?(base, base.dup)).to be(true)
    end

    it "is false when the checksum differs (content changed at equal row count)" do
      expect(described_class.fingerprint_match?(base, base.merge("checksum" => 999))).to be(false)
    end

    it "is false when a row count differs" do
      expect(described_class.fingerprint_match?(base, base.merge("row_count" => 11))).to be(false)
    end

    it "is false when either side is nil, or a compared field is nil on both" do
      expect(described_class.fingerprint_match?(nil, base)).to be(false)
      expect(described_class.fingerprint_match?(base, nil)).to be(false)
      nilled = base.merge("checksum" => nil)
      expect(described_class.fingerprint_match?(nilled, nilled)).to be(false)
    end
  end
end
