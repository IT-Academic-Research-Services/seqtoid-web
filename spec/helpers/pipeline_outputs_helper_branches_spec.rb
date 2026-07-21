require "rails_helper"

# Branch coverage for PipelineOutputsHelper. The existing pipeline_outputs_helper_spec
# drives the common paths; this file targets the conditional arms it leaves undriven:
# the curate host_subtracted-absent arm; parse_accession's read-sampling cap, the
# reversed/read_part swap, the empty left/right-portion ternaries, and the ref_seq
# trim-vs-pad while loops; parse_tree's missing-coverage arm; taxon_name's found and
# not-found arms; and the combined NT/NR fasta empty vs non-empty arms. Pure/in-memory
# except stubbed lookups; no real DB or AWS calls.
RSpec.describe PipelineOutputsHelper, type: :helper do
  describe "#curate_pipeline_run_display" do
    it "omits host_subtracted when the run has none" do
      pipeline_run = create(:pipeline_run, sample: create(:sample, project: create(:project)))
      allow(pipeline_run).to receive(:host_subtracted).and_return(nil)

      display = helper.curate_pipeline_run_display(pipeline_run)
      expect(display).not_to have_key("host_subtracted")
      expect(display["version"][:pipeline]).to eq(pipeline_run.pipeline_version)
    end
  end

  describe "#parse_accession" do
    it "samples down to the per-accession cap while recording the true count" do
      reads = Array.new(25) do |i|
        [
          "read#{i}/1",
          "ACGTACGT",
          ["1.5", "1", "2", "3", "2", "5", "10", "20", "0.1", "0.2"],
          ["AA", "ACGT", "TT"],
        ]
      end
      result = helper.parse_accession({ "reads" => reads })

      expect(result["reads_count"]).to eq(25)
      expect(result["reads"].size).to eq(PipelineOutputsHelper::MAX_ALGIN_VIZ_READS_PER_ACCESSION)
    end

    it "flips the aligned coordinates for an un-reversed read of the second mate" do
      # reversed == 0 (metrics[6] <= metrics[7]) AND read_part == 2 -> the L50 swap runs.
      # metrics[4]=2, metrics[5]=8 -> after swap metrics[4]=1 (so the left-portion ternary
      # takes its ELSE and left_portion == "") and metrics[5]=7.
      accession_details = {
        "reads" => [
          [
            "readA/2",
            "ACGTACGT",
            ["1.5", "1", "2", "3", "2", "8", "10", "20", "0.1", "0.2"],
            ["AA", "ACGTACG", "TT"],
          ],
        ],
      }
      result = helper.parse_accession(accession_details)
      read = result["reads"].first

      # coordinates were swapped to [1, 7]
      expect(read["metrics"][4]).to eq(1)
      expect(read["metrics"][5]).to eq(7)
      expect(read["reversed"]).to eq(0)
    end

    it "pads the reference edges when they are shorter than the read portions" do
      # left_portion is non-empty (metrics[4]=3) but ref_seq[0] is empty -> the ref-left
      # trim ELSE pads ref_seq[0] via the while loop. right_portion is empty (metrics[5]=8
      # == read size, so its ternary ELSE fires) but ref_seq[2] is non-empty -> the
      # ref-right THEN pads right_portion via its while loop.
      accession_details = {
        "reads" => [
          [
            "readB/1",
            "ACGTACGT",
            ["1.5", "1", "2", "3", "3", "8", "10", "20", "0.1", "0.2"],
            ["", "ACGTAC", "TTTT"],
          ],
        ],
      }
      result = helper.parse_accession(accession_details)
      read = result["reads"].first

      # alignment strings are built from the padded portions
      expect(read["alignment"].size).to eq(3)
    end
  end

  describe "#parse_tree" do
    it "sorts reads in place even when the raw leaf has no coverage summary" do
      # raw == true and the leaf has "reads" but no "coverage_summary" -> the coverage
      # sort guard takes its ELSE and only the reads are sorted.
      results = {}
      leaf = {
        "reads" => [
          ["r2", "seq", [nil, nil, nil, nil, nil, nil, "5"]],
          ["r1", "seq", [nil, nil, nil, nil, nil, nil, "2"]],
        ],
      }
      helper.parse_tree(results, "taxid_1", leaf, true)

      expect(results["taxid_1"]["reads"].first[0]).to eq("r1")
      expect(results["taxid_1"]).not_to have_key("coverage_summary")
    end
  end

  describe "#taxon_name" do
    it "returns the level-specific name when the lineage is found" do
      allow(TaxonLineage).to receive(:find_by).and_return({ "species_name" => "Homo sapiens" })
      expect(helper.taxon_name(9606, "species")).to eq("Homo sapiens")
    end

    it "returns nil when the lineage is not found" do
      allow(TaxonLineage).to receive(:find_by).and_return(nil)
      expect(helper.taxon_name(-1, "species")).to be_nil
    end
  end

  describe "#get_taxon_fasta_from_pipeline_run_combined_nt_nr" do
    let(:pipeline_run) { instance_double(PipelineRun) }

    it "returns nil when neither NT nor NR yields any reads" do
      allow(helper).to receive(:get_taxon_fasta_from_pipeline_run).and_return("", "")
      expect(helper.get_taxon_fasta_from_pipeline_run_combined_nt_nr(pipeline_run, 570, 1)).to be_nil
    end

    it "returns the merged fasta when reads are present" do
      allow(helper).to receive(:get_taxon_fasta_from_pipeline_run)
        .and_return(">nt_read\nACGT\n", ">nr_read\nTGCA\n")
      combined = helper.get_taxon_fasta_from_pipeline_run_combined_nt_nr(pipeline_run, 570, 1)

      expect(combined).to start_with(">")
      expect(combined).to include("nt_read")
      expect(combined).to include("nr_read")
    end
  end
end
