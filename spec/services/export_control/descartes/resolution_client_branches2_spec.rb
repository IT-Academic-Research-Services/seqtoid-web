# frozen_string_literal: true

require "rails_helper"

# Coverage Wave (branch): residual branch for
# ExportControl::Descartes::ResolutionClient#poll -- the
# `raise Error unless resp.code.to_s == '200'` guard. The main spec and
# resolution_client_branches_spec.rb only ever see a 200 response (or short-circuit
# on the configuration guard), so the non-200 then-arm is never taken.
RSpec.describe ExportControl::Descartes::ResolutionClient, type: :service do
  let(:configured) do
    described_class::Config.new(endpoint: "https://rpstest.example.test", secno: "12345", password: "secretpw")
  end
  let(:client) { described_class.new(config: configured) }

  # Runs the breaker block inline so no circuit state or network is involved, and
  # returns the supplied fake response from HttpResilience.request.
  def stub_transport(code:, body: "")
    breaker = double("breaker")
    allow(breaker).to receive(:run) { |&blk| blk.call }
    allow(HttpResilience).to receive(:breaker).with(:descartes_rps_resolution).and_return(breaker)
    allow(HttpResilience).to receive(:request).and_return(double("response", code: code, body: body))
  end

  it "raises Error carrying the status when the API answers non-200 (the unless then-arm)" do
    stub_transport(code: "503", body: "upstream down")

    expect { client.poll(time_from: Time.utc(2018, 1, 1), time_to: Time.utc(2018, 1, 2)) }
      .to raise_error(described_class::Error, /unexpected HTTP status 503/)
  end

  it "parses the body when the API answers 200 (the unless else-arm)" do
    body = <<~XML
      <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
        <soap:Body>
          <IMTimeStampSearchResult>&lt;SH&gt;&lt;/SH&gt;</IMTimeStampSearchResult>
        </soap:Body>
      </soap:Envelope>
    XML
    stub_transport(code: 200, body: body)

    expect(client.poll(time_from: Time.utc(2018, 1, 1), time_to: Time.utc(2018, 1, 2))).to eq([])
  end
end
