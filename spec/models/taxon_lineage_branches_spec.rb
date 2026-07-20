require 'rails_helper'

# Coverage Wave (branch): taxon_lineage_spec.rb was thin. This drives the pure,
# in-memory branch logic (schema column-defaults are all negative, so a bare
# TaxonLineage.new needs no DB rows):
#   - tax_level: species hit, deeper-level hit (after skipping species), all-missing nil
#   - name: resolves the *_name column for the detected level
#   - self.level_name: species / genus / family / fall-through "rank_N"
RSpec.describe TaxonLineage, type: :model do
  describe "#tax_level" do
    it "returns the species level when species_taxid is positive" do
      tl = TaxonLineage.new(species_taxid: 100)
      expect(tl.tax_level).to eq(TaxonCount::TAX_LEVEL_SPECIES)
    end

    it "skips missing lower levels and returns the first positive level" do
      tl = TaxonLineage.new(species_taxid: -100, genus_taxid: 500)
      expect(tl.tax_level).to eq(TaxonCount::TAX_LEVEL_GENUS)
    end

    it "returns nil when every level taxid is non-positive" do
      tl = TaxonLineage.new
      expect(tl.tax_level).to be_nil
    end
  end

  describe "#name" do
    it "returns the name column for the detected level" do
      tl = TaxonLineage.new(species_taxid: 100, species_name: "Escherichia coli")
      expect(tl.name).to eq("Escherichia coli")
    end
  end

  describe ".level_name" do
    it "maps species, genus, and family to their names" do
      expect(TaxonLineage.level_name(TaxonCount::TAX_LEVEL_SPECIES)).to eq("species")
      expect(TaxonLineage.level_name(TaxonCount::TAX_LEVEL_GENUS)).to eq("genus")
      expect(TaxonLineage.level_name(TaxonCount::TAX_LEVEL_FAMILY)).to eq("family")
    end

    it "falls through to rank_N for any other level" do
      expect(TaxonLineage.level_name(TaxonCount::TAX_LEVEL_ORDER)).to eq("rank_#{TaxonCount::TAX_LEVEL_ORDER}")
    end
  end
end
