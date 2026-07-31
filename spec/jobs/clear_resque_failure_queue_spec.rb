require "rails_helper"

RSpec.describe ClearResqueFailureQueue, type: :job do
  # Build a Resque::Failure-style record hash.
  def failure(klass:, failed_at:)
    {
      "failed_at" => failed_at.utc.iso8601,
      "payload" => { "class" => klass },
    }
  end

  # Stub Resque::Failure.each to yield [id, job] pairs like the real backend.
  def stub_failures(failures)
    allow(Resque::Failure).to receive(:count).and_return(failures.length)
    allow(Resque::Failure).to receive(:each) do |&block|
      failures.each_with_index { |job, idx| block.call(idx, job) }
    end
    allow(Resque::Failure).to receive(:remove)
  end

  describe "#perform" do
    context "when failures are a mix of old and recent" do
      let(:old_job) { failure(klass: "SomeJob", failed_at: 10.days.ago) }
      let(:old_job2) { failure(klass: "SomeJob", failed_at: 8.days.ago) }
      let(:recent_job) { failure(klass: "OtherJob", failed_at: 1.day.ago) }

      before { stub_failures([old_job, old_job2, recent_job]) }

      it "removes only failures older than 7 days" do
        # ids 0 and 1 are the old jobs; id 2 (recent) must be kept.
        expect(Resque::Failure).to receive(:remove).with(0)
        expect(Resque::Failure).to receive(:remove).with(1)
        expect(Resque::Failure).not_to receive(:remove).with(2)
        ClearResqueFailureQueue.perform
      end

      it "logs the per-class counts and the total cleared" do
        expect(LogUtil).to receive(:log_message).with('Resque failures by job class: {"SomeJob":2}', to_sentry: false)
        expect(LogUtil).to receive(:log_message).with("Cleared 2 failures", to_sentry: false)
        ClearResqueFailureQueue.perform
      end
    end

    context "when there are no old failures" do
      before { stub_failures([failure(klass: "SomeJob", failed_at: 1.day.ago)]) }

      it "removes nothing and reports zero cleared" do
        expect(Resque::Failure).not_to receive(:remove)
        expect(LogUtil).to receive(:log_message).with("Resque failures by job class: {}", to_sentry: false)
        expect(LogUtil).to receive(:log_message).with("Cleared 0 failures", to_sentry: false)
        ClearResqueFailureQueue.perform
      end
    end

    context "when the failure count exceeds MAX_JOB_LIMIT" do
      before do
        stub_failures([])
        allow(Resque::Failure).to receive(:count).and_return(ClearResqueFailureQueue::MAX_JOB_LIMIT + 1)
        allow(LogUtil).to receive(:log_message)
      end

      it "logs an error about the excessive failure count" do
        expect(LogUtil).to receive(:log_error).with(
          a_string_matching(/#{Regexp.escape(ClearResqueFailureQueue::TOO_MANY_FAILED_JOBS_MESSAGE)}/),
          exception: an_instance_of(StandardError)
        )
        ClearResqueFailureQueue.perform
      end
    end

    context "when removing an individual job raises" do
      let(:old_job) { failure(klass: "SomeJob", failed_at: 10.days.ago) }

      before do
        stub_failures([old_job])
        allow(Resque::Failure).to receive(:remove).and_raise(StandardError.new("redis error"))
        allow(LogUtil).to receive(:log_message)
      end

      it "logs the per-job error and the batch failure summary without raising" do
        expect(LogUtil).to receive(:log_error).with(
          "Failed to clear Resque job with id 0",
          exception: an_instance_of(StandardError)
        )
        expect(LogUtil).to receive(:log_error).with(
          ClearResqueFailureQueue::FAILED_TO_REMOVE_JOB_MESSAGE,
          exception: an_instance_of(StandardError),
          jobs_errored_during_clear: an_instance_of(Hash)
        )
        expect { ClearResqueFailureQueue.perform }.not_to raise_error
      end
    end
  end
end
