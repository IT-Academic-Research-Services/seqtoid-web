class S3TransferJob < ApplicationRecord
  belongs_to :user

  STATUS = {
    created: "CREATED",
    running: "RUNNING",
    succeeded: "SUCCEEDED",
    failed: "FAILED",
  }.freeze

  # AWS Batch job statuses -> our status. See:
  # https://docs.aws.amazon.com/batch/latest/userguide/job_states.html
  BATCH_STATUS_MAPPING = {
    "SUBMITTED" => STATUS[:running],
    "PENDING" => STATUS[:running],
    "RUNNABLE" => STATUS[:running],
    "STARTING" => STATUS[:running],
    "RUNNING" => STATUS[:running],
    "SUCCEEDED" => STATUS[:succeeded],
    "FAILED" => STATUS[:failed],
  }.freeze

  FINALIZED_STATUSES = [STATUS[:succeeded], STATUS[:failed]].freeze

  validates :status, inclusion: { in: STATUS.values }

  scope :in_progress, -> { where(status: [STATUS[:created], STATUS[:running]]) }

  def finalized?
    FINALIZED_STATUSES.include?(status)
  end

  def update_status(remote_status, status_reason: nil)
    return if remote_status.blank?

    new_status = BATCH_STATUS_MAPPING[remote_status]
    return if new_status.blank?

    if new_status == STATUS[:failed]
      update(
        status: new_status,
        error_message: status_reason,
        time_to_finalized: time_since_executed_at
      )
    elsif new_status == STATUS[:succeeded]
      update(
        status: new_status,
        time_to_finalized: time_since_executed_at
      )
    elsif !finalized? && new_status != status
      update(status: new_status)
    end
  end

  private

  def time_since_executed_at
    Time.now.utc - executed_at if executed_at
  end
end
