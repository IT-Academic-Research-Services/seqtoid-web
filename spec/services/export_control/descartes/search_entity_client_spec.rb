require 'rails_helper'

# CZID-596 -- the Descartes SearchEntity REST/JSON client. Covers request shape, alert mapping, and the
# INERT-WHEN-UNSET guarantee (no endpoint/creds => ConfigurationError, no network call).
RSpec.describe ExportControl::Descartes::SearchEntityClient, type: :service do
  let(:search_url) { 'https://rpstest.example.test/RPS/RPSService.svc/SearchEntity' }
  let(:json_headers) { { 'Content-Type' => 'application/json;charset=UTF-8' } }
  let(:configured) do
    described_class::Config.new(endpoint: 'https://rpstest.example.test', secno: '12345',
                                password: 'secretpw', groups: '12')
  end
  let(:party) do
    ExportControl::ScreeningService::Subject.new(name: 'Wayne Smith', country: 'US', subject_ref: 'User:42')
  end

  # The circuit breaker is a process-wide singleton; reset it so failures in one example never leak.
  before { HttpResilience.reset! }

  describe 'inert when unset' do
    it 'is not configured and raises ConfigurationError WITHOUT any network call' do
      client = described_class.new(config: described_class::Config.new(endpoint: nil, secno: nil, password: nil))
      expect(client.configured?).to be(false)
      expect { client.search(party, soptionalid: '42') }.to raise_error(described_class::ConfigurationError)
      expect(a_request(:post, search_url)).not_to have_been_made
    end
  end

  describe 'TLS enforcement (SMP-1689 / gap C-107)' do
    it 'refuses a non-https endpoint fail-closed, with NO network call' do
      http_client = described_class.new(
        config: described_class::Config.new(endpoint: 'http://rpstest.example.test', secno: '1', password: 'p')
      )
      expect(http_client.configured?).to be(true) # it IS configured -- the point is we still refuse
      expect { http_client.search(party, soptionalid: '42') }
        .to raise_error(described_class::ConfigurationError, /must be https/)
      expect(a_request(:post, %r{rpstest\.example\.test}i)).not_to have_been_made
    end

    it 'refuses a malformed endpoint fail-closed' do
      bad = described_class.new(
        config: described_class::Config.new(endpoint: 'not a url', secno: '1', password: 'p')
      )
      expect { bad.search(party, soptionalid: '42') }
        .to raise_error(described_class::ConfigurationError, /must be https/)
    end

    it 'allows an https endpoint through to the network' do
      stub = stub_request(:post, search_url).to_return(
        status: 200, headers: json_headers,
        body: JSON.dump('transstatus' => 'Passed', 'smaxalert' => '',
                        'searches' => [{ 'nomatch' => '1', 'riskcountry' => '0', 'sdistributedid' => '' }])
      )
      described_class.new(config: configured).search(party, soptionalid: '42')
      expect(stub).to have_been_requested
    end
  end

  describe '#search request shape' do
    it 'POSTs the credentialed JSON sdoc envelope with our table-keyed soptionalid' do
      stub = stub_request(:post, search_url)
             .with do |req|
               body = JSON.parse(req.body)
               req.headers['Content-Type'] == 'application/json;charset=UTF-8' &&
                 body['ssecno'] == '12345' && body['spassword'] == 'secretpw' &&
                 body['searches'].first['soptionalid'] == '42' &&
                 body['searches'].first['sname'] == 'Wayne Smith'
             end
             .to_return(status: 200, headers: json_headers,
                        body: JSON.dump('transstatus' => 'Passed', 'smaxalert' => '',
                                        'searches' => [{ 'nomatch' => '1', 'riskcountry' => '0',
                                                         'results' => [], }]))

      described_class.new(config: configured).search(party, soptionalid: '42')
      expect(stub).to have_been_requested
    end
  end

  describe 'response parsing (alert mapping + transstatus)' do
    def parse_with(smaxalert:, transstatus:, extra_search: {})
      body = JSON.dump('transstatus' => transstatus, 'smaxalert' => smaxalert,
                       'searches' => [{ 'nomatch' => '0', 'riskcountry' => '1',
                                        'sdistributedid' => '999', }.merge(extra_search)])
      stub_request(:post, search_url).to_return(status: 200, body: body, headers: json_headers)
      described_class.new(config: configured).search(party, soptionalid: '42')
    end

    it 'maps smaxalert letters to normalized levels and carries transstatus/risk_country' do
      { '_Y' => ScreeningResult::ALERT_YELLOW, '_R' => ScreeningResult::ALERT_RED,
        'DR' => ScreeningResult::ALERT_DOUBLE_RED, 'TR' => ScreeningResult::ALERT_TRIPLE_RED,
        'WL' => ScreeningResult::ALERT_WL, 'AL' => ScreeningResult::ALERT_AL,
        'RC' => ScreeningResult::ALERT_NOMATCH, '' => ScreeningResult::ALERT_NOMATCH, }.each do |letter, level|
        res = parse_with(smaxalert: letter, transstatus: 'On Hold-RPS')
        expect(res.alert_level).to eq(level)
        expect(res.transstatus).to eq('On Hold-RPS')
        expect(res.risk_country).to eq(1)
      end
    end

    it 'flags errored? on a per-search nomatch == E' do
      body = JSON.dump('transstatus' => 'On Hold-RPS', 'smaxalert' => '',
                       'searches' => [{ 'nomatch' => 'E', 'errorstring' => 'REJECT: ...', 'results' => [] }])
      stub_request(:post, search_url).to_return(status: 200, body: body, headers: json_headers)
      expect(described_class.new(config: configured).search(party, soptionalid: '42')).to be_errored
    end

    it 'raises Error on a job-fatal credentials marker' do
      stub_request(:post, search_url)
        .to_return(status: 200, body: JSON.dump('errorstring' => 'ERROR: Invalid credentials.'),
                   headers: json_headers)
      expect { described_class.new(config: configured).search(party, soptionalid: '42') }
        .to raise_error(described_class::Error)
    end

    it 'raises Error on a non-200 status' do
      stub_request(:post, search_url).to_return(status: 500, body: 'oops')
      expect { described_class.new(config: configured).search(party, soptionalid: '42') }
        .to raise_error(StandardError)
    end

    # SMP-1693 (gap C-125): the vendor body carries the screened/matched party's name; a job-fatal
    # raise must surface only the fixed vendor MARKER, never the body (which lands verbatim in
    # logs/Sentry/Resque).
    it 'raises with the vendor marker ONLY -- never the party name -- on a job-fatal body' do
      body = JSON.dump(
        'transstatus' => 'On Hold-RPS',
        'searches' => [{ 'sname' => 'Wayne Smith', 'scompany' => 'ACME Munitions',
                         'saddress1' => '1 Main St', 'errorstring' => 'ERROR: Invalid credentials.' }]
      )
      stub_request(:post, search_url).to_return(status: 200, body: body, headers: json_headers)

      expect { described_class.new(config: configured).search(party, soptionalid: '42') }
        .to raise_error(described_class::Error) { |e|
          expect(e.message).to include('Invalid credentials')
          expect(e.message).not_to match(/Wayne|ACME|Main St/)
        }
    end

    it 'raises a body-free malformed error (no response fragment) on unparseable JSON' do
      # A malformed body that still embeds the party name -- JSON::ParserError#message would echo a
      # fragment of it, so the wrapped Error must carry only the error class, not the fragment.
      stub_request(:post, search_url)
        .to_return(status: 200, body: '{"searches":[{"sname":"Wayne Smith"', headers: json_headers)

      expect { described_class.new(config: configured).search(party, soptionalid: '42') }
        .to raise_error(described_class::Error) { |e|
          expect(e.message).to include('malformed SearchEntity response')
          expect(e.message).not_to match(/Wayne/)
        }
    end
  end
end
