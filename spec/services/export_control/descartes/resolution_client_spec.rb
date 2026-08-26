require 'rails_helper'

# CZID-598 -- the Descartes IMTimeStampSearch (resolution) SOAP client. Covers request shape (SOAP 1.1
# envelope + SOAPAction + UTC window), response parsing (the <SH>/<SHresult> stream, CDATA-wrapped and
# bare), the NO_STATUS_HISTORY empty case, fail-closed fatal markers, and the INERT-WHEN-UNSET guarantee.
RSpec.describe ExportControl::Descartes::ResolutionClient, type: :service do
  let(:soap_url) { 'https://rpstest.example.test/RPS/RPSService.svc/SOAP' }
  let(:xml_headers) { { 'Content-Type' => 'text/xml;charset=UTF-8' } }
  let(:configured) do
    described_class::Config.new(endpoint: 'https://rpstest.example.test', secno: '12345', password: 'secretpw')
  end
  let(:time_from) { Time.utc(2018, 7, 24, 0, 0, 0) }
  let(:time_to) { Time.utc(2018, 7, 25, 14, 19, 11) }

  before { HttpResilience.reset! }

  # A bare <SH> result document (our mock returns it un-wrapped; the client also handles CDATA-wrapped).
  def sh_document(results_xml)
    <<~XML
      <SH><SHtime><SHtimeFrom>2018-07-24T00:00:00</SHtimeFrom><SHtimeTo>2018-07-25T14:19:11</SHtimeTo></SHtime>
      <SHresults>#{results_xml}</SHresults></SH>
    XML
  end

  def sh_result(id:, status:, optid: '', name: '', company: '')
    <<~XML
      <SHresult id="#{id}"><SHrevsecno>06G8M</SHrevsecno><SHownersecno>06G8M</SHownersecno>
      <SHrevlogin>EXT0011</SHrevlogin><SHrevdiv>RPS TESTING</SHrevdiv><SHstatus>#{status}</SHstatus>
      <SHrevdate>07-24-2018 17:39:06</SHrevdate><SHname>#{name}</SHname><SHcompany>#{company}</SHcompany>
      <SHoptid>#{optid}</SHoptid></SHresult>
    XML
  end

  # The client's own extract path also handles the true SOAP envelope where the <SH> doc is CDATA text
  # inside IMTimeStampSearchResult.
  def soap_envelope(inner)
    <<~XML
      <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>
      <IMTimeStampSearchResponse xmlns="http://eim.visualcompliance.com/RPSService/2016/11">
      <IMTimeStampSearchResult><![CDATA[#{inner}]]></IMTimeStampSearchResult>
      </IMTimeStampSearchResponse></s:Body></s:Envelope>
    XML
  end

  describe 'inert when unset' do
    it 'is not configured and raises ConfigurationError WITHOUT any network call' do
      client = described_class.new(config: described_class::Config.new(endpoint: nil, secno: nil, password: nil))
      expect(client.configured?).to be(false)
      expect { client.poll(time_from: time_from, time_to: time_to) }
        .to raise_error(described_class::ConfigurationError)
      expect(a_request(:post, soap_url)).not_to have_been_made
    end
  end

  describe '#poll request shape' do
    it 'POSTs a SOAP 1.1 envelope with the SOAPAction, credentials, sMode=1, and the UTC window' do
      stub = stub_request(:post, soap_url)
             .with do |req|
               req.headers['Soapaction'] == '"http://eim.visualcompliance.com/RPSService/2016/11/RPSService/IMTimeStampSearch"' &&
                 req.headers['Content-Type'] == 'text/xml;charset=UTF-8' &&
                 req.body.include?('<ns:sSecno>12345</ns:sSecno>') &&
                 req.body.include?('<ns:sPassword>secretpw</ns:sPassword>') &&
                 req.body.include?('<ns:sMode>1</ns:sMode>') &&
                 req.body.include?('<ns:sTimeFrom>2018-07-24T00:00:00</ns:sTimeFrom>') &&
                 req.body.include?('<ns:sTimeTo>2018-07-25T14:19:11</ns:sTimeTo>')
             end
             .to_return(status: 200, headers: xml_headers, body: sh_document('NO_STATUS_HISTORY'))

      described_class.new(config: configured).poll(time_from: time_from, time_to: time_to)
      expect(stub).to have_been_requested
    end

    it 'formats a Time as offset-less UTC ISO-8601' do
      expect(described_class.format_time(Time.utc(2016, 3, 11, 3, 45, 40))).to eq('2016-03-11T03:45:40')
    end
  end

  describe 'response parsing' do
    it 'returns an empty array on NO_STATUS_HISTORY' do
      stub_request(:post, soap_url).to_return(status: 200, headers: xml_headers,
                                              body: sh_document('NO_STATUS_HISTORY'))
      expect(described_class.new(config: configured).poll(time_from: time_from, time_to: time_to)).to eq([])
    end

    it 'parses a bare <SH> stream into verdicts (id, status, optid, name/company)' do
      body = sh_document(sh_result(id: '267063362374320', status: 'Cleared', optid: '42',
                                   name: '', company: 'Winston'))
      stub_request(:post, soap_url).to_return(status: 200, headers: xml_headers, body: body)

      verdicts = described_class.new(config: configured).poll(time_from: time_from, time_to: time_to)
      expect(verdicts.size).to eq(1)
      v = verdicts.first
      expect(v.shresult_id).to eq('267063362374320')
      expect(v.shstatus).to eq('Cleared')
      expect(v.shoptid).to eq('42')
      expect(v.shcompany).to eq('Winston')
    end

    it 'parses the CDATA-wrapped result inside a real SOAP envelope' do
      inner = sh_document(sh_result(id: '999', status: 'True Hit', optid: '7'))
      stub_request(:post, soap_url).to_return(status: 200, headers: xml_headers, body: soap_envelope(inner))

      verdicts = described_class.new(config: configured).poll(time_from: time_from, time_to: time_to)
      expect(verdicts.map(&:shstatus)).to eq(['True Hit'])
      expect(verdicts.first.shresult_id).to eq('999')
    end

    it 'parses multiple SHresult nodes' do
      body = sh_document(sh_result(id: '1', status: 'Cleared', optid: '10') +
                         sh_result(id: '2', status: 'DS New', optid: '11'))
      stub_request(:post, soap_url).to_return(status: 200, headers: xml_headers, body: body)
      verdicts = described_class.new(config: configured).poll(time_from: time_from, time_to: time_to)
      expect(verdicts.map(&:shresult_id)).to eq(['1', '2'])
    end
  end

  describe 'fail-closed error handling' do
    it 'raises Error on a job-fatal credentials marker' do
      stub_request(:post, soap_url).to_return(status: 200, headers: xml_headers,
                                              body: 'ERROR: Invalid credentials.')
      expect { described_class.new(config: configured).poll(time_from: time_from, time_to: time_to) }
        .to raise_error(described_class::Error)
    end

    it 'raises Error on the sTimeFrom-empty fatal marker' do
      stub_request(:post, soap_url).to_return(
        status: 200, headers: xml_headers,
        body: 'ERROR: sTimeFrom cannot be empty when sTimeTo is passed.'
      )
      expect { described_class.new(config: configured).poll(time_from: time_from, time_to: time_to) }
        .to raise_error(described_class::Error)
    end

    it 'raises Error on a non-200 status' do
      stub_request(:post, soap_url).to_return(status: 500, body: 'oops')
      expect { described_class.new(config: configured).poll(time_from: time_from, time_to: time_to) }
        .to raise_error(StandardError)
    end

    it 'raises Error on a malformed body' do
      stub_request(:post, soap_url).to_return(status: 200, headers: xml_headers, body: '<SH><unterminated')
      expect { described_class.new(config: configured).poll(time_from: time_from, time_to: time_to) }
        .to raise_error(described_class::Error)
    end

    # SMP-1693 completeness (gap C-125): a malformed body still carries party identity, and a parser
    # error message can quote the offending markup. The parse-failure raise must NOT leak SHname/SHcompany.
    it 'raises on a malformed body WITHOUT leaking any party name -- parse-error path' do
      malformed = '<SH><SHresult><SHname>Wayne Smith</SHname><SHcompany>ACME</SHcompany></SHresult><unterminated'
      stub_request(:post, soap_url).to_return(status: 200, headers: xml_headers, body: malformed)
      expect { described_class.new(config: configured).poll(time_from: time_from, time_to: time_to) }
        .to raise_error(described_class::Error) { |e|
          expect(e.message).not_to match(/Wayne|ACME/)
        }
    end

    # SMP-1693 (gap C-125): the SOAP body carries SHname/SHcompany for EVERY party in the polling
    # window. A job-fatal raise must surface only the fixed vendor MARKER, never the body -- otherwise
    # every party in the window leaks into the log/Sentry/Resque failure record.
    it 'raises with the vendor marker ONLY -- never any party name -- on a job-fatal body' do
      body = "#{sh_document(sh_result(id: '1', status: 'Cleared', name: 'Wayne Smith', company: 'ACME'))}" \
             'ERROR: Access to RPS Denied.'
      stub_request(:post, soap_url).to_return(status: 200, headers: xml_headers, body: body)

      expect { described_class.new(config: configured).poll(time_from: time_from, time_to: time_to) }
        .to raise_error(described_class::Error) { |e|
          expect(e.message).to include('Access to RPS Denied')
          expect(e.message).not_to match(/Wayne|ACME/)
        }
    end
  end
end
