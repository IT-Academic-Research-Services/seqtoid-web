require "rails_helper"

# Coverage for the pure version-comparison and small utility functions in
# PipelineRunsHelper. (Isolated from pipeline_runs_helper_spec.rb, which covers
# the sfn_info / execution-history / check_for_user_error surface.)
RSpec.describe PipelineRunsHelper, type: :helper do
  describe "#pipeline_version_at_least" do
    it "returns false when pipeline_version is nil" do
      expect(helper.pipeline_version_at_least(nil, "3.1")).to be(false)
    end

    it "returns true when the major version is greater" do
      expect(helper.pipeline_version_at_least("4.0", "3.1")).to be(true)
    end

    it "returns false when the major version is lower" do
      expect(helper.pipeline_version_at_least("2.9", "3.1")).to be(false)
    end

    it "compares the minor version when majors are equal" do
      expect(helper.pipeline_version_at_least("3.2", "3.1")).to be(true)
      expect(helper.pipeline_version_at_least("3.0", "3.1")).to be(false)
    end

    it "compares the patch version when major and minor are equal (inclusive)" do
      expect(helper.pipeline_version_at_least("3.1.5", "3.1.5")).to be(true)
      expect(helper.pipeline_version_at_least("3.1.6", "3.1.5")).to be(true)
      expect(helper.pipeline_version_at_least("3.1.4", "3.1.5")).to be(false)
    end

    it "treats a missing minor/patch component as zero" do
      # "3" -> [3], nil.to_i == 0
      expect(helper.pipeline_version_at_least("3", "3.0.0")).to be(true)
      expect(helper.pipeline_version_at_least("3", "3.1")).to be(false)
    end
  end

  describe "version predicate wrappers" do
    it "pipeline_version_at_least_2" do
      expect(helper.pipeline_version_at_least_2("2.0")).to be(true)
      expect(helper.pipeline_version_at_least_2("1.9")).to be(false)
    end

    it "pipeline_version_has_assembly (>= 3.1)" do
      expect(helper.pipeline_version_has_assembly("3.1")).to be(true)
      expect(helper.pipeline_version_has_assembly("3.0")).to be(false)
    end

    it "pipeline_version_has_coverage_viz (>= 3.6)" do
      expect(helper.pipeline_version_has_coverage_viz("3.6")).to be(true)
      expect(helper.pipeline_version_has_coverage_viz("3.5")).to be(false)
    end

    it "pipeline_version_uses_new_host_filtering_stage (>= 7.2, the real WDL boundary)" do
      expect(helper.pipeline_version_uses_new_host_filtering_stage("8.0")).to be(true)
      expect(helper.pipeline_version_uses_new_host_filtering_stage("7.2")).to be(true)
      expect(helper.pipeline_version_uses_new_host_filtering_stage("7.1")).to be(false)
    end

    it "pipeline_version_uses_bowtie2_to_calculate_ercc_reads (>= 8.1)" do
      expect(helper.pipeline_version_uses_bowtie2_to_calculate_ercc_reads("8.1")).to be(true)
      expect(helper.pipeline_version_uses_bowtie2_to_calculate_ercc_reads("8.0")).to be(false)
    end

    it "pipeline_version_calculates_erccs_before_quality_filtering (>= 8.2)" do
      expect(helper.pipeline_version_calculates_erccs_before_quality_filtering("8.2")).to be(true)
      expect(helper.pipeline_version_calculates_erccs_before_quality_filtering("8.1")).to be(false)
    end
  end

  describe "#get_additional_outputs" do
    it "returns the additional_output list for a target" do
      status = { "gsnap_out" => { "additional_output" => ["extra.txt"] } }
      expect(helper.get_additional_outputs(status, "gsnap_out")).to eq(["extra.txt"])
    end

    it "returns an empty array when there is no additional_output" do
      status = { "gsnap_out" => { "something_else" => 1 } }
      expect(helper.get_additional_outputs(status, "gsnap_out")).to eq([])
    end

    it "returns an empty array when the target is missing" do
      expect(helper.get_additional_outputs({}, "missing")).to eq([])
    end
  end
end
