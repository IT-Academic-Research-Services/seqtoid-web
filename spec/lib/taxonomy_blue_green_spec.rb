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
      expect(described_class.index_name("2026-07-09", "20260720T0148Z"))
        .to eq("taxon_lineages_v2026_07_09_20260720T0148Z")
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
end
