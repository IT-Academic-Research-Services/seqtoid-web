require "rails_helper"

# Coverage Wave (branch): heatmap_elasticsearch_service_spec.rb only exercises the
# readSpecificity cast in TopTaxonsElasticsearchService#build_filter_param_hash.
# This spec drives the remaining conditional arms of that method -- which is a pure
# params-to-hash builder that needs no Elasticsearch -- plus the empty-samples guard
# in #generate. Branches driven:
#   - min_reads present vs. default (MINIMUM_READ_THRESHOLD)
#   - removedTaxonIds Integer() rescue-to-nil path
#   - addedTaxonIds / taxonIds / taxonTags present vs. default
#   - thresholdFilters as an Array vs. as a JSON string
#   - background_id positive (given) vs. fall-through to samples.first.default_background_id
#   - categories include? present vs. absent
#   - subcategories: Phage present / Viruses key absent / whole param absent
#   - taxon_level species vs. genus
#   - sort_by given vs. default (and the metric_count_type extraction it feeds)
#   - taxons_per_sample given vs. default
#   - #generate empty-samples early return
RSpec.describe TopTaxonsElasticsearchService do
  def build(params_hash, samples: nil, background: 26)
    service = TopTaxonsElasticsearchService.new(
      params: ActionController::Parameters.new(params_hash),
      samples_for_heatmap: samples,
      background_for_heatmap: background
    )
    service.build_filter_param_hash
  end

  describe "#build_filter_param_hash min_reads" do
    it "casts a supplied minReads to an integer" do
      expect(build({ minReads: "7" })[:min_reads]).to eq(7)
    end

    it "falls back to MINIMUM_READ_THRESHOLD when minReads is absent" do
      expect(build({})[:min_reads]).to eq(described_class::MINIMUM_READ_THRESHOLD)
    end
  end

  describe "#build_filter_param_hash removedTaxonIds" do
    it "drops non-integer removedTaxonIds via the rescue instead of raising" do
      result = nil
      expect { result = build({ removedTaxonIds: ["10", "not-a-number", "20"] }) }.not_to raise_error
      # taxonIds default is [], so after subtraction taxon_ids stays empty, but the
      # rescue must have swallowed "not-a-number" for us to reach this point at all.
      expect(result[:taxon_ids]).to eq([])
    end

    it "subtracts valid removedTaxonIds from taxonIds" do
      # taxonIds and removedTaxonIds must share a type for the subtraction to bite.
      result = build({ taxonIds: [10, 20, 30], removedTaxonIds: ["20"] })
      expect(result[:taxon_ids]).to eq([10, 30])
    end
  end

  describe "#build_filter_param_hash added/taxon ids and tags" do
    it "passes supplied addedTaxonIds, taxonIds and taxonTags through" do
      result = build({ addedTaxonIds: [1, 2], taxonIds: [5], taxonTags: ["known_pathogen"] })
      expect(result[:addedTaxonIds]).to eq([1, 2])
      expect(result[:taxon_ids]).to eq([5])
      expect(result[:taxon_tags]).to eq(["known_pathogen"])
    end

    it "defaults addedTaxonIds, taxon_ids and taxon_tags to empty arrays" do
      result = build({})
      expect(result[:addedTaxonIds]).to eq([])
      expect(result[:taxon_ids]).to eq([])
      expect(result[:taxon_tags]).to eq([])
    end
  end

  describe "#build_filter_param_hash threshold_filters" do
    it "parses each element when thresholdFilters is an array of JSON strings" do
      result = build({ thresholdFilters: ['{"metric":"NT_zscore","operator":">","value":"1"}'] })
      # First element is the parsed user filter; the mandatory min-reads filter is appended last.
      expect(result[:threshold_filters].first).to eq(
        "metric" => "NT_zscore", "operator" => ">", "value" => "1"
      )
    end

    it "parses the whole value when thresholdFilters is a single JSON string" do
      result = build({ thresholdFilters: '[{"metric":"NR_rpm","operator":"<","value":"3"}]' })
      expect(result[:threshold_filters].first).to eq(
        "metric" => "NR_rpm", "operator" => "<", "value" => "3"
      )
    end

    it "always appends the mandatory min-reads threshold filter derived from sort_by" do
      result = build({ minReads: "4" })
      expect(result[:threshold_filters].last).to eq(
        "metric" => "NT_r", "value" => 4, "operator" => ">="
      )
    end
  end

  describe "#build_filter_param_hash background_id" do
    it "uses the given positive background id" do
      expect(build({}, background: 26)[:background_id]).to eq(26)
    end

    it "falls through to the first sample's default background when the id is not positive" do
      sample = instance_double("Sample", default_background_id: 99)
      expect(build({}, samples: [sample], background: 0)[:background_id]).to eq(99)
    end
  end

  describe "#build_filter_param_hash categories" do
    it "includes categories when the param is present" do
      expect(build({ categories: ["Bacteria"] })[:categories]).to eq(["Bacteria"])
    end

    it "omits categories when the param is absent" do
      expect(build({})).not_to have_key(:categories)
    end
  end

  describe "#build_filter_param_hash subcategories/include_phage" do
    it "sets include_phage true when Viruses subcategory contains Phage" do
      result = build({ subcategories: '{"Viruses":["Phage"]}' })
      expect(result[:include_phage]).to eq(true)
    end

    it "sets include_phage falsey when the Viruses subcategory is absent" do
      result = build({ subcategories: '{"Bacteria":["Something"]}' })
      expect(result[:include_phage]).to be_falsey
    end

    it "does not set include_phage when the subcategories param is absent" do
      expect(build({})).not_to have_key(:include_phage)
    end
  end

  describe "#build_filter_param_hash taxon_level" do
    it "uses the species tax level when species is 1" do
      expect(build({ species: "1" })[:taxon_level]).to eq(TaxonCount::TAX_LEVEL_SPECIES)
    end

    it "uses the genus tax level otherwise" do
      expect(build({ species: "0" })[:taxon_level]).to eq(TaxonCount::TAX_LEVEL_GENUS)
      expect(build({})[:taxon_level]).to eq(TaxonCount::TAX_LEVEL_GENUS)
    end
  end

  describe "#build_filter_param_hash sort_by and taxons_per_sample" do
    it "uses a supplied sortBy and reflects it in the mandatory metric filter" do
      result = build({ sortBy: "highest_nr_rpm" })
      expect(result[:sort_by]).to eq("highest_nr_rpm")
      expect(result[:threshold_filters].last["metric"]).to eq("NR_r")
    end

    it "defaults sort_by and taxons_per_sample when unspecified" do
      result = build({})
      expect(result[:sort_by]).to eq(described_class::DEFAULT_TAXON_SORT_PARAM)
      expect(result[:taxons_per_sample]).to eq(described_class::DEFAULT_MAX_NUM_TAXONS)
    end

    it "uses a supplied taxonsPerSample" do
      expect(build({ taxonsPerSample: 25 })[:taxons_per_sample]).to eq(25)
    end
  end

  describe "#build_filter_param_hash read_specificity" do
    it "omits read_specificity when the param is absent" do
      expect(build({})).not_to have_key(:read_specificity)
    end
  end

  describe "#generate" do
    it "returns an empty hash without touching Elasticsearch when there are no samples" do
      service = TopTaxonsElasticsearchService.new(
        params: ActionController::Parameters.new({}),
        samples_for_heatmap: [],
        background_for_heatmap: 26
      )
      expect(service.call).to eq({})
    end
  end

  # SMP-1788: on-demand (re)indexing must be kicked off asynchronously so the heatmap
  # first-load returns immediately instead of blocking on the synchronous indexing lambda,
  # while still emitting the SMP-1795 "indexing" preparing-state so the client keeps polling.
  describe "#generate on-demand indexing is async" do
    let(:sample) { instance_double("Sample") }
    let(:service) do
      TopTaxonsElasticsearchService.new(
        params: ActionController::Parameters.new({}),
        samples_for_heatmap: [sample],
        background_for_heatmap: 26
      )
    end

    before do
      allow(HeatmapHelper).to receive(:get_latest_pipeline_runs_for_samples).and_return(101 => 201)
      allow(ElasticsearchQueryHelper).to receive(:update_last_read_at)
      allow(service).to receive(:fetch_top_taxons).and_return({})
      allow(ElasticsearchQueryHelper).to receive(:samples_taxons_details).and_return([])
    end

    it "requests indexing with async: true and never makes the blocking lambda invoke on the request" do
      expect(ElasticsearchQueryHelper).to receive(:update_es_for_missing_data)
        .with(anything, [101], async: true)
        .and_return([101])
      expect(ElasticsearchQueryHelper).not_to receive(:call_taxon_indexing_lambda)

      service.generate
    end

    it "still updates last_read_at for the requested runs" do
      allow(ElasticsearchQueryHelper).to receive(:update_es_for_missing_data).and_return([])
      expect(ElasticsearchQueryHelper).to receive(:update_last_read_at).with(anything, [101])

      service.generate
    end

    it "returns the indexing preparing-state when indexing was kicked off and the query is still empty" do
      allow(ElasticsearchQueryHelper).to receive(:update_es_for_missing_data).and_return([101])

      expect(service.generate).to eq(status: "indexing")
    end

    it "returns the heatmap dict once the freshly-indexed docs are searchable" do
      allow(ElasticsearchQueryHelper).to receive(:update_es_for_missing_data).and_return([101])
      # Run 101 maps to sample 201 (see get_latest_pipeline_runs_for_samples stub); the enqueued run's
      # sample now carries taxa, so the abundance is searchable and the dict is served.
      dict = [{ sample_id: 201, taxons: [{ "tax_id" => 5 }] }]
      allow(ElasticsearchQueryHelper).to receive(:samples_taxons_details).and_return(dict)

      expect(service.generate).to eq(dict)
    end
  end

  # SMP-1887: after a re-login, opening a heatmap for freshly CLI-uploaded data showed missing abundance
  # for most samples on the first render (a manual reload fixed it). The cause was server-side: when only
  # SOME requested runs were cold, the query returned a PARTIAL dict -- taxa for the already-indexed
  # samples, nothing for the freshly-enqueued ones -- and the old all-empty guard served it as final
  # instead of signalling "indexing". The service must keep polling until every enqueued run is searchable.
  describe "#generate partial-indexing preparing-state (SMP-1887)" do
    let(:sample_a) { instance_double("Sample") }
    let(:sample_b) { instance_double("Sample") }
    let(:service) do
      TopTaxonsElasticsearchService.new(
        params: ActionController::Parameters.new({}),
        samples_for_heatmap: [sample_a, sample_b],
        background_for_heatmap: 26
      )
    end

    before do
      # Two runs -> two samples; run 101 is already indexed, run 102 was cold and just enqueued.
      allow(HeatmapHelper).to receive(:get_latest_pipeline_runs_for_samples)
        .and_return(101 => 201, 102 => 202)
      allow(ElasticsearchQueryHelper).to receive(:update_last_read_at)
      allow(service).to receive(:fetch_top_taxons).and_return({})
    end

    it "returns the indexing preparing-state when an enqueued run is missing abundance (absent entry)" do
      allow(ElasticsearchQueryHelper).to receive(:update_es_for_missing_data).and_return([102])
      # Only the already-indexed sample (201) came back with taxa; the freshly-enqueued run 102's sample
      # (202) is absent from the partial result.
      dict = [{ sample_id: 201, taxons: [{ "tax_id" => 5 }] }]
      allow(ElasticsearchQueryHelper).to receive(:samples_taxons_details).and_return(dict)

      expect(service.generate).to eq(status: "indexing")
    end

    it "returns the indexing preparing-state when an enqueued run's entry has an empty taxons list" do
      allow(ElasticsearchQueryHelper).to receive(:update_es_for_missing_data).and_return([102])
      # Sample 202 present but with no taxa yet (metadata-only entry); still not searchable.
      dict = [
        { sample_id: 201, taxons: [{ "tax_id" => 5 }] },
        { sample_id: 202, taxons: [] },
      ]
      allow(ElasticsearchQueryHelper).to receive(:samples_taxons_details).and_return(dict)

      expect(service.generate).to eq(status: "indexing")
    end

    it "serves the full dict once every enqueued run has searchable abundance" do
      allow(ElasticsearchQueryHelper).to receive(:update_es_for_missing_data).and_return([102])
      dict = [
        { sample_id: 201, taxons: [{ "tax_id" => 5 }] },
        { sample_id: 202, taxons: [{ "tax_id" => 9 }] },
      ]
      allow(ElasticsearchQueryHelper).to receive(:samples_taxons_details).and_return(dict)

      expect(service.generate).to eq(dict)
    end

    it "serves the partial dict when nothing needed indexing (no cold runs to wait on)" do
      # A sample legitimately having no taxa must NOT be mistaken for indexing when no run was enqueued.
      allow(ElasticsearchQueryHelper).to receive(:update_es_for_missing_data).and_return([])
      dict = [
        { sample_id: 201, taxons: [{ "tax_id" => 5 }] },
        { sample_id: 202, taxons: [] },
      ]
      allow(ElasticsearchQueryHelper).to receive(:samples_taxons_details).and_return(dict)

      expect(service.generate).to eq(dict)
    end
  end
end
