class S3TransferJobsController < ApplicationController
  before_action :admin_required

  # GET /s3_transfer_jobs
  def index
    @transfer_jobs = S3TransferJob.includes(:user).order(created_at: :desc)
  end
end
