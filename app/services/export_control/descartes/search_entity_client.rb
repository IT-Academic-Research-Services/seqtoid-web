# frozen_string_literal: true

require 'net/http'
require 'uri'
require 'json'

# CZID-596 (Export-control Layer 3 / #285) -- REST/JSON client for Descartes Visual Compliance
# Restricted Party Screening (RPS) SearchEntity, the synchronous screen. This is integration code, not
# secrets: endpoints/param names/alert semantics come from the API design (workspace doc #595); the
# ssecno/spassword VALUES come from Chamber/SSM at runtime (never in the repo).
#
# INERT WHEN UNSET: with no endpoint/credentials configured, #search raises ConfigurationError and makes
# NO network call. Nothing here runs unless the caller (ScreeningService) is enabled behind its
# OFF-by-default flag AND the environment carries real credentials.
#
# FAIL-CLOSED: transport errors, non-200, malformed bodies, and job-fatal API error strings all RAISE.
# The ScreeningService turns any raise into a HOLD; this client never swallows an error into a "clean".
module ExportControl
  module Descartes
    class SearchEntityClient
      class Error < StandardError; end
      class ConfigurationError < Error; end

      # REST/JSON SearchEntity path appended to the configured base endpoint.
      SEARCH_PATH = '/RPS/RPSService.svc/SearchEntity'
      # Required __type marker on the request envelope (the RPSService URL namespace).
      REQUEST_TYPE = 'searchrequest:http://eim.visualcompliance.com/RPSService/2016/11'

      # Bounded timeouts -- a hung vendor must never wedge a request thread (see HttpResilience).
      OPEN_TIMEOUT = 4
      READ_TIMEOUT = 10

      # Map the Descartes smaxalert LETTER onto our normalized alert_level (severity detail). RC / empty /
      # unknown fall through to nomatch -- the actual release/hold decision is transstatus-primary, and a
      # risk-country condition is carried separately in risk_country, so this is safe.
      ALERT_LETTER_MAP = {
        'TR' => ScreeningResult::ALERT_TRIPLE_RED,
        'DR' => ScreeningResult::ALERT_DOUBLE_RED,
        '_R' => ScreeningResult::ALERT_RED,
        '_Y' => ScreeningResult::ALERT_YELLOW,
        'WL' => ScreeningResult::ALERT_WL,
        'AL' => ScreeningResult::ALERT_AL,
      }.freeze

      # Job-fatal API error strings (whole job fails). Any of these -> raise -> HOLD.
      JOB_FATAL_MARKERS = ['ERROR: Invalid credentials.', 'ERROR: Access to RPS Denied.',
                           'ERROR: Access to RPS Groups Denied.',].freeze

      # Parsed, provider-neutral view of one screen (single party). errored? drives the fail-closed HOLD.
      ParsedResponse = Struct.new(
        :transstatus, :alert_level, :risk_country, :sdistributedid, :list,
        :raw_ref, :errored, :error_detail,
        keyword_init: true
      ) do
        def errored?
          errored
        end
      end

      # Minimal env-sourced config. configured? is false until the endpoint + both credentials are set,
      # which is what keeps the whole client inert in an un-provisioned environment.
      Config = Struct.new(:endpoint, :secno, :password, :groups, :list_label, keyword_init: true) do
        def self.from_env
          new(
            endpoint: ENV['DESCARTES_RPS_ENDPOINT'],
            secno: ENV['DESCARTES_RPS_SECNO'],
            password: ENV['DESCARTES_RPS_PASSWORD'],
            groups: ENV['DESCARTES_RPS_GROUPS'],       # srpsgroupbypass; empty => profile default
            list_label: ENV['DESCARTES_RPS_LIST_LABEL'] # human label for the screening_results.list column
          )
        end

        def configured?
          endpoint.present? && secno.present? && password.present?
        end
      end

      def initialize(config: Config.from_env)
        @config = config
      end

      def configured?
        @config.configured?
      end

      # Screen a single subject. Returns a ParsedResponse. Raises ConfigurationError (no network) when
      # unset, or Error on any transport/protocol/parse failure.
      def search(subject, soptionalid:)
        raise ConfigurationError, 'Descartes RPS endpoint/credentials not configured' unless configured?

        enforce_https!(@config.endpoint)
        uri = URI.join(@config.endpoint, SEARCH_PATH)
        req = build_request(uri, subject, soptionalid)

        resp = HttpResilience.breaker(:descartes_rps).run do
          HttpResilience.request(req, uri, open_timeout: OPEN_TIMEOUT, read_timeout: READ_TIMEOUT)
        end
        raise Error, "unexpected HTTP status #{resp.code}" unless resp.code.to_s == '200'

        parse(JSON.parse(resp.body.to_s))
      rescue JSON::ParserError => e
        raise Error, "malformed SearchEntity response: #{e.message}"
      end

      private

      # SMP-1689 (gap C-107): enforce TLS at the boundary. The SearchEntity request carries the Descartes
      # credentials AND the screened party's real name (plus company/country on the diagnostic path) in
      # the request BODY, and HttpResilience retries up to 3x -- so a single non-https DESCARTES_RPS_ENDPOINT
      # would put a named individual's identity and the API credential on the wire in CLEARTEXT, up to three
      # times per screen. Fail CLOSED: refuse to transmit rather than downgrade. ScreeningService turns this
      # raise into a fail-closed HOLD, so a misconfigured endpoint denies access -- it never leaks.
      def enforce_https!(endpoint)
        scheme = begin
          URI(endpoint.to_s).scheme&.downcase
        rescue URI::InvalidURIError
          nil
        end
        return if scheme == 'https'

        raise ConfigurationError,
              "Descartes RPS endpoint must be https (got #{scheme.inspect}); refusing to transmit " \
              'credentials and screened-party identity over a non-TLS connection'
      end

      def build_request(uri, subject, soptionalid)
        req = Net::HTTP::Post.new(uri)
        req['Content-Type'] = 'application/json;charset=UTF-8'
        req['Accept'] = 'application/json;charset=UTF-8'
        req.body = JSON.dump(build_body(subject, soptionalid))
        req
      end

      # Build the sdoc -> searches JSON envelope. Credentials ride in the body (the API's scheme). Values
      # are pre-truncated to the audit-table field lengths so our stored record matches what was screened.
      def build_body(subject, soptionalid)
        {
          '__type' => REQUEST_TYPE,
          'sguid' => '',
          'stransid' => '',
          'ssecno' => @config.secno,
          'spassword' => @config.password,
          'smodes' => '',                          # empty => profile default (recommended)
          'srpsgroupbypass' => @config.groups.to_s, # empty => profile default list groups
          'searches' => [{
            'soptionalid' => soptionalid.to_s,       # table-keyed correlation id or "0" (never random)
            'sname' => truncate(subject.name, 100),
            'scompany' => truncate(subject.company, 100),
            'saddress1' => truncate(subject.address1, 100),
            'scity' => truncate(subject.city, 100),
            'sstate' => truncate(subject.state, 100),
            'szip' => truncate(subject.zip, 25),
            'scountry' => truncate(subject.country, 50),
          },],
        }
      end

      def parse(json)
        # Job-fatal errors can come back as the whole result or in a search errorstring -> fail-closed.
        raise Error, "SearchEntity job error: #{json}" if job_fatal?(json)

        searches = Array(json['searches'])
        first = searches.first || {}
        errored = searches.any? { |s| s['nomatch'].to_s == 'E' }

        ParsedResponse.new(
          transstatus: json['transstatus'],
          alert_level: map_alert(json['smaxalert']),
          risk_country: to_int(first['riskcountry']),
          sdistributedid: first['sdistributedid'].presence,
          list: extract_list(first),
          raw_ref: json['sguid'].presence,
          errored: errored,
          error_detail: first['errorstring'].presence
        )
      end

      def job_fatal?(json)
        blob = json.is_a?(String) ? json : json.to_s
        JOB_FATAL_MARKERS.any? { |m| blob.include?(m) }
      end

      def map_alert(smaxalert)
        ALERT_LETTER_MAP.fetch(smaxalert.to_s.strip, ScreeningResult::ALERT_NOMATCH)
      end

      # The government list name from the first match node, if any (evidence of what matched).
      def extract_list(search)
        results = Array(search['results'])
        results.first && results.first['list'].presence
      end

      def to_int(val)
        Integer(val.to_s, exception: false)
      end

      def truncate(val, max)
        val.to_s[0, max]
      end
    end
  end
end
