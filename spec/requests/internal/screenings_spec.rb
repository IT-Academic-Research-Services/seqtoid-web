# frozen_string_literal: true

require 'rails_helper'

RSpec.describe 'Internal::Screenings', type: :request do
  let(:secret) { 'test-signing-secret' }
  let(:body) { JSON.dump('correlation_id' => 'User:1', 'subject' => { 'name' => 'A' }) }

  def signature(raw)
    OpenSSL::HMAC.hexdigest('SHA256', secret, raw)
  end

  around do |example|
    original = ENV['SCREENING_SERVICE_SIGNING_SECRET']
    ENV['SCREENING_SERVICE_SIGNING_SECRET'] = secret
    example.run
    ENV['SCREENING_SERVICE_SIGNING_SECRET'] = original
  end

  it 'enqueues the screen and returns 202 on a valid signature' do
    expect(ProcessScreeningJob).to receive(:enqueue)
    post '/internal/v1/screenings', params: body,
                                    headers: { 'Content-Type' => 'application/json', 'X-Export-Control-Signature' => signature(body) }
    expect(response).to have_http_status(:accepted)
    expect(JSON.parse(response.body)['status']).to eq('pending')
  end

  it 'returns 401 and does not enqueue on a bad signature' do
    expect(ProcessScreeningJob).not_to receive(:enqueue)
    post '/internal/v1/screenings', params: body,
                                    headers: { 'Content-Type' => 'application/json', 'X-Export-Control-Signature' => 'wrong' }
    expect(response).to have_http_status(:unauthorized)
  end

  it 'is disabled (503) when the signing secret is unset' do
    ENV['SCREENING_SERVICE_SIGNING_SECRET'] = nil
    post '/internal/v1/screenings', params: body, headers: { 'Content-Type' => 'application/json' }
    expect(response).to have_http_status(:service_unavailable)
  end
end
