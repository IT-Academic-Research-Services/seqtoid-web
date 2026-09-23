# frozen_string_literal: true

require 'rails_helper'

# SMP-1902 -- disposable/free email-domain blocklist enforcement on the User model. Mirrors the CZID-523
# allowlist spec (user_institutional_email_spec.rb). Both switches default OFF, so the default posture is
# "any email accepted"; each example opts the relevant switch on. An explicit allow (the exceptions list
# or the CZID-523 allowlist) always beats the blocklist.
describe User, type: :model do
  def block_disposable(on) # rubocop:disable Naming/AccessorMethodName
    AppConfigHelper.set_app_config(AppConfig::BLOCK_DISPOSABLE_EMAIL_DOMAINS, on ? "1" : "0")
  end

  def block_free(on) # rubocop:disable Naming/AccessorMethodName
    AppConfigHelper.set_app_config(AppConfig::BLOCK_FREE_EMAIL_DOMAINS, on ? "1" : "0")
  end

  def set_exceptions(domains) # rubocop:disable Naming/AccessorMethodName
    AppConfigHelper.set_json_app_config(AppConfig::BLOCKED_EMAIL_DOMAIN_EXCEPTIONS, domains)
  end

  def set_allowlist(domains) # rubocop:disable Naming/AccessorMethodName
    AppConfigHelper.set_json_app_config(AppConfig::ALLOWED_EMAIL_DOMAINS, domains)
  end

  before do
    # Self-contained defaults regardless of run order: both switches off, no exceptions, no allowlist.
    block_disposable(false)
    block_free(false)
    set_exceptions([])
    set_allowlist([])
  end

  context "both switches off (the default)" do
    it "accepts a free personal domain" do
      expect(build(:user, email: "person@gmail.com")).to be_valid
    end

    it "accepts a disposable domain" do
      expect(build(:user, email: "person@mailinator.com")).to be_valid
    end
  end

  context "disposable blocking on" do
    before { block_disposable(true) }

    it "rejects a disposable domain with the user-facing message" do
      user = build(:user, email: "person@mailinator.com")
      expect(user).not_to be_valid
      expect(user.errors[:email].join).to include("personal or temporary email address")
    end

    it "rejects a subdomain of a disposable domain (parent-domain match)" do
      expect(build(:user, email: "person@x.mailinator.com")).not_to be_valid
    end

    it "still accepts a free personal domain (free switch is independent)" do
      expect(build(:user, email: "person@gmail.com")).to be_valid
    end
  end

  context "free blocking on" do
    before { block_free(true) }

    it "rejects a free personal domain" do
      user = build(:user, email: "person@gmail.com")
      expect(user).not_to be_valid
      expect(user.errors[:email].join).to include("personal or temporary email address")
    end

    it "matches case-insensitively" do
      # Emails are stored lowercase (User rejects capital letters at the format layer), so the
      # case-insensitivity contract is exercised on the domain matcher directly.
      expect(User.blocked_email_domain?("GMAIL.COM")).to be(true)
      expect(User.blocked_email_domain?("User@GMAIL.COM".split("@").last)).to be(true)
    end
  end

  context "both switches on" do
    before do
      block_disposable(true)
      block_free(true)
    end

    it "accepts institutional domains" do
      expect(build(:user, email: "a@ucsf.edu")).to be_valid
      expect(build(:user, email: "b@nih.gov")).to be_valid
      expect(build(:user, email: "c@nus.edu.sg")).to be_valid
    end
  end

  context "explicit allow beats the blocklist" do
    it "accepts a domain listed in the exceptions while free blocking is on" do
      block_free(true)
      set_exceptions(["gmail.com"])
      expect(build(:user, email: "person@gmail.com")).to be_valid
    end

    it "accepts a domain on the CZID-523 allowlist while free blocking is on" do
      block_free(true)
      set_allowlist(["gmail.com"])
      expect(build(:user, email: "person@gmail.com")).to be_valid
    end
  end

  context "existing users are not re-checked" do
    it "lets an existing gmail user be updated (name change) after free blocking is turned on" do
      user = create(:user, email: "person@gmail.com") # created while blocking is off
      block_free(true) # tighten after creation
      user.name = "New Name"
      expect(user.save).to be(true)
    end
  end

  context "bundled file sanity" do
    it "loads the expected number of entries" do
      expect(User.disposable_email_domains.size).to eq(9_534)
      expect(User.free_email_domains.size).to eq(4_554)
    end

    it "has no entry without a dot" do
      expect(User.disposable_email_domains).to all(include("."))
      expect(User.free_email_domains).to all(include("."))
    end
  end
end
