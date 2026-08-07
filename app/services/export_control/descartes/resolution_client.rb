# frozen_string_literal: true

require 'net/http'
require 'uri'
require 'nokogiri'

# CZID-598 (Export-control Layer 3 / #285) -- SOAP client for Descartes Visual Compliance
# IMTimeStampSearch, the RESOLUTION poll. IMTimeStampSearch is SOAP-only (SOAP 1.1); it returns the
# Incident Manager status changes recorded between a From and To UTC window so a human compliance
# officer's verdict can be pulled back into our system. This is the async other half of the two-phase
# model whose synchronous screen half is SearchEntityClient (CZID-596). See the API design doc (#595)
# Section 4 for the request/response schema and the IM lifecycle.
#
# INERT WHEN UNSET: with no endpoint/credentials configured, #poll raises ConfigurationError and makes
# NO network call. Nothing here runs unless the caller (the ResolveScreeningHolds Resque job) is enabled
# behind the OFF-by-default flag AND the environment carries real credentials.
#
# FAIL-CLOSED: transport errors, non-200, malformed bodies, and job-fatal API error strings all RAISE.
# The poller never RELEASES a hold on an error -- an un-parseable or errored reply leaves every hold in
# force. Only an explicit terminal-clear verdict releases.
module ExportControl
  module Descartes
    class ResolutionClient
      class Error < StandardError; end
      class ConfigurationError < Error; end

      # SOAP endpoint path appended to the configured base endpoint (both methods share the SOAP path).
      SOAP_PATH = '/RPS/RPSService.svc/SOAP'
      # XML namespace for the RPSService methods.
      NS = 'http://eim.visualcompliance.com/RPSService/2016/11'
      # SOAPAction for IMTimeStampSearch (SOAP 1.1 only; SOAP 1.2 is not supported).
      SOAP_ACTION = 'http://eim.visualcompliance.com/RPSService/2016/11/RPSService/IMTimeStampSearch'

      # sMode "1" == retrieve by Secno (the only supported mode today; 2/3 are future By-Company/Division).
      MODE_BY_SECNO = '1'

      # Timestamp format the API expects/returns: combined date+time in UTC, NO offset (per Section 4.1).
      TIME_FORMAT = '%Y-%m-%dT%H:%M:%S'

      # Sentinel the API returns inside <SHresults> when there are no status changes in the window.
      NO_STATUS_HISTORY = 'NO_STATUS_HISTORY'

      # Bounded timeouts -- a hung vendor must never wedge the poller (see HttpResilience).
      OPEN_TIMEOUT = 4
      READ_TIMEOUT = 15

      # Job-fatal API error strings (whole call fails) -> raise -> the poller keeps every hold in force.
      JOB_FATAL_MARKERS = [
        'ERROR: Invalid credentials.',
        'ERROR: Access to RPS Denied.',
        'ERROR: sTimeFrom cannot be empty when sTimeTo is passed.',
      ].freeze

      # One parsed Incident Manager status change (an <SHresult> node). shstatus drives the disposition;
      # shresult_id / shoptid are the correlation keys back to a screening_results row.
      Verdict = Struct.new(
        :shresult_id, :shstatus, :shoptid, :shrevdate,
        :shname, :shcompany, :shownersecno, :shrevsecno,
        keyword_init: true
      )

      # Minimal env-sourced config. configured? is false until the endpoint + both credentials are set,
      # which keeps the whole client inert in an un-provisioned environment. Same credential pair the
      # SearchEntity screen uses (both methods authenticate identically).
      Config = Struct.new(:endpoint, :secno, :password, keyword_init: true) do
        def self.from_env
          new(
            endpoint: ENV['DESCARTES_RPS_ENDPOINT'],
            secno: ENV['DESCARTES_RPS_SECNO'],
            password: ENV['DESCARTES_RPS_PASSWORD']
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

      # Poll the IM status-change window [time_from, time_to] (both Time, treated as UTC). Returns an
      # Array of Verdict (empty when the API reports NO_STATUS_HISTORY). Raises ConfigurationError (no
      # network) when unset, or Error on any transport/protocol/parse failure. optional_id, when given,
      # asks for the full status history of one specific audit transaction (ad-hoc lookup, Section 4.1).
      def poll(time_from:, time_to:, optional_id: nil)
        raise ConfigurationError, 'Descartes RPS endpoint/credentials not configured' unless configured?

        uri = URI.join(@config.endpoint, SOAP_PATH)
        req = build_request(uri, time_from, time_to, optional_id)

        resp = HttpResilience.breaker(:descartes_rps_resolution).run do
          HttpResilience.request(req, uri, open_timeout: OPEN_TIMEOUT, read_timeout: READ_TIMEOUT)
        end
        raise Error, "unexpected HTTP status #{resp.code}" unless resp.code.to_s == '200'

        parse(resp.body.to_s)
      end

      # Format a Time as the API's offset-less UTC ISO-8601 (public so the poller logs match the wire).
      def self.format_time(time)
        time.utc.strftime(TIME_FORMAT)
      end

      private

      def build_request(uri, time_from, time_to, optional_id)
        req = Net::HTTP::Post.new(uri)
        req['Content-Type'] = 'text/xml;charset=UTF-8'
        req['SOAPAction'] = %("#{SOAP_ACTION}")
        req.body = build_envelope(time_from, time_to, optional_id)
        req
      end

      # Build the SOAP 1.1 envelope. Credentials ride in the body (the API's scheme). Timestamps are UTC
      # with no offset. sMode is fixed to "1" (by Secno).
      def build_envelope(time_from, time_to, optional_id)
        from = time_from ? self.class.format_time(time_from) : ''
        to = time_to ? self.class.format_time(time_to) : ''
        <<~XML
          <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns="#{NS}">
            <soapenv:Header/>
            <soapenv:Body>
              <ns:IMTimeStampSearch>
                <ns:sSecno>#{xml_escape(@config.secno)}</ns:sSecno>
                <ns:sPassword>#{xml_escape(@config.password)}</ns:sPassword>
                <ns:sOptionalID>#{xml_escape(optional_id)}</ns:sOptionalID>
                <ns:sTimeFrom>#{from}</ns:sTimeFrom>
                <ns:sTimeTo>#{to}</ns:sTimeTo>
                <ns:sMode>#{MODE_BY_SECNO}</ns:sMode>
              </ns:IMTimeStampSearch>
            </soapenv:Body>
          </soapenv:Envelope>
        XML
      end

      # Parse the SOAP reply. The IMTimeStampSearchResult is an XML string (the <SH> document, often
      # wrapped in CDATA) carried inside the SOAP body. We locate the result text, guard the fatal
      # markers, then parse the inner <SH> tree into Verdicts.
      def parse(body)
        # SMP-1693: the SOAP body / inner <SH> document carries SHname/SHcompany for EVERY party in the
        # polling window. Raise with the matched vendor error MARKER only (a fixed vendor code -- no PII),
        # NEVER the body itself, so the message can safely reach logs/Sentry/the Resque failure record.
        if (marker = fatal_marker(body))
          raise Error, "IMTimeStampSearch job error: #{marker}"
        end

        inner = extract_result_xml(body)
        return [] if inner.nil? || inner.include?(NO_STATUS_HISTORY)

        # A fatal marker may only surface once the outer envelope is stripped.
        if (marker = fatal_marker(inner))
          raise Error, "IMTimeStampSearch job error: #{marker}"
        end

        doc = strict_xml(inner)
        doc.remove_namespaces!
        doc.xpath('//SHresult').map { |node| verdict_from(node) }
      rescue Nokogiri::XML::SyntaxError => e
        raise Error, "malformed IMTimeStampSearch response: #{e.message}"
      end

      # Parse strictly so a malformed reply RAISES (fail-closed HOLD) instead of Nokogiri's default
      # error-recovery silently yielding an empty tree that would look like "no verdicts".
      def strict_xml(str)
        Nokogiri::XML(str) { |cfg| cfg.strict }
      end

      # Pull the inner <SH> result document out of the SOAP envelope. Nokogiri collapses the CDATA into
      # the element text, so reading the *IMTimeStampSearchResult text is enough; we fall back to the raw
      # body when the reply is already the bare <SH> document (as our mock returns it).
      def extract_result_xml(body)
        doc = strict_xml(body)
        doc.remove_namespaces!
        node = doc.at_xpath('//IMTimeStampSearchResult')
        text = node&.text
        return text if text.present?

        body.include?('<SH') || body.include?(NO_STATUS_HISTORY) ? body : text
      end

      def verdict_from(node)
        Verdict.new(
          shresult_id: node['id'].presence,
          shstatus: text_at(node, 'SHstatus'),
          shoptid: text_at(node, 'SHoptid'),
          shrevdate: text_at(node, 'SHrevdate'),
          shname: text_at(node, 'SHname'),
          shcompany: text_at(node, 'SHcompany'),
          shownersecno: text_at(node, 'SHownersecno'),
          shrevsecno: text_at(node, 'SHrevsecno')
        )
      end

      def text_at(node, tag)
        child = node.at_xpath("./#{tag}")
        child&.text.to_s.strip.presence
      end

      # The first job-fatal marker present in the (stringified) blob, or nil. Returning the matched
      # marker -- not the whole blob -- is what lets the raise carry a safe, PII-free identifier.
      def fatal_marker(blob)
        JOB_FATAL_MARKERS.find { |m| blob.to_s.include?(m) }
      end

      def job_fatal?(blob)
        !fatal_marker(blob).nil?
      end

      def xml_escape(val)
        val.to_s.gsub('&', '&amp;').gsub('<', '&lt;').gsub('>', '&gt;')
      end
    end
  end
end
