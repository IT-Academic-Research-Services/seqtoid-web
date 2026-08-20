# frozen_string_literal: true

require 'json'

# CZID-601 -- a creds-free, stateful test double for the Descartes Visual Compliance RPS web service,
# covering BOTH methods the integration uses: SearchEntity (REST/JSON screen, CZID-596) and
# IMTimeStampSearch (SOAP resolution poll, CZID-598). It lets the FULL two-phase flow run end-to-end
# without the live sandbox: screen -> hit (transstatus "On Hold-RPS") -> the mock records an Incident
# Manager record (status "DS New") -> a test can adjudicate it (as a human compliance officer would in
# IM) -> the poll returns the verdict -> release / keep-held.
#
# It is WebMock-shaped: install! registers stubs for the two endpoints against a fake host; the real
# SearchEntityClient / ResolutionClient talk to it over HTTP exactly as they would the sandbox. Response
# bodies are shaped from the API design doc (#595) Sections 3.6 and 4.2. NO credentials required.
class DescartesMockServer
  ENDPOINT = 'https://rpstest.mock.test'
  SEARCH_PATH = '/RPS/RPSService.svc/SearchEntity'
  SOAP_PATH = '/RPS/RPSService.svc/SOAP'
  NS = 'http://eim.visualcompliance.com/RPSService/2016/11'

  # One Incident Manager audit record the mock is tracking (created on a hit; adjudicated by a test).
  IMRecord = Struct.new(:sdistributedid, :status, :optid, :name, :company, keyword_init: true)

  def initialize(endpoint: ENDPOINT)
    @endpoint = endpoint
    @hit_rules = {}    # match key -> { smaxalert:, list: }
    @im_records = {}   # sdistributedid -> IMRecord
    @seq = 0
  end

  # Credentialed configs the real clients use to reach the mock (mock creds -- never real).
  def search_config
    ExportControl::Descartes::SearchEntityClient::Config.new(
      endpoint: @endpoint, secno: 'MOCK1', password: 'mockpw', groups: '12', list_label: 'Export+Munitions'
    )
  end

  def resolution_config
    ExportControl::Descartes::ResolutionClient::Config.new(
      endpoint: @endpoint, secno: 'MOCK1', password: 'mockpw'
    )
  end

  def search_client
    ExportControl::Descartes::SearchEntityClient.new(config: search_config)
  end

  def resolution_client
    ExportControl::Descartes::ResolutionClient.new(config: resolution_config)
  end

  # Program a party (by name or company) that will HIT with the given alert level, mirroring a real
  # restricted-party match. Unregistered parties screen CLEAN (Passed / nomatch).
  def register_hit(name: nil, company: nil, smaxalert: '_R', list: 'AECA Debarred Parties [DDTC]')
    @hit_rules[match_key(name, company)] = { smaxalert: smaxalert, list: list }
    self
  end

  # Simulate a compliance officer recording a verdict in Incident Manager. Advances the IM record so the
  # next poll returns the new status.
  def adjudicate(sdistributedid, status)
    rec = @im_records[sdistributedid]
    raise "no IM record for #{sdistributedid.inspect}" if rec.nil?

    rec.status = status
    self
  end

  # The sdistributedid minted for the (single) IM record created from screening the given party, so a
  # test can adjudicate it. Nil until that party has been screened and hit.
  def incident_id_for(name: nil, company: nil)
    key = match_key(name, company)
    rec = @im_records.values.find { |r| r.name == key || r.company == key }
    rec&.sdistributedid
  end

  # Install the WebMock stubs for both endpoints. Call inside an example (WebMock is per-example).
  def install!
    stub_search_entity
    stub_im_timestamp_search
    self
  end

  private

  def stub_search_entity
    WebMock.stub_request(:post, "#{@endpoint}#{SEARCH_PATH}").to_return do |request|
      body = JSON.parse(request.body)
      search = Array(body['searches']).first || {}
      { status: 200, headers: json_headers, body: search_response(search) }
    end
  end

  def stub_im_timestamp_search
    WebMock.stub_request(:post, "#{@endpoint}#{SOAP_PATH}").to_return do |_request|
      { status: 200, headers: xml_headers, body: soap_envelope(sh_document) }
    end
  end

  # Build a SearchEntity response for one input search. A registered hit -> On Hold-RPS + a result node
  # + a new IM record (DS New). Otherwise -> Passed / nomatch.
  def search_response(search)
    name = search['sname'].to_s
    company = search['scompany'].to_s
    optid = search['soptionalid'].to_s
    rule = @hit_rules[match_key(name, nil)] || @hit_rules[match_key(nil, company)]

    return clean_body if rule.nil?

    sdistributedid = mint_incident(name: name, company: company, optid: optid)
    hit_body(search: search, smaxalert: rule[:smaxalert], list: rule[:list], sdistributedid: sdistributedid)
  end

  def mint_incident(name:, company:, optid:)
    @seq += 1
    sdistributedid = "MOCKDIST#{format('%03d', @seq)}"
    @im_records[sdistributedid] = IMRecord.new(
      sdistributedid: sdistributedid, status: 'DS New', optid: optid,
      name: match_key(name, nil), company: match_key(nil, company)
    )
    sdistributedid
  end

  def clean_body
    JSON.dump(
      'transstatus' => 'Passed', 'smaxalert' => '', 'sguid' => 'mock-clean',
      'searches' => [{ 'nomatch' => '1', 'riskcountry' => '0', 'sdistributedid' => '', 'results' => [] }]
    )
  end

  def hit_body(search:, smaxalert:, list:, sdistributedid:)
    JSON.dump(
      'transstatus' => 'On Hold-RPS', 'smaxalert' => smaxalert, 'sguid' => 'mock-hit',
      'searches' => [{
        # riskcountry 0: a pure NAME-match hit. The sanctioned-jurisdiction path (riskcountry >= 1 or an
        # embargoed subject country) takes precedence and uses REASON_SANCTIONED_JURISDICTION, so it is
        # exercised with its own fixtures rather than piggy-backing on every name-match mock hit.
        'soptionalid' => search['soptionalid'], 'scountry' => search['scountry'],
        'riskcountry' => '0', 'nomatch' => '0', 'sdistributedid' => sdistributedid,
        'results' => [{
          'dp_id' => 'DBP000063', 'list' => list, 'name' => (search['sname'].presence || search['scompany']),
          'alerttype' => smaxalert,
        }],
      }]
    )
  end

  # The inner <SH> document listing every IM record's CURRENT status (the mock ignores the poll window
  # and returns all records; the poller is idempotent so re-seeing a record is harmless).
  def sh_document
    return "<SH><SHresults>NO_STATUS_HISTORY</SHresults></SH>" if @im_records.empty?

    nodes = @im_records.values.map { |rec| sh_result(rec) }.join
    "<SH><SHtime><SHtimeFrom></SHtimeFrom><SHtimeTo></SHtimeTo></SHtime><SHresults>#{nodes}</SHresults></SH>"
  end

  def sh_result(rec)
    "<SHresult id=\"#{rec.sdistributedid}\">" \
      "<SHrevsecno>MOCK1</SHrevsecno><SHownersecno>MOCK1</SHownersecno>" \
      "<SHrevlogin>MOCKREV</SHrevlogin><SHrevdiv>MOCK</SHrevdiv>" \
      "<SHstatus>#{rec.status}</SHstatus><SHrevdate>07-09-2026 12:00:00</SHrevdate>" \
      "<SHname>#{rec.name}</SHname><SHcompany>#{rec.company}</SHcompany>" \
      "<SHoptid>#{rec.optid}</SHoptid></SHresult>"
  end

  # Wrap the inner <SH> string as the CDATA IMTimeStampSearchResult in a SOAP envelope (as the real API
  # returns it -- exercises the client's CDATA-extraction path).
  def soap_envelope(inner)
    "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\"><s:Body>" \
      "<IMTimeStampSearchResponse xmlns=\"#{NS}\">" \
      "<IMTimeStampSearchResult><![CDATA[#{inner}]]></IMTimeStampSearchResult>" \
      "</IMTimeStampSearchResponse></s:Body></s:Envelope>"
  end

  def match_key(name, company)
    (name.presence || company).to_s.strip.downcase
  end

  def json_headers
    { 'Content-Type' => 'application/json;charset=UTF-8' }
  end

  def xml_headers
    { 'Content-Type' => 'text/xml;charset=UTF-8' }
  end
end
