require 'rails_helper'
require_relative '../../support/descartes_mock_server'

# CZID-601 / SMP-1688 -- the export_control:vc:test_screen operator diagnostic. Proves:
#   * the OFF-by-default flag gate: REFUSES to transmit (no client, no network) unless
#     AppConfig::ENABLE_DESCARTES_SCREENING == '1' (SMP-1688 (a));
#   * the explicit CONFIRM=1 operator confirmation gate (SMP-1688 (b));
#   * the creds-free NO-OP when the Descartes RPS environment is unset;
#   * a clean run against the DescartesMockServer when flag+creds+confirm are all satisfied -- WITHOUT
#     writing any DB rows (the task calls the client directly);
#   * an ExportControl::ScreeningAudit.record('screen.connectivity_check', ...) is emitted for every
#     invocation, identifiers only (SMP-1688 (c)).
describe 'export_control:vc:test_screen' do
  let(:task) { Rake::Task['export_control:vc:test_screen'] }

  before do
    HttpResilience.reset!
    allow(ExportControl::ScreeningAudit).to receive(:record).and_call_original
  end
  after do
    task.reenable
    ENV.delete('CONFIRM')
  end

  def run(*args)
    out = StringIO.new
    orig = $stdout
    $stdout = out
    task.invoke(*args)
    out.string
  ensure
    $stdout = orig
  end

  def enable_flag!
    AppConfigHelper.set_app_config(AppConfig::ENABLE_DESCARTES_SCREENING, '1')
  end

  describe 'flag OFF (default) -- SMP-1688 (a)' do
    it 'REFUSES to transmit, builds no client, makes NO network call, writes no rows, and audits' do
      spy_config = class_spy(ExportControl::Descartes::SearchEntityClient::Config)
      stub_const('ExportControl::Descartes::SearchEntityClient::Config', spy_config)

      output = nil
      expect { output = run('Wayne Smith', '', 'US') }
        .to change(ScreeningResult, :count).by(0).and(change(Hold, :count).by(0))
      expect(output).to include('REFUSED')
      expect(WebMock).not_to have_requested(:post, /.*/)
      # Flag-off refuses BEFORE reading Descartes config -- proves no client path is entered.
      expect(spy_config).not_to have_received(:from_env)
      expect(ExportControl::ScreeningAudit)
        .to have_received(:record).with('screen.connectivity_check', hash_including(decision: 'refused_flag_off'))
    end
  end

  describe 'flag ON but unset environment (no credentials)' do
    before do
      enable_flag!
      allow(ExportControl::Descartes::SearchEntityClient::Config).to receive(:from_env).and_return(
        ExportControl::Descartes::SearchEntityClient::Config.new(endpoint: nil, secno: nil, password: nil)
      )
    end

    it 'SKIPS with a clear message and makes NO network call, writing no rows' do
      output = nil
      expect { output = run('Wayne Smith', '', 'US') }
        .to change(ScreeningResult, :count).by(0).and(change(Hold, :count).by(0))
      expect(output).to include('SKIPPED')
      expect(WebMock).not_to have_requested(:post, /.*/)
      expect(ExportControl::ScreeningAudit)
        .to have_received(:record).with('screen.connectivity_check', hash_including(decision: 'skipped_unconfigured'))
    end
  end

  describe 'flag ON, configured, but NOT confirmed -- SMP-1688 (b)' do
    let(:mock) { DescartesMockServer.new }

    before do
      enable_flag!
      allow(ExportControl::Descartes::SearchEntityClient::Config).to receive(:from_env)
        .and_return(mock.search_config)
    end

    it 'REFUSES without CONFIRM=1, makes NO network call, and audits' do
      output = run('Wayne Smith', '', 'US')
      expect(output).to include('REFUSED')
      expect(output).to include('CONFIRM=1')
      expect(WebMock).not_to have_requested(:post, /.*/)
      expect(ExportControl::ScreeningAudit)
        .to have_received(:record).with('screen.connectivity_check', hash_including(decision: 'unconfirmed'))
    end
  end

  describe 'flag ON, configured, CONFIRM=1 (against the mock)' do
    let(:mock) { DescartesMockServer.new }

    before do
      enable_flag!
      ENV['CONFIRM'] = '1'
      allow(ExportControl::Descartes::SearchEntityClient::Config).to receive(:from_env)
        .and_return(mock.search_config)
      mock.register_hit(name: 'Wayne Smith', smaxalert: '_R').install!
    end

    it 'runs a single screen, reports the parsed hit, persists NOTHING, and audits the decision' do
      output = nil
      expect { output = run('Wayne Smith', '', 'US') }
        .to change(ScreeningResult, :count).by(0).and(change(Hold, :count).by(0))
      expect(output).to include('transstatus')
      expect(output).to include('On Hold-RPS').or include('would HOLD')
      expect(output).to include('MOCKDIST001') # the sdistributedid poll-correlation key
      # A pre-transmission marker AND the final decision are both audited (identifiers only).
      expect(ExportControl::ScreeningAudit)
        .to have_received(:record).with('screen.connectivity_check', hash_including(decision: 'transmit'))
      expect(ExportControl::ScreeningAudit)
        .to have_received(:record).with('screen.connectivity_check', hash_including(decision: 'held'))
    end
  end

  describe 'flag ON, configured, CONFIRM=1, no subject provided' do
    before do
      enable_flag!
      ENV['CONFIRM'] = '1'
      allow(ExportControl::Descartes::SearchEntityClient::Config).to receive(:from_env)
        .and_return(DescartesMockServer.new.search_config)
    end

    it 'errors clearly, screens nothing, and audits' do
      expect(run('', '', '')).to include('provide a name or company')
      expect(WebMock).not_to have_requested(:post, /.*/)
      expect(ExportControl::ScreeningAudit)
        .to have_received(:record).with('screen.connectivity_check', hash_including(decision: 'no_subject'))
    end
  end
end
