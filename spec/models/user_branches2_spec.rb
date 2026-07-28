# frozen_string_literal: true

require 'rails_helper'

# Coverage Wave (branch): third branch sweep for User, complementing
# user_branches_spec.rb and user_institutional_email_spec.rb. It drives the
# untaken arm of the remaining conditionals on the model:
#
#   - role_name ternary (admin / non-admin)
#   - allowed_feature_list: the `allowed_features || "[]"` nil arm and the
#     union with the launched-feature list
#   - add_allowed_feature / remove_allowed_feature: present and absent
#   - can_upload: the admin short-circuit, each operand of the deny guard
#     (nil bucket / idseq- prefix), and the czbiohub prefix branch with
#     biohub upload enabled and disabled
#   - .allowed_email_domains: the "config is not an Array" coercion
#   - institutional_email?: empty allowlist, blank user domain, match/no-match
#   - first_name / last_name nil-name guards
#   - traits_for_analytics: include_pii true and false
describe User, type: :model do
  # AppConfig-backed globals this model reads. Seeded per example so the file is
  # self-contained regardless of run order.
  def set_launched_features(list) # rubocop:disable Naming/AccessorMethodName
    AppConfigHelper.set_json_app_config(AppConfig::LAUNCHED_FEATURES, list)
  end

  def set_allowlist(domains) # rubocop:disable Naming/AccessorMethodName
    AppConfigHelper.set_json_app_config(AppConfig::ALLOWED_EMAIL_DOMAINS, domains)
  end

  before do
    set_launched_features([])
    set_allowlist([])
  end

  describe "#role_name" do
    it "returns 'admin user' for an admin (the then-arm)" do
      expect(build(:user, role: 1).role_name).to eq('admin user')
    end

    it "returns 'non-admin user' for a regular user (the else-arm)" do
      expect(build(:user, role: 0).role_name).to eq('non-admin user')
    end
  end

  describe "#allowed_feature_list" do
    it "defaults to just the launched features when allowed_features is nil (the || else-arm)" do
      set_launched_features(["launched_thing"])
      user = build(:user, allowed_features: nil)

      expect(user.allowed_feature_list).to eq(["launched_thing"])
      expect(user.allowed_feature?("launched_thing")).to be(true)
    end

    it "unions the per-user list with the launched list when allowed_features is set" do
      set_launched_features(["launched_thing"])
      user = build(:user, allowed_features: ["mine", "launched_thing"].to_json)

      expect(user.allowed_feature_list).to contain_exactly("mine", "launched_thing")
      expect(user.allowed_feature?("mine")).to be(true)
      expect(user.allowed_feature?("not_mine")).to be(false)
    end
  end

  describe "#add_allowed_feature / #remove_allowed_feature" do
    it "adds the feature when it is absent (the unless then-arm)" do
      user = create(:user, allowed_features: [].to_json)

      user.add_allowed_feature("new_feature")

      expect(JSON.parse(user.reload.allowed_features)).to eq(["new_feature"])
    end

    it "leaves the record alone when the feature is already present (the unless else-arm)" do
      user = create(:user, allowed_features: ["dupe"].to_json)

      expect { user.add_allowed_feature("dupe") }.not_to(change { user.reload.allowed_features })
      expect(JSON.parse(user.reload.allowed_features)).to eq(["dupe"])
    end

    it "removes the feature when it is present (the if then-arm)" do
      user = create(:user, allowed_features: ["gone", "kept"].to_json)

      user.remove_allowed_feature("gone")

      expect(JSON.parse(user.reload.allowed_features)).to eq(["kept"])
    end

    it "leaves the record alone when the feature is absent (the if else-arm)" do
      user = create(:user, allowed_features: ["kept"].to_json)

      expect { user.remove_allowed_feature("never_there") }.not_to(change { user.reload.allowed_features })
      expect(JSON.parse(user.reload.allowed_features)).to eq(["kept"])
    end
  end

  describe "#can_upload" do
    let(:regular) { build(:user, role: 0, email: "person@example.com", allowed_features: [].to_json) }

    it "short-circuits to true for an admin (the `return true if admin?` then-arm)" do
      admin = build(:user, role: 1, email: "admin@example.com")

      expect(admin.can_upload("s3://idseq-anything/path/file.fastq")).to be(true)
    end

    it "denies a path with no bucket segment (the user_bucket.nil? operand)" do
      expect(regular.can_upload("not-an-s3-path")).to be(false)
    end

    it "denies idseq- prefixed buckets (the IDSEQ_BUCKET_PREFIXES operand)" do
      expect(regular.can_upload("s3://IDSEQ-samples/path/file.fastq")).to be(false)
    end

    it "denies czbiohub buckets for a user without biohub upload enabled (the inner unless then-arm)" do
      expect(regular.can_upload("s3://czb-private/path/file.fastq")).to be(false)
    end

    it "allows czbiohub buckets for a biohub user (the inner unless else-arm)" do
      biohub = build(:user, role: 0, email: "person@czbiohub.org", allowed_features: [].to_json)

      expect(biohub.can_upload("s3://czbiohub-private/path/file.fastq")).to be(true)
    end

    it "allows czbiohub buckets when the biohub_s3_upload_enabled feature is granted" do
      flagged = build(:user, role: 0, email: "person@example.com",
                             allowed_features: ["biohub_s3_upload_enabled"].to_json)

      expect(flagged.can_upload("s3://czb-private/path/file.fastq")).to be(true)
    end

    it "allows an ordinary third-party bucket (the czbiohub if else-arm)" do
      expect(regular.can_upload("s3://some-lab-bucket/path/file.fastq")).to be(true)
    end
  end

  describe ".allowed_email_domains" do
    it "coerces a non-Array AppConfig value to an empty list (the unless then-arm)" do
      AppConfigHelper.set_app_config(AppConfig::ALLOWED_EMAIL_DOMAINS, '{"not":"an array"}')
      allow(ENV).to receive(:[]).and_call_original
      allow(ENV).to receive(:[]).with("ALLOWED_EMAIL_DOMAINS").and_return(nil)

      expect(User.allowed_email_domains).to eq([])
    end

    it "keeps a configured Array untouched (the unless else-arm)" do
      set_allowlist(["ucsf.edu"])

      expect(User.allowed_email_domains).to eq(["ucsf.edu"])
    end
  end

  describe "#institutional_email?" do
    it "is true when enforcement is disabled (the empty-allowlist then-arm)" do
      expect(build(:user, email: "anyone@gmail.com").institutional_email?).to be(true)
    end

    it "is false when the email has no domain part (the blank-domain then-arm)" do
      set_allowlist(["ucsf.edu"])
      user = build(:user, email: "no-at-sign")

      expect(user.institutional_email?).to be(false)
    end

    it "is true on an exact match and false on a non-match (both any? outcomes)" do
      set_allowlist(["ucsf.edu"])

      expect(build(:user, email: "a@ucsf.edu").institutional_email?).to be(true)
      expect(build(:user, email: "a@example.com").institutional_email?).to be(false)
    end
  end

  describe "#first_name / #last_name" do
    it "returns nil when the name is nil (both guard then-arms)" do
      user = build(:user, name: nil)

      expect(user.first_name).to be_nil
      expect(user.last_name).to be_nil
    end

    it "splits the name when it is present (both guard else-arms)" do
      user = build(:user, name: "Greg  L.  Dingle")

      expect(user.first_name).to eq("Greg L.")
      expect(user.last_name).to eq("Dingle")
    end
  end

  describe "#traits_for_analytics" do
    it "omits PII by default (the include_pii else-arm)" do
      user = create(:user, name: "Nopii User", email: "nopii@example.com")

      traits = user.traits_for_analytics

      expect(traits).to include(role: user.role, admin: false, has_projects: false)
      expect(traits).not_to have_key(:email)
      expect(traits).not_to have_key(:firstName)
    end

    it "merges the PII traits when include_pii is true (the then-arm)" do
      user = create(:user, name: "Withpii User", email: "withpii@example.com")

      traits = user.traits_for_analytics(include_pii: true)

      expect(traits[:email]).to eq("withpii@example.com")
      expect(traits[:firstName]).to eq("Withpii")
      expect(traits[:lastName]).to eq("User")
      expect(traits[:projects]).to eq(0)
    end
  end
end
