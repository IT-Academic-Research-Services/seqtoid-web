require 'rails_helper'

# Third branch sweep for PipelineReportService, companion to
# pipeline_report_service_spec.rb (full Illumina report end-to-end) and
# pipeline_report_service_branches_spec.rb (status/metadata/merge/z-score arms).
#
# The arms filled in here are the ones neither of those reaches:
#
#   * generate: the mass-normalized-background-with-zero-total-count raise.
#   * hash_by_tax_id_and_count_type: the is_phage arm, the decimal-columns arm
#     (PIPELINE_REPORT_SERVICE_USE_DECIMAL_TYPE_COLUMNS on) and the
#     `unless count_type == :merged_nt_nr` else (a merged row carries no
#     background mean/stdev fields).
#   * compute_z_scores: a background present but NT/NR absent from the taxon
#     (every `if taxon_counts[:nt].present?` guard's else), and the nanopore
#     bpm key of the standard-background count-per-million ternary.
#   * compute_aggregate_scores: the nanopore bpm key of the same ternary.
#   * find_species_to_highlight: the UI_HIGHLIGHT_TOP_N early return.
#   * report_csv: the nil e_value arms of the "10^" rewrite, and the
#     known-pathogen row counting arm.
#
# Self-contained: no AppConfig or global state is read that is not set here
# (@use_decimal_columns is set on the instance rather than through AppConfig so
# the example does not depend on suite-wide config seeding).
#
# Spec-only, no app changes.
RSpec.describe PipelineReportService, type: :service do
  let(:project) { create(:project) }
  let(:sample) { create(:sample, project: project) }

  let(:illumina) { PipelineRun::TECHNOLOGY_INPUT[:illumina] }
  let(:nanopore) { PipelineRun::TECHNOLOGY_INPUT[:nanopore] }

  def service_for(technology)
    pr = create(:pipeline_run, sample: sample, technology: technology)
    svc = described_class.new(pr, nil)
    svc.instance_variable_set(:@timer, Timer.new("spec"))
    [svc, pr]
  end

  # Build one plucked taxon-count row positionally from the service's own field
  # index, so the example does not hard-code column offsets.
  def count_row(technology, values)
    index = PipelineReportService::TAXON_COUNT_AND_SUMMARY_FIELDS_INDEX[technology]
    row = Array.new(index.size)
    values.each { |field, value| row[index.fetch(field)] = value }
    row
  end

  describe "#generate with a mass-normalized background" do
    it "raises MassNormalizedBackgroundError when the run has no reads at all" do
      svc, pr = service_for(illumina)
      svc.instance_variable_set(:@background, instance_double(Background, id: 4242, mass_normalized?: true))
      allow(pr).to receive(:report_ready?).and_return(true)
      allow(pr).to receive(:fetch_total_count_by_technology).and_return(0)

      expect { svc.generate }.to raise_error(
        PipelineReportService::MassNormalizedBackgroundError,
        /background 4242 is mass normalized but pipeline run #{pr.id} has no ERCC reads/
      )
    end

    it "does not raise when the background is mass normalized but the run has reads" do
      svc, pr = service_for(illumina)
      svc.instance_variable_set(:@background, instance_double(Background, id: 4242, mass_normalized?: true))
      allow(pr).to receive(:report_ready?).and_return(true)
      allow(pr).to receive(:fetch_total_count_by_technology).and_return(1000)
      # Stop the run right after the guard; the rest of generate needs a full
      # taxon-count fixture that is not what this example is pinning.
      allow(pr).to receive(:fetch_adjusted_total_count_by_technology).and_raise(ArgumentError, "past the guard")

      expect { svc.generate }.to raise_error(ArgumentError, "past the guard")
    end
  end

  describe "#generate for a report-ready run with no taxon counts" do
    # A run that is report_ready with a non-zero total count but no taxon_counts
    # rows walks the whole of generate while every per-taxon structure stays
    # empty: it is the cheapest way to drive the merge_nt_nr arms, the
    # nil-background safe navigations and the "no species / no genus" arms.
    def empty_report_run
      pr = create(
        :pipeline_run,
        sample: sample,
        technology: illumina,
        total_reads: 1000,
        total_ercc_reads: 0,
        fraction_subsampled: 1.0
      )
      allow(pr).to receive(:report_ready?).and_return(true)
      pr
    end

    it "serially fetches merged counts with a nil background and emits an empty report" do
      pr = empty_report_run
      svc = described_class.new(pr, nil, parallel: false, merge_nt_nr: true)

      # The nil background must be passed through as nil, not raise.
      expect(svc).to receive(:fetch_taxon_counts)
        .with(hash_including(background_id: nil, count_types: [TaxonCount::COUNT_TYPE_NT, TaxonCount::COUNT_TYPE_NR]))
        .and_call_original
      expect(svc).to receive(:fetch_taxon_counts)
        .with(hash_including(count_types: [TaxonCount::COUNT_TYPE_MERGED]))
        .and_call_original

      report = JSON.parse(svc.call)

      expect(report["all_tax_ids"]).to eq([])
      expect(report["counts"]).to eq({})
      expect(report["lineage"]).to be_nil
      expect(report["sortedGenus"]).to be_nil
      expect(report["metadata"]["pipelineRunStatus"]).to eq("WAITING")
      expect(report["metadata"]["reportReady"]).to be(true)
    end

    it "adds the merged-count step to the parallel fetch when merge_nt_nr is set" do
      pr = empty_report_run
      svc = described_class.new(pr, nil, parallel: true, merge_nt_nr: true)

      report = JSON.parse(svc.call)

      expect(report["counts"]).to eq({})
      expect(report["all_tax_ids"]).to eq([])
    end

    it "runs only the three base steps in parallel when merge_nt_nr is not set" do
      pr = empty_report_run
      svc = described_class.new(pr, nil, parallel: true, merge_nt_nr: false)

      requested_count_types = Queue.new
      allow(svc).to receive(:fetch_taxon_counts).and_wrap_original do |original, **kwargs|
        requested_count_types << kwargs[:count_types]
        original.call(**kwargs)
      end

      report = JSON.parse(svc.call)

      expect(requested_count_types.size).to eq(1)
      expect(requested_count_types.pop).to eq([TaxonCount::COUNT_TYPE_NT, TaxonCount::COUNT_TYPE_NR])
      expect(report["counts"]).to eq({})
    end
  end

  describe "#process_taxon_counts_by_tax_level" do
    before do
      allow(PathogenList).to receive_message_chain(:find_by, :fetch_list_version, :fetch_pathogens_info, :pluck).and_return([])
    end

    it "merges the merged_nt_nr structure in and looks up lineage by species for a negative genus" do
      svc, = service_for(illumina)
      svc.instance_variable_set(:@background, instance_double(Background, mass_normalized?: false))

      species_counts = {
        573 => {
          genus_tax_id: -200,
          name: "Klebsiella pneumoniae",
          nt: { count: 100, bg_mean: 1.0, bg_stdev: 1.0 },
          nr: { count: 50, bg_mean: 1.0, bg_stdev: 1.0 },
        },
      }
      genus_counts = {
        -200 => {
          genus_tax_id: -200,
          name: "Klebsiella",
          nt: { count: 100, bg_mean: 1.0, bg_stdev: 1.0 },
          nr: { count: 50, bg_mean: 1.0, bg_stdev: 1.0 },
        },
      }
      counts_by_tax_level = {
        TaxonCount::TAX_LEVEL_SPECIES => species_counts,
        TaxonCount::TAX_LEVEL_GENUS => genus_counts,
      }
      merged = {
        TaxonCount::TAX_LEVEL_SPECIES => { 573 => { merged_nt_nr: { count: 150 } } },
        TaxonCount::TAX_LEVEL_GENUS => { -200 => { merged_nt_nr: { count: 150 } } },
      }

      structured_lineage, sorted_genus_tax_ids, highlighted = svc.send(
        :process_taxon_counts_by_tax_level,
        taxon_counts: [counts_by_tax_level, merged],
        total_count: 1_000_000,
        contigs: {}
      )

      # The merged structure was folded into both levels (merge_taxon_count_structures).
      expect(species_counts[573][:merged_nt_nr]).to eq(count: 150, rpm: 150.0)
      expect(genus_counts[-200][:merged_nt_nr]).to eq(count: 150, rpm: 150.0)
      # rpm was computed for the plain count types too.
      expect(species_counts[573][:nt][:rpm]).to eq(100.0)
      # The species was attached to its (negative-id) genus.
      expect(genus_counts[-200][:species_tax_ids]).to eq([573])
      expect(sorted_genus_tax_ids).to eq([-200])
      # No lineage rows exist for these tax ids, so the encoded lineage is empty.
      expect(structured_lineage).to eq({})
      # The single species clears every highlight threshold (rpm 100, z-score 99).
      expect(highlighted).to eq([573])
    end
  end

  describe "#hash_by_tax_id_and_count_type" do
    let(:index) { PipelineReportService::TAXON_COUNT_AND_SUMMARY_FIELDS_INDEX[PipelineRun::TECHNOLOGY_INPUT[:illumina]] }

    let(:base_values) do
      {
        tax_id: 573,
        tax_level: TaxonCount::TAX_LEVEL_SPECIES,
        genus_taxid: 570,
        name: "Klebsiella pneumoniae",
        common_name: "",
        superkingdom_taxid: 2,
        count_type: "NT",
        count: 100,
        e_value: -50,
        source_count_type: nil,
        percent_identity: 95,
        percent_identity_decimal: 95.5,
        alignment_length: 120,
        alignment_length_decimal: 120.5,
        rpm: 10,
        rpm_decimal: 10.25,
        mean: 1.5,
        stdev: 0.5,
        mean_mass_normalized: 2.5,
        stdev_mass_normalized: 1.25,
      }
    end

    it "tags a phage row with the phage subcategory" do
      svc, = service_for(illumina)
      row = count_row(illumina, base_values.merge(is_phage: 1))

      result = svc.send(:hash_by_tax_id_and_count_type, [row], index)

      expect(result[573][:subcategories]).to eq(["phage"])
      expect(result[573][:is_phage]).to be(true)
    end

    it "leaves a non-phage row without a subcategory list" do
      svc, = service_for(illumina)
      row = count_row(illumina, base_values.merge(is_phage: 0))

      result = svc.send(:hash_by_tax_id_and_count_type, [row], index)

      expect(result[573]).not_to have_key(:subcategories)
      expect(result[573][:is_phage]).to be(false)
    end

    it "reads the integer columns when the decimal-column app config is off" do
      svc, = service_for(illumina)
      row = count_row(illumina, base_values.merge(is_phage: 0))

      result = svc.send(:hash_by_tax_id_and_count_type, [row], index)

      expect(result[573][:nt][:percent_identity]).to eq(95)
      expect(result[573][:nt][:alignment_length]).to eq(120)
      expect(result[573][:nt][:rpm]).to eq(10)
    end

    it "reads the decimal columns when the decimal-column app config is on" do
      svc, = service_for(illumina)
      svc.instance_variable_set(:@use_decimal_columns, true)
      row = count_row(illumina, base_values.merge(is_phage: 0))

      result = svc.send(:hash_by_tax_id_and_count_type, [row], index)

      expect(result[573][:nt][:percent_identity]).to eq(95.5)
      expect(result[573][:nt][:alignment_length]).to eq(120.5)
      expect(result[573][:nt][:rpm]).to eq(10.25)
    end

    it "attaches the background mean/stdev fields to an NT row" do
      svc, = service_for(illumina)
      row = count_row(illumina, base_values.merge(is_phage: 0))

      result = svc.send(:hash_by_tax_id_and_count_type, [row], index)

      expect(result[573][:nt]).to include(
        bg_mean: 1.5,
        bg_stdev: 0.5,
        bg_mean_mass_normalized: 2.5,
        bg_stdev_mass_normalized: 1.25
      )
    end

    it "omits the background fields from a merged_NT_NR row" do
      svc, = service_for(illumina)
      row = count_row(illumina, base_values.merge(is_phage: 0, count_type: "merged_NT_NR"))

      result = svc.send(:hash_by_tax_id_and_count_type, [row], index)

      merged = result[573][:merged_nt_nr]
      expect(merged[:count]).to eq(100)
      expect(merged).not_to have_key(:bg_mean)
      expect(merged).not_to have_key(:bg_stdev_mass_normalized)
    end
  end

  describe "#compute_z_scores" do
    it "skips every per-count-type write when the taxon has neither NT nor NR" do
      svc, = service_for(illumina)
      svc.instance_variable_set(:@background, instance_double(Background, mass_normalized?: true))
      taxa = { 573 => { name: "no counts" } }

      svc.send(:compute_z_scores, taxa)

      expect(taxa[573]).not_to have_key(:nt)
      expect(taxa[573]).not_to have_key(:nr)
      # nr_z_score is nil, so the max_z_score ternary takes the nt (also nil) side.
      expect(taxa[573][:max_z_score]).to be_nil
    end

    it "uses the bpm column of a standard background for a nanopore run" do
      svc, pr = service_for(nanopore)
      svc.instance_variable_set(:@background, instance_double(Background, mass_normalized?: false))
      allow(pr).to receive(:total_ercc_reads).and_return(0)
      taxa = {
        573 => {
          nt: { count: 5, bpm: 20.0, rpm: 999.0, bg_mean: 10.0, bg_stdev: 5.0 },
          nr: { count: 5, bpm: 30.0, rpm: 999.0, bg_mean: 10.0, bg_stdev: 5.0 },
        },
      }

      svc.send(:compute_z_scores, taxa)

      # (20 - 10) / 5 == 2.0 from bpm; the rpm column would have given 197.8.
      expect(taxa[573][:nt][:z_score]).to be_within(1e-9).of(2.0)
      expect(taxa[573][:nr][:z_score]).to be_within(1e-9).of(4.0)
      expect(taxa[573][:max_z_score]).to be_within(1e-9).of(4.0)
    end

    it "marks a zero-count taxon as absent from the sample" do
      svc, = service_for(illumina)
      svc.instance_variable_set(:@background, instance_double(Background, mass_normalized?: false))
      taxa = { 573 => { nt: { count: 0, rpm: 0.0, bg_mean: 1.0, bg_stdev: 1.0 } } }

      svc.send(:compute_z_scores, taxa)

      expect(taxa[573][:nt][:z_score]).to eq(PipelineReportService::Z_SCORE_WHEN_ABSENT_FROM_SAMPLE)
    end
  end

  describe "#compute_aggregate_scores with a background" do
    it "aggregates from the bpm column for a nanopore run" do
      svc, = service_for(nanopore)
      svc.instance_variable_set(:@background, instance_double(Background, mass_normalized?: false))
      genus_counts = { 570 => { nt: { z_score: 2.0, bpm: 5.0 }, nr: { z_score: 2.0, bpm: 5.0 } } }
      species_counts = {
        573 => {
          genus_tax_id: 570,
          nt: { z_score: 3.0, bpm: 10.0 },
          nr: { z_score: 4.0, bpm: 20.0 },
        },
      }

      svc.send(:compute_aggregate_scores, species_counts, genus_counts)

      # from_nt = |2| * 3 * 10 == 60; from_nr = |2| * 4 * 20 == 160.
      expect(species_counts[573][:agg_score]).to be_within(1e-9).of(220.0)
      expect(genus_counts[570][:agg_score]).to be_within(1e-9).of(220.0)
    end

    it "contributes nothing from a count type the species does not have" do
      svc, = service_for(illumina)
      svc.instance_variable_set(:@background, instance_double(Background, mass_normalized?: false))
      genus_counts = { 570 => { nt: { z_score: 2.0, rpm: 5.0 }, nr: { z_score: 2.0, rpm: 5.0 } } }
      species_counts = { 573 => { genus_tax_id: 570, nt: { z_score: 3.0, rpm: 10.0 } } }

      svc.send(:compute_aggregate_scores, species_counts, genus_counts)

      # Only from_nt contributes: |2| * 3 * 10 == 60.
      expect(species_counts[573][:agg_score]).to be_within(1e-9).of(60.0)
    end
  end

  describe "#find_species_to_highlight" do
    def highlightable(tax_id)
      [tax_id, { nt: { rpm: 100, z_score: 10 }, nr: { rpm: 100, z_score: 10 } }]
    end

    it "stops once the top-N cap is reached" do
      svc, = service_for(illumina)
      species_ids = [101, 102, 103, 104, 105]
      counts = {
        TaxonCount::TAX_LEVEL_GENUS => { 570 => { species_tax_ids: species_ids } },
        TaxonCount::TAX_LEVEL_SPECIES => species_ids.map { |id| highlightable(id) }.to_h,
      }

      highlighted = svc.send(:find_species_to_highlight, [570], counts)

      expect(highlighted.length).to eq(PipelineReportService::UI_HIGHLIGHT_TOP_N)
      expect(highlighted).to eq(species_ids.first(PipelineReportService::UI_HIGHLIGHT_TOP_N))
    end

    it "skips species that do not meet the highlight thresholds" do
      svc, = service_for(illumina)
      counts = {
        TaxonCount::TAX_LEVEL_GENUS => { 570 => { species_tax_ids: [101, 102] } },
        TaxonCount::TAX_LEVEL_SPECIES => {
          101 => { nt: { rpm: 0, z_score: 0 }, nr: { rpm: 0, z_score: 0 } },
          102 => highlightable(102).last,
        },
      }

      expect(svc.send(:find_species_to_highlight, [570], counts)).to eq([102])
    end
  end

  describe "#report_csv" do
    let(:counts) do
      {
        2 => {
          570 => {
            genus_tax_id: 570,
            name: "Klebsiella",
            species_tax_ids: [573],
            nt: { e_value: nil, rpm: 1.0 },
            nr: { e_value: -5, rpm: 1.0 },
          },
        },
        1 => {
          573 => {
            genus_tax_id: 570,
            name: "Klebsiella pneumoniae",
            nt: { e_value: nil, rpm: 2.0 },
            nr: { e_value: -7, rpm: 2.0 },
            'pathogenFlag' => PipelineReportService::FLAG_KNOWN_PATHOGEN,
          },
        },
      }
    end

    it "leaves a nil e_value blank and exponentiates a present one" do
      svc, = service_for(illumina)

      rows = CSV.parse(svc.send(:report_csv, counts, [570]), headers: true)

      expect(rows.length).to eq(2)
      expect(rows[0]["nt_e_value"]).to be_nil
      expect(rows[0]["nr_e_value"]).to eq("10^-5")
      expect(rows[1]["nt_e_value"]).to be_nil
      expect(rows[1]["nr_e_value"]).to eq("10^-7")
    end

    it "leaves both e_value columns blank when neither count type has one" do
      svc, = service_for(illumina)
      no_e_values = counts.deep_dup
      no_e_values[2][570][:nr][:e_value] = nil
      no_e_values[1][573][:nr][:e_value] = nil

      rows = CSV.parse(svc.send(:report_csv, no_e_values, [570]), headers: true)

      expect(rows[0]["nt_e_value"]).to be_nil
      expect(rows[0]["nr_e_value"]).to be_nil
      expect(rows[1]["nt_e_value"]).to be_nil
      expect(rows[1]["nr_e_value"]).to be_nil
    end

    it "counts the known-pathogen species against both its own row and its genus" do
      svc, = service_for(illumina)

      rows = CSV.parse(svc.send(:report_csv, counts, [570]), headers: true)

      expect(rows[0]["tax_id"]).to eq("570")
      expect(rows[0]["known_pathogen"]).to eq("1")
      expect(rows[1]["tax_id"]).to eq("573")
      expect(rows[1]["known_pathogen"]).to eq("1")
    end

    it "counts nothing when no row carries a known-pathogen flag" do
      svc, = service_for(illumina)
      clean = counts.deep_dup
      clean[1][573].delete('pathogenFlag')

      rows = CSV.parse(svc.send(:report_csv, clean, [570]), headers: true)

      expect(rows[0]["known_pathogen"]).to eq("0")
      expect(rows[1]["known_pathogen"]).to eq("0")
    end

    it "counts a species flagged through the pathogenFlags list" do
      svc, = service_for(illumina)
      flagged = counts.deep_dup
      flagged[1][573].delete('pathogenFlag')
      flagged[1][573]['pathogenFlags'] = [PipelineReportService::FLAG_KNOWN_PATHOGEN]

      rows = CSV.parse(svc.send(:report_csv, flagged, [570]), headers: true)

      expect(rows[0]["known_pathogen"]).to eq("1")
      expect(rows[1]["known_pathogen"]).to eq("1")
    end
  end
end
