# frozen_string_literal: true

require 'rails_helper'

# SMP-1901 -- the CZ ID transfer request captured on the pre-account signup form. The point of these specs
# is the boundary the design promises: the fields are written to the LOCAL czid_transfer_requests sidecar
# and are NEVER added to the screening payload the producer sends.
RSpec.describe "ExportControlSignups", type: :request do
  let(:base_params) do
    {
      name_first: "Ada", name_last: "Lovelace", email: "Ada@Example.org",
      institution: "Analytical Engine Ltd", address1: "1 Mill Rd", city: "London",
      state: "England", zip: "AB1", country: "GB", terms_accepted: "1"
    }
  end

  before do
    # Keep screening inert and side-effect-free; assert separately on what (if anything) is handed to it.
    allow(ExportControl::SignupScreeningProducer).to receive(:submit).and_return(:skipped_unconfigured)
  end

  describe "POST /export_control_signup -> the local sidecar" do
    it "writes a row with the request + CZ ID email when the box is checked, and redirects to pending" do
      expect do
        post export_control_signups_path,
             params: base_params.merge(wants_czid_data_transferred: "1", czid_account_email: "ada@czid.org")
      end.to change(CzidTransferRequest, :count).by(1)

      row = CzidTransferRequest.last
      expect(row.email).to eq("ada@example.org") # normalized (stripped + downcased)
      expect(row.wants_czid_data_transferred).to be(true)
      expect(row.czid_account_email).to eq("ada@czid.org")
      expect(response).to redirect_to(export_control_signup_pending_path)
    end

    it "writes a row with false and no CZ ID email when the box is unchecked" do
      post export_control_signups_path, params: base_params
      row = CzidTransferRequest.find_by(email: "ada@example.org")
      expect(row).to be_present
      expect(row.wants_czid_data_transferred).to be(false)
      expect(row.czid_account_email).to be_nil
    end

    it "matches the signup email case- and whitespace-insensitively" do
      post export_control_signups_path,
           params: base_params.merge(email: "  ADA@example.ORG  ",
                                     wants_czid_data_transferred: "1", czid_account_email: "ada@czid.org")
      expect(CzidTransferRequest.where(email: "ada@example.org").count).to eq(1)
    end

    it "overwrites on re-submit -- latest answer wins" do
      post export_control_signups_path,
           params: base_params.merge(wants_czid_data_transferred: "1", czid_account_email: "old@czid.org")
      expect do
        post export_control_signups_path,
             params: base_params.merge(wants_czid_data_transferred: "1", czid_account_email: "new@czid.org")
      end.not_to change(CzidTransferRequest, :count)

      expect(CzidTransferRequest.find_by(email: "ada@example.org").czid_account_email).to eq("new@czid.org")
    end
  end

  describe "the screening payload never carries the CZ ID fields" do
    it "hands the producer only the screening fields -- no CZ ID keys, no CZ ID email value" do
      expect(ExportControl::SignupScreeningProducer).to receive(:submit) do |fields|
        expect(fields.keys).not_to include(:wants_czid_data_transferred, :czid_account_email)
        expect(fields.values.map(&:to_s).join(" ")).not_to include("ada@czid.org")
        :skipped_unconfigured
      end

      post export_control_signups_path,
           params: base_params.merge(wants_czid_data_transferred: "1", czid_account_email: "ada@czid.org")
    end
  end

  describe "server-side validation (required-when-checked, format)" do
    it "re-renders with an error and writes NO row when checked but the CZ ID email is blank" do
      expect do
        post export_control_signups_path,
             params: base_params.merge(wants_czid_data_transferred: "1", czid_account_email: "")
      end.not_to change(CzidTransferRequest, :count)

      expect(response).to have_http_status(:unprocessable_entity)
      expect(ExportControl::SignupScreeningProducer).not_to have_received(:submit)
    end

    it "re-renders with an error when the CZ ID email is malformed" do
      post export_control_signups_path,
           params: base_params.merge(wants_czid_data_transferred: "1", czid_account_email: "not-an-email")
      expect(response).to have_http_status(:unprocessable_entity)
    end
  end

  # SMP-1902 -- reject a blocked (personal/temporary) email domain at the signup form, before screening or
  # any local write, so the applicant sees the error immediately instead of a silent rejection later.
  describe "email-domain blocklist" do
    let(:blocked_params) { base_params.merge(email: "user@gmail.com") }

    # Self-contained default regardless of run order -- the AppConfig value is cached, so a prior example
    # leaving the switch on must not bleed into the "off" case (mirrors user_blocked_email_domain_spec).
    before { AppConfigHelper.set_app_config(AppConfig::BLOCK_FREE_EMAIL_DOMAINS, "0") }

    context "when the free-email blocklist is ON" do
      before { AppConfigHelper.set_app_config(AppConfig::BLOCK_FREE_EMAIL_DOMAINS, "1") }

      it "re-renders with the email error, screens nothing, and writes no sidecar row" do
        expect do
          post export_control_signups_path,
               params: blocked_params.merge(wants_czid_data_transferred: "1", czid_account_email: "user@czid.org")
        end.not_to change(CzidTransferRequest, :count)

        expect(response).to have_http_status(:unprocessable_entity)
        expect(response.body).to include("institutional email address")
        expect(ExportControl::SignupScreeningProducer).not_to have_received(:submit)
      end

      it "blocks case- and whitespace-insensitively" do
        post export_control_signups_path, params: base_params.merge(email: "  USER@GMAIL.COM  ")
        expect(response).to have_http_status(:unprocessable_entity)
        expect(ExportControl::SignupScreeningProducer).not_to have_received(:submit)
      end

      it "lets an institutional (non-blocked) domain through to screening" do
        post export_control_signups_path, params: base_params.merge(email: "researcher@ucsf.edu")
        expect(response).to redirect_to(export_control_signup_pending_path)
        expect(ExportControl::SignupScreeningProducer).to have_received(:submit)
      end
    end

    context "when the blocklist is OFF (default)" do
      it "lets a free-domain email through unchanged (screens + writes the sidecar row)" do
        expect do
          post export_control_signups_path, params: blocked_params
        end.to change(CzidTransferRequest, :count).by(1)

        expect(response).to redirect_to(export_control_signup_pending_path)
        expect(ExportControl::SignupScreeningProducer).to have_received(:submit)
      end
    end
  end
end
