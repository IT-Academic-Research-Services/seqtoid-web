# frozen_string_literal: true

require "rails_helper"

# Security spec for the public snapshot-share authorization used by the SampleView report resolvers
# (SMP-1457). The report page runs UNAUTHENTICATED for a shared "/pub/:share_id" link, so these
# helpers must authorize via the SnapshotLink -- never current_power -- and fail closed on every
# unshared / disabled / unknown / malformed path.
RSpec.describe Queries::Concerns::SnapshotSampleAuthorization, type: :concern do
  let(:host_class) { Class.new { include Queries::Concerns::SnapshotSampleAuthorization } }
  let(:host) { host_class.new }

  let(:project) { create(:project) }
  let(:shared_sample) { create(:sample, project: project) }
  let(:other_sample) { create(:sample, project: project) }
  let(:share_id) { "shareabc123" }
  let(:snapshot) do
    create(:snapshot_link,
           project: project,
           share_id: share_id,
           content: { samples: [{ shared_sample.id.to_s => { pipeline_run_id: 1 } }] }.to_json)
  end

  before do
    snapshot
    allow(host).to receive(:get_app_config).with(AppConfig::ENABLE_SNAPSHOT_SHARING).and_return("1")
  end

  describe "#snapshot_authorized_sample" do
    it "returns a sample that IS pinned in the snapshot" do
      expect(host.snapshot_authorized_sample(shared_sample.id, share_id)).to eq(shared_sample)
    end

    it "fails closed for a sample NOT in the snapshot (cannot read beyond the share)" do
      expect { host.snapshot_authorized_sample(other_sample.id, share_id) }
        .to raise_error(GraphQL::ExecutionError, /not part of this snapshot share/)
    end

    it "fails closed when snapshot sharing is disabled" do
      allow(host).to receive(:get_app_config).with(AppConfig::ENABLE_SNAPSHOT_SHARING).and_return(nil)
      expect { host.snapshot_authorized_sample(shared_sample.id, share_id) }
        .to raise_error(GraphQL::ExecutionError, /not enabled/)
    end

    it "fails closed for an unknown share id" do
      expect { host.snapshot_authorized_sample(shared_sample.id, "does-not-exist") }
        .to raise_error(GraphQL::ExecutionError, /not found/)
    end

    it "fails closed on malformed snapshot content" do
      create(:snapshot_link, project: project, share_id: "malformed01", content: "{not valid json")
      expect { host.snapshot_authorized_sample(shared_sample.id, "malformed01") }
        .to raise_error(GraphQL::ExecutionError, /malformed/)
    end
  end

  describe "#snapshot_authorized_sample_ids" do
    it "returns only the requested ids that are pinned in the snapshot" do
      expect(host.snapshot_authorized_sample_ids([shared_sample.id, other_sample.id], share_id))
        .to eq([shared_sample.id])
    end

    it "fails closed when NONE of the requested ids are shared" do
      expect { host.snapshot_authorized_sample_ids([other_sample.id], share_id) }
        .to raise_error(GraphQL::ExecutionError, /not part of this snapshot share/)
    end
  end
end
