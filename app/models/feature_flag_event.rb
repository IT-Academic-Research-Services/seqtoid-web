# One row per feature-flag change; written only by Feature (see db/migrate/*_create_feature_flag_events.rb).
class FeatureFlagEvent < ApplicationRecord
  ACTIONS = ["enable", "disable", "add_member", "remove_member"].freeze
  SCOPES = ["global", "user", "group"].freeze

  belongs_to :target_user, class_name: "User", optional: true
  belongs_to :actor_user, class_name: "User", optional: true

  validates :action, inclusion: { in: ACTIONS }
  validates :scope, inclusion: { in: SCOPES }
  validates :actor_label, :environment, presence: true

  scope :recent, ->(limit = 50) { order(created_at: :desc, id: :desc).limit(limit) }

  def readonly?
    persisted?
  end

  def self.current_environment
    deploy_env = ENV["ENVIRONMENT"].to_s.strip
    deploy_env.present? && deploy_env != Rails.env ? "#{Rails.env}/#{deploy_env}" : Rails.env.to_s
  end
end
