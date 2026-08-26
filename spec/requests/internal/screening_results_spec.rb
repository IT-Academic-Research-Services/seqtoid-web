# frozen_string_literal: true

require 'rails_helper'

RSpec.describe 'Internal::ScreeningResults', type: :request do
  let(:secret) { 'test-signing-secret' }
  let(:body) { JSON.dump('correlation_id' => 'User:1', 'decision' => 'approved', 'account' => { 'email' => 'a@ucsf.edu' }) }

  def signature(raw)
    OpenSSL::HMAC.hexdigest('SHA256', secret, raw)
  end

  around do |example|
    original = ENV['SCREENING_SERVICE_SIGNING_SECRET']
    ENV['SCREENING_SERVICE_SIGNING_SECRET'] = secret
    example.run
    ENV['SCREENING_SERVICE_SIGNING_SECRET'] = original
  end

  it 'enqueues provisioning and returns 200 on a valid signature' do
    expect(ProvisionScreenedAccountJob).to receive(:enqueue)
    post '/internal/v1/screening_result', params: body,
                                          headers: { 'Content-Type' => 'application/json', 'X-Export-Control-Signature' => signature(body) }
    expect(response).to have_http_status(:ok)
  end

  it 'returns 401 and does not enqueue on a bad signature' do
    expect(ProvisionScreenedAccountJob).not_to receive(:enqueue)
    post '/internal/v1/screening_result', params: body,
                                          headers: { 'Content-Type' => 'application/json', 'X-Export-Control-Signature' => 'wrong' }
    expect(response).to have_http_status(:unauthorized)
  end

  it 'is disabled (503) when the signing secret is unset' do
    ENV['SCREENING_SERVICE_SIGNING_SECRET'] = nil
    post '/internal/v1/screening_result', params: body, headers: { 'Content-Type' => 'application/json' }
    expect(response).to have_http_status(:service_unavailable)
  end

  # The P0 fix: a signed decision callback must reach the correlated user's export-control CLEARANCE, not
  # just enqueue account provisioning. Before this, an approved (clean) screen 200'd but the user's
  # clearance stayed verified+pending and they were blocked at the Layer-3 gate on prod login forever.
  describe 'export-control clearance write-back' do
    let(:user) { create(:user) }

    # A user mid-clearance: verified identity, screening still pending (the row the clearance controller
    # writes before handing off to the async screening service).
    let!(:clearance) do
      create(:export_control_clearance, :screening_pending, user: user,
                                                             screening_provider: 'screening_service')
    end

    def post_callback(decision:, extra: {})
      raw = JSON.dump({ 'correlation_id' => "User:#{user.id}", 'decision' => decision }.merge(extra))
      post '/internal/v1/screening_result', params: raw,
                                            headers: { 'Content-Type' => 'application/json',
                                                       'X-Export-Control-Signature' => signature(raw) }
    end

    it 'satisfies the clearance (verified + clear) on a signed approved callback' do
      allow(ProvisionScreenedAccountJob).to receive(:enqueue)
      expect(ExportControlClearance.current_clearance_satisfied?(user)).to be(false)

      post_callback(decision: 'approved', extra: { 'screening_id' => 'scr-777' })

      expect(response).to have_http_status(:ok)
      expect(ExportControlClearance.current_clearance_satisfied?(user)).to be(true)
      clearance.reload
      expect(clearance.screening_result).to eq(ExportControlClearance::SCREENING_CLEAR)
      expect(clearance.verification_status).to eq(ExportControlClearance::VERIFICATION_VERIFIED) # not downgraded
      expect(clearance.screening_evidence_ref).to eq('scr-777')
    end

    it 'keeps the user BLOCKED on a denied callback and records a durable HIT (fail-closed)' do
      allow(ProvisionScreenedAccountJob).to receive(:enqueue)

      post_callback(decision: 'denied')

      expect(response).to have_http_status(:ok)
      expect(ExportControlClearance.current_clearance_satisfied?(user)).to be(false)
      expect(clearance.reload.screening_result).to eq(ExportControlClearance::SCREENING_HIT)
    end

    it 'is idempotent: a replayed approved callback does not stack duplicate clear rows' do
      allow(ProvisionScreenedAccountJob).to receive(:enqueue)

      expect do
        post_callback(decision: 'approved', extra: { 'screening_id' => 'scr-777' })
        post_callback(decision: 'approved', extra: { 'screening_id' => 'scr-777' })
      end.not_to change { ExportControlClearance.where(user_id: user.id).count }

      expect(ExportControlClearance.current_clearance_satisfied?(user)).to be(true)
    end
  end
end
