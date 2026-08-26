# frozen_string_literal: true

require 'rails_helper'

RSpec.describe ExportControl::Providers::ScreeningServiceHttp, type: :service do
  let(:user) { instance_double('User', id: 42, name: 'Jane Doe', email: 'jane@ucsf.edu') }

  describe '.screen' do
    context 'when the client is not configured' do
      it 'returns PENDING and makes no call' do
        allow(ExportControl::ScreeningServiceClient).to receive(:configured?).and_return(false)
        expect(ExportControl::ScreeningServiceClient).not_to receive(:post_signed)

        result = described_class.screen(user, {})

        expect(result.result).to eq(ExportControlClearance::SCREENING_PENDING)
        expect(result.provider).to eq('screening_service')
      end
    end

    context 'when configured' do
      before do
        allow(ExportControl::ScreeningServiceClient).to receive(:configured?).and_return(true)
        allow(ExportControl::ScreeningServiceClient).to receive(:screenings_url)
          .and_return('http://svc/internal/v1/screenings')
        allow(ExportControl::ScreeningServiceClient).to receive(:callback_url)
          .and_return('http://web/internal/v1/screening_result')
      end

      it 'POSTs the subject + account and returns PENDING (async, decision arrives via callback)' do
        captured = nil
        allow(ExportControl::ScreeningServiceClient).to receive(:post_signed) do |url, body|
          expect(url).to eq('http://svc/internal/v1/screenings')
          captured = JSON.parse(body)
        end

        result = described_class.screen(user, { country: 'US', institution: 'UCSF' })

        expect(result.result).to eq(ExportControlClearance::SCREENING_PENDING)
        expect(captured['correlation_id']).to eq('User:42')
        expect(captured['subject']['name']).to eq('Jane Doe')
        expect(captured['subject']['country']).to eq('US')
        expect(captured['account']['email']).to eq('jane@ucsf.edu')
        expect(captured['account']['institution']).to eq('UCSF')
        expect(captured['callback_url']).to eq('http://web/internal/v1/screening_result')
      end

      it 'fails closed to PENDING on a transport error (never leaks a clear)' do
        allow(ExportControl::ScreeningServiceClient).to receive(:post_signed).and_raise(Timeout::Error)

        result = described_class.screen(user, {})

        expect(result.result).to eq(ExportControlClearance::SCREENING_PENDING)
      end

      it 'uses viewer_country when no explicit country is supplied' do
        captured = nil
        allow(ExportControl::ScreeningServiceClient).to receive(:post_signed) do |_url, body|
          captured = JSON.parse(body)
        end

        described_class.screen(user, { viewer_country: 'IR' })

        expect(captured['subject']['country']).to eq('IR')
      end
    end
  end
end
