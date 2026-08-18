require 'elasticsearch/model'
require 'auth0'
require 'active_support/core_ext/securerandom'

class User < ApplicationRecord
  before_create { self.salt ||= SecureRandom.base58(24) }

  # Tell rails to ignore these columns since they have been dropped from the db.
  # This is really just to keep the CI tests happy, since all migrations are run
  # in every CI run and one in particular calls User.all, which Rails was
  # translating into SQL queries that referenced nonexistent columns.
  # This is probably some sort of cache issue, and hopefully we can eliminate
  # these lines in about three months or so.
  # See also https://api.rubyonrails.org/classes/ActiveRecord/ModelSchema/ClassMethods.html#method-i-ignored_columns-3D
  # - Lucia 2023-05-17
  self.ignored_columns = [
    :authentication_token,
    :authentication_token_encrypted,
    :encrypted_password,
    :favorite_projects_count,
    :favorites_count,
    :remember_created_at,
    :reset_password_sent_at,
    :reset_password_token,
  ]

  # NOTE: counter_cache is not supported for has_and_belongs_to_many.
  has_and_belongs_to_many :projects
  # All one-to-many assocs are counter cached for per-user analytics.
  # See traits_for_analytics.
  has_many :samples, dependent: :destroy
  has_many :workflow_runs, dependent: :destroy
  has_many :visualizations, dependent: :destroy
  has_many :s3_transfer_jobs, dependent: :destroy
  has_many :phylo_trees, dependent: :destroy
  has_many :phylo_tree_ngs, dependent: :destroy
  has_many :backgrounds, dependent: :destroy
  has_many :bulk_downloads, dependent: :destroy
  has_many :user_settings, dependent: :destroy
  has_many :persisted_backgrounds, dependent: :destroy
  # CZID-330 — export-control attestation records are COMPLIANCE EVIDENCE and must be retained; they are
  # deliberately NOT dependent: :destroy. TODO(counsel): confirm the retention/erasure policy for these
  # records on user deletion (evidence retention vs. data-subject erasure requests).
  has_many :export_control_attestations, dependent: :restrict_with_exception
  # CZID-285/286 — Layer 3 export-control evidence (identity/screening clearances + device-location
  # attestations) are COMPLIANCE EVIDENCE and must be retained; like the CZID-330 records they are
  # deliberately NOT dependent: :destroy. TODO(counsel): retention/erasure policy on user deletion.
  has_many :export_control_clearances, dependent: :restrict_with_exception
  has_many :device_location_attestations, dependent: :restrict_with_exception

  validates :email, presence: true, uniqueness: true, format: {
    # Auth0 converts all emails to lowercase. Let's raise this at creation time
    # instead of automatically lower-casing.
    with: /\A(?~[A-Z])\z/, message: "may not contain capital letters",
  }
  validates :name, format: {
    # See https://www.ascii-code.com/. These were the ranges that captured the
    # common accented chars I knew from experience, leaving out pure symbols.
    with: /\A[- 'a-zA-ZÀ-ÖØ-öø-ÿ]+\z/, message: "must contain only letters, apostrophes, dashes or spaces",
  }, allow_nil: true
  # CZID-523 -- enforce that verified/uploading users belong to an approved institution by validating
  # the email domain against a configurable allowlist. Runs on both create and email changes, so it
  # covers admin creation (UsersController), self-signup (Mutations::CreateUser), and the shared
  # UserFactoryService choke point. Enforcement is OFF unless an allowlist is configured (see below),
  # so existing deployments/tests are unaffected until UCSF go-live populates the list.
  validate :email_domain_allowed, if: -> { email.present? && (new_record? || will_save_change_to_email?) }
  attr_accessor :email_arguments

  # `User` creation/changes/deletions get auto-tracked for analytics
  ENABLE_MODEL_AUTO_ANALYTICS = true

  ROLE_REGULAR_USER = 0
  ROLE_ADMIN = 1
  validates :role, presence: true, inclusion: { in: [
    ROLE_REGULAR_USER,
    ROLE_ADMIN,
  ] }, allow_nil: true

  PROFILE_FORM_VERSION = {
    incomplete: 0,
    interest_form: 1, # https://airtable.com/shrBGT42xVBR6JAVv
    in_app_form: 2, # UserProfileForm.tsx
  }.freeze
  validates :profile_form_version, presence: true, inclusion: { in: [
    PROFILE_FORM_VERSION[:incomplete],
    PROFILE_FORM_VERSION[:interest_form],
    PROFILE_FORM_VERSION[:in_app_form],
  ] }, allow_nil: false

  SIGNUP_PATH = {
    project: "Project", # Invited to a project by an existing user
    self_registered: "Self-Registered", # Self-registered via the landing pg
  }.freeze

  IDSEQ_BUCKET_PREFIXES = ['idseq-'].freeze
  CZBIOHUB_BUCKET_PREFIXES = ['czb-', 'czbiohub-'].freeze

  def as_json(options = {})
    super({ methods: [:admin] }.merge(options))
  end

  def admin
    role == ROLE_ADMIN
  end

  def admin?
    admin
  end

  def role_name
    admin? ? 'admin user' : 'non-admin user'
  end

  def launched_feature_list
    AppConfigHelper.get_json_app_config(AppConfig::LAUNCHED_FEATURES, [])
  end

  def allowed_feature_list
    launched = AppConfigHelper.get_json_app_config(AppConfig::LAUNCHED_FEATURES, [])
    JSON.parse(allowed_features || "[]") | launched
  end

  def allowed_feature?(feature)
    allowed_feature_list.include?(feature)
  end

  def add_allowed_feature(feature)
    parsed_allowed_features = allowed_feature_list

    unless parsed_allowed_features.include?(feature)
      update(allowed_features: parsed_allowed_features + [feature])
    end
  end

  def remove_allowed_feature(feature)
    parsed_allowed_features = allowed_feature_list

    if parsed_allowed_features.include?(feature)
      update(allowed_features: parsed_allowed_features - [feature])
    end
  end

  def can_upload(s3_path)
    return true if admin?

    user_bucket = s3_path.split("/")[2] # get "bucket" from "s3://bucket/path/to/file"

    # Don't allow any users to upload from idseq buckets
    return false if user_bucket.nil? || user_bucket == SAMPLES_BUCKET_NAME || IDSEQ_BUCKET_PREFIXES.any? { |prefix| user_bucket.downcase.starts_with?(prefix) }

    # Don't allow any non-Biohub users to upload from czbiohub buckets
    if CZBIOHUB_BUCKET_PREFIXES.any? { |prefix| user_bucket.downcase.starts_with?(prefix) }
      unless biohub_s3_upload_enabled?
        return false
      end
    end

    true
  end

  # This method is for tracking purposes only, not security.
  def biohub_user?
    ["czbiohub.org", "ucsf.edu"].include?(email.split("@").last)
  end

  def biohub_s3_upload_enabled?
    biohub_user? || allowed_feature_list.include?("biohub_s3_upload_enabled") || admin?
  end

  # This method is for tracking purposes only, not security.
  def czi_user?
    domain = email.split("@").last
    domain == "chanzuckerberg.com" || domain.ends_with?(".chanzuckerberg.com")
  end

  # CZID-523 -- the configured allowlist of approved institutional email domains. Reads the DB-backed
  # AppConfig JSON array first (runtime-editable, no deploy), then falls back to a comma-separated
  # ALLOWED_EMAIL_DOMAINS ENV var. Returns a lowercased, de-duped, blank-free array. An empty array
  # means "enforcement disabled" (any domain accepted).
  def self.allowed_email_domains
    from_config = AppConfigHelper.get_json_app_config(AppConfig::ALLOWED_EMAIL_DOMAINS, [])
    from_config = [] unless from_config.is_a?(Array)
    if from_config.empty? && ENV["ALLOWED_EMAIL_DOMAINS"].present?
      from_config = ENV["ALLOWED_EMAIL_DOMAINS"].split(",")
    end
    from_config.map { |d| d.to_s.strip.downcase.delete_prefix("@") }.reject(&:blank?).uniq
  end

  # CZID-523 -- true when domain enforcement is disabled (empty allowlist) or the user's email domain
  # matches an approved institutional domain (exact match or a subdomain of one). This is used for the
  # institutional-user gate; it is NOT a substitute for authorization checks.
  def institutional_email?
    domains = User.allowed_email_domains
    return true if domains.empty?

    user_domain = email.to_s.split("@").last&.downcase
    return false if user_domain.blank?

    domains.any? { |allowed| user_domain == allowed || user_domain.end_with?(".#{allowed}") }
  end

  # "Greg  L.  Dingle" -> "Greg L."
  def first_name
    return nil if name.nil?

    name.split[0..-2].join " "
  end

  # "Greg  L.  Dingle" -> "Dingle"
  def last_name
    return nil if name.nil?

    name.split[-1]
  end

  def owns_project?(project_id)
    projects.exists?(project_id)
  end

  # Update login trackable fields
  def update_tracked_fields!(request)
    # This method has been adapted from Devise trackable module to keep previous behavior (IDSEQ-1558 / IDSEQ-1720)
    # See: https://github.com/plataformatec/devise/blob/715192a7709a4c02127afb067e66230061b82cf2/lib/devise/models/trackable.rb#L20
    return if new_record?

    old_current = current_sign_in_at
    new_current = Time.now.utc
    self.last_sign_in_at     = old_current || new_current
    self.current_sign_in_at  = new_current

    old_current = current_sign_in_ip
    new_current = request.remote_ip
    self.last_sign_in_ip     = old_current || new_current
    self.current_sign_in_ip  = new_current

    self.sign_in_count ||= 0
    self.sign_in_count += 1
    save(validate: false)
  end

  # This returns a hash of interesting optional data for Analytics user tracking.
  # Make sure you use any reserved names as intended by Segment or Appcues!
  # See https://segment.com/docs/spec/identify/#traits .
  def traits_for_analytics(include_pii: false)
    # Caching because this method does a lot of queries but does not need per-second accuracy.
    Rails.cache.fetch("traits_for_analytics-user-#{id}-#{include_pii}", expires_in: 1.minute) do
      traits = {
        # DB fields
        created_at: created_at,
        updated_at: updated_at,
        role: role,
        allowed_features: allowed_feature_list,
        # Derived fields
        admin: admin?,
        # Has-some (this is important for Google Custom Dimensions, which require
        # categorical values--there is no way to derive them from raw counts.) See
        # https://segment.com/docs/destinations/google-analytics/#custom-dimensions
        has_projects: !projects.empty?,
        has_samples: !samples.empty?,
        has_visualizations: !visualizations.empty?,
        has_phylo_trees: !phylo_trees.empty?,
        # Segment special fields
        createdAt: created_at.iso8601, # currently same as created_at
        # Login trackable fields (see User#update_tracked_fields!)
        sign_in_count: sign_in_count,
        current_sign_in_at: current_sign_in_at,
        last_sign_in_at: last_sign_in_at,
      }

      if include_pii
        pii_traits = {
          # DB fields
          email: email,
          name: name,
          institution: institution,
          biohub_user: biohub_user?,
          czi_user: czi_user?,
          projects: projects.size, # projects counter is NOT cached because has_and_belongs_to_many
          samples: samples.size,
          visualizations: visualizations.size,
          phylo_trees: phylo_trees.size,
          firstName: first_name,
          lastName: last_name,
          current_sign_in_ip: current_sign_in_ip,
          last_sign_in_ip: last_sign_in_ip,
        }
        traits.merge!(pii_traits)
      end
      traits
    end
  end

  private

  # CZID-523 -- reject accounts whose email domain is not on the approved institutional allowlist.
  # No-op when the allowlist is empty (enforcement disabled). The error is user-facing (surfaced by the
  # UsersController rescue and the GraphQL mutation), so keep it clear and actionable.
  def email_domain_allowed
    return if institutional_email?

    errors.add(:email, "domain is not on the list of approved institutional email domains. " \
                       "Please sign up with your institutional email address, or contact your administrator.")
  end
end
