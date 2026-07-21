require "rails_helper"

# Branch coverage for ReportsHelper. The existing reports_helper_spec exercises the
# single-taxon validate_name/convert_neg_taxid/fetch_parent_name/fake_genus paths;
# this file drives the branch arms those tests leave undriven: the validate_names
# orchestrator (name-set vs unset, missing-report present vs absent, missing parent
# vs missing name, and the two trailing "unless empty?" warn guards), plus the
# validate_name arm where a negative id is one of the known MISSING_LINEAGE ids.
# Pure in-memory logic: no DB writes, no AWS.
RSpec.describe ReportsHelper, type: :helper do
  let(:species) { TaxonCount::TAX_LEVEL_SPECIES }

  describe ".validate_names" do
    it "records a missing name and warns when a positive taxon has no name" do
      # tax_id > 0 with a nil name -> validate_name returns a made-up name (truthy,
      # driving the L24 name-assign THEN) and missing[:name] (driving L28 THEN);
      # after the loop missing_names is non-empty -> the L33 warn guard fires.
      counts = { species => { 100 => { name: nil, genus_tax_id: 50 } } }

      expect(Rails.logger).to receive(:warn).with(/missing names/)
      ReportsHelper.validate_names(counts, {}, 123)

      expect(counts[species][100][:name]).to eq("unnamed species taxon 100")
    end

    it "leaves a well-formed positive taxon untouched and records nothing" do
      # tax_id > 0 with a name present -> validate_name returns [nil, {}], driving the
      # L24 name-assign ELSE (validated name is nil) and the L26 missing-report ELSE
      # (missing report is blank). No warns.
      counts = { species => { 200 => { name: "Homo sapiens", genus_tax_id: 60 } } }

      expect(Rails.logger).not_to receive(:warn)
      ReportsHelper.validate_names(counts, {}, 123)

      expect(counts[species][200][:name]).to eq("Homo sapiens")
    end

    it "records a missing parent and warns when a below-base species has no parent name" do
      # tax_id below INVALID_CALL_BASE_ID with no resolvable parent name -> validate_name
      # returns missing[:parent] but no missing[:name], driving the L27 parent THEN and
      # the L28 name ELSE; after the loop missing_parents is non-empty -> the L34 warn
      # guard fires (and missing_names stays empty).
      invalid_id = -100_000_300
      counts = { species => { invalid_id => { name: "x", genus_tax_id: 70 } } }

      expect(Rails.logger).to receive(:warn).with(/missing parent/)
      ReportsHelper.validate_names(counts, {}, 123)
    end
  end

  describe ".validate_name" do
    it "does not append the tax_id for the alternate missing-species sentinel id" do
      # tax_id == MISSING_SPECIES_ID_ALT (-1): negative, but above the invalid-call base
      # and not the blacklist genus, so it reaches the final elsif whose guard is false
      # (the id IS a known missing-lineage sentinel) -> the ELSE (no id append).
      name, missing = ReportsHelper.validate_name(
        tax_id: TaxonLineage::MISSING_SPECIES_ID_ALT,
        tax_level: species,
        tax_name: nil,
        genus_tax_id: nil,
        parent_name: nil,
        pipeline_run_id: 1
      )

      expect(name).to eq("all taxa with neither family nor genus classification")
      expect(missing).to eq({})
    end
  end
end
