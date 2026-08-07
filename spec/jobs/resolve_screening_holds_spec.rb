require 'rails_helper'

RSpec::Matchers.define_negated_matcher :not_change, :change

# CZID-598 -- the Descartes Incident Manager resolution poller. Proves, with a stubbed ResolutionClient
# (no live SOAP), the verdict -> release/keep-held mapping across the full IM lifecycle, correlation by
# sdistributedid / soptionalid, idempotent re-processing, the OFF-by-default self-skip (no network, no
# writes), the inert-when-unconfigured skip, and the fail-closed "never advance the watermark on error".
RSpec.describe ResolveScreeningHolds, type: :job do
  let(:client) { instance_double(ExportControl::Descartes::ResolutionClient, configured?: true) }

  # A held subject: a hit screening_result (On Hold-RPS) with a known sdistributedid + a matching active
  # hold. sdistributedid is the primary correlation key back from the poll.
  def held_subject(sdistributedid:, soptionalid: '0', subject_ref: nil)
    ref = subject_ref || "user:#{sdistributedid}"
    sr = create(:screening_result, :red, subject_ref: ref, soptionalid: soptionalid,
                                         sdistributedid: sdistributedid)
    hold = create(:hold, subject_ref: ref, screening_result: sr)
    [sr, hold]
  end

  def verdict(status:, shresult_id: nil, shoptid: '')
    ExportControl::Descartes::ResolutionClient::Verdict.new(
      shresult_id: shresult_id, shstatus: status, shoptid: shoptid, shrevdate: '07-24-2018 17:39:06'
    )
  end

  def enable!
    AppConfigHelper.set_app_config(AppConfig::ENABLE_DESCARTES_SCREENING, '1')
  end

  # Run the job with a stubbed client that returns the given verdicts.
  def run_with(verdicts)
    job = described_class.new
    allow(job).to receive(:client).and_return(client)
    allow(client).to receive(:poll).and_return(verdicts)
    job.run
    job
  end

  before { HttpResilience.reset! }

  describe '.disposition_for -- the IM lifecycle mapping (fail-closed)' do
    it 'releases only on the terminal-clear states' do
      ['Cleared', 'False Hit', 'CRI Auto-Clear'].each do |s|
        expect(described_class.disposition_for(s)).to eq(:release)
      end
    end

    it 'denies (keep held) on True Hit' do
      expect(described_class.disposition_for('True Hit')).to eq(:deny)
    end

    it 'keeps held on every non-terminal or unknown status' do
      ['DS New', 'Actioned', 'Escalated', 'Closed', 'something weird', '', nil].each do |s|
        expect(described_class.disposition_for(s)).to eq(:keep_held)
      end
    end
  end

  describe '#run -- verdict application' do
    before { enable! }

    it 'RELEASES the hold on Cleared and stamps the incident id' do
      sr, hold = held_subject(sdistributedid: '100')
      run_with([verdict(status: 'Cleared', shresult_id: '100')])

      expect(hold.reload).not_to be_active
      expect(sr.reload.incident_id).to eq('100')
    end

    it 'records the release adjudication durably on the hold (SMP-1253)' do
      _sr, hold = held_subject(sdistributedid: '100b')
      run_with([verdict(status: 'Cleared', shresult_id: '100b')])

      hold.reload
      expect(hold.disposition).to eq(Hold::DISPOSITION_RELEASED)
      expect(hold.resolution_status).to eq('Cleared')
      expect(hold.incident_id).to eq('100b')
      expect(hold.resolved_at).to be_present
    end

    it 'RELEASES on False Hit' do
      _sr, hold = held_subject(sdistributedid: '101')
      run_with([verdict(status: 'False Hit', shresult_id: '101')])
      expect(hold.reload).not_to be_active
    end

    it 'RELEASES on CRI Auto-Clear' do
      _sr, hold = held_subject(sdistributedid: '102')
      run_with([verdict(status: 'CRI Auto-Clear', shresult_id: '102')])
      expect(hold.reload).not_to be_active
    end

    it 'KEEPS HELD on True Hit (terminal deny) and still records the incident' do
      sr, hold = held_subject(sdistributedid: '103')
      run_with([verdict(status: 'True Hit', shresult_id: '103')])

      expect(hold.reload).to be_active
      expect(sr.reload.incident_id).to eq('103')
    end

    it 'records the True Hit deny durably on the hold while leaving it in force (SMP-1253)' do
      _sr, hold = held_subject(sdistributedid: '103b')
      run_with([verdict(status: 'True Hit', shresult_id: '103b')])

      hold.reload
      expect(hold).to be_active # a deny never releases the hold
      expect(hold).to be_adjudicated # but the review is now durable, not just logged
      expect(hold.disposition).to eq(Hold::DISPOSITION_DENIED)
      expect(hold.resolution_status).to eq('True Hit')
      expect(hold.incident_id).to eq('103b')
      expect(hold.resolved_at).to be_present
    end

    ['DS New', 'Actioned', 'Escalated', 'Closed'].each do |status|
      it "KEEPS HELD on the non-terminal status #{status}" do
        _sr, hold = held_subject(sdistributedid: "200-#{status}")
        run_with([verdict(status: status, shresult_id: "200-#{status}")])
        expect(hold.reload).to be_active
      end
    end

    it 'correlates by soptionalid (table-keyed) when the result id does not match a row' do
      sr = create(:screening_result, :red, subject_ref: 'user:sopt', soptionalid: '4242',
                                           sdistributedid: 'unmatched-dist')
      hold = create(:hold, subject_ref: 'user:sopt', screening_result: sr)

      run_with([verdict(status: 'Cleared', shresult_id: 'no-such-dist', shoptid: '4242')])
      expect(hold.reload).not_to be_active
    end

    it 'via the soptionalid fallback, releases only the most-recent held screen, not unrelated older ones (SMP-1694)' do
      # One user (same table-keyed soptionalid) with TWO distinct screens, each with its own active hold.
      old_sr = create(:screening_result, :red, subject_ref: 'user:multi', soptionalid: '7777',
                                               sdistributedid: 'old-dist', screened_at: 3.days.ago)
      old_hold = create(:hold, subject_ref: 'user:multi', screening_result: old_sr)

      new_sr = create(:screening_result, :red, subject_ref: 'user:multi', soptionalid: '7777',
                                               sdistributedid: 'new-dist', screened_at: 1.hour.ago)
      new_hold = create(:hold, subject_ref: 'user:multi', screening_result: new_sr)

      # A verdict whose result id matches no row -> forced down the soptionalid fallback path.
      run_with([verdict(status: 'Cleared', shresult_id: 'no-such-dist', shoptid: '7777')])

      expect(new_hold.reload).not_to be_active # the single most-recent held screen is released
      expect(old_hold.reload).to be_active     # the unrelated older screen's hold is left in force
    end

    it 'NEVER correlates on the ambiguous soptionalid "0"' do
      _sr, hold = held_subject(sdistributedid: 'zzz', soptionalid: '0')
      # verdict carries no matching result id and only the ambiguous "0" optid -> no correlation, no-op.
      run_with([verdict(status: 'Cleared', shresult_id: 'other', shoptid: '0')])
      expect(hold.reload).to be_active
    end
  end

  describe '#run -- idempotency (re-processing a verdict is a no-op)' do
    before { enable! }

    it 're-applies the same Cleared verdict without error and keeps the first release timestamp' do
      _sr, hold = held_subject(sdistributedid: '300')
      run_with([verdict(status: 'Cleared', shresult_id: '300')])
      first_released_at = hold.reload.released_at
      expect(first_released_at).to be_present

      run_with([verdict(status: 'Cleared', shresult_id: '300')])
      expect(hold.reload.released_at).to eq(first_released_at)
    end
  end

  describe '#run -- watermark cursor' do
    before { enable! }

    it 'advances the cursor to the window "To" on a successful poll' do
      allow(Time).to receive(:now).and_return(Time.utc(2026, 7, 9, 12, 0, 0))
      run_with([])
      cursor = AppConfigHelper.get_app_config(AppConfig::DESCARTES_RESOLUTION_POLL_CURSOR)
      expect(cursor).to eq('2026-07-09T12:00:00')
    end

    it 'polls from the persisted cursor as the From bound' do
      AppConfigHelper.set_app_config(AppConfig::DESCARTES_RESOLUTION_POLL_CURSOR, '2026-07-09T00:00:00')
      job = described_class.new
      allow(job).to receive(:client).and_return(client)
      expect(client).to receive(:poll)
        .with(hash_including(time_from: Time.parse('2026-07-09T00:00:00Z').utc))
        .and_return([])
      job.run
    end

    it 'does NOT advance the cursor when the poll raises (fail-closed re-poll)' do
      AppConfigHelper.set_app_config(AppConfig::DESCARTES_RESOLUTION_POLL_CURSOR, '2026-07-09T00:00:00')
      job = described_class.new
      allow(job).to receive(:client).and_return(client)
      allow(client).to receive(:poll).and_raise(ExportControl::Descartes::ResolutionClient::Error, 'boom')

      expect { job.run }.to raise_error(ExportControl::Descartes::ResolutionClient::Error)
      expect(AppConfigHelper.get_app_config(AppConfig::DESCARTES_RESOLUTION_POLL_CURSOR))
        .to eq('2026-07-09T00:00:00')
    end

    it 'does NOT release a hold when the poll raises' do
      _sr, hold = held_subject(sdistributedid: '400')
      job = described_class.new
      allow(job).to receive(:client).and_return(client)
      allow(client).to receive(:poll).and_raise(ExportControl::Descartes::ResolutionClient::Error, 'boom')
      expect { job.run }.to raise_error(StandardError)
      expect(hold.reload).to be_active
    end

    # SMP-1693 (gap C-125): LogUtil.log_error uses the exception message as the Sentry event title AND
    # the job re-raises so it also lands in the Resque failure record. Because the client now raises with
    # the vendor MARKER only, neither observability signal carries a screened party's name.
    it 'reports a marker-only error to Sentry/Resque without any party name' do
      job = described_class.new
      allow(job).to receive(:client).and_return(client)
      allow(client).to receive(:poll)
        .and_raise(ExportControl::Descartes::ResolutionClient::Error,
                   'IMTimeStampSearch job error: ERROR: Access to RPS Denied.')
      allow(LogUtil).to receive(:log_error).and_call_original

      expect { job.run }.to raise_error(ExportControl::Descartes::ResolutionClient::Error) { |e|
        # The re-raised message (-> Resque failure record) and its use as the Sentry title carry no PII.
        expect(e.message).not_to match(/Wayne|SHname|SHcompany/)
      }
      expect(LogUtil).to have_received(:log_error)
        .with(a_string_matching(/poll failed; holds left in force/),
              hash_including(exception: kind_of(ExportControl::Descartes::ResolutionClient::Error)))
    end
  end

  describe '#run -- OFF-by-default self-skip (full no-op)' do
    it 'when the flag is OFF: polls NOTHING, writes NOTHING, does not build a client' do
      # Flag defaults off; do not set it.
      _sr, hold = held_subject(sdistributedid: '500')

      job = described_class.new
      # If the client were built/polled, this spy would receive :poll -- assert it never does.
      expect(job).not_to receive(:client)

      expect { job.run }.to(not_change { hold.reload.released_at })
      expect(hold.reload).to be_active
    end

    it 'when the flag is OFF: .perform is a clean no-op' do
      expect { described_class.perform }.not_to raise_error
    end
  end

  describe '#run -- inert when unconfigured (flag on, no creds)' do
    it 'skips when the ResolutionClient is not configured -- no poll' do
      enable!
      unconfigured = instance_double(ExportControl::Descartes::ResolutionClient, configured?: false)
      job = described_class.new
      allow(job).to receive(:client).and_return(unconfigured)
      expect(unconfigured).not_to receive(:poll)
      expect { job.run }.not_to raise_error
    end
  end
end
