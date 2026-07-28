# frozen_string_literal: true

require "rails_helper"

# Coverage Wave: branch sweep for ExportControl::Descartes::ResolutionClient.
# The main spec (resolution_client_spec.rb) always polls with BOTH timestamps set,
# always gets a well-formed <SH> document back, and always sees fully-populated
# <SHresult> nodes. This spec drives the untaken arms:
#
#   - build_envelope: the `time_from ? ... : ''` and `time_to ? ... : ''` else arms
#   - extract_result_xml: the final ternary's else arm (no IMTimeStampSearchResult
#     node, no '<SH', no NO_STATUS_HISTORY -> falls through to the nil text)
#   - parse: the post-extraction job_fatal? raise (a marker that only becomes
#     visible once character references in the SOAP body are decoded)
#   - text_at: the `child&.text` nil-receiver arm (a <SHresult> missing a child tag)
#     and verdict_from's `node['id'].presence` nil arm
#
# No network is touched: every example calls the pure request/response helpers.
RSpec.describe ExportControl::Descartes::ResolutionClient, type: :service do
  let(:configured) do
    described_class::Config.new(endpoint: "https://rpstest.example.test", secno: "12345", password: "secretpw")
  end
  let(:client) { described_class.new(config: configured) }

  describe "Config#configured?" do
    it "is true only when endpoint, secno AND password are all present" do
      expect(configured.configured?).to be(true)
    end

    it "is false when the endpoint is blank (first operand of the &&-chain)" do
      cfg = described_class::Config.new(endpoint: nil, secno: "1", password: "p")
      expect(cfg.configured?).to be(false)
    end

    it "is false when the secno is blank (second operand of the &&-chain)" do
      cfg = described_class::Config.new(endpoint: "https://x.test", secno: nil, password: "p")
      expect(cfg.configured?).to be(false)
    end

    it "is false when the password is blank (third operand of the &&-chain)" do
      cfg = described_class::Config.new(endpoint: "https://x.test", secno: "1", password: nil)
      expect(cfg.configured?).to be(false)
    end
  end

  describe "#poll configuration guard" do
    it "raises ConfigurationError and makes no network call when unconfigured" do
      unconfigured = described_class.new(config: described_class::Config.new(endpoint: nil, secno: nil, password: nil))
      expect(HttpResilience).not_to receive(:breaker)
      expect { unconfigured.poll(time_from: Time.utc(2018, 1, 1), time_to: Time.utc(2018, 1, 2)) }
        .to raise_error(described_class::ConfigurationError, /not configured/)
    end
  end

  describe "#build_envelope timestamp ternaries" do
    it "formats both timestamps as offset-less UTC when both are given (the then arms)" do
      xml = client.send(:build_envelope, Time.utc(2018, 7, 24, 0, 0, 0), Time.utc(2018, 7, 25, 14, 19, 11), nil)
      expect(xml).to include("<ns:sTimeFrom>2018-07-24T00:00:00</ns:sTimeFrom>")
      expect(xml).to include("<ns:sTimeTo>2018-07-25T14:19:11</ns:sTimeTo>")
    end

    it "emits an empty sTimeFrom when time_from is nil (the else arm)" do
      xml = client.send(:build_envelope, nil, Time.utc(2018, 7, 25, 14, 19, 11), nil)
      expect(xml).to include("<ns:sTimeFrom></ns:sTimeFrom>")
      expect(xml).to include("<ns:sTimeTo>2018-07-25T14:19:11</ns:sTimeTo>")
    end

    it "emits an empty sTimeTo when time_to is nil (the else arm)" do
      xml = client.send(:build_envelope, Time.utc(2018, 7, 24, 0, 0, 0), nil, nil)
      expect(xml).to include("<ns:sTimeFrom>2018-07-24T00:00:00</ns:sTimeFrom>")
      expect(xml).to include("<ns:sTimeTo></ns:sTimeTo>")
    end

    it "xml-escapes the optional id and the credentials" do
      cfg = described_class::Config.new(endpoint: "https://x.test", secno: "a&b", password: "p<q")
      xml = described_class.new(config: cfg).send(:build_envelope, nil, nil, "id>1")
      expect(xml).to include("<ns:sSecno>a&amp;b</ns:sSecno>")
      expect(xml).to include("<ns:sPassword>p&lt;q</ns:sPassword>")
      expect(xml).to include("<ns:sOptionalID>id&gt;1</ns:sOptionalID>")
    end
  end

  describe "#extract_result_xml fallbacks" do
    it "returns the IMTimeStampSearchResult text when the node is present (the present? arm)" do
      body = <<~XML
        <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>
        <IMTimeStampSearchResponse xmlns="http://eim.visualcompliance.com/RPSService/2016/11">
        <IMTimeStampSearchResult><![CDATA[<SH><SHresults/></SH>]]></IMTimeStampSearchResult>
        </IMTimeStampSearchResponse></s:Body></s:Envelope>
      XML
      expect(client.send(:extract_result_xml, body)).to include("<SH>")
    end

    it "falls back to the raw body when the reply is already a bare <SH> document" do
      body = "<SH><SHresults/></SH>"
      expect(client.send(:extract_result_xml, body)).to eq(body)
    end

    it "returns the nil text when the body carries neither a result node, '<SH' nor the sentinel (the ternary else)" do
      body = "<Unrelated><Payload>nothing useful</Payload></Unrelated>"
      expect(client.send(:extract_result_xml, body)).to be_nil
    end

    it "makes #parse return an empty verdict list when extraction yields nil" do
      expect(client.send(:parse, "<Unrelated><Payload>nothing useful</Payload></Unrelated>")).to eq([])
    end
  end

  describe "#parse fail-closed guards" do
    it "raises on a fatal marker present in the raw body (the pre-extraction guard)" do
      expect { client.send(:parse, "<SH>ERROR: Invalid credentials.</SH>") }
        .to raise_error(described_class::Error, /Invalid credentials/)
    end

    it "raises on a fatal marker that only appears once character references are decoded (the post-extraction guard)" do
      # "ERROR: Access to RPS Denied." with the trailing period written as a numeric
      # character reference -- invisible to a raw substring scan of the envelope, but
      # present in the decoded IMTimeStampSearchResult text. Must still fail closed.
      body = <<~XML
        <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>
        <IMTimeStampSearchResult>ERROR: Access to RPS Denied&#46;</IMTimeStampSearchResult>
        </s:Body></s:Envelope>
      XML
      expect(client.send(:job_fatal?, body)).to be(false)
      expect { client.send(:parse, body) }
        .to raise_error(described_class::Error, /Access to RPS Denied/)
    end

    it "returns [] on the NO_STATUS_HISTORY sentinel instead of raising" do
      expect(client.send(:parse, "<SH><SHresults>NO_STATUS_HISTORY</SHresults></SH>")).to eq([])
    end

    it "raises a wrapped Error on a malformed (non-strict) document" do
      expect { client.send(:parse, "<SH><SHresults>") }
        .to raise_error(described_class::Error, /malformed IMTimeStampSearch response/)
    end
  end

  describe "#verdict_from sparse nodes" do
    it "returns nil for absent child tags and an absent id attribute (the &.-nil arms)" do
      body = <<~XML
        <SH><SHresults><SHresult><SHstatus>CLEARED</SHstatus></SHresult></SHresults></SH>
      XML
      verdicts = client.send(:parse, body)
      expect(verdicts.length).to eq(1)
      verdict = verdicts.first
      expect(verdict.shstatus).to eq("CLEARED")
      expect(verdict.shresult_id).to be_nil
      expect(verdict.shoptid).to be_nil
      expect(verdict.shrevdate).to be_nil
      expect(verdict.shname).to be_nil
    end

    it "returns nil for a child tag that is present but whitespace-only (the .presence arm)" do
      body = "<SH><SHresults><SHresult id=\"abc\"><SHstatus>CLEARED</SHstatus><SHname>   </SHname></SHresult></SHresults></SH>"
      verdict = client.send(:parse, body).first
      expect(verdict.shresult_id).to eq("abc")
      expect(verdict.shname).to be_nil
    end
  end

  describe ".format_time" do
    it "converts a non-UTC time to the offset-less UTC wire format" do
      expect(described_class.format_time(Time.new(2018, 7, 24, 5, 0, 0, "+05:00")))
        .to eq("2018-07-24T00:00:00")
    end
  end
end
