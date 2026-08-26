require 'rails_helper'

# Composable negated matcher so "creates X but NOT Y" reads as one expectation.
RSpec::Matchers.define_negated_matcher :not_change, :change

# CZID-596 -- Descartes ScreeningService. Proves the transstatus-primary, fail-closed screening core
# WITHOUT live credentials, using WebMock fixtures shaped from the SearchEntity API design (#595):
#   - clean screen (transstatus Passed, nomatch) -> ALLOWED, no hold
#   - each hit level (transstatus On Hold-RPS)   -> HELD + hold + fail-closed deny (provider HIT)
#   - per-search error / job-fatal / timeout / missing-config -> fail-closed error HOLD
#   - FLAG OFF -> full BYPASS: service not invoked, NO http call, NO hold (normal behavior)
RSpec.describe ExportControl::ScreeningService, type: :service do
  let(:config) do
    ExportControl::Descartes::SearchEntityClient::Config.new(
      endpoint: 'https://rpstest.example.test', secno: '12345', password: 'secretpw',
      groups: '12', list_label: 'Export+Munitions'
    )
  end
  let(:client) { ExportControl::Descartes::SearchEntityClient.new(config: config) }
  let(:service) { described_class.new(client: client) }
  let(:search_url) { 'https://rpstest.example.test/RPS/RPSService.svc/SearchEntity' }
  let(:json_headers) { { 'Content-Type' => 'application/json;charset=UTF-8' } }

  let(:party) do
    ExportControl::ScreeningService::Subject.new(
      subject_ref: 'User:42', subject_type: 'User', name: 'Wayne Smith',
      country: 'US', soptionalid: '42'
    )
  end

  # The circuit breaker is a process-wide singleton; reset it so failures in one example never leak.
  before { HttpResilience.reset! }

  # --- Fixtures shaped from API design doc Section 3.6 ---
  def clean_body
    JSON.dump(
      'transstatus' => 'Passed', 'smaxalert' => '', 'sguid' => 'g-clean',
      'searches' => [{ 'soptionalid' => '42', 'riskcountry' => '0', 'nomatch' => '1',
                       'sdistributedid' => '', 'results' => [], }]
    )
  end

  def hit_body(smaxalert:, sdistributedid:)
    JSON.dump(
      'transstatus' => 'On Hold-RPS', 'smaxalert' => smaxalert, 'sguid' => 'g-hit',
      'searches' => [{
        # Pure NAME-match hit: riskcountry 0 so this isolates the transstatus/name path. The
        # sanctioned-jurisdiction path (riskcountry >= 1 / embargoed subject country) is covered
        # separately below, since it takes precedence and uses a different hold reason.
        'soptionalid' => '42', 'scountry' => 'GB', 'riskcountry' => '0', 'nomatch' => '0',
        'sdistributedid' => sdistributedid,
        'results' => [{ 'dp_id' => 'DBP000063', 'list' => 'AECA Debarred Parties [DDTC]',
                        'name' => 'SMITH, Wayne P.', 'alerttype' => smaxalert, }],
      },]
    )
  end

  describe '#screen -- clean screen (Passed / nomatch)' do
    before { stub_request(:post, search_url).to_return(status: 200, body: clean_body, headers: json_headers) }

    it 'returns ALLOWED, persists a passing screening_results row, and creates NO hold' do
      expect { @outcome = service.screen(party) }
        .to change(ScreeningResult, :count).by(1)
        .and(not_change(Hold, :count))

      expect(@outcome.decision).to eq(:allowed)
      sr = @outcome.screening_result
      expect(sr.transstatus).to eq(ScreeningResult::TRANSSTATUS_PASSED)
      expect(sr.alert_level).to eq(ScreeningResult::ALERT_NOMATCH)
      expect(sr).to be_passed
      expect(sr.soptionalid).to eq('42') # table-keyed, echoed back
    end

    it 'maps to a CLEAR provider result (allow)' do
      expect(service.screen(party).to_provider_result.result).to eq(ExportControlClearance::SCREENING_CLEAR)
    end
  end

  describe '#screen -- hit levels (On Hold-RPS) all HOLD + fail-closed deny' do
    {
      '_Y' => ScreeningResult::ALERT_YELLOW,
      '_R' => ScreeningResult::ALERT_RED,
      'DR' => ScreeningResult::ALERT_DOUBLE_RED,
      'TR' => ScreeningResult::ALERT_TRIPLE_RED,
    }.each do |letter, mapped_level|
      context "smaxalert #{letter}" do
        before do
          stub_request(:post, search_url)
            .to_return(status: 200, body: hit_body(smaxalert: letter, sdistributedid: '295395313516552'),
                       headers: json_headers)
        end

        it "records #{mapped_level}, places an active hold, and denies (provider HIT)" do
          expect { @outcome = service.screen(party) }
            .to change(ScreeningResult, :count).by(1)
            .and(change(Hold, :count).by(1))

          sr = @outcome.screening_result
          expect(@outcome.decision).to eq(:held)
          expect(sr.transstatus).to eq(ScreeningResult::TRANSSTATUS_ON_HOLD)
          expect(sr.alert_level).to eq(mapped_level)
          expect(sr.risk_country).to eq(0)
          expect(sr.jurisdiction_risk).to be(false)
          expect(sr.sdistributedid).to eq('295395313516552')
          expect(sr).to be_hold_required

          hold = @outcome.hold
          expect(hold).to be_active
          expect(hold.reason).to eq(Hold::REASON_SCREENING_HIT)
          expect(hold.screening_result_id).to eq(sr.id)

          expect(@outcome.to_provider_result.result).to eq(ExportControlClearance::SCREENING_HIT)
        end
      end
    end
  end

  describe '#screen -- sanctioned-jurisdiction rule (hard HOLD/red, overrides transstatus)' do
    it 'HOLDs a party from an embargoed country even on a clean Passed/nomatch screen' do
      embargoed = ExportControl::ScreeningService::Subject.new(
        subject_ref: 'User:99', subject_type: 'User', name: 'Jane Clean', country: 'IR', soptionalid: '99'
      )
      stub_request(:post, search_url).to_return(status: 200, body: clean_body, headers: json_headers)

      expect { @outcome = service.screen(embargoed) }
        .to change(ScreeningResult, :count).by(1)
        .and(change(Hold, :count).by(1))

      sr = @outcome.screening_result
      expect(@outcome.decision).to eq(:held)
      expect(sr.jurisdiction_risk).to be(true)
      expect(sr.country).to eq('IR')
      expect(sr.transstatus).to eq(ScreeningResult::TRANSSTATUS_PASSED) # would have ALLOWED on name-screen alone
      expect(sr.effective_alert_level).to eq(ScreeningResult::ALERT_RED)
      expect(@outcome.hold.reason).to eq(Hold::REASON_SANCTIONED_JURISDICTION)
      expect(@outcome.to_provider_result.result).to eq(ExportControlClearance::SCREENING_HIT)
    end

    it 'HOLDs on the vendor risk_country flag even when the subject country is not embargoed' do
      risky_clean = JSON.dump(
        'transstatus' => 'Passed', 'smaxalert' => '', 'sguid' => 'g-rc',
        'searches' => [{ 'soptionalid' => '42', 'riskcountry' => '1', 'nomatch' => '1', 'results' => [] }]
      )
      stub_request(:post, search_url).to_return(status: 200, body: risky_clean, headers: json_headers)

      expect { @outcome = service.screen(party) }.to change(Hold, :count).by(1) # party.country == 'US'
      expect(@outcome.decision).to eq(:held)
      expect(@outcome.screening_result.jurisdiction_risk).to be(true)
      expect(@outcome.hold.reason).to eq(Hold::REASON_SANCTIONED_JURISDICTION)
    end
  end

  describe '#screen -- fail-closed error paths (HOLD, no screening row, never allow)' do
    it 'HOLDs on a per-search error (nomatch == E)' do
      body = JSON.dump('transstatus' => 'On Hold-RPS', 'smaxalert' => '',
                       'searches' => [{ 'nomatch' => 'E',
                                        'errorstring' => 'REJECT: Search Request Essential Columns are empty.',
                                        'results' => [], }])
      stub_request(:post, search_url).to_return(status: 200, body: body, headers: json_headers)

      expect { @outcome = service.screen(party) }
        .to change(Hold, :count).by(1)
        .and(not_change(ScreeningResult, :count))
      expect(@outcome.decision).to eq(:error)
      expect(@outcome.hold.reason).to eq(Hold::REASON_SCREENING_ERROR)
      expect(@outcome.hold.screening_result_id).to be_nil
      expect(@outcome.to_provider_result.result).to eq(ExportControlClearance::SCREENING_PENDING)
    end

    it 'HOLDs on a job-fatal credentials error' do
      body = JSON.dump('errorstring' => 'ERROR: Invalid credentials.')
      stub_request(:post, search_url).to_return(status: 200, body: body, headers: json_headers)

      expect { @outcome = service.screen(party) }.to change(Hold, :count).by(1)
      expect(@outcome.decision).to eq(:error)
    end

    it 'HOLDs on a non-200 HTTP status' do
      stub_request(:post, search_url).to_return(status: 403, body: 'forbidden')
      expect { @outcome = service.screen(party) }.to change(Hold, :count).by(1)
      expect(@outcome.decision).to eq(:error)
    end

    it 'HOLDs on a client timeout (fail-closed on transport failure)' do
      timing_out = instance_double(ExportControl::Descartes::SearchEntityClient)
      allow(timing_out).to receive(:search).and_raise(Timeout::Error, 'read timeout')
      svc = described_class.new(client: timing_out)

      expect { @outcome = svc.screen(party) }
        .to change(Hold, :count).by(1)
        .and(not_change(ScreeningResult, :count))
      expect(@outcome.decision).to eq(:error)
      expect(@outcome.hold.reason).to eq(Hold::REASON_SCREENING_ERROR)
    end

    it 'HOLDs (and makes NO http call) when the client is not configured (inert env)' do
      unconfigured = ExportControl::Descartes::SearchEntityClient.new(
        config: ExportControl::Descartes::SearchEntityClient::Config.new(endpoint: nil, secno: nil, password: nil)
      )
      svc = described_class.new(client: unconfigured)

      expect { @outcome = svc.screen(party) }.to change(Hold, :count).by(1)
      expect(@outcome.decision).to eq(:error)
      expect(a_request(:post, search_url)).not_to have_been_made
    end
  end

  describe '#screen_if_enabled -- OFF-by-default FULL BYPASS' do
    it 'when the flag is OFF: returns nil, invokes NOTHING, no http, no rows' do
      # Flag defaults off; do not set it. Inject a spy client to prove it is never touched.
      spy_client = instance_double(ExportControl::Descartes::SearchEntityClient)
      svc = described_class.new(client: spy_client)

      expect(svc.enabled?).to be(false)
      expect(spy_client).not_to receive(:search)

      result = nil
      expect { result = svc.screen_if_enabled(party) }
        .to(not_change(ScreeningResult, :count).and(not_change(Hold, :count)))

      expect(result).to be_nil
      expect(a_request(:post, search_url)).not_to have_been_made
    end

    it 'when the flag is ON: the service runs and screens' do
      AppConfigHelper.set_app_config(AppConfig::ENABLE_DESCARTES_SCREENING, '1')
      stub_request(:post, search_url).to_return(status: 200, body: clean_body, headers: json_headers)

      expect(service.enabled?).to be(true)
      outcome = service.screen_if_enabled(party)
      expect(outcome).not_to be_nil
      expect(outcome.decision).to eq(:allowed)
    end
  end

  # SMP-1253 -- the OTel/structured-log audit layer ON TOP of the durable evidence rows.
  describe '#screen -- SMP-1253 audit wiring' do
    it 'stamps trace_id on the evidence + hold rows (nil when tracing is off) and audit-logs the decision' do
      stub_request(:post, search_url).to_return(status: 200, body: hit_body(smaxalert: '_R', sdistributedid: 'd-1'),
                                                headers: json_headers)
      allow(Rails.logger).to receive(:info).and_call_original

      outcome = service.screen(party)

      expect(outcome.decision).to eq(:held)
      # trace_id is stamped but nil in test/CI (no OTLP configured -> no recording span).
      expect(outcome.screening_result).to have_attributes(trace_id: nil)
      expect(outcome.hold).to have_attributes(trace_id: nil)
      expect(Rails.logger).to have_received(:info)
        .with(a_string_matching(/\[screening_audit\].*"screening_event":"screen\.held"/))
    end

    it 'emits an audit line on a fail-closed error hold' do
      stub_request(:post, search_url).to_timeout
      allow(Rails.logger).to receive(:info).and_call_original

      outcome = service.screen(party)

      expect(outcome.decision).to eq(:error)
      expect(Rails.logger).to have_received(:info)
        .with(a_string_matching(/\[screening_audit\].*"screening_event":"screen\.error"/))
    end

    it 'never leaks the screened party name into the audit log' do
      stub_request(:post, search_url).to_return(status: 200, body: clean_body, headers: json_headers)
      allow(Rails.logger).to receive(:info).and_call_original

      service.screen(party) # party.name = 'Wayne Smith'

      expect(Rails.logger).not_to have_received(:info).with(a_string_matching(/screening_audit.*Wayne/))
    end
  end

  # SMP-1693 (gap C-125) -- the service's own fail-closed log line must not carry an exception message,
  # only the error CLASS: a client/transport exception can interpolate the vendor body (party name).
  describe '#screen -- SMP-1693 error log carries the class only, never the message' do
    it 'logs the error class but not a leaked exception message on a transport failure' do
      leaky = instance_double(ExportControl::Descartes::SearchEntityClient)
      allow(leaky).to receive(:search).and_raise(StandardError, 'boom for Wayne Smith at 1 Main St')
      svc = described_class.new(client: leaky)
      allow(Rails.logger).to receive(:error).and_call_original

      outcome = svc.screen(party)

      expect(outcome.decision).to eq(:error) # still fail-closed
      expect(Rails.logger).to have_received(:error).with(a_string_matching(/\[ScreeningService\] fail-closed/))
      expect(Rails.logger).not_to have_received(:error).with(a_string_matching(/Wayne|Main St/))
    end
  end

  # SMP-1695 (gap C-129) -- a persistence failure (Aurora failover, pool exhaustion, validation) on the
  # request-path gate must STILL leave durable evidence (an audit record) and STILL fail closed (deny).
  # Previously persist_and_decide ran outside any rescue: the request 500'd with NO hold, NO
  # screening_results row, and NO audit record -- the screen left no compliance evidence.
  describe '#screen -- SMP-1695 persistence failure still leaves evidence + fails closed' do
    before { stub_request(:post, search_url).to_return(status: 200, body: clean_body, headers: json_headers) }

    it 'emits a screen.persist_error audit line and denies (no allow, no leak) when create! raises' do
      allow(Rails.logger).to receive(:info).and_call_original
      allow(ScreeningResult).to receive(:create!)
        .and_raise(ActiveRecord::StatementInvalid, 'Lost connection to MySQL server')

      outcome = nil
      expect { outcome = service.screen(party) }
        .to(not_change(ScreeningResult, :count).and(not_change(Hold, :count)))

      # Fail-closed: :error -> SCREENING_PENDING -> deny. NEVER downgraded to an allow.
      expect(outcome.decision).to eq(:error)
      expect(outcome).not_to be_allowed
      expect(outcome.screening_result).to be_nil
      expect(outcome.hold).to be_nil
      expect(outcome.to_provider_result.result).to eq(ExportControlClearance::SCREENING_PENDING)

      # Durable EVIDENCE survives the DB failure: ScreeningAudit is log-based + inert-safe.
      expect(Rails.logger).to have_received(:info)
        .with(a_string_matching(/\[screening_audit\].*"screening_event":"screen\.persist_error"/))
    end

    it 'still fails closed with an audit record when the HOLD write raises on a hit' do
      stub_request(:post, search_url)
        .to_return(status: 200, body: hit_body(smaxalert: '_R', sdistributedid: 'd-1'), headers: json_headers)
      allow(Rails.logger).to receive(:info).and_call_original
      allow(Hold).to receive(:create!).and_raise(ActiveRecord::RecordNotUnique, 'deadlock')

      outcome = service.screen(party)

      expect(outcome.decision).to eq(:error)
      expect(outcome).not_to be_allowed
      expect(Rails.logger).to have_received(:info)
        .with(a_string_matching(/"screening_event":"screen\.persist_error"/))
    end

    it 'never leaks the screened party name when persistence fails' do
      allow(Rails.logger).to receive(:info).and_call_original
      allow(Rails.logger).to receive(:error).and_call_original
      allow(ScreeningResult).to receive(:create!).and_raise(ActiveRecord::RecordNotUnique, 'dup key')

      service.screen(party) # party.name = 'Wayne Smith'

      expect(Rails.logger).not_to have_received(:info).with(a_string_matching(/Wayne/))
      expect(Rails.logger).not_to have_received(:error).with(a_string_matching(/Wayne/))
    end
  end

  # ---- SMP-1684: ScreeningPolicy wiring (whitelist + screen-once cadence + hit-handling) ----
  describe '#screen -- policy short-circuits (SMP-1684)' do
    it 'ALLOWS a whitelisted subject with NO vendor call and NO screening_results row' do
      allow(ExportControl::ScreeningPolicy).to receive(:whitelisted?).and_return(true)
      outcome = nil
      expect { outcome = service.screen(party) }.not_to change(ScreeningResult, :count)
      expect(outcome).to be_allowed
      expect(a_request(:post, search_url)).not_to have_been_made
    end

    it 'SKIPS re-screen when a recent passing screen is within cadence and no hold is active' do
      create(:screening_result, subject_ref: 'User:42',
                                transstatus: ScreeningResult::TRANSSTATUS_PASSED, screened_at: 1.hour.ago)
      allow(ExportControl::ScreeningPolicy).to receive(:rescreen_due?).and_return(false)
      outcome = nil
      expect { outcome = service.screen(party) }.not_to change(ScreeningResult, :count)
      expect(outcome).to be_allowed
      expect(a_request(:post, search_url)).not_to have_been_made
    end

    it 're-screens (does NOT skip) when the subject has an active hold, even within cadence' do
      create(:screening_result, subject_ref: 'User:42',
                                transstatus: ScreeningResult::TRANSSTATUS_PASSED, screened_at: 1.hour.ago)
      create(:hold, :error, subject_ref: 'User:42')
      allow(ExportControl::ScreeningPolicy).to receive(:rescreen_due?).and_return(false)
      stub_request(:post, search_url).to_return(status: 200, body: clean_body, headers: json_headers)
      service.screen(party)
      expect(a_request(:post, search_url)).to have_been_made
    end

    it 'emits a report signal on a hit when hit_handling is "report" (never downgrades to allow)' do
      allow(ExportControl::ScreeningPolicy).to receive(:hit_handling)
        .and_return(ExportControl::ScreeningPolicy::HIT_REPORT)
      allow(ExportControl::ScreeningAudit).to receive(:record).and_call_original
      stub_request(:post, search_url)
        .to_return(status: 200, body: hit_body(smaxalert: '_R', sdistributedid: 'd-1'), headers: json_headers)
      outcome = service.screen(party)
      expect(outcome.decision).to eq(:held)
      expect(ExportControl::ScreeningAudit).to have_received(:record)
        .with('screen.hit_reported', hash_including(subject_ref: 'User:42'))
    end
  end

  # ---- SMP-1692: fail-closed error holds are releasable via re-screen (+ operator backstop rake) ----
  describe '#screen -- error-hold release (SMP-1692)' do
    it 'releases the subject active error holds when a re-screen comes back clean' do
      error_hold = create(:hold, :error, subject_ref: 'User:42')
      stub_request(:post, search_url).to_return(status: 200, body: clean_body, headers: json_headers)
      service.screen(party)
      expect(error_hold.reload).not_to be_active
      expect(error_hold.disposition).to eq(Hold::DISPOSITION_RELEASED)
    end

    it 'releases error holds for a whitelisted subject too' do
      error_hold = create(:hold, :error, subject_ref: 'User:42')
      allow(ExportControl::ScreeningPolicy).to receive(:whitelisted?).and_return(true)
      service.screen(party)
      expect(error_hold.reload).not_to be_active
    end

    it 'does NOT release a real screening_hit hold on a clean re-screen' do
      hit_hold = create(:hold, subject_ref: 'User:42') # default reason = screening_hit
      stub_request(:post, search_url).to_return(status: 200, body: clean_body, headers: json_headers)
      service.screen(party)
      expect(hit_hold.reload).to be_active
    end
  end
end
