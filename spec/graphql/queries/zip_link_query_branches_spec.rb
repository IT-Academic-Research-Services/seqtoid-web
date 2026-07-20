# frozen_string_literal: true

require "rails_helper"

# Branch sweep for Queries::ZipLinkQuery#resolve_zip_link (CZID-285/307). The existing spec
# is a request spec; this drives the resolver through doubles so every arm (workflow-class
# cast, present/absent path, RecordNotFound rescue) is exercised in isolation.
#
# Branches driven (each fails if its arm is inverted/removed):
#   - workflow_class present -> becomes(class) vs nil -> unchanged.
#   - path present -> { url, error: nil } vs nil -> { url: nil, error: "Not Found" }.
#   - ActiveRecord::RecordNotFound -> { url: nil, error: "Not Found" }.
RSpec.describe Queries::ZipLinkQuery, type: :concern do
  # Host mixing in the concern. The `included do field ... end` needs a no-op `field` DSL;
  # the resolver reads context[:current_power], stubbed per-example.
  let(:host_class) do
    Class.new do
      def self.field(*_args, **_kwargs); end
      include Queries::ZipLinkQuery
      attr_accessor :context
    end
  end

  let(:host) { host_class.new }

  def wire(workflow_run)
    host.context = { current_power: double("power", workflow_runs: double("runs", find: workflow_run)) }
  end

  it "returns the url with no error when zip_link resolves a path" do
    wr = double("wr", workflow: "no-class", zip_link: "s3://bucket/out.zip")
    allow(wr).to receive(:becomes)
    wire(wr)

    expect(host.resolve_zip_link(workflow_run_id: "1")).to eq(url: "s3://bucket/out.zip", error: nil)
    # workflow with no mapped class -> becomes is NOT called (the nil/else arm).
    expect(wr).not_to have_received(:becomes)
  end

  it "casts via becomes when the workflow maps to a class" do
    cg = WorkflowRun::WORKFLOW[:consensus_genome]
    wr = double("wr", workflow: cg, zip_link: "s3://x.zip")
    allow(wr).to receive(:becomes).and_return(wr)
    wire(wr)

    host.resolve_zip_link(workflow_run_id: "1")

    expect(wr).to have_received(:becomes).with(WorkflowRun::WORKFLOW_CLASS[cg])
  end

  it "returns the 'Not Found' error when there is no zip output path" do
    wr = double("wr", workflow: "no-class", zip_link: nil)
    allow(wr).to receive(:becomes)
    wire(wr)

    expect(host.resolve_zip_link(workflow_run_id: "1")).to eq(url: nil, error: "Not Found")
  end

  it "maps a RecordNotFound (non-viewable / missing run) to the 'Not Found' error" do
    power = double("power")
    allow(power).to receive(:workflow_runs).and_return(double("runs").tap do |r|
      allow(r).to receive(:find).and_raise(ActiveRecord::RecordNotFound)
    end)
    host.context = { current_power: power }

    expect(host.resolve_zip_link(workflow_run_id: "999")).to eq(url: nil, error: "Not Found")
  end
end
