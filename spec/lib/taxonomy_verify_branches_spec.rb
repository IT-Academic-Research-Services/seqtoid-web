# frozen_string_literal: true

require "rails_helper"
require Rails.root.join("lib/taxonomy_verify").to_s

# Branch sweep for TaxonomyVerify. The main spec covers the pass/fail arm of each
# check with realistic inputs; this file targets the arms it leaves untaken:
#
#   check_artifacts  - the `|| sizes_by_name["#{base}.csv.gz"]` right-hand side
#                      (the rake hands in gz-suffixed keys).
#   check_deltas     - the `baseline_distinct.positive?` FALSE arm (a cold/empty
#                      baseline skips the statistical bounds entirely), plus the
#                      negative new_count / deleted_count guards.
#   check_known_panel- the `got.to_s.strip.empty?` half of the missing check (a
#                      blank superkingdom string, not an absent key).
RSpec.describe TaxonomyVerify do
  describe ".check_artifacts gz-suffixed key fallback" do
    it "accepts sizes keyed by the '<base>.csv.gz' object name" do
      sizes = {
        "versioned-taxid-lineages.csv.gz" => 900,
        "changed_lineage_taxa.csv.gz" => 40,
        "new_taxa.csv.gz" => 10,
        "deleted_taxa.csv.gz" => 5,
      }
      result = described_class.check_artifacts(sizes)
      expect(result).to be_pass
      expect(result.detail).to include("4 required artifacts")
    end

    it "still fails on an empty gz-keyed artifact (the size <= 0 arm on the fallback)" do
      sizes = {
        "versioned-taxid-lineages.csv.gz" => 900,
        "changed_lineage_taxa.csv.gz" => 40,
        "new_taxa.csv.gz" => 0,
        "deleted_taxa.csv.gz" => 5,
      }
      result = described_class.check_artifacts(sizes)
      expect(result).to be_failed_block
      expect(result.detail).to include("new_taxa: empty")
    end

    it "honors an overridden required-artifact list" do
      result = described_class.check_artifacts({ "only_thing" => 5 }, required: %w[only_thing])
      expect(result).to be_pass
      expect(result.detail).to include("1 required artifacts")
    end
  end

  describe ".check_deltas with a cold baseline" do
    it "skips the statistical bounds when the baseline is zero (positive? false arm)" do
      # A 0 baseline makes every fraction a division by zero; the guard must skip
      # the shrink/growth/deletion checks rather than compute them.
      result = described_class.check_deltas(baseline_distinct: 0, new_count: 2_500_000,
                                            changed_count: 0, deleted_count: 0)
      expect(result).to be_pass
      expect(result.detail).to include("candidate_distinct=2500000")
    end

    it "fails on a negative new_count even with a cold baseline" do
      result = described_class.check_deltas(baseline_distinct: 0, new_count: -5,
                                            changed_count: 0, deleted_count: 0)
      expect(result).to be_failed_block
      expect(result.detail).to include("new_count is negative (-5)")
    end

    it "fails on a negative deleted_count" do
      result = described_class.check_deltas(baseline_distinct: 1_000_000, new_count: 0,
                                            changed_count: 0, deleted_count: -3)
      expect(result).to be_failed_block
      expect(result.detail).to include("deleted_count is negative (-3)")
    end

    it "treats a nil thresholds override as 'use the defaults'" do
      # thresholds: nil hits the `|| {}` side of DEFAULT_THRESHOLDS.merge(thresholds || {}).
      result = described_class.check_deltas(baseline_distinct: 1_000_000, new_count: 0,
                                            changed_count: 0, deleted_count: 200_000,
                                            thresholds: nil)
      expect(result).to be_failed_block
      expect(result.detail).to include("deletions are 20.0%")
    end
  end

  describe ".check_known_panel blank-resolution arm" do
    let(:correct) { described_class::KNOWN_PANEL.dup }

    it "treats a blank superkingdom as unresolved rather than misclassified" do
      result = described_class.check_known_panel(correct.merge(1280 => "   "))
      expect(result).to be_failed_block
      expect(result.detail).to include("unresolved taxids: 1280")
      expect(result.detail).not_to include("misclassified")
    end

    it "reports misclassified and unresolved taxa together when both occur" do
      bad = correct.merge(9606 => "Bacteria").except(562)
      result = described_class.check_known_panel(bad)
      expect(result.detail).to include("misclassified: 9606: expected Eukaryota, got Bacteria")
      expect(result.detail).to include("unresolved taxids: 562")
    end

    it "accepts a custom panel" do
      result = described_class.check_known_panel({ 99 => "Archaea" }, panel: { 99 => "Archaea" })
      expect(result).to be_pass
      expect(result.detail).to include("all 1 curated taxa")
    end
  end
end
