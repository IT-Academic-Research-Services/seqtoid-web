require 'rails_helper'

# MonitorPipelineResults is defined in lib/tasks/result_monitor.rake, which is loaded via
# Rails.application.load_tasks in rails_helper.
#
# update_jobs is the loop that actually loads pipeline results, and it had no spec at all. Two
# production bugs lived inside it last night, and both were untested conditionals in this method's
# immediate blast radius:
#
#   1. It iterates PipelineRun.results_in_progress, which is `WHERE results_finalized = 0`. Runs
#      whose results_finalized was NULL never matched, so the loop never saw them, results never
#      loaded, and the report never rendered. Nothing raised -- the loop simply had an empty list.
#   2. The `!= "1"` guard below means pr.monitor_results is only ever called with SFN notifications
#      OFF. Dev/staging/prod run them ON, so the call is dead code there and nothing exercised it.
#      A preview sandbox runs them OFF and depends on this branch entirely.
#
# These specs therefore cover the branches rather than the happy path: which runs the scope hands
# to the loop, both sides of the notifications flag, that one exploding run does not abandon the
# rest, and that a shutdown request actually stops the loop. They assert the OUTCOME -- which runs
# got monitored -- rather than the internals of monitor_results, which has its own specs.
RSpec.describe MonitorPipelineResults do
  let(:project) { create(:project) }
  let(:sample) { create(:sample, project: project) }

  # Ids of the pipeline runs monitor_results was actually called on, in call order. update_jobs
  # loads its own PipelineRun objects out of the scope, so there is no instance here to stub; the
  # any_instance stub records ids instead, which is exactly what these specs want to assert on.
  let(:monitored) { [] }

  def stub_monitor_results
    allow_any_instance_of(PipelineRun).to receive(:monitor_results) do |pr|
      monitored << pr.id
    end
  end

  def set_notifications(value)
    AppConfigHelper.set_app_config(AppConfig::ENABLE_SFN_NOTIFICATIONS, value)
  end

  around do |example|
    previous = AppConfigHelper.get_app_config(AppConfig::ENABLE_SFN_NOTIFICATIONS)
    example.run
    AppConfigHelper.set_app_config(AppConfig::ENABLE_SFN_NOTIFICATIONS, previous.to_s)
  end

  after do
    # shutdown_requested is class-level state on a constant that outlives the example, so a spec
    # that sets it would silently empty the loop in every spec that follows it.
    described_class.shutdown_requested = false
  end

  describe ".update_jobs" do
    context "with SFN notifications OFF (the polling model -- what a preview sandbox runs)" do
      before { set_notifications("0") }

      it "monitors a run whose results are still in progress" do
        in_progress = create(:pipeline_run, sample: sample, results_finalized: PipelineRun::IN_PROGRESS)
        stub_monitor_results

        described_class.update_jobs

        expect(monitored).to eq([in_progress.id])
      end

      it "does not monitor a run whose results already finalized successfully" do
        create(:pipeline_run, sample: sample, results_finalized: PipelineRun::FINALIZED_SUCCESS)
        stub_monitor_results

        described_class.update_jobs

        expect(monitored).to be_empty
      end

      it "does not monitor a run whose results already finalized as a failure" do
        create(:pipeline_run, sample: sample, results_finalized: PipelineRun::FINALIZED_FAIL)
        stub_monitor_results

        described_class.update_jobs

        expect(monitored).to be_empty
      end

      it "picks only the in-progress runs out of a mixed set" do
        in_progress = create(:pipeline_run, sample: sample, results_finalized: PipelineRun::IN_PROGRESS)
        create(:pipeline_run, sample: create(:sample, project: project), results_finalized: PipelineRun::FINALIZED_SUCCESS)
        create(:pipeline_run, sample: create(:sample, project: project), results_finalized: PipelineRun::FINALIZED_FAIL)
        stub_monitor_results

        described_class.update_jobs

        expect(monitored).to eq([in_progress.id])
      end

      # Characterization of the first bug, from the loop's side rather than the model's. This is
      # not a behaviour to preserve -- it is the sharp edge that makes persisting results_finalized
      # as 0 at creation load-bearing. `results_finalized = 0` does not match NULL in SQL, so such
      # a run is not "pending", it is invisible: the loop never looks at it and never complains.
      it "cannot see a run whose results_finalized is NULL -- the loop is silently empty" do
        orphan = create(:pipeline_run, sample: sample)
        orphan.update_column(:results_finalized, nil) # rubocop:disable Rails/SkipsModelValidations
        stub_monitor_results

        described_class.update_jobs

        expect(PipelineRun.results_in_progress).not_to include(orphan)
        expect(monitored).to be_empty
      end
    end

    context "with SFN notifications ON (dev/staging/prod -- shoryuken drives result loading)" do
      before { set_notifications("1") }

      it "does not monitor an in-progress run, leaving it to the notification path" do
        create(:pipeline_run, sample: sample, results_finalized: PipelineRun::IN_PROGRESS)
        stub_monitor_results

        described_class.update_jobs

        expect(monitored).to be_empty
      end
    end

    context "when the flag is set to something other than 0 or 1" do
      # The guard is `!= "1"`, not `== "0"`, so every value except the exact string "1" polls.
      # An unset flag is the case that matters: a sandbox that never seeded app_configs still
      # needs the polling path, and it gets it.
      it "polls when the flag is unset" do
        AppConfigHelper.remove_app_config(AppConfig::ENABLE_SFN_NOTIFICATIONS)
        in_progress = create(:pipeline_run, sample: sample)
        stub_monitor_results

        described_class.update_jobs

        expect(monitored).to eq([in_progress.id])
      end

      it "polls when the flag holds an unexpected value" do
        set_notifications("true")
        in_progress = create(:pipeline_run, sample: sample)
        stub_monitor_results

        described_class.update_jobs

        expect(monitored).to eq([in_progress.id])
      end
    end

    context "when one run raises" do
      before { set_notifications("0") }

      # Order-independence: PipelineRun.results_in_progress has no ORDER BY, so which run comes
      # first is not guaranteed. Raising on the FIRST run visited -- whichever it turns out to be
      # -- means the remaining two prove the loop continued, no matter what order MySQL chose.
      it "logs the failure and carries on with the remaining runs" do
        runs = Array.new(3) { create(:pipeline_run, sample: create(:sample, project: project)) }
        calls = 0
        exploded_id = nil
        allow_any_instance_of(PipelineRun).to receive(:monitor_results) do |pr|
          calls += 1
          if calls == 1
            exploded_id = pr.id
            raise "S3 fell over"
          end
          monitored << pr.id
        end

        logged = []
        allow(LogUtil).to receive(:log_error) do |_message, **details|
          logged << details[:pipeline_run_id]
        end

        expect { described_class.update_jobs }.not_to raise_error

        # Every run was reached: the two survivors plus the one that blew up.
        expect(monitored + [exploded_id]).to match_array(runs.map(&:id))
        expect(logged).to eq([exploded_id])
      end

      it "reports which run failed, and why" do
        run = create(:pipeline_run, sample: sample)
        allow_any_instance_of(PipelineRun).to receive(:monitor_results).and_raise("S3 fell over")

        expect(LogUtil).to receive(:log_error).with(
          /Failed monitor results for pipeline run #{run.id}: S3 fell over/,
          hash_including(pipeline_run_id: run.id)
        )

        described_class.update_jobs
      end
    end

    context "when shutdown is requested" do
      before { set_notifications("0") }

      it "monitors nothing if the request arrived before the loop started" do
        create(:pipeline_run, sample: sample)
        stub_monitor_results
        described_class.shutdown_requested = true

        described_class.update_jobs

        expect(monitored).to be_empty
      end

      it "stops at the next run when the request arrives mid-loop" do
        3.times { create(:pipeline_run, sample: create(:sample, project: project)) }
        allow_any_instance_of(PipelineRun).to receive(:monitor_results) do |pr|
          monitored << pr.id
          described_class.shutdown_requested = true
        end

        described_class.update_jobs

        # The break is checked at the top of each iteration, so the run in flight finishes and no
        # further run is started -- one of three, not all three.
        expect(monitored.length).to eq(1)
      end
    end

    context "stalled upload handling" do
      before { set_notifications("1") }

      # Both calls sit behind their own rescue for the same reason the per-run rescue exists: one
      # failing must not take the other down with it, or the result monitor stops alerting.
      it "still fails stalled uploads when alerting on them raises" do
        allow(described_class).to receive(:alert_stalled_uploads!).and_raise("alerting broke")
        allow(LogUtil).to receive(:log_error)

        expect(described_class).to receive(:fail_stalled_uploads!)
        expect { described_class.update_jobs }.not_to raise_error
        expect(LogUtil).to have_received(:log_error).with(/Failed to alert on stalled uploads/, hash_including(:exception))
      end

      it "logs rather than raises when failing stalled uploads raises" do
        allow(described_class).to receive(:alert_stalled_uploads!)
        allow(described_class).to receive(:fail_stalled_uploads!).and_raise("failing broke")
        allow(LogUtil).to receive(:log_error)

        expect { described_class.update_jobs }.not_to raise_error
        expect(LogUtil).to have_received(:log_error).with(/Failed to fail stalled uploads/, hash_including(:exception))
      end

      it "does not let a stalled-upload failure stop pipeline runs from being monitored" do
        # The pipeline run loop runs first, but a raise escaping it would abort update_jobs before
        # either stalled-upload call. Pin the ordering the other way round too: these are separate
        # concerns and neither should be able to break the other.
        set_notifications("0")
        run = create(:pipeline_run, sample: sample)
        stub_monitor_results
        allow(described_class).to receive(:alert_stalled_uploads!).and_raise("alerting broke")
        allow(LogUtil).to receive(:log_error)

        described_class.update_jobs

        expect(monitored).to eq([run.id])
      end
    end
  end
end
