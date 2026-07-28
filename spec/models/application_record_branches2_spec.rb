# frozen_string_literal: true

require "rails_helper"

# Branch sweep #2 for ApplicationRecord#log_analytics. The existing branches spec
# drives the ENABLE_MODEL_AUTO_ANALYTICS short-circuit, the id ternary's truthy
# arm and the User PII arm of the name ternary. What is left untaken are the arms
# only reachable with a record that (a) does NOT respond to :id and (b) DOES
# respond to :name / :user_id / :project_id while not being a User:
#
#   line 81  `record.respond_to?(:id) ? record.id : nil`          -> the nil arm
#   line 84  `... && record.class.name != User.name ? record.name` -> the record.name arm
#   line 86  `record.respond_to?(:user_id) ? record.user_id : nil` -> the user_id arm
#   line 87  `record.respond_to?(:project_id) ? ...`               -> the project_id arm
#   line 88  `record.respond_to?(:sample_id) ? ...`                -> the sample_id arm
#
# No real AR model has that shape (they all respond to :id), so we hand
# log_analytics a purpose-built opt-in record and assert on the properties hash
# that reaches MetricUtil.
RSpec.describe ApplicationRecord, type: :model do
  # A stand-in "flagged" record: opts into auto-analytics, exposes name/user_id/
  # project_id/sample_id, and deliberately has NO #id.
  let(:probe_class) do
    klass = Class.new do
      def name = "probe-name"
      def user_id = 11
      def project_id = 22
      def sample_id = 33
      def attributes = { "job_status" => "RUNNING", "unrelated" => "x" }
    end
    klass.const_set(:ENABLE_MODEL_AUTO_ANALYTICS, true)
    klass
  end

  let(:carrier) { create(:metadata_field) }

  before { stub_const("AutoAnalyticsProbe", probe_class) }

  def capture_properties(record)
    captured = nil
    allow(MetricUtil).to receive(:log_analytics_event) do |event, _user, properties, _request|
      captured = [event, properties]
    end
    carrier.send(:log_analytics, record, "updated")
    captured
  end

  it "resolves name/user_id/project_id/sample_id and omits id for a record with no #id" do
    event, properties = capture_properties(AutoAnalyticsProbe.new)

    expect(event).to eq("auto_analytics_probe_updated")
    # id ternary took the nil arm -> delete_if strips the key entirely.
    expect(properties).not_to have_key(:id)
    # name ternary took the record.name arm (not a User, responds to :name).
    expect(properties[:name]).to eq("probe-name")
    expect(properties[:user_id]).to eq(11)
    expect(properties[:project_id]).to eq(22)
    expect(properties[:sample_id]).to eq(33)
    # pipeline_run_id is not implemented -> nil arm -> stripped.
    expect(properties).not_to have_key(:pipeline_run_id)
  end

  it "merges attribute keys containing 'status' and drops the rest" do
    _event, properties = capture_properties(AutoAnalyticsProbe.new)

    expect(properties["job_status"]).to eq("RUNNING")
    expect(properties).not_to have_key("unrelated")
  end

  it "still fires when every optional accessor is missing (all nil arms stripped)" do
    bare = Class.new do
      def attributes = {}
    end
    bare.const_set(:ENABLE_MODEL_AUTO_ANALYTICS, true)
    stub_const("BareAutoAnalyticsProbe", bare)

    event, properties = capture_properties(BareAutoAnalyticsProbe.new)

    expect(event).to eq("bare_auto_analytics_probe_updated")
    expect(properties).to eq({})
  end
end
