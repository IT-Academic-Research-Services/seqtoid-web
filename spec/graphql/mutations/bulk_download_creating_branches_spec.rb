# frozen_string_literal: true

require "rails_helper"

# Branch sweep for the Mutations::BulkDownloadCreating concern (CZID-304/#458). The
# concern has no dedicated spec, so every conditional arm in create_bulk_download and
# the private bulk_download_domain_error? predicate is currently untaken.
#
# Branches driven here (each test fails if the arm is inverted/removed):
#   - run_ids:  workflow_run_ids_strings present (&.map + `id && id.to_i` both arms)
#               vs nil (|| workflow_run_ids fallback).
#   - workflow: input.workflow present vs nil (|| short_read_mngs default).
#   - validate rescue: domain-error RuntimeError -> GraphQL::ExecutionError;
#               non-domain RuntimeError -> re-raised untouched.
#   - workflow-type gate: short/long-read mngs -> pipeline_run_ids path;
#               else -> workflow_run_ids = active.pluck path.
#   - save guard: save false -> KICKOFF_FAILURE ExecutionError; save true -> continue.
#   - kickoff rescue: kickoff raises -> status ERROR + ExecutionError; success -> returns bd.
#   - bulk_download_domain_error?: fixed-message match (true), template match (true),
#               and no match (false).
RSpec.describe Mutations::BulkDownloadCreating, type: :concern do
  # Minimal host mixing in the concern. The concern reads `context[:current_user]`
  # and calls helper methods (validate_bulk_download_create_params,
  # get_valid_pipeline_run_ids_for_samples) that come from the included
  # BulkDownloadsHelper -- so the real module is mixed in and those are stubbed
  # per-example on the instance.
  let(:host_class) do
    Class.new do
      include Mutations::BulkDownloadCreating
      attr_accessor :context
    end
  end

  let(:current_user) { instance_double("User", id: 42) }
  let(:host) do
    h = host_class.new
    h.context = { current_user: current_user }
    h
  end

  let(:mngs) { WorkflowRun::WORKFLOW[:short_read_mngs] }
  let(:cg) { WorkflowRun::WORKFLOW[:consensus_genome] }

  # A saved-and-kicked-off BulkDownload double (happy path unless overridden).
  def bulk_download_double(save: true)
    bd = double("BulkDownload")
    allow(bd).to receive(:save).and_return(save)
    allow(bd).to receive(:kickoff)
    allow(bd).to receive(:update)
    bd
  end

  # Build a mutation input double exposing the reader methods the concern calls.
  def input_double(download_type: "reads_non_host", download_format: "fasta",
                   workflow: nil, workflow_run_ids: nil, workflow_run_ids_strings: nil)
    double(
      "input",
      download_type: download_type,
      download_format: download_format,
      workflow: workflow,
      workflow_run_ids: workflow_run_ids,
      workflow_run_ids_strings: workflow_run_ids_strings
    )
  end

  describe "#create_bulk_download run_ids + workflow defaulting" do
    it "uses workflow_run_ids_strings (mapping non-nil to_i) when present" do
      viewable = double("viewable")
      allow(host).to receive(:validate_bulk_download_create_params).and_return(viewable)
      allow(host).to receive(:get_valid_pipeline_run_ids_for_samples).and_return([7])
      captured = nil
      allow(BulkDownload).to receive(:new) do |args|
        captured = args
        bulk_download_double
      end

      host.create_bulk_download(input_double(workflow: mngs, workflow_run_ids_strings: %w[3 5]))

      # "3","5" -> 3,5 (proves &.map + id.to_i arm ran, not the || fallback).
      expect(captured[:pipeline_run_ids]).to eq([7])
      expect(host).to have_received(:get_valid_pipeline_run_ids_for_samples).with(viewable)
    end

    it "keeps nil entries as nil in the strings map (the `id && id.to_i` false arm)" do
      viewable = double("viewable")
      allow(host).to receive(:validate_bulk_download_create_params).and_return(viewable)
      allow(host).to receive(:get_valid_pipeline_run_ids_for_samples).and_return([])
      captured = nil
      allow(BulkDownload).to receive(:new) do |args|
        captured = args
        bulk_download_double
      end

      host.create_bulk_download(input_double(workflow: mngs, workflow_run_ids_strings: [nil, "9"]))

      # sample_ids in params carries run_ids: [nil, 9]. If the `id &&` guard were
      # dropped, nil.to_i would coerce to 0 instead of staying nil.
      expect(captured[:params]["sample_ids"]["value"]).to eq([nil, 9])
    end

    it "falls back to workflow_run_ids when strings are nil (the || arm)" do
      active = double("active", pluck: [11, 12])
      relation = double("viewable", active: active)
      allow(host).to receive(:validate_bulk_download_create_params).and_return(relation)
      captured = nil
      allow(BulkDownload).to receive(:new) do |args|
        captured = args
        bulk_download_double
      end

      # workflow=cg -> not mngs, so workflow_run_ids = active.pluck path.
      host.create_bulk_download(input_double(workflow: cg, workflow_run_ids: [1, 2], workflow_run_ids_strings: nil))

      expect(captured[:params]["sample_ids"]["value"]).to eq([1, 2])
      expect(captured[:workflow_run_ids]).to eq([11, 12])
    end

    it "defaults workflow to short_read_mngs when input.workflow is nil (the || default)" do
      viewable = double("viewable")
      allow(host).to receive(:validate_bulk_download_create_params).and_return(viewable)
      allow(host).to receive(:get_valid_pipeline_run_ids_for_samples).and_return([1])
      captured = nil
      allow(BulkDownload).to receive(:new) do |args|
        captured = args
        bulk_download_double
      end

      host.create_bulk_download(input_double(workflow: nil, workflow_run_ids: [1]))

      # nil workflow -> defaulted to mngs -> pipeline path taken (not workflow-run path).
      # The resolved workflow is threaded through params[:workflow][:value].
      expect(host).to have_received(:get_valid_pipeline_run_ids_for_samples)
      expect(captured[:params]["workflow"]["value"]).to eq(mngs)
    end
  end

  describe "#create_bulk_download workflow-type gate" do
    it "takes the workflow_run path (active.pluck) for a non-mngs workflow" do
      active = double("active", pluck: [99])
      relation = double("viewable", active: active)
      allow(host).to receive(:validate_bulk_download_create_params).and_return(relation)
      allow(host).to receive(:get_valid_pipeline_run_ids_for_samples)
      captured = nil
      allow(BulkDownload).to receive(:new) do |args|
        captured = args
        bulk_download_double
      end

      host.create_bulk_download(input_double(workflow: cg))

      expect(host).not_to have_received(:get_valid_pipeline_run_ids_for_samples)
      expect(captured[:workflow_run_ids]).to eq([99])
      expect(captured[:pipeline_run_ids]).to eq([])
    end
  end

  describe "#create_bulk_download validate rescue" do
    it "converts a known domain-error RuntimeError into a GraphQL::ExecutionError" do
      allow(host).to receive(:validate_bulk_download_create_params)
        .and_raise(RuntimeError.new(BulkDownloadsHelper::SAMPLE_NO_PERMISSION_ERROR))

      expect { host.create_bulk_download(input_double(workflow: mngs)) }
        .to raise_error(GraphQL::ExecutionError, BulkDownloadsHelper::SAMPLE_NO_PERMISSION_ERROR)
    end

    it "re-raises a non-domain RuntimeError untouched (the `raise` else arm)" do
      allow(host).to receive(:validate_bulk_download_create_params)
        .and_raise(RuntimeError.new("some unrelated boom"))

      expect { host.create_bulk_download(input_double(workflow: mngs)) }
        .to raise_error(RuntimeError, "some unrelated boom")
    end
  end

  describe "#create_bulk_download save + kickoff guards" do
    before do
      viewable = double("viewable")
      allow(host).to receive(:validate_bulk_download_create_params).and_return(viewable)
      allow(host).to receive(:get_valid_pipeline_run_ids_for_samples).and_return([1])
    end

    it "raises KICKOFF_FAILURE when save returns false" do
      allow(BulkDownload).to receive(:new).and_return(bulk_download_double(save: false))

      expect { host.create_bulk_download(input_double(workflow: mngs)) }
        .to raise_error(GraphQL::ExecutionError, BulkDownloadsHelper::KICKOFF_FAILURE_HUMAN_READABLE)
    end

    it "marks the download errored and raises when kickoff raises" do
      bd = bulk_download_double(save: true)
      allow(bd).to receive(:kickoff).and_raise(StandardError.new("sfn down"))
      allow(BulkDownload).to receive(:new).and_return(bd)

      expect { host.create_bulk_download(input_double(workflow: mngs)) }
        .to raise_error(GraphQL::ExecutionError, BulkDownloadsHelper::KICKOFF_FAILURE_HUMAN_READABLE)
      expect(bd).to have_received(:update).with(status: BulkDownload::STATUS_ERROR)
    end

    it "returns the saved bulk_download on the full happy path" do
      bd = bulk_download_double(save: true)
      allow(BulkDownload).to receive(:new).and_return(bd)

      result = host.create_bulk_download(input_double(workflow: mngs))

      expect(result).to be(bd)
      expect(bd).to have_received(:kickoff)
      expect(bd).not_to have_received(:update)
    end
  end

  describe "#bulk_download_domain_error?" do
    it "is true for a fixed known domain message (include? arm)" do
      expect(host.send(:bulk_download_domain_error?, BulkDownloadsHelper::UNKNOWN_DOWNLOAD_TYPE)).to be(true)
    end

    it "is true for a filled-in MAX_OBJECTS template (the template-match arm)" do
      msg = format(BulkDownloadsHelper::MAX_OBJECTS_EXCEEDED_ERROR_TEMPLATE, 25)
      expect(host.send(:bulk_download_domain_error?, msg)).to be(true)
    end

    it "is false for an unrelated message (neither arm matches)" do
      expect(host.send(:bulk_download_domain_error?, "totally different error")).to be(false)
    end
  end
end
