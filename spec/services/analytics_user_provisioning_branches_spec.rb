# frozen_string_literal: true

require "rails_helper"

# Coverage Wave 3: branch sweep for AnalyticsUserProvisioning (CZID-722). This
# service had no spec; it is conditional-dense fail-closed auth logic. These
# examples drive BOTH arms of every guard without touching the database: the
# AnalyticsUser class methods (find_by / exists? / create!) are stubbed and the
# users are plain doubles, so no DB/ES/network is exercised.
#
# Branches driven:
#   normalize_email  -> valid email (match? true) AND invalid email (match? false -> nil)
#   seed_break_glass! -> invalid-email raise, short-password raise, existing-returns,
#                        fresh-create arms
#   create_user!     -> invalid-email raise, short-password raise, invalid-role raise,
#                        already-exists raise, fresh-create arms
#   verify_login     -> unknown email (nil user -> dummy_authenticate), wrong password
#                        (authed false), inactive user, and the success arm
#   change_password! -> nil user, inactive user, wrong current password, short new
#                        password, unchanged password, and the success arm
#   deactivate!      -> no-such-user raise, break-glass raise, and the success arm
RSpec.describe AnalyticsUserProvisioning, type: :service do
  # -- normalize_email (private, exercised through the public API) -------------

  describe "email normalization" do
    it "strips and downcases a valid email (the match? true arm)" do
      allow(AnalyticsUser).to receive(:find_by).and_return(nil)
      allow(AnalyticsUser).to receive(:exists?).and_return(false)
      created = double("user")
      expect(AnalyticsUser).to receive(:create!)
        .with(hash_including(email: "person@example.com"))
        .and_return(created)

      described_class.create_user!(email: "  Person@Example.COM ", role: "viewer", temp_password: "temp1234")
    end

    it "rejects a string with no @ (the match? false arm collapses to nil)" do
      expect do
        described_class.seed_break_glass!(email: "not-an-email", password: "longenough")
      end.to raise_error(ArgumentError, /valid email/)
    end
  end

  # -- seed_break_glass! -------------------------------------------------------

  describe ".seed_break_glass!" do
    it "raises when the email is invalid (unless normalized -> true)" do
      expect do
        described_class.seed_break_glass!(email: "@@", password: "longenough")
      end.to raise_error(ArgumentError, /valid email/)
    end

    it "raises when the password is too short (length < MIN -> true)" do
      expect do
        described_class.seed_break_glass!(email: "admin@example.com", password: "short")
      end.to raise_error(ArgumentError, /at least 8/)
    end

    it "returns the existing account without recreating it (return existing if existing)" do
      existing = double("user")
      allow(AnalyticsUser).to receive(:find_by).with(email: "admin@example.com").and_return(existing)
      expect(AnalyticsUser).not_to receive(:create!)

      expect(described_class.seed_break_glass!(email: "admin@example.com", password: "longenough")).to eq(existing)
    end

    it "creates a fail-closed break-glass admin when none exists (the create arm)" do
      allow(AnalyticsUser).to receive(:find_by).with(email: "admin@example.com").and_return(nil)
      created = double("user")
      expect(AnalyticsUser).to receive(:create!).with(
        email: "admin@example.com", password: "longenough", role: "admin",
        active: true, break_glass: true, must_change_password: false
      ).and_return(created)

      expect(described_class.seed_break_glass!(email: "admin@example.com", password: "longenough")).to eq(created)
    end
  end

  # -- create_user! ------------------------------------------------------------

  describe ".create_user!" do
    it "raises on an invalid email (unless normalized -> true)" do
      expect do
        described_class.create_user!(email: "nope", role: "viewer", temp_password: "temp1234")
      end.to raise_error(ArgumentError, /valid email/)
    end

    it "raises on a short temp password (length < MIN -> true)" do
      expect do
        described_class.create_user!(email: "u@example.com", role: "viewer", temp_password: "tiny")
      end.to raise_error(ArgumentError, /at least 8/)
    end

    it "raises on an unrecognized role (unless ROLES.include? -> true)" do
      expect do
        described_class.create_user!(email: "u@example.com", role: "superuser", temp_password: "temp1234")
      end.to raise_error(ArgumentError, /role must be one of/)
    end

    it "raises when the email is already taken (if exists? -> true)" do
      allow(AnalyticsUser).to receive(:exists?).with(email: "u@example.com").and_return(true)
      expect(AnalyticsUser).not_to receive(:create!)

      expect do
        described_class.create_user!(email: "u@example.com", role: "viewer", temp_password: "temp1234")
      end.to raise_error(ArgumentError, /already exists/)
    end

    it "creates a must-change-password account for a valid request (the create arm)" do
      allow(AnalyticsUser).to receive(:exists?).with(email: "u@example.com").and_return(false)
      created = double("user")
      expect(AnalyticsUser).to receive(:create!).with(
        email: "u@example.com", password: "temp1234", role: "viewer",
        active: true, break_glass: false, must_change_password: true
      ).and_return(created)

      expect(described_class.create_user!(email: "u@example.com", role: :viewer, temp_password: "temp1234")).to eq(created)
    end
  end

  # -- verify_login ------------------------------------------------------------

  describe ".verify_login" do
    it "denies an unknown email with :invalid_credentials (nil user -> dummy_authenticate)" do
      allow(AnalyticsUser).to receive(:find_by).with(email: "ghost@example.com").and_return(nil)

      result = described_class.verify_login(email: "ghost@example.com", password: "whatever8")
      expect(result.ok?).to be(false)
      expect(result.reason).to eq(:invalid_credentials)
    end

    it "denies a known email with a wrong password (authed false)" do
      user = double("user")
      allow(user).to receive(:authenticate).with("wrongpass").and_return(false)
      allow(AnalyticsUser).to receive(:find_by).with(email: "u@example.com").and_return(user)

      result = described_class.verify_login(email: "u@example.com", password: "wrongpass")
      expect(result.reason).to eq(:invalid_credentials)
    end

    it "denies a correct password on an inactive account with :inactive (unless active? -> true)" do
      user = double("user")
      allow(user).to receive(:authenticate).with("goodpass8").and_return(true)
      allow(user).to receive(:active?).and_return(false)
      allow(AnalyticsUser).to receive(:find_by).with(email: "u@example.com").and_return(user)

      result = described_class.verify_login(email: "u@example.com", password: "goodpass8")
      expect(result.ok?).to be(false)
      expect(result.reason).to eq(:inactive)
    end

    it "signs in an active account and stamps last_login_at (the success arm)" do
      user = double("user")
      allow(user).to receive(:authenticate).with("goodpass8").and_return(true)
      allow(user).to receive(:active?).and_return(true)
      expect(user).to receive(:update!).with(hash_including(:last_login_at))
      allow(AnalyticsUser).to receive(:find_by).with(email: "u@example.com").and_return(user)

      result = described_class.verify_login(email: "u@example.com", password: "goodpass8")
      expect(result.ok?).to be(true)
      expect(result.user).to eq(user)
    end
  end

  # -- change_password! --------------------------------------------------------

  describe ".change_password!" do
    it "raises when no user is found (user&.active? -> nil short-circuit)" do
      allow(AnalyticsUser).to receive(:find_by).with(email: "u@example.com").and_return(nil)

      expect do
        described_class.change_password!(email: "u@example.com", current_password: "old12345", new_password: "new12345")
      end.to raise_error(ArgumentError, /current password is incorrect/)
    end

    it "raises when the account is inactive (active? -> false)" do
      user = double("user")
      allow(user).to receive(:active?).and_return(false)
      allow(AnalyticsUser).to receive(:find_by).with(email: "u@example.com").and_return(user)

      expect do
        described_class.change_password!(email: "u@example.com", current_password: "old12345", new_password: "new12345")
      end.to raise_error(ArgumentError, /current password is incorrect/)
    end

    it "raises when the current password is wrong (authenticate(current) -> false)" do
      user = double("user")
      allow(user).to receive(:active?).and_return(true)
      allow(user).to receive(:authenticate).with("old12345").and_return(false)
      allow(AnalyticsUser).to receive(:find_by).with(email: "u@example.com").and_return(user)

      expect do
        described_class.change_password!(email: "u@example.com", current_password: "old12345", new_password: "new12345")
      end.to raise_error(ArgumentError, /current password is incorrect/)
    end

    it "raises when the new password is too short (length < MIN -> true)" do
      user = double("user")
      allow(user).to receive(:active?).and_return(true)
      allow(user).to receive(:authenticate).with("old12345").and_return(true)
      allow(AnalyticsUser).to receive(:find_by).with(email: "u@example.com").and_return(user)

      expect do
        described_class.change_password!(email: "u@example.com", current_password: "old12345", new_password: "tiny")
      end.to raise_error(ArgumentError, /at least 8/)
    end

    it "raises when the new password equals the current one (authenticate(new) -> true)" do
      user = double("user")
      allow(user).to receive(:active?).and_return(true)
      allow(user).to receive(:authenticate).with("old12345").and_return(true)
      allow(user).to receive(:authenticate).with("old12345dup").and_return(true)
      allow(AnalyticsUser).to receive(:find_by).with(email: "u@example.com").and_return(user)

      expect do
        described_class.change_password!(email: "u@example.com", current_password: "old12345", new_password: "old12345dup")
      end.to raise_error(ArgumentError, /must differ/)
    end

    it "updates and clears must_change_password on a valid change (the success arm)" do
      user = double("user")
      allow(user).to receive(:active?).and_return(true)
      allow(user).to receive(:authenticate).with("old12345").and_return(true)
      allow(user).to receive(:authenticate).with("new12345").and_return(false)
      expect(user).to receive(:update!).with(password: "new12345", must_change_password: false)
      allow(AnalyticsUser).to receive(:find_by).with(email: "u@example.com").and_return(user)

      described_class.change_password!(email: "u@example.com", current_password: "old12345", new_password: "new12345")
    end
  end

  # -- deactivate! -------------------------------------------------------------

  describe ".deactivate!" do
    it "raises when the user does not exist (unless user -> true)" do
      allow(AnalyticsUser).to receive(:find_by).with(email: "u@example.com").and_return(nil)

      expect do
        described_class.deactivate!(email: "u@example.com")
      end.to raise_error(ArgumentError, /no such user/)
    end

    it "refuses to deactivate the break-glass account (if break_glass? -> true)" do
      user = double("user")
      allow(user).to receive(:break_glass?).and_return(true)
      allow(AnalyticsUser).to receive(:find_by).with(email: "admin@example.com").and_return(user)
      expect(user).not_to receive(:update!)

      expect do
        described_class.deactivate!(email: "admin@example.com")
      end.to raise_error(ArgumentError, /break-glass account cannot be deactivated/)
    end

    it "deactivates an ordinary account (the update arm)" do
      user = double("user")
      allow(user).to receive(:break_glass?).and_return(false)
      expect(user).to receive(:update!).with(active: false)
      allow(AnalyticsUser).to receive(:find_by).with(email: "u@example.com").and_return(user)

      described_class.deactivate!(email: "u@example.com")
    end
  end
end
