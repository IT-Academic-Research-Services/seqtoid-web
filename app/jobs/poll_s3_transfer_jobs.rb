class PollS3TransferJobs
  extend InstrumentedJob

  @queue = :poll_s3_transfer_jobs

  BATCH_DESCRIBE_JOBS_PAGE_SIZE = 100

  def self.perform
    transfer_jobs = S3TransferJob.in_progress.where.not(batch_job_arn: nil)
    return if transfer_jobs.empty?

    transfer_jobs.find_in_batches(batch_size: BATCH_DESCRIBE_JOBS_PAGE_SIZE) do |batch|
      arns = batch.map(&:batch_job_arn)
      resp = AwsClient[:batch].describe_jobs(jobs: arns)
      jobs_by_arn = resp[:jobs].index_by { |j| j[:job_arn] }

      batch.each do |transfer_job|
        remote = jobs_by_arn[transfer_job.batch_job_arn]
        next if remote.blank?

        transfer_job.update_status(remote[:status], status_reason: remote[:status_reason])
      rescue StandardError => e
        LogUtil.log_error(
          "Error polling S3TransferJob #{transfer_job.id}",
          exception: e,
          batch_job_arn: transfer_job.batch_job_arn
        )
      end
    end
  end
end
