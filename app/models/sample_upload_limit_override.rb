# An approved exception to the weekly sample upload limits for one user: higher limits per channel, or
# none at all (unlimited). A NULL limit keeps the deployment default for that channel. See
# WeeklySampleUploadLimit and lib/tasks/upload_limits.rake.
class SampleUploadLimitOverride < ApplicationRecord
  LIMIT_COLUMNS = {
    "cli" => :cli_weekly_limit,
    "web" => :web_weekly_limit,
    "s3" => :s3_weekly_limit,
    "basespace" => :basespace_weekly_limit,
    "total" => :total_weekly_limit,
  }.freeze

  belongs_to :user

  validates :user_id, uniqueness: true
  validates :approved_by, :reason, presence: true
  validates(*LIMIT_COLUMNS.values, numericality: { only_integer: true, greater_than: 0 }, allow_nil: true)

  scope :active, -> { where(expires_at: nil).or(where("expires_at > ?", Time.current)) }

  def limit_for(scope)
    self[LIMIT_COLUMNS.fetch(scope)]
  end
end
