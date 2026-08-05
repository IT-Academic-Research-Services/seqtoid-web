require "rails_helper"

# CZID-972 -- version ordering must be numeric-segment aware, not lexical.
#
# The bug is not hypothetical: on dev, `ORDER BY version DESC` already resolved short-read-mngs to
# 8.3.3 (over 8.3.15) and long-read-mngs to 0.7.8 (over 0.7.12), with only two or three versions
# present. The upstream backfill (CZID-974) brings 108 short-read-mngs versions.
RSpec.describe WorkflowVersion, type: :model do
  let(:workflow) { WorkflowRun::WORKFLOW[:short_read_mngs] }

  describe ".version_sort_key" do
    # Asserts through max_by, which is how the production code consumes the key. (Array defines
    # <=> but not >, so the keys cannot be compared with a bare `be >` matcher.)
    def highest(*versions)
      versions.max_by { |v| described_class.version_sort_key(v) }
    end

    it "orders by numeric segment, not by string" do
      expect(highest("8.3.9", "8.3.15")).to eq("8.3.15")
      expect(highest("0.7.8", "0.7.12")).to eq("0.7.12")
      expect(highest("8.9.99", "8.10.0")).to eq("8.10.0")
    end

    it "orders ISO dates correctly (ncbi_index_date)" do
      expect(highest("2024-02-06", "2026-07-09")).to eq("2026-07-09")
      expect(highest("2021-01-22", "2024-02-06")).to eq("2024-02-06")
    end

    it "orders bare integers numerically (human_host_genome), including past a single digit" do
      expect(highest("1", "2")).to eq("2")
      # The case a string sort gets wrong once the counter rolls over.
      expect(highest("9", "10")).to eq("10")
    end

    it "sorts a commit-tagged build below the clean release of the same number" do
      # scripts/release.sh appends the commit when tagging off main; that is a pre-release.
      expect(highest("8.2.3-b9b4ab1", "8.2.3")).to eq("8.2.3")
    end

    it "treats a shorter version as lower than a longer one sharing its prefix" do
      expect(highest("8.3", "8.3.1")).to eq("8.3.1")
    end

    it "produces keys whose elements are type-consistent, so any pair is comparable" do
      keys = ["8.3.15", "2024-02-06", "2", "8.2.3-b9b4ab1", "8.3"].map { |v| described_class.version_sort_key(v) }
      keys.combination(2) { |a, b| expect(a <=> b).to be_a(Integer) }
    end
  end

  describe ".version_matches_prefix?" do
    it "matches within the same line" do
      expect(described_class.version_matches_prefix?("8.1.2", "8.1")).to be true
      expect(described_class.version_matches_prefix?("8.1.2", "8")).to be true
      expect(described_class.version_matches_prefix?("8.1.2", "8.1.2")).to be true
    end

    it "does NOT match a different minor line that shares a string prefix" do
      # The `LIKE '8.1%'` trap: 8.10.5 is not in the 8.1 line.
      expect(described_class.version_matches_prefix?("8.10.5", "8.1")).to be false
    end

    it "does not match a different major line" do
      expect(described_class.version_matches_prefix?("9.1.2", "8")).to be false
    end

    it "handles date and integer versions" do
      expect(described_class.version_matches_prefix?("2024-02-06", "2024")).to be true
      expect(described_class.version_matches_prefix?("2024-02-06", "2021")).to be false
      expect(described_class.version_matches_prefix?("2", "2")).to be true
      expect(described_class.version_matches_prefix?("20", "2")).to be false
    end

    # An AlignmentConfig may be named anything, and a project pins ncbi_index_date to that NAME.
    # Those have no segment structure, so they must keep the plain string-prefix behaviour --
    # segment-matching them would silently unpin every project with a named alignment config.
    it "falls back to string-prefix matching for non-numeric identifiers" do
      expect(described_class.version_matches_prefix?("fake_alignment_config_name", "fake_alignment_config_name")).to be true
      expect(described_class.version_matches_prefix?("2024-02-06-patched", "2024-02-06")).to be true
      expect(described_class.version_matches_prefix?("some_other_config", "fake_alignment_config_name")).to be false
    end
  end

  describe ".latest_version_of" do
    it "returns the highest version numerically, not lexically" do
      create(:workflow_version, workflow: workflow, version: "8.3.3")
      create(:workflow_version, workflow: workflow, version: "8.3.9")
      create(:workflow_version, workflow: workflow, version: "8.3.15")

      expect(described_class.latest_version_of(workflow)).to eq("8.3.15")
    end

    it "reproduces the exact dev case that was resolving wrong" do
      create(:workflow_version, workflow: "long-read-mngs", version: "0.7.3")
      create(:workflow_version, workflow: "long-read-mngs", version: "0.7.8")
      create(:workflow_version, workflow: "long-read-mngs", version: "0.7.12")

      expect(described_class.latest_version_of("long-read-mngs")).to eq("0.7.12")
    end

    it "still returns the latest human host genome version" do
      create(:workflow_version, workflow: HostGenome::HUMAN_HOST, version: "1")
      create(:workflow_version, workflow: HostGenome::HUMAN_HOST, version: "2")

      expect(described_class.latest_version_of(HostGenome::HUMAN_HOST)).to eq("2")
    end

    it "still returns the latest NCBI index date" do
      create(:workflow_version, workflow: AlignmentConfig::NCBI_INDEX, version: "2021-01-22")
      create(:workflow_version, workflow: AlignmentConfig::NCBI_INDEX, version: "2024-02-06")
      create(:workflow_version, workflow: AlignmentConfig::NCBI_INDEX, version: "2026-07-09")

      expect(described_class.latest_version_of(AlignmentConfig::NCBI_INDEX)).to eq("2026-07-09")
    end

    it "raises when the workflow has no versions at all" do
      expect { described_class.latest_version_of("no-such-workflow") }.to raise_error(/No WorkflowVersions/)
    end
  end
end
