require 'rails_helper'

# Branch-coverage companion #2 for app/models/metadata_field.rb.
# metadata_field_branches_spec.rb covers the "all" and invalid-host arms of
# add_examples; this file takes the remaining arms:
#   - add_examples: the matching host-genome arm (elsif ... == 1)
#   - add_examples_helper: the "examples already present" arm of the ternary
#   - by_samples: the nil-samples guard AND the real lookup
describe MetadataField, type: :model do
  describe "#add_examples for a specific host genome" do
    let(:host_genome) { create(:host_genome, name: "BranchCoverageHost") }
    let(:field) do
      create(:metadata_field, name: "branch_examples_field", base_type: MetadataField::STRING_TYPE,
                              host_genomes: [host_genome])
    end

    it "stores the examples under the host genome id when the field applies to that host" do
      field.add_examples(["Blood"], "BranchCoverageHost")

      expect(JSON.parse(field.reload.examples)).to eq(host_genome.id.to_s => ["Blood"])
    end

    it "merges into the existing examples on a second call" do
      field.add_examples(["Blood"], "BranchCoverageHost")
      field.add_examples(["Serum", "Blood"], "BranchCoverageHost")

      stored = JSON.parse(field.reload.examples)
      expect(stored[host_genome.id.to_s]).to match_array(%w[Blood Serum])
    end

    it "keeps 'all' examples separate from host-specific examples" do
      field.add_examples(["Generic"])
      field.add_examples(["Blood"], "BranchCoverageHost")

      stored = JSON.parse(field.reload.examples)
      expect(stored["all"]).to eq(["Generic"])
      expect(stored[host_genome.id.to_s]).to eq(["Blood"])
    end

    it "raises for a host genome the field does not apply to" do
      create(:host_genome, name: "BranchUnrelatedHost")

      expect { field.add_examples(["Blood"], "BranchUnrelatedHost") }.to raise_error("Invalid host genome")
    end
  end

  describe ".by_samples" do
    it "returns an empty array when samples is nil" do
      expect(described_class.by_samples(nil)).to eq([])
    end

    it "returns the field_info for fields shared by the samples' projects and host genomes" do
      host_genome = create(:host_genome, name: "BranchBySamplesHost")
      field = create(:metadata_field, name: "branch_by_samples_field", base_type: MetadataField::STRING_TYPE,
                                      host_genomes: [host_genome])
      project = create(:project, metadata_fields: [field])
      sample = create(:sample, project: project, host_genome: host_genome)

      infos = described_class.by_samples(Sample.where(id: sample.id))

      expect(infos.pluck(:key)).to include("branch_by_samples_field")
    end

    it "excludes fields that are on the project but not on the host genome" do
      host_genome = create(:host_genome, name: "BranchBySamplesHost2")
      other_host = create(:host_genome, name: "BranchBySamplesHost3")
      field = create(:metadata_field, name: "branch_project_only_field", base_type: MetadataField::STRING_TYPE,
                                      host_genomes: [other_host])
      project = create(:project, metadata_fields: [field])
      sample = create(:sample, project: project, host_genome: host_genome)

      infos = described_class.by_samples(Sample.where(id: sample.id))

      expect(infos.pluck(:key)).not_to include("branch_project_only_field")
    end
  end
end
