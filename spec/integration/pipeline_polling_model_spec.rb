require 'rails_helper'

# The POLLING model -- what runs when ENABLE_SFN_NOTIFICATIONS is off -- had exactly one consumer
# and zero tests, and it cost four silent bugs in a single night. All four were the same shape: code
# that only ever worked because the notification path masked it. None raised. None failed CI. Each
# was found by running a real sample through a preview sandbox and noticing a number on a screen
# never changed, and each was only visible after fixing the one in front of it.
#
#   1. pipeline_monitor skips update_job_status unless the flag is off, so a sandbox switched off its
#      own status poller and waited for a notification no shoryuken would ever send.
#   2. sandboxes inherited dev's REDISCLOUD_URL, so DEV's workers popped their ResultMonitorLoader
#      jobs and ran them against DEV's schema. (Infra, not reachable from here.)
#   3. results_finalized was assigned in-memory in an after_create and only ever persisted as a side
#      effect of the notification path calling pr.dispatch -> update(...).
#   4. should_be_available is derived from updated_at AFTER update_job_stats writes that same row, so
#      it asks "was this touched over a minute ago?" milliseconds after touching it -- always false.
#
# Why dev never noticed any of it: every branch above is guarded by
# `... || ENABLE_SFN_NOTIFICATIONS == "1"`, or by the flag directly. Dev/staging/prod all run
# notifications ON, so the `||` short-circuits and the left-hand side is never evaluated. Those code
# paths are dead there. Only a preview sandbox runs them -- it cannot have a shoryuken, because that
# would make it a competing consumer on dev's shared SQS queue.
#
# So this file exists to make the polling path a tested path. It asserts the OUTCOME a sandbox needs
# -- a run that finishes actually reads as finished -- rather than the internals of any one fix, so
# it keeps its value if the internals change. If the sandbox ever rejoins the notification path
# (per the platform ticket on retiring this divergence), delete this file along with the branches it
# covers.
RSpec.describe 'pipeline result loading with SFN notifications OFF (the polling model)', type: :integration do
  let(:project) { create(:project) }
  let(:sample) { create(:sample, project: project) }
  let(:pipeline_run) { create(:pipeline_run, sample: sample, pipeline_version: "8.3", finalized: 1) }

  around do |example|
    previous = AppConfigHelper.get_app_config(AppConfig::ENABLE_SFN_NOTIFICATIONS)
    AppConfigHelper.set_app_config(AppConfig::ENABLE_SFN_NOTIFICATIONS, "0")
    example.run
    AppConfigHelper.set_app_config(AppConfig::ENABLE_SFN_NOTIFICATIONS, previous.to_s)
  end

  before do
    # The run finished a while ago and nothing is touching it: "quiet", and therefore available.
    pipeline_run.update_column(:updated_at, 5.minutes.ago) # rubocop:disable Rails/SkipsModelValidations

    # update_job_stats reads S3 job stats. Stub it down to the ONE behaviour that matters here: it
    # WRITES this row (load_compression_ratio/load_qc_percent call update!), which is what made
    # should_be_available unreachable. Stubbing the maths keeps the spec about the ordering.
    allow(pipeline_run).to receive(:update_job_stats) do
      pipeline_run.touch # rubocop:disable Rails/SkipsModelValidations
      nil
    end
  end

  # Mark every output LOADED except the named one, and refresh the association so monitor_results
  # sees what the database actually holds. update_all alone leaves loaded copies stale.
  def load_all_outputs_except(output)
    pipeline_run.output_states.where.not(output: output)
                .update_all(state: PipelineRun::STATUS_LOADED) # rubocop:disable Rails/SkipsModelValidations
    pipeline_run.output_states.reload
  end

  context 'an output that will never exist (insert_size_metrics on a single-end sample)' do
    before do
      # Nothing is in S3: no output is "ready".
      allow(pipeline_run).to receive(:output_ready?).and_return(false)
      # The checker's answer for a single-end sample: no, this file should not have been generated.
      allow(pipeline_run).to receive(:should_have_insert_size_metrics).and_return(false)
    end

    it 'resolves the output instead of waiting for it forever' do
      pipeline_run.monitor_results

      state = pipeline_run.output_states.find_by(output: "insert_size_metrics")
      expect(state.reload.state).to eq(PipelineRun::STATUS_LOADED)
    end

    it 'lets the run finalize, so the sample can stop reading as in-progress' do
      # Everything else already loaded; insert_size_metrics is the last one outstanding.
      # `.reload` is load-bearing: update_all writes the DB but leaves an already-loaded
      # association holding stale rows, so monitor_results would iterate copies still reading
      # UNKNOWN, re-process outputs that are actually LOADED, and -- since only
      # insert_size_metrics has a checker -- mark the rest FAILED via `!checker`. The run then
      # finalizes as FINALIZED_FAIL and the spec fails for a reason that has nothing to do with
      # what it is testing.
      load_all_outputs_except("insert_size_metrics")

      pipeline_run.monitor_results

      expect(pipeline_run.reload.results_finalized).to eq(PipelineRun::FINALIZED_SUCCESS)
    end

    it 'displays COMPLETE rather than POST PROCESSING -- the bug a human actually sees' do
      load_all_outputs_except("insert_size_metrics")

      pipeline_run.monitor_results
      pipeline_run.reload

      # status_display_helper can ONLY print COMPLETE from results_finalized being terminal. While
      # insert_size_metrics sat UNKNOWN, every sandbox sample fell through to "POST PROCESSING" and
      # stayed there permanently, with the pipeline long since SUCCEEDED.
      states = { pipeline_run.id => pipeline_run.output_states }
      expect(pipeline_run.status_display(states)).to eq("COMPLETE")
    end
  end

  context 'an output that SHOULD exist but does not' do
    before do
      allow(pipeline_run).to receive(:output_ready?).and_return(false)
      # No checker for this output => "it should have been generated" => this is a real failure.
      allow(pipeline_run).to receive(:should_have_insert_size_metrics).and_return(true)
    end

    it 'marks it FAILED rather than silently resolving it' do
      pipeline_run.monitor_results

      state = pipeline_run.output_states.find_by(output: "taxon_counts")
      expect(state.reload.state).to eq(PipelineRun::STATUS_FAILED)
    end
  end

  context 'results_finalized' do
    it 'is PERSISTED at creation, not merely assigned in memory' do
      # With notifications ON this column reached the database only because pr.dispatch happened to
      # flush the dirty attribute. With them OFF, PipelineMonitor dispatches from a run reloaded out
      # of the database, so nothing would write it -- results_in_progress (WHERE results_finalized =
      # 0) would never match, and the result monitor would never look at the run at all.
      fresh = create(:pipeline_run, sample: sample)
      expect(fresh.reload.results_finalized).to eq(PipelineRun::IN_PROGRESS)
      expect(PipelineRun.results_in_progress).to include(fresh)
    end
  end
end
