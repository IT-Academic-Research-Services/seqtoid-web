require 'rails_helper'

# CZID-600 -- the export-control screening CONFIG/secrets surface. Proves every reader defaults to the
# conservative/fail-closed choice (so an un-provisioned env is inert) and that AppConfig/ENV values are
# read correctly: RPS group selection, the WL/AL whitelist allow-table, re-screen cadence, hit-handling
# policy, and the sandbox-vs-prod endpoint + secrets plumbing (no secret values in code).
RSpec.describe ExportControl::ScreeningPolicy do
  # Temporarily set ENV for a block without leaking to other examples.
  def with_env(vars)
    originals = {}
    vars.each { |k, v| originals[k] = ENV[k]; v.nil? ? ENV.delete(k) : (ENV[k] = v) }
    yield
  ensure
    originals.each { |k, v| v.nil? ? ENV.delete(k) : ENV[k] = v }
  end

  describe '.rps_groups (srpsgroupbypass selection)' do
    it 'defaults to "" (Descartes profile default) when unset' do
      expect(described_class.rps_groups).to eq('')
    end

    it 'maps counsel group NAMES to sorted numerals' do
      AppConfigHelper.set_app_config(AppConfig::EXPORT_CONTROL_RPS_GROUPS, 'Munitions, Export')
      expect(described_class.rps_groups).to eq('12')
    end

    it 'accepts raw numerals and pipe/space separators, de-duped and sorted' do
      AppConfigHelper.set_app_config(AppConfig::EXPORT_CONTROL_RPS_GROUPS, '2|1 1')
      expect(described_class.rps_groups).to eq('12')
    end

    it 'drops unknown/out-of-range tokens' do
      AppConfigHelper.set_app_config(AppConfig::EXPORT_CONTROL_RPS_GROUPS, 'Export, Bogus, 9')
      expect(described_class.rps_groups).to eq('1')
    end

    it 'falls back to the DESCARTES_RPS_GROUPS env var when the AppConfig key is unset' do
      with_env('DESCARTES_RPS_GROUPS' => 'export') do
        expect(described_class.rps_groups).to eq('1')
      end
    end
  end

  describe '.whitelist / .whitelisted? (WL/AL allow-table)' do
    it 'is empty by default -- nobody is auto-allowed (fail-closed)' do
      expect(described_class.whitelist).to eq([])
      expect(described_class.whitelisted?('User:42', 'a@ucsf.edu')).to be(false)
    end

    it 'matches an explicit subject_ref (case-insensitive)' do
      AppConfigHelper.set_app_config(AppConfig::EXPORT_CONTROL_SCREENING_WHITELIST, JSON.dump(['User:42']))
      expect(described_class.whitelisted?('user:42')).to be(true)
      expect(described_class.whitelisted?('User:99')).to be(false)
    end

    it 'matches by email domain, with or without the leading @' do
      AppConfigHelper.set_app_config(AppConfig::EXPORT_CONTROL_SCREENING_WHITELIST, JSON.dump(['ucsf.edu']))
      expect(described_class.whitelisted?('User:1', 'jane@ucsf.edu')).to be(true)
      expect(described_class.whitelisted?('User:1', 'jane@evil.test')).to be(false)
    end
  end

  describe '.rescreen_cadence_days / .rescreen_due?' do
    it 'defaults to 0 (always re-screen) when unset or non-positive' do
      expect(described_class.rescreen_cadence_days).to eq(0)
      AppConfigHelper.set_app_config(AppConfig::EXPORT_CONTROL_RESCREEN_CADENCE_DAYS, '-5')
      expect(described_class.rescreen_cadence_days).to eq(0)
      expect(described_class.rescreen_due?(Time.current)).to be(true)
    end

    it 'reads a positive cadence and computes due-ness against it' do
      AppConfigHelper.set_app_config(AppConfig::EXPORT_CONTROL_RESCREEN_CADENCE_DAYS, '30')
      expect(described_class.rescreen_cadence_days).to eq(30)
      expect(described_class.rescreen_due?(10.days.ago)).to be(false)
      expect(described_class.rescreen_due?(40.days.ago)).to be(true)
      expect(described_class.rescreen_due?(nil)).to be(true)
    end
  end

  describe '.hit_handling' do
    it 'defaults to "hold" (fail-closed) when unset or unknown' do
      expect(described_class.hit_handling).to eq(ExportControl::ScreeningPolicy::HIT_HOLD)
      AppConfigHelper.set_app_config(AppConfig::EXPORT_CONTROL_HIT_HANDLING, 'allow')
      expect(described_class.hit_handling).to eq(ExportControl::ScreeningPolicy::HIT_HOLD)
    end

    it 'reads the recognized policies' do
      AppConfigHelper.set_app_config(AppConfig::EXPORT_CONTROL_HIT_HANDLING, 'block')
      expect(described_class.hit_handling).to eq(ExportControl::ScreeningPolicy::HIT_BLOCK)
      AppConfigHelper.set_app_config(AppConfig::EXPORT_CONTROL_HIT_HANDLING, 'REPORT')
      expect(described_class.hit_handling).to eq(ExportControl::ScreeningPolicy::HIT_REPORT)
    end
  end

  describe '.endpoint / .client_config / .configured? (endpoint + secrets plumbing)' do
    it 'is nil / unconfigured by default so the client stays inert (no network)' do
      with_env('DESCARTES_RPS_ENDPOINT' => nil, 'DESCARTES_RPS_ENV' => nil,
               'DESCARTES_RPS_SECNO' => nil, 'DESCARTES_RPS_PASSWORD' => nil) do
        expect(described_class.endpoint).to be_nil
        expect(described_class.configured?).to be(false)
      end
    end

    it 'resolves the sandbox / production host from DESCARTES_RPS_ENV' do
      with_env('DESCARTES_RPS_ENDPOINT' => nil, 'DESCARTES_RPS_ENV' => 'sandbox') do
        expect(described_class.endpoint).to eq('https://rpstest.visualcompliance.com')
      end
      with_env('DESCARTES_RPS_ENDPOINT' => nil, 'DESCARTES_RPS_ENV' => 'production') do
        expect(described_class.endpoint).to eq('https://rps.visualcompliance.com')
      end
    end

    it 'lets an explicit DESCARTES_RPS_ENDPOINT override the env selection' do
      with_env('DESCARTES_RPS_ENDPOINT' => 'https://custom.example.test', 'DESCARTES_RPS_ENV' => 'sandbox') do
        expect(described_class.endpoint).to eq('https://custom.example.test')
      end
    end

    it 'assembles a configured client_config once endpoint + both credentials are present' do
      with_env('DESCARTES_RPS_ENV' => 'sandbox', 'DESCARTES_RPS_ENDPOINT' => nil,
               'DESCARTES_RPS_SECNO' => '12345', 'DESCARTES_RPS_PASSWORD' => 'secretpw') do
        AppConfigHelper.set_app_config(AppConfig::EXPORT_CONTROL_RPS_GROUPS, 'Export Munitions')
        cfg = described_class.client_config
        expect(cfg.configured?).to be(true)
        expect(cfg.endpoint).to eq('https://rpstest.visualcompliance.com')
        expect(cfg.groups).to eq('12')
        expect(described_class.configured?).to be(true)
      end
    end
  end

  describe '.sanctioned_country? / SANCTIONED_COUNTRIES (single source of truth)' do
    it 'is true for embargoed countries (case- and space-insensitive)' do
      expect(described_class.sanctioned_country?('IR')).to be(true)
      expect(described_class.sanctioned_country?(' ir ')).to be(true)
      expect(described_class.sanctioned_country?('RU')).to be(true)
    end

    it 'is false for non-embargoed, blank, and nil' do
      expect(described_class.sanctioned_country?('US')).to be(false)
      expect(described_class.sanctioned_country?('')).to be(false)
      expect(described_class.sanctioned_country?(nil)).to be(false)
    end

    it 'loads SANCTIONED_COUNTRIES from the vendored blocked-jurisdictions.json (the WAF source of truth)' do
      canonical = JSON.parse(
        File.read(Rails.root.join('config/export_control/blocked-jurisdictions.json'), encoding: 'UTF-8')
      ).fetch('blocked_country_codes').map { |c| c.to_s.strip.upcase }
      expect(described_class::SANCTIONED_COUNTRIES).to match_array(canonical)
      expect(described_class::SANCTIONED_COUNTRIES).not_to be_empty
    end
  end
end
