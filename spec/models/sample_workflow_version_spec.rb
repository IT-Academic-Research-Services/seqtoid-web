require "rails_helper"

# CZID-976 -- the user's version selection is validated at the UPLOAD boundary, so a malformed value
# is a 4xx on the request rather than a 500 later at dispatch (dispatch resolves the version well
# after the upload response has returned).
RSpec.describe Sample, type: :model do
  let(:project) { create(:project) }

  def sample_with_version(version)
    build(:sample, project: project, workflow_version: version)
  end

  it "accepts no selection at all -- the overwhelmingly common case" do
    expect(sample_with_version(nil)).to be_valid
    expect(sample_with_version("")).to be_valid
  end

  ["8", "8.1", "8.1.2", "0.7.12"].each do |good|
    it "accepts #{good.inspect}" do
      expect(sample_with_version(good)).to be_valid
    end
  end

  ["8.1.2.3", "v8.1.2", "eight", "8%", "%", "8; DROP TABLE samples", "8.1.2-rc1"].each do |bad|
    it "rejects #{bad.inspect} with a usable message" do
      sample = sample_with_version(bad)

      expect(sample).not_to be_valid
      expect(sample.errors[:workflow_version].join).to match(/major.*minor.*full version/)
    end
  end

  it "persists a valid selection so dispatch can read it back" do
    sample = create(:sample, project: project, workflow_version: "8.1.2")

    expect(sample.reload.workflow_version).to eq("8.1.2")
  end
end
