# frozen_string_literal: true

require "rails_helper"
require Rails.root.join("lib/taxonomy_verify").to_s

RSpec.describe TaxonomyVerify do
  describe ".check_header" do
    it "passes when every expected column is present (extras allowed)" do
      header = described_class::EXPECTED_COLUMNS + %w[created_at updated_at]
      result = described_class.check_header(header)
      expect(result).to be_pass
      expect(result.blocking).to be(true)
    end

    it "fails (blocking) when a required column is missing" do
      header = described_class::EXPECTED_COLUMNS - %w[species_taxid]
      result = described_class.check_header(header)
      expect(result.status).to eq(:fail)
      expect(result).to be_failed_block
      expect(result.detail).to include("species_taxid")
    end
  end

  describe ".check_artifacts" do
    let(:ok) do
      { "versioned-taxid-lineages" => 100, "changed_lineage_taxa" => 50, "new_taxa" => 10, "deleted_taxa" => 5 }
    end

    it "passes when all required artifacts are present and non-empty" do
      expect(described_class.check_artifacts(ok)).to be_pass
    end

    it "fails when an artifact is missing" do
      result = described_class.check_artifacts(ok.merge("new_taxa" => nil))
      expect(result).to be_failed_block
      expect(result.detail).to include("new_taxa: missing")
    end

    it "fails when an artifact is empty" do
      result = described_class.check_artifacts(ok.merge("deleted_taxa" => 0))
      expect(result).to be_failed_block
      expect(result.detail).to include("deleted_taxa: empty")
    end
  end

  describe ".check_deltas" do
    # baseline 1,000,000 distinct taxa; the 2026-07-09 proof shape (huge new, tiny delete) is healthy.
    it "passes a realistic refresh (big additions, small deletions)" do
      result = described_class.check_deltas(baseline_distinct: 1_000_000, new_count: 321_026,
                                            changed_count: 2_514_752, deleted_count: 14_207)
      expect(result).to be_pass
    end

    it "fails when deletions blow past the ceiling (corrupt/partial pull)" do
      result = described_class.check_deltas(baseline_distinct: 1_000_000, new_count: 0,
                                            changed_count: 0, deleted_count: 200_000)
      expect(result).to be_failed_block
      expect(result.detail).to include("deletions")
    end

    it "fails when distinct taxa shrink beyond tolerance" do
      # net shrink 5% (deleted 60k > new 10k on a 1M baseline), past the 2% shrink bound
      result = described_class.check_deltas(baseline_distinct: 1_000_000, new_count: 10_000,
                                            changed_count: 0, deleted_count: 60_000)
      expect(result).to be_failed_block
      expect(result.detail).to include("shrank")
    end

    it "fails when the table more than doubles (runaway/duplicated pull)" do
      result = described_class.check_deltas(baseline_distinct: 1_000_000, new_count: 1_200_000,
                                            changed_count: 0, deleted_count: 0)
      expect(result).to be_failed_block
      expect(result.detail).to include("grew")
    end

    it "honors overridden thresholds" do
      # a 60k deletion on 1M is 6% -> passes only if the ceiling is raised past it
      result = described_class.check_deltas(baseline_distinct: 1_000_000, new_count: 60_000,
                                            changed_count: 0, deleted_count: 60_000,
                                            thresholds: { max_delete_frac: 0.10 })
      expect(result).to be_pass
    end
  end

  describe ".check_known_panel" do
    let(:correct) do
      described_class::KNOWN_PANEL.transform_values(&:itself)
    end

    it "passes when every curated taxid resolves to the expected domain" do
      expect(described_class.check_known_panel(correct)).to be_pass
    end

    it "accepts string-keyed resolutions (CSV taxids come through as strings)" do
      string_keyed = correct.transform_keys(&:to_s)
      expect(described_class.check_known_panel(string_keyed)).to be_pass
    end

    it "fails (blocking) when a load-bearing organism is misclassified" do
      bad = correct.merge(2_697_049 => "Bacteria") # SARS-CoV-2 must be Viruses
      result = described_class.check_known_panel(bad)
      expect(result).to be_failed_block
      expect(result.detail).to include("2697049")
    end

    it "fails (blocking) when a panel taxid vanished from the candidate" do
      result = described_class.check_known_panel(correct.except(694_009))
      expect(result).to be_failed_block
      expect(result.detail).to include("694009")
    end
  end

  describe ".build_report" do
    it "is PASS when no blocking check failed" do
      results = [described_class.check_header(described_class::EXPECTED_COLUMNS)]
      report = described_class.build_report(results, version: "2026-07-09", prefix: "p")
      expect(report[:overall]).to eq("PASS")
      expect(report[:blocking_failures]).to be_empty
    end

    it "is FAIL and lists the blocking failures" do
      results = [described_class.check_header(described_class::EXPECTED_COLUMNS - %w[taxid])]
      report = described_class.build_report(results, version: "2026-07-09", prefix: "p")
      expect(report[:overall]).to eq("FAIL")
      expect(report[:blocking_failures]).to include("structural.header")
    end
  end
end
