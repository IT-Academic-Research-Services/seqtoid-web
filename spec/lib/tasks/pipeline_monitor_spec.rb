require "rails_helper"

# CheckPipelineRuns is defined in lib/tasks/pipeline_monitor.rake, which is loaded
# via Rails.application.load_tasks in rails_helper. These specs cover the defensive
# guards added for Forgejo #388 (the empty/blank JSON body was 532 Sentry events).
RSpec.describe CheckPipelineRuns do
  describe ".parse_json_or_nil" do
    it "returns nil for a blank body without raising" do
      expect(LogUtil).not_to receive(:log_error)
      expect(described_class.parse_json_or_nil("", "test")).to be_nil
      expect(described_class.parse_json_or_nil(nil, "test")).to be_nil
      expect(described_class.parse_json_or_nil("   ", "test")).to be_nil
    end

    it "returns nil and logs for an unparseable body instead of raising" do
      expect(LogUtil).to receive(:log_error).with(/Failed to parse JSON/, hash_including(:exception))
      expect(described_class.parse_json_or_nil("{not json", "test")).to be_nil
    end

    it "parses valid JSON" do
      expect(described_class.parse_json_or_nil('{"a":1}', "test")).to eq("a" => 1)
    end
  end

  describe ".benchmark_update" do
    it "no-ops on an empty benchmark config body instead of raising JSON::ParserError" do
      # Simulate `aws s3 cp ... -` returning an empty body (missing object / creds hiccup).
      allow(described_class).to receive(:`).and_return("")
      expect { described_class.benchmark_update(Time.now.to_f) }.not_to raise_error
    end

    it "no-ops when the config is present but has no active_benchmarks" do
      allow(described_class).to receive(:`).and_return('{"defaults":{}}')
      expect { described_class.benchmark_update(Time.now.to_f) }.not_to raise_error
    end
  end

  # update_jobs is the poller. Every branch below was previously unexercised, and the
  # ENABLE_SFN_NOTIFICATIONS conditional is the one that cost a real sample: a preview
  # sandbox runs with the flag OFF (it cannot have a shoryuken -- that would make it a
  # competing consumer on dev's shared SQS queue), so polling is the ONLY thing that
  # advances its runs. Dev/staging/prod run the flag ON, so the polling side is dead code
  # there and nobody noticed it had switched itself off. A sample reached SUCCEEDED while
  # its card read HOST FILTERING forever, and nothing raised.
  describe ".update_jobs" do
    # Record ids rather than setting a message expectation on a specific object: update_jobs
    # does its own find_by, so the PipelineRun it polls is never one the spec holds a
    # reference to. The list is also what makes "exactly once, across all shards" assertable.
    let(:polled) { [] }

    before do
      allow_any_instance_of(PipelineRun).to receive(:update_job_status) do |pipeline_run|
        polled << pipeline_run.id
      end
    end

    # shutdown_requested is class-level state on a long-lived daemon object. Leaving it set
    # would silently empty `polled` in every later spec in this file.
    after { described_class.shutdown_requested = false }

    around do |example|
      previous = AppConfigHelper.get_app_config(AppConfig::ENABLE_SFN_NOTIFICATIONS)
      example.run
      AppConfigHelper.set_app_config(AppConfig::ENABLE_SFN_NOTIFICATIONS, previous.to_s)
    end

    def in_progress_run
      create(:pipeline_run, sample: create(:sample), job_status: PipelineRun::STATUS_READY, finalized: 0)
    end

    context "when SFN notifications are OFF (a preview sandbox: no shoryuken, so it must poll)" do
      before { AppConfigHelper.set_app_config(AppConfig::ENABLE_SFN_NOTIFICATIONS, "0") }

      it "polls the run's status" do
        pipeline_run = in_progress_run

        described_class.update_jobs(1, 0, [pipeline_run.id])

        expect(polled).to eq([pipeline_run.id])
      end
    end

    context "when the flag has never been set" do
      before { AppConfigHelper.remove_app_config(AppConfig::ENABLE_SFN_NOTIFICATIONS) }

      it "polls, because absent is not \"1\"" do
        pipeline_run = in_progress_run

        described_class.update_jobs(1, 0, [pipeline_run.id])

        expect(polled).to eq([pipeline_run.id])
      end
    end

    context "when SFN notifications are ON (dev/staging/prod: shoryuken delivers status)" do
      before { AppConfigHelper.set_app_config(AppConfig::ENABLE_SFN_NOTIFICATIONS, "1") }

      it "does not poll, leaving status to the notification path" do
        pipeline_run = in_progress_run

        described_class.update_jobs(1, 0, [pipeline_run.id])

        expect(polled).to be_empty

        # Carry the control inside the example. "Nothing was polled" is also exactly what a spec
        # whose stub had quietly stopped intercepting would report, so prove the poller was live
        # and willing by flipping the single thing under test: with the flag off, this very same
        # call polls. Without this, the spec would still pass against a poller that never worked.
        AppConfigHelper.set_app_config(AppConfig::ENABLE_SFN_NOTIFICATIONS, "0")
        described_class.update_jobs(1, 0, [pipeline_run.id])
        expect(polled).to eq([pipeline_run.id])
      end
    end

    context "sharding" do
      before { AppConfigHelper.set_app_config(AppConfig::ENABLE_SFN_NOTIFICATIONS, "0") }

      it "polls each run exactly once across the full set of shards" do
        ids = Array.new(4) { in_progress_run.id }
        # Shards above 0 reconnect, which in a transactional spec would drop the connection
        # holding the fixtures. The partition maths is what is under test here.
        allow(ActiveRecord::Base.connection).to receive(:reconnect!)

        described_class.update_jobs(2, 0, ids)
        described_class.update_jobs(2, 1, ids)

        # match_array is multiset equality: a run polled twice by overlapping shards fails.
        expect(polled).to match_array(ids)
      end

      it "leaves ids belonging to another shard alone" do
        ids = Array.new(4) { in_progress_run.id }

        described_class.update_jobs(2, 0, ids)

        expect(polled).to all(satisfy { |id| id.even? })
        expect(polled).not_to be_empty
      end
    end

    context "when a run cannot be polled" do
      before { AppConfigHelper.set_app_config(AppConfig::ENABLE_SFN_NOTIFICATIONS, "0") }

      it "skips an id whose run no longer exists rather than raising" do
        pipeline_run = in_progress_run
        deleted_id = pipeline_run.id + 10_000

        expect { described_class.update_jobs(1, 0, [deleted_id, pipeline_run.id]) }.not_to raise_error
        expect(polled).to eq([pipeline_run.id])
      end

      it "logs one run's failure and still polls the rest" do
        failing = in_progress_run
        healthy = in_progress_run
        allow_any_instance_of(PipelineRun).to receive(:update_job_status) do |pipeline_run|
          raise "S3 exploded" if pipeline_run.id == failing.id

          polled << pipeline_run.id
        end

        expect(LogUtil).to receive(:log_error).with(
          /Updating pipeline run #{failing.id} failed with exception: S3 exploded/,
          hash_including(pipeline_run_id: failing.id)
        )

        described_class.update_jobs(1, 0, [failing.id, healthy.id])

        expect(polled).to eq([healthy.id])
      end
    end

    context "when shutdown has been requested" do
      before { AppConfigHelper.set_app_config(AppConfig::ENABLE_SFN_NOTIFICATIONS, "0") }

      it "stops polling so the daemon can drain on SIGTERM" do
        pipeline_run = in_progress_run
        described_class.shutdown_requested = true

        described_class.update_jobs(1, 0, [pipeline_run.id])

        expect(polled).to be_empty

        # Same reasoning as the notifications-ON spec: an empty list only means "shutdown stopped
        # it" if the poller would otherwise have run. Clearing the flag must make this poll.
        described_class.shutdown_requested = false
        described_class.update_jobs(1, 0, [pipeline_run.id])
        expect(polled).to eq([pipeline_run.id])
      end
    end
  end

  describe ".run" do
    let(:polled) { [] }

    before do
      allow_any_instance_of(PipelineRun).to receive(:update_job_status) do |pipeline_run|
        polled << pipeline_run.id
      end
      # run() forks a worker per shard. Forking inside a transactional spec hands the child a
      # copy of an uncommitted transaction and a shared DB socket. Run the shard inline so the
      # spec still exercises the real in_progress selection and shard maths.
      allow(Process).to receive(:fork) { |&shard| shard.call }
      allow(Process).to receive(:waitpid)
      # benchmark_update shells out to `aws s3 cp`; an empty body makes it no-op via its own guard.
      allow(described_class).to receive(:`).and_return("")
      AppConfigHelper.set_app_config(AppConfig::ENABLE_SFN_NOTIFICATIONS, "0")
    end

    after { described_class.shutdown_requested = false }

    around do |example|
      previous = AppConfigHelper.get_app_config(AppConfig::ENABLE_SFN_NOTIFICATIONS)
      example.run
      AppConfigHelper.set_app_config(AppConfig::ENABLE_SFN_NOTIFICATIONS, previous.to_s)
    end

    # A duration of 0 means t_end == t_now, so the loop runs exactly one iteration and
    # breaks before any sleep. This is the same entry point as `pipeline_monitor[single_iteration]`.
    it "polls the in-progress runs and nothing else" do
      sample = create(:sample)
      in_progress = create(:pipeline_run, sample: sample, job_status: PipelineRun::STATUS_READY, finalized: 0)
      # Finished: in_progress filters on finalized: 0.
      create(:pipeline_run, sample: sample, job_status: PipelineRun::STATUS_CHECKED, finalized: 1)
      # Failed: in_progress filters job_status != FAILED.
      create(:pipeline_run, sample: sample, job_status: PipelineRun::STATUS_FAILED, finalized: 0)

      described_class.run(0, 60.0)

      expect(polled).to eq([in_progress.id])
    end

    it "completes an iteration when there is nothing in progress" do
      expect { described_class.run(0, 60.0) }.not_to raise_error
      expect(polled).to be_empty
    end
  end

  # A polling sandbox must poll each PipelineRun with the same per-technology branch the
  # notification handler uses: nanopore (single-stage SFN) via update_single_stage_run_status,
  # illumina (multi-stage) via update_job_status. Wrong method => nanopore never leaves RUNNING.
  describe ".update_jobs polling by technology" do
    before do
      allow(AppConfigHelper).to receive(:get_app_config)
        .with(AppConfig::ENABLE_SFN_NOTIFICATIONS).and_return("0")
    end

    it "polls a nanopore run via the single-stage method" do
      pr = instance_double(PipelineRun, id: 9011, sample_id: 1, technology: PipelineRun::TECHNOLOGY_INPUT[:nanopore])
      allow(PipelineRun).to receive(:find_by).with(id: 9011).and_return(pr)
      expect(pr).to receive(:update_single_stage_run_status)
      expect(pr).not_to receive(:update_job_status)
      described_class.update_jobs(1, 0, [9011])
    end

    it "polls an illumina run via the multi-stage method" do
      pr = instance_double(PipelineRun, id: 9012, sample_id: 1, technology: PipelineRun::TECHNOLOGY_INPUT[:illumina])
      allow(PipelineRun).to receive(:find_by).with(id: 9012).and_return(pr)
      expect(pr).to receive(:update_job_status)
      expect(pr).not_to receive(:update_single_stage_run_status)
      described_class.update_jobs(1, 0, [9012])
    end
  end

  # A POLLING sandbox has no shoryuken to consume SFN notifications, so WorkflowRuns
  # (consensus-genome / amr / benchmark) must be polled here, exactly as the mNGS PipelineRuns
  # are -- otherwise their status never leaves RUNNING. Guarded by ENABLE_SFN_NOTIFICATIONS so
  # dev/staging/prod (notification mode) are untouched.
  describe ".update_workflow_run_jobs" do
    let(:workflow_run) { instance_double(WorkflowRun, id: 7, sample_id: 3) }
    let(:running) { instance_double(ActiveRecord::Relation, pluck: [7]) }

    it "polls running WorkflowRuns when notifications are DISABLED (a polling sandbox)" do
      allow(AppConfigHelper).to receive(:get_app_config)
        .with(AppConfig::ENABLE_SFN_NOTIFICATIONS).and_return("0")
      allow(WorkflowRun).to receive(:in_progress).and_return(running)
      allow(WorkflowRun).to receive(:find_by).with(id: 7).and_return(workflow_run)
      expect(workflow_run).to receive(:update_status)
      described_class.update_workflow_run_jobs
    end

    it "does NOT poll when notifications are ENABLED (dev/staging/prod)" do
      allow(AppConfigHelper).to receive(:get_app_config)
        .with(AppConfig::ENABLE_SFN_NOTIFICATIONS).and_return("1")
      expect(WorkflowRun).not_to receive(:in_progress)
      described_class.update_workflow_run_jobs
    end

    it "logs and continues if one WorkflowRun update raises (never aborts the loop)" do
      allow(AppConfigHelper).to receive(:get_app_config)
        .with(AppConfig::ENABLE_SFN_NOTIFICATIONS).and_return("0")
      allow(WorkflowRun).to receive(:in_progress).and_return(running)
      allow(WorkflowRun).to receive(:find_by).with(id: 7).and_return(workflow_run)
      allow(workflow_run).to receive(:update_status).and_raise(StandardError, "boom")
      expect(LogUtil).to receive(:log_error)
        .with(/Updating workflow run 7 failed/, hash_including(:exception))
      expect { described_class.update_workflow_run_jobs }.not_to raise_error
    end
  end
end
