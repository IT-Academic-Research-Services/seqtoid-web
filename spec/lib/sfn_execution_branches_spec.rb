# frozen_string_literal: true

require "rails_helper"

# Branch sweep for SfnExecution. The existing spec exercises #description,
# #history, #error, #output_path, #format_json and #sfn_archive_from_s3, but two
# whole branchy methods are never entered:
#   * #pipeline_error -- the FAILED-vs-not guard AND both cause-parse rescue arms
#     (JSON::ParserError, TypeError) plus the successful parse.
#   * #stop_execution -- the blank-arn early return, the happy path, the wait
#     branch (wait_until_finalized), and the ExecutionDoesNotExist rescue.
# Both methods are driven with plain stubs (no real AWS / S3 round trips).
RSpec.describe SfnExecution do
  let(:arn) { "fake:sfn:execution:arn:name" }
  let(:s3_path) { "s3://fake_bucket/fake/path" }

  subject(:sfn_execution) { described_class.new(execution_arn: arn, s3_path: s3_path) }

  describe "#pipeline_error" do
    it "returns nil when the execution did not fail (guard false)" do
      allow(sfn_execution).to receive(:description).and_return(status: "SUCCEEDED")
      # history must not even be consulted on the non-failed arm.
      expect(sfn_execution).not_to receive(:history)
      expect(sfn_execution.pipeline_error).to be_nil
    end

    it "returns [error, parsed cause] when the cause JSON parses" do
      allow(sfn_execution).to receive(:description).and_return(status: "FAILED")
      allow(sfn_execution).to receive(:history).and_return(
        events: [
          { execution_failed_event_details: {
            error: "States.TaskFailed",
            cause: JSON.dump(errorMessage: "the pod OOMed"),
          } },
        ]
      )

      error, cause = sfn_execution.pipeline_error
      expect(error).to eq("States.TaskFailed")
      expect(cause).to eq("the pod OOMed")
    end

    it "returns a nil cause when the cause is not valid JSON (JSON::ParserError arm)" do
      allow(sfn_execution).to receive(:description).and_return(status: "FAILED")
      allow(sfn_execution).to receive(:history).and_return(
        events: [
          { execution_failed_event_details: { error: "States.Runtime", cause: "not-json-at-all" } },
        ]
      )

      error, cause = sfn_execution.pipeline_error
      expect(error).to eq("States.Runtime")
      expect(cause).to be_nil
    end

    it "returns a nil cause when the cause is missing (TypeError arm)" do
      allow(sfn_execution).to receive(:description).and_return(status: "FAILED")
      allow(sfn_execution).to receive(:history).and_return(
        events: [
          # No :cause key -> JSON.parse(nil) raises TypeError.
          { execution_failed_event_details: { error: "States.Timeout" } },
        ]
      )

      error, cause = sfn_execution.pipeline_error
      expect(error).to eq("States.Timeout")
      expect(cause).to be_nil
    end
  end

  describe "#stop_execution" do
    # A plain double, NOT an Aws::States::Client(stub_responses: true): the real
    # SDK client still runs client-side request-parameter validation, which threw
    # ArgumentError before the response stub was ever consulted. A plain double
    # intercepts stop_execution outright, so only our branch logic is exercised.
    let(:states) { double("Aws::States::Client") }

    before do
      allow(AwsClient).to receive(:[]).with(:states).and_return(states)
    end

    it "returns nil without calling AWS when the arn is blank" do
      blank = described_class.new(execution_arn: "", s3_path: s3_path)
      expect(states).not_to receive(:stop_execution)
      expect(blank.stop_execution).to be_nil
    end

    it "stops the execution and returns true on the happy path (no wait)" do
      allow(states).to receive(:stop_execution)
      expect(sfn_execution.stop_execution).to be(true)
      expect(states).to have_received(:stop_execution).with(execution_arn: arn)
    end

    it "waits for finalization when wait is true, then returns true" do
      allow(states).to receive(:stop_execution)
      # Drive wait_until_finalized to exit on its first check (no sleep): return an
      # ABORTED description and an ExecutionAborted history for the two subpaths.
      allow(sfn_execution).to receive(:sfn_archive_from_s3) do |subpath|
        if subpath == "sfn-desc"
          { status: "ABORTED" }
        else
          { events: [{ type: "ExecutionAborted" }] }
        end
      end

      expect(sfn_execution.stop_execution(true)).to be(true)
      expect(sfn_execution.instance_variable_get(:@finalized)).to be(true)
    end

    it "returns false when the execution no longer exists (rescue arm)" do
      allow(states).to receive(:stop_execution)
        .and_raise(Aws::States::Errors::ExecutionDoesNotExist.new(nil, "gone"))
      expect(sfn_execution.stop_execution).to be(false)
    end
  end
end
