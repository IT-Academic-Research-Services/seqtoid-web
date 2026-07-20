require "rails_helper"

# Branch sweep for the response-shaping helpers of ElasticsearchQueryHelper that
# the main spec does not exercise: the total_reads guard in organize_data_by_pr,
# the nil-safe rounding arms of round_decimal_value, and the field renaming in
# change_field_name. organize_data_by_pr's PipelineRun lookup is stubbed so no DB
# is touched. Each example flips a single branch. Spec-only.
RSpec.describe ElasticsearchQueryHelper, type: :helper do
  describe ".organize_data_by_pr total_reads guard" do
    def stub_pipeline_run(id:, total_reads:)
      pr = double("pipeline_run_#{id}")
      allow(pr).to receive(:id).and_return(id)
      allow(pr).to receive(:[]).with("total_reads").and_return(total_reads)
      relation = double("relation")
      allow(PipelineRun).to receive(:where).with(id: [id]).and_return(relation)
      allow(relation).to receive(:includes).with([:sample]).and_return([pr])
      pr
    end

    it "appends the es row to a pipeline run that has total_reads" do
      stub_pipeline_run(id: 10, total_reads: 500)
      row = { "pipeline_run_id" => 10, "tax_id" => 1 }

      result = ElasticsearchQueryHelper.organize_data_by_pr([row], { 10 => 55 })
      expect(result[10]["taxon_counts"]).to eq([row])
      expect(result[10]["sample_id"]).to eq(55)
    end

    it "does NOT append the row when the pipeline run has no total_reads" do
      stub_pipeline_run(id: 10, total_reads: nil)
      row = { "pipeline_run_id" => 10, "tax_id" => 1 }

      result = ElasticsearchQueryHelper.organize_data_by_pr([row], { 10 => 55 })
      expect(result[10]["taxon_counts"]).to eq([])
    end
  end

  describe ".round_decimal_value nil-safe arms" do
    it "rounds present rpm/zscore/r to 4 decimals as floats" do
      metric = ElasticsearchQueryHelper.round_decimal_value(
        "rpm" => 1.234567, "zscore" => 2.345678, "r" => 3
      )
      expect(metric["rpm"]).to eq(1.2346)
      expect(metric["zscore"]).to eq(2.3457)
      expect(metric["r"]).to eq(3.0)
      expect(metric["r"]).to be_a(Float)
    end

    it "leaves nil metrics as nil (the &. short-circuit arm)" do
      metric = ElasticsearchQueryHelper.round_decimal_value(
        "rpm" => nil, "zscore" => nil, "r" => nil
      )
      expect(metric["rpm"]).to be_nil
      expect(metric["zscore"]).to be_nil
      expect(metric["r"]).to be_nil
    end
  end

  describe ".change_field_name" do
    it "renames the ES field names to their report equivalents" do
      metric = ElasticsearchQueryHelper.change_field_name(
        "counts" => 5, "percent_identity" => 99, "e_value" => -3, "alignment_length" => 150
      )
      expect(metric).to eq(
        "r" => 5, "percentidentity" => 99, "logevalue" => -3, "alignmentlength" => 150
      )
      # old keys are removed by the delete-based rename
      expect(metric).not_to have_key("counts")
      expect(metric).not_to have_key("e_value")
    end
  end
end
