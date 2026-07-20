require "rails_helper"

# ReferenceDataIntegrity is defined in lib/tasks/reference_data_integrity.rake, loaded via
# Rails.application.load_tasks in rails_helper (same pattern as CheckPipelineRuns). These
# specs exercise the reference-data integrity checks nightly-full-regime.yml gates on
# (platform-overhaul #741, epic #734).
RSpec.describe ReferenceDataIntegrity do
  # 694009 = SARS-related coronavirus -- the sentinel whose absence was a live incident (#528).
  let(:sentinel_taxid) { 694009 }
  let(:version) { "2022-01-01" }

  # Make `AlignmentConfig.default_name` (backed by AppConfig) resolve to our seeded config
  # without touching the app_configs table.
  def set_default_config(config)
    allow(AlignmentConfig).to receive(:default_name).and_return(config&.name)
  end

  describe ".current_lineage_version" do
    it "returns the lineage_version of the default alignment config" do
      cfg = create(:alignment_config, lineage_version: version)
      set_default_config(cfg)
      expect(described_class.current_lineage_version).to eq(version)
    end

    it "returns nil when no default is configured" do
      allow(AlignmentConfig).to receive(:default_name).and_return(nil)
      expect(described_class.current_lineage_version).to be_nil
    end

    it "returns nil when the default name points at no row" do
      allow(AlignmentConfig).to receive(:default_name).and_return("does-not-exist")
      expect(described_class.current_lineage_version).to be_nil
    end
  end

  describe ".check_default_alignment_config" do
    it "passes for a complete default config" do
      cfg = create(:alignment_config, lineage_version: version)
      set_default_config(cfg)
      result = described_class.check_default_alignment_config
      expect(result.ok).to be(true)
      expect(result.failed?).to be(false)
    end

    it "fails (error) when no default is configured" do
      allow(AlignmentConfig).to receive(:default_name).and_return(nil)
      result = described_class.check_default_alignment_config
      expect(result.failed?).to be(true)
      expect(result.detail).to match(/unset/)
    end

    it "fails when the default name resolves to no row" do
      allow(AlignmentConfig).to receive(:default_name).and_return("ghost-config")
      result = described_class.check_default_alignment_config
      expect(result.failed?).to be(true)
      expect(result.detail).to match(/no AlignmentConfig row/)
    end

    it "fails when a required S3 path is blank" do
      cfg = create(:alignment_config, lineage_version: version)
      set_default_config(cfg)
      # Blank a required path at the read layer (the column is NOT NULL at the DB level).
      allow(cfg).to receive(:[]).and_call_original
      allow(cfg).to receive(:[]).with("s3_lineage_path").and_return("")
      allow(AlignmentConfig).to receive(:find_by).with(name: cfg.name).and_return(cfg)
      result = described_class.check_default_alignment_config
      expect(result.failed?).to be(true)
      expect(result.detail).to match(/s3_lineage_path/)
    end

    it "fails when lineage_version is blank" do
      cfg = create(:alignment_config, lineage_version: version)
      set_default_config(cfg)
      allow(cfg).to receive(:lineage_version).and_return("")
      allow(AlignmentConfig).to receive(:find_by).with(name: cfg.name).and_return(cfg)
      result = described_class.check_default_alignment_config
      expect(result.failed?).to be(true)
      expect(result.detail).to match(/blank lineage_version/)
    end
  end

  describe ".check_lineage_sentinels" do
    it "passes when every sentinel taxid resolves for the version" do
      create(:taxon_lineage, taxid: sentinel_taxid, version_start: version, version_end: version)
      results = described_class.check_lineage_sentinels(version)
      expect(results).to all(have_attributes(ok: true))
    end

    it "fails when a sentinel taxid is missing for the version (the #528 gap)" do
      # No lineage row for the sentinel taxid at all.
      results = described_class.check_lineage_sentinels(version)
      expect(results).to all(have_attributes(failed?: true))
      expect(results.first.detail).to match(/MISSING/)
    end

    it "fails when the sentinel exists but only for a different version window" do
      create(:taxon_lineage, taxid: sentinel_taxid, version_start: "2018-01-01", version_end: "2018-12-31")
      results = described_class.check_lineage_sentinels(version)
      expect(results).to all(have_attributes(failed?: true))
    end

    it "fails (error) when there is no lineage_version to check against" do
      results = described_class.check_lineage_sentinels(nil)
      expect(results.first.failed?).to be(true)
      expect(results.first.name).to eq("lineage_sentinels")
    end
  end

  describe ".check_es_db_consistency" do
    it "is skipped (warn, non-failing) when ELASTICSEARCH_ON is false (test env)" do
      result = described_class.check_es_db_consistency
      expect(result.ok).to be(true)
      expect(result.failed?).to be(false)
      expect(result.detail).to match(/skipped/)
    end
  end

  describe ".run (integration)" do
    it "returns all-passing results on a healthy reference dataset" do
      cfg = create(:alignment_config, lineage_version: version)
      set_default_config(cfg)
      create(:taxon_lineage, taxid: sentinel_taxid, version_start: version, version_end: version)

      results = described_class.run
      expect(results).not_to be_empty
      expect(results.select(&:failed?)).to be_empty
    end

    it "surfaces the sentinel gap as a run failure when the slice is incomplete" do
      cfg = create(:alignment_config, lineage_version: version)
      set_default_config(cfg)
      # Deliberately do NOT seed the sentinel taxid -- simulate the #528 incomplete slice.

      results = described_class.run
      failed = results.select(&:failed?)
      expect(failed.map(&:name)).to include("lineage_sentinel:#{sentinel_taxid}")
    end
  end
end
