require 'rails_helper'

# platform-overhaul 733 follow-up: param type/key normalization in
# TopTaxonsElasticsearchService#build_filter_param_hash. Two latent bugs, masked in
# production only because callers pass ActionController::Parameters:
#   BUG 1 -- include?("categories"/"subcategories"/"readSpecificity") used STRING keys while
#            every [] read used a SYMBOL, so a plain symbol-keyed Hash caller silently skipped
#            those filter blocks. These specs pass PLAIN Hashes to prove the indifferent-access
#            normalization makes include? and [] agree.
#   BUG 2 -- taxonIds arrive from an HTTP request as STRINGS while removedTaxonIds are
#            Integer()-coerced, so ["20"] - [20] removed nothing. These specs pass STRING
#            taxonIds (as a real request does) and assert the removal now bites.
# Each assertion fails if the fix is reverted (mutation-checked).
RSpec.describe TopTaxonsElasticsearchService do
  def filter_for(params, background: 26)
    TopTaxonsElasticsearchService.new(
      params: params,
      samples_for_heatmap: nil,
      background_for_heatmap: background
    ).build_filter_param_hash
  end

  describe "#build_filter_param_hash key normalization (plain symbol-keyed Hash)" do
    it "honors categories from a symbol-keyed plain Hash" do
      # Reverting the fix (include?("categories") against a symbol-keyed Hash) drops this key.
      expect(filter_for({ categories: ["Bacteria"] })[:categories]).to eq(["Bacteria"])
    end

    it "honors subcategories/include_phage from a symbol-keyed plain Hash" do
      expect(filter_for({ subcategories: '{"Viruses":["Phage"]}' })[:include_phage]).to be_truthy
    end

    it "honors readSpecificity from a symbol-keyed plain Hash" do
      expect(filter_for({ readSpecificity: "1" })[:read_specificity]).to eq(1)
    end

    it "still omits categories when the key is genuinely absent" do
      expect(filter_for({})).not_to have_key(:categories)
    end
  end

  describe "#build_filter_param_hash removedTaxonIds vs string taxonIds (HTTP shape)" do
    it "removes a string-typed taxonId supplied via ActionController::Parameters" do
      # As a browser sends them: taxonIds + removedTaxonIds are strings. Without the Integer
      # coercion on taxonIds, "20" - 20 removes nothing and this expectation fails.
      result = filter_for(ActionController::Parameters.new(taxonIds: ["10", "20", "30"], removedTaxonIds: ["20"]))
      expect(result[:taxon_ids]).to eq([10, 30])
    end

    it "removes string taxonIds when the caller is a plain symbol-keyed Hash too" do
      result = filter_for({ taxonIds: ["10", "20", "30"], removedTaxonIds: ["20"] })
      expect(result[:taxon_ids]).to eq([10, 30])
    end
  end

  describe "#build_filter_param_hash thresholdFilters shape handling" do
    # DEV-REACTJS-PROJECT-1D: params[:thresholdFilters] can arrive as a Hash (Rails parses a
    # nested-object encoding thresholdFilters[i][k]=v into an index-keyed Hash). The old
    # else-branch JSON.parse'd it, raising "no implicit conversion of
    # HashWithIndifferentAccess into String" and 500'ing the heatmap. Only Strings are JSON.
    let(:one_filter) { { "metric" => "NT_rpm", "value" => 1, "operator" => ">=" } }

    it "parses a JSON string (the frontend's normal encoding)" do
      result = filter_for({ thresholdFilters: '[{"metric":"NT_rpm","value":1,"operator":">="}]' })
      expect(result[:threshold_filters]).to eq([one_filter])
    end

    it "does NOT JSON.parse a Hash (Rails-parsed nested params) -- the heatmap-500 regression" do
      nested = ActionController::Parameters.new(thresholdFilters: { "0" => one_filter })
      expect { filter_for(nested) }.not_to raise_error
      expect(filter_for(nested)[:threshold_filters]).to eq([one_filter])
    end

    it "parses an array of JSON strings" do
      result = filter_for({ thresholdFilters: ['{"metric":"NT_rpm","value":1,"operator":">="}'] })
      expect(result[:threshold_filters]).to eq([one_filter])
    end

    it "returns [] for an empty-array string" do
      expect(filter_for({ thresholdFilters: "[]" })[:threshold_filters]).to eq([])
    end

    it "returns [] when thresholdFilters is absent" do
      expect(filter_for({})[:threshold_filters]).to eq([])
    end
  end
end
