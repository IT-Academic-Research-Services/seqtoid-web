require 'rails_helper'

# Coverage Wave (branch): host_genome_spec.rb was thin. This drives the pure,
# in-memory predicate/serializer branches (no DB writes required):
#   - ercc_only?: both-ercc true, and each && operand false
#   - show_as_option?: user.nil? && deprecation_status.nil? (both operands, both sides)
#   - as_json: the `unless options[:public]` ercc_only branch (present vs omitted)
RSpec.describe HostGenome, type: :model do
  def ercc_path(kind)
    "s3://database-bucket/host_filter/ercc/2017-09-01/#{kind}"
  end

  def non_ercc_path(kind)
    "s3://database-bucket/human/2020-01-01/#{kind}"
  end

  describe "#ercc_only?" do
    it "is true when both index paths point at the ercc directory" do
      hg = HostGenome.new(
        s3_star_index_path: ercc_path("STAR_genome.tar"),
        s3_bowtie2_index_path: ercc_path("bowtie2_genome.tar")
      )
      expect(hg.ercc_only?).to eq(true)
    end

    it "is false when only the star index is ercc (second operand false)" do
      hg = HostGenome.new(
        s3_star_index_path: ercc_path("STAR_genome.tar"),
        s3_bowtie2_index_path: non_ercc_path("bowtie2_genome.tar")
      )
      expect(hg.ercc_only?).to eq(false)
    end

    it "is false when the star index is not ercc (first operand false)" do
      hg = HostGenome.new(
        s3_star_index_path: non_ercc_path("STAR_genome.tar"),
        s3_bowtie2_index_path: ercc_path("bowtie2_genome.tar")
      )
      expect(hg.ercc_only?).to eq(false)
    end
  end

  describe "#show_as_option?" do
    it "is true for a null-user, non-deprecated host genome" do
      hg = HostGenome.new(deprecation_status: nil)
      allow(hg).to receive(:user).and_return(nil)
      expect(hg.show_as_option?).to eq(true)
    end

    it "is false when the host genome is deprecated (second operand false)" do
      hg = HostGenome.new(deprecation_status: "deprecated 2024")
      allow(hg).to receive(:user).and_return(nil)
      expect(hg.show_as_option?).to eq(false)
    end

    it "is false when the host genome has an owning user (first operand false)" do
      hg = HostGenome.new(deprecation_status: nil)
      allow(hg).to receive(:user).and_return(double("user"))
      expect(hg.show_as_option?).to eq(false)
    end
  end

  describe "#as_json" do
    let(:host_genome) do
      HostGenome.new(
        name: "TestHost",
        s3_star_index_path: ercc_path("STAR_genome.tar"),
        s3_bowtie2_index_path: ercc_path("bowtie2_genome.tar")
      )
    end

    it "includes ercc_only and showAsOption by default" do
      json = host_genome.as_json
      expect(json[:showAsOption]).to eq(true)
      expect(json).to have_key(:ercc_only)
      expect(json[:ercc_only]).to eq(true)
    end

    it "omits ercc_only when serialized for the public option" do
      json = host_genome.as_json(public: true)
      expect(json[:showAsOption]).to eq(true)
      expect(json).not_to have_key(:ercc_only)
    end
  end
end
