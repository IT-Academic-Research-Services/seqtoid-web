require "rails_helper"
require "webmock/rspec"

RSpec.describe ElasticsearchHelper, type: :helper do
  describe "#fetch_taxon_data" do
    before do
      # lineages added in 2024
      @taxon_lineage1 = create(:taxon_lineage, taxid: 1, species_taxid: 100, species_name: "species1 2024", genus_name: "genus1", version_start: "2024-02-06", version_end: "2024-02-06")
      @taxon_lineage2 = create(:taxon_lineage, taxid: 2, species_taxid: 200, species_name: "species2 2024", genus_name: "genus2", version_start: "2024-02-06", version_end: "2024-02-06")
      @taxon_lineage3 = create(:taxon_lineage, taxid: 3, species_taxid: 300, species_name: "species3 2024", genus_name: "genus3", version_start: "2024-02-06", version_end: "2024-02-06")

      # "lineages added in 2021 that are valid through 2022"
      @taxon_lineage4 = create(:taxon_lineage, taxid: 4, species_taxid: 300, species_name: "species3 2021", genus_name: "genus3", version_start: "2021-01-22", version_end: "2022-02-06")
    end

    context "when there are multiple taxid versions" do
      it "returns the most recent matching taxa that includes the ncbi_version" do
        taxon_ids = [100, 200, 300]
        ncbi_version = "2024-02-06"
        level = "species"
        matching_taxa = fetch_taxon_data(taxon_ids, ncbi_version, level)

        expected_results = [
          { "title" => "species1 2024", "description" => "Taxonomy ID: 100", "taxid" => 100, "level" => "species" },
          { "title" => "species2 2024", "description" => "Taxonomy ID: 200", "taxid" => 200, "level" => "species" },
          { "title" => "species3 2024", "description" => "Taxonomy ID: 300", "taxid" => 300, "level" => "species" },
        ]
        expect(matching_taxa).to eq expected_results
      end

      it "returns the older version based on the ncbi_version" do
        taxon_ids = [300]
        ncbi_version = "2021-01-22"
        level = "species"
        matching_taxa = fetch_taxon_data(taxon_ids, ncbi_version, level)

        expected_results = [
          { "title" => "species3 2021", "description" => "Taxonomy ID: 300", "taxid" => 300, "level" => "species" },
        ]
        expect(matching_taxa).to eq expected_results
      end
    end
  end

  describe "#fetch_taxon_data for a taxon with many descendant rows" do
    before do
      # A genus whose lineage rows are its many species/strains: every row carries the genus taxid + name.
      25.times do |i|
        create(:taxon_lineage, taxid: 1000 + i, genus_taxid: 570, genus_name: "Klebsiella",
                               species_taxid: 2000 + i, species_name: "Klebsiella sp. #{i}",
                               version_start: "2024-02-06", version_end: "2024-02-06")
      end
      create(:taxon_lineage, taxid: 3000, genus_taxid: 590, genus_name: "Salmonella",
                             species_taxid: 3001, species_name: "Salmonella enterica",
                             version_start: "2024-02-06", version_end: "2024-02-06")
      # The genus name changed in an older index version still covering the pinned date.
      create(:taxon_lineage, taxid: 3002, genus_taxid: 590, genus_name: "Salmonella (old)",
                             species_taxid: 3003, species_name: "Salmonella old",
                             version_start: "2021-01-22", version_end: "2024-02-06")
    end

    it "returns one result per taxon, in the order the search returned them" do
      results = fetch_taxon_data([590, 570], "2024-02-06", "genus")
      expect(results.pluck("taxid")).to eq([590, 570])
      expect(results.pluck("title")).to contain_exactly("Salmonella", "Klebsiella").or contain_exactly("Salmonella (old)", "Klebsiella")
    end

    it "takes the name from the row with the latest version_end" do
      create(:taxon_lineage, taxid: 4000, genus_taxid: 600, genus_name: "Oldname",
                             species_taxid: 4001, species_name: "x", version_start: "2021-01-22", version_end: "2024-01-01")
      create(:taxon_lineage, taxid: 4002, genus_taxid: 600, genus_name: "Newname",
                             species_taxid: 4003, species_name: "y", version_start: "2021-01-22", version_end: "2026-01-01")
      expect(fetch_taxon_data([600], "2023-06-01", "genus").pluck("title")).to eq(["Newname"])
    end

    it "accepts taxids as strings (search bucket keys) and returns integers" do
      expect(fetch_taxon_data(["570"], "2024-02-06", "genus").pluck("taxid")).to eq([570])
    end

    it "returns nothing for no taxids without querying" do
      expect(TaxonLineage).not_to receive(:where)
      expect(fetch_taxon_data([], "2024-02-06", "genus")).to eq([])
    end

    it "does not build ActiveRecord objects for the lineage rows" do
      instantiated = 0
      callback = ->(*, payload) { instantiated += payload[:record_count] if payload[:class_name] == "TaxonLineage" }
      ActiveSupport::Notifications.subscribed(callback, "instantiation.active_record") do
        fetch_taxon_data([570, 590], "2024-02-06", "genus")
      end
      expect(instantiated).to eq(0)
    end
  end

  context "when the taxid falls outside of the ncbi_version" do
    it "returns an empty array" do
      taxon_ids = [100, 200, 300]
      ncbi_version = "2025-02-06"
      level = "species"
      matching_taxa = fetch_taxon_data(taxon_ids, ncbi_version, level)

      expect(matching_taxa).to eq []
    end
  end

  describe "#sanitize" do
    it "returns nil when passed nil" do
      expect(helper.send(:sanitize, nil)).to be_nil
    end

    it "leaves allowed characters untouched" do
      expect(helper.send(:sanitize, "abc 123._|'/")).to eq("abc 123._|'/")
    end

    it "escapes special characters with a backslash" do
      expect(helper.send(:sanitize, "a+b")).to eq("a\\+b")
      expect(helper.send(:sanitize, "a*b")).to eq("a\\*b")
    end
  end

  describe "#get_taxid_name_columns" do
    {
      "species" => %w[species_taxid species_name],
      "genus" => %w[genus_taxid genus_name],
      "family" => %w[family_taxid family_name],
      "order" => %w[order_taxid order_name],
      "class" => %w[class_taxid class_name],
      "phylum" => %w[phylum_taxid phylum_name],
      "superkingdom" => %w[superkingdom_taxid superkingdom_name],
    }.each do |level, (taxid_col, name_col)|
      it "returns the taxid/name columns for #{level}" do
        expect(helper.send(:get_taxid_name_columns, level)).to eq([taxid_col, name_col])
      end
    end

    it "raises for an invalid level" do
      expect { helper.send(:get_taxid_name_columns, "kingdom") }.to raise_error("Invalid level")
    end
  end

  describe "#get_ncbi_version" do
    it "returns the version_prefix for the project's NCBI index workflow version" do
      project = create(:project)
      create(
        :project_workflow_version,
        project_id: project.id,
        workflow: AlignmentConfig::NCBI_INDEX,
        version_prefix: "2024-02-06"
      )
      expect(helper.send(:get_ncbi_version, project.id)).to eq("2024-02-06")
    end
  end

  describe "#filter_by_superkingdom" do
    it "returns only taxids matching the given superkingdom" do
      create(:taxon_lineage, taxid: 501, superkingdom_name: "Viruses")
      create(:taxon_lineage, taxid: 502, superkingdom_name: "Bacteria")
      result = helper.send(:filter_by_superkingdom, [501, 502], "Viruses")
      expect(result).to eq([501])
    end
  end

  describe "#prefix_match (test env)" do
    it "returns all records filtered by the condition, since ES is unavailable in tests" do
      p1 = create(:project, name: "Alpha")
      create(:project, name: "Beta")
      results = helper.prefix_match(Project, "name", "Al", { id: [p1.id] })
      expect(results.pluck(:id)).to eq([p1.id])
    end
  end

  describe "#taxon_search (test env)" do
    it "returns an empty hash because ES is unavailable in tests" do
      expect(helper.taxon_search("influenza")).to eq({})
    end
  end
end
