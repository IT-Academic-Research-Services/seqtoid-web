require "rails_helper"

# Branch-coverage companion for app/lib/report_helper.rb.
# Targets the conditional arms the existing specs never take:
#   - generate_heatmap_csv: the non-flagged side of the known_pathogen ternary,
#     the `dig` miss (|| []), and the non-nil background_id path including both
#     arms of `Background.find(...)&.name`.
#   - validate_names!: the "invalid call" negative taxid path (tax_id below
#     INVALID_CALL_BASE_ID) with both a resolvable and a missing parent, the
#     generic-negative-taxid suffix path, and the missing-parents warning.
RSpec.describe ReportHelper do
  # Instance methods live on the module; mix it into a bare host object.
  let(:host) { Class.new { include ReportHelper }.new }

  describe "#generate_heatmap_csv known_pathogen column" do
    let(:sample_taxa_hash) do
      [{
        name: "Sample A",
        sample_id: 7,
        taxons: [
          { "tax_id" => 100, "genus_name" => "G", "name" => "Flagged taxon", "NT" => { "r" => 1 }, "NR" => { "r" => 2 } },
          { "tax_id" => 200, "genus_name" => "G", "name" => "Plain taxon", "NT" => { "r" => 3 }, "NR" => { "r" => 4 } },
        ],
      }]
    end

    it "writes 1 for flagged taxa and 0 for taxa whose flags omit the known-pathogen flag" do
      flags = { 7 => { 100 => [PipelineReportService::FLAG_KNOWN_PATHOGEN], 200 => ["some_other_flag"] } }

      csv = CSV.parse(host.generate_heatmap_csv(sample_taxa_hash, nil, flags), headers: true)

      expect(csv.headers).to include("known_pathogen")
      expect(csv[0]["known_pathogen"]).to eq("1")
      expect(csv[1]["known_pathogen"]).to eq("0")
    end

    it "writes 0 when the sample/taxon pair is absent from the flag hash entirely" do
      csv = CSV.parse(host.generate_heatmap_csv(sample_taxa_hash, nil, {}), headers: true)

      # The last CSV row is the trailing "Background: ..." footer, not a taxon.
      expect(csv.first(2).pluck("known_pathogen")).to eq(%w[0 0])
    end

    it "omits the known_pathogen column when no flags are supplied" do
      csv = CSV.parse(host.generate_heatmap_csv(sample_taxa_hash, nil), headers: true)

      expect(csv.headers).not_to include("known_pathogen")
    end
  end

  describe "#generate_heatmap_csv background footer" do
    it "writes 'None' when background_id is nil" do
      output = host.generate_heatmap_csv([], nil)
      expect(output).to include("Background: None")
    end

    it "writes the background name when the background resolves" do
      allow(Background).to receive(:find).with(42).and_return(instance_double(Background, name: "My Background"))

      output = host.generate_heatmap_csv([], 42)
      expect(output).to include("Background: My Background")
    end

    it "writes an empty name when the background lookup yields nil" do
      allow(Background).to receive(:find).with(42).and_return(nil)

      output = host.generate_heatmap_csv([], 42)
      expect(output).to include("Background: ")
      expect(output).not_to include("Background: None")
    end
  end

  describe ".validate_names! for invalid-call negative taxids" do
    # convert_neg_taxid maps -100_000_570 back onto parent taxid 570.
    let(:invalid_call_taxid) { TaxonLineage::INVALID_CALL_BASE_ID - 570 }

    it "names the taxon after its parent when the parent is present in the 2d hash" do
      tax_2d = {
        570 => { "tax_level" => TaxonCount::TAX_LEVEL_GENUS, "name" => "Klebsiella", "superkingdom_taxid" => 2 },
        invalid_call_taxid => { "tax_level" => TaxonCount::TAX_LEVEL_SPECIES, "superkingdom_taxid" => 2 },
      }

      described_class.validate_names!(tax_2d)

      expect(tax_2d[invalid_call_taxid]["name"]).to eq("non-species-specific reads in genus Klebsiella")
      expect(tax_2d[invalid_call_taxid]["category_name"]).to eq("Bacteria")
    end

    it "synthesizes a placeholder parent and warns when the parent is missing" do
      allow(Rails.logger).to receive(:warn)
      tax_2d = {
        invalid_call_taxid => { "tax_level" => TaxonCount::TAX_LEVEL_GENUS, "superkingdom_taxid" => 10_239 },
      }

      described_class.validate_names!(tax_2d)

      expect(tax_2d[invalid_call_taxid]["name"]).to eq("non-genus-specific reads in  taxon 570")
      expect(tax_2d[invalid_call_taxid]["category_name"]).to eq("Viruses")
      expect(Rails.logger).to have_received(:warn).with(/Missing parent for child:.*570/)
    end
  end

  describe ".validate_names! for other negative taxids" do
    it "appends the raw taxid for a negative id that is neither a known sentinel nor -1" do
      tax_2d = { -55 => { "tax_level" => TaxonCount::TAX_LEVEL_SPECIES, "superkingdom_taxid" => 2 } }

      described_class.validate_names!(tax_2d)

      expect(tax_2d[-55]["name"]).to eq("all taxa with neither family nor genus classification -55")
    end

    it "leaves the generic label alone for a known missing-lineage sentinel id" do
      sentinel = TaxonLineage::MISSING_GENUS_ID
      tax_2d = { sentinel => { "tax_level" => TaxonCount::TAX_LEVEL_GENUS, "superkingdom_taxid" => 2 } }

      described_class.validate_names!(tax_2d)

      expect(tax_2d[sentinel]["name"]).to eq("all taxa with neither family nor genus classification")
    end
  end

  describe ".convert_neg_taxid" do
    it "maps an invalid-call taxid back onto its positive parent" do
      expect(described_class.convert_neg_taxid(TaxonLineage::INVALID_CALL_BASE_ID - 570)).to eq(570)
    end

    it "leaves taxids above the invalid-call threshold untouched" do
      expect(described_class.convert_neg_taxid(-201)).to eq(-201)
    end
  end
end
