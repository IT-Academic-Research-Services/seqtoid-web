# frozen_string_literal: true

require "rails_helper"

# Branch sweep for Queries::SampleForReportQuery#stringify_report_ids (CZID-310). The
# existing spec is a request spec; this drives the id-stringification helper directly on a
# plain hash so every present/nil arm is exercised in isolation.
#
# Branches driven (each fails if its arm is inverted/removed):
#   - pipeline_runs / workflow_runs: id present -> to_s vs nil -> left untouched.
#   - default_pipeline_run_id: present -> to_s vs nil -> skipped.
#   - project: present-with-id -> to_s vs project nil / id nil -> skipped.
RSpec.describe Queries::SampleForReportQuery, type: :concern do
  # Host mixing in the concern. The `included do field ... end` needs a no-op `field` DSL.
  let(:host_class) do
    Class.new do
      def self.field(*_args, **_kwargs); end
      include Queries::SampleForReportQuery
    end
  end

  let(:host) { host_class.new }

  it "stringifies present pipeline_run / workflow_run ids and leaves nil ids untouched" do
    info = {
      "pipeline_runs" => [{ "id" => 1 }, { "id" => nil }],
      "workflow_runs" => [{ "id" => 2 }, { "id" => nil }],
    }

    host.send(:stringify_report_ids, info)

    expect(info["pipeline_runs"].map { |r| r["id"] }).to eq(["1", nil])
    expect(info["workflow_runs"].map { |r| r["id"] }).to eq(["2", nil])
  end

  it "treats missing run lists as empty via Array() (no error)" do
    info = {}
    expect { host.send(:stringify_report_ids, info) }.not_to raise_error
  end

  it "stringifies default_pipeline_run_id when present" do
    info = { "default_pipeline_run_id" => 55 }
    host.send(:stringify_report_ids, info)
    expect(info["default_pipeline_run_id"]).to eq("55")
  end

  it "leaves default_pipeline_run_id alone when nil (guard false arm)" do
    info = { "default_pipeline_run_id" => nil }
    host.send(:stringify_report_ids, info)
    expect(info["default_pipeline_run_id"]).to be_nil
  end

  it "stringifies the project id when the project and its id are present" do
    info = { "project" => { "id" => 9, "name" => "P" } }
    host.send(:stringify_report_ids, info)
    expect(info["project"]["id"]).to eq("9")
  end

  it "does nothing when the project id is nil (the && short-circuit false arm)" do
    info = { "project" => { "id" => nil } }
    host.send(:stringify_report_ids, info)
    expect(info["project"]["id"]).to be_nil
  end

  it "does nothing when there is no project (the first && operand false arm)" do
    info = { "project" => nil }
    expect { host.send(:stringify_report_ids, info) }.not_to raise_error
    expect(info["project"]).to be_nil
  end
end
