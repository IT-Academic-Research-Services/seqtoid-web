require "rails_helper"

# Branch coverage for ElasticsearchHelper. The sibling elasticsearch_helper_spec exercises
# the pure helpers, but both public entry points short-circuit under RAILS_ENV=test:
# prefix_match takes its `model.all` arm and taxon_search returns {} immediately. That
# leaves the real ElasticSearch-backed arms (and every filter branch inside taxon_search)
# undriven. Here we pretend we are outside the test env and stub the ES calls, so the
# filtering/ordering logic that actually ships is exercised without any ES server.
RSpec.describe ElasticsearchHelper, type: :helper do
  def pretend_not_test_env
    allow(Rails).to receive(:env).and_return(ActiveSupport::StringInquirer.new("development"))
  end

  # Stub TaxonLineage.search -- the class only gains `.search` when ELASTICSEARCH_ON, which is
  # false under test, so partial-double verification has to be waived for this one call.
  def stub_taxon_lineage_search(taxids)
    buckets = taxids.map { |taxid| { key: taxid } }
    response = double("SearchResponse", aggregations: double("Aggs", distinct_taxa: double("Terms", buckets: buckets)))
    without_partial_double_verification do
      allow(TaxonLineage).to receive(:search).and_return(response)
    end
  end

  describe "#prefix_match outside the test environment" do
    it "queries ElasticSearch and then applies the extra conditions to the returned records" do
      pretend_not_test_env
      matching = create(:project, name: "Alpha")
      create(:project, name: "Alphabet")

      es_records = Project.where(name: %w[Alpha Alphabet])
      model = double("Model", __elasticsearch__: double("Proxy", search: double("Result", records: es_records)))

      results = helper.prefix_match(model, "name", "Alph", { name: ["Alpha"] })

      expect(results.pluck(:id)).to eq([matching.id])
    end
  end

  describe "#taxon_search outside the test environment" do
    let!(:species_lineage) do
      create(:taxon_lineage,
             taxid: 100,
             species_taxid: 100,
             species_name: "Influenza A virus",
             superkingdom_name: "Viruses",
             version_start: "2024-02-06",
             version_end: "2024-02-06")
    end

    before do
      pretend_not_test_env
      create(:app_config, key: AppConfig::DEFAULT_ALIGNMENT_CONFIG_NAME, value: "2024-02-06")
    end

    it "falls back to the default alignment config when no project filter is given and applies no filters" do
      stub_taxon_lineage_search([100])

      results = helper.taxon_search("Influenza", ["species"])

      expect(results).to eq(
        [{ "title" => "Influenza A virus", "description" => "Taxonomy ID: 100", "taxid" => 100, "level" => "species" }]
      )
    end

    it "drops taxa that the superkingdom filter excludes" do
      stub_taxon_lineage_search([100])

      expect(helper.taxon_search("Influenza", ["species"], superkingdom: "Bacteria")).to eq([])
      expect(helper.taxon_search("Influenza", ["species"], superkingdom: "Viruses").pluck("taxid")).to eq([100])
    end

    it "resolves the ncbi version from the project and filters by that project's samples" do
      project = create(:project)
      create(:project_workflow_version,
             project_id: project.id,
             workflow: AlignmentConfig::NCBI_INDEX,
             version_prefix: "2024-02-06")
      stub_taxon_lineage_search([100])

      # No sample in the project has a CHECKED pipeline run with this taxon, so the
      # project filter empties the result set.
      expect(helper.taxon_search("Influenza", ["species"], project_id: project.id)).to eq([])
    end

    it "filters by the supplied sample scope" do
      project = create(:project)
      sample = create(:sample, project: project)
      stub_taxon_lineage_search([100])

      expect(helper.taxon_search("Influenza", ["species"], samples: Sample.where(id: sample.id))).to eq([])
    end

    it "always removes homo sapiens hits" do
      homo_taxid = TaxonLineage::HOMO_SAPIENS_TAX_IDS.first
      create(:taxon_lineage,
             taxid: 2,
             species_taxid: homo_taxid,
             species_name: "Homo sapiens",
             version_start: "2024-02-06",
             version_end: "2024-02-06")
      stub_taxon_lineage_search([homo_taxid])

      expect(helper.taxon_search("Homo", ["species"])).to eq([])
    end

    it "ignores tax levels that are not real taxonomic levels" do
      stub_taxon_lineage_search([100])

      expect(helper.taxon_search("Influenza", ["species", "not_a_level"]).pluck("taxid")).to eq([100])
    end
  end
end
