# Job to initiate s3 copy
class InitiateS3Cp
  extend InstrumentedJob
  # Shells out to S3 to copy sample input files -- prone to transient S3 errors
  # (SlowDown/503, throttling, endpoint blips). Retry with backoff and dead-letter
  # on exhaustion so an upload copy is retried + visible rather than lost (#496).
  extend ResqueRetryWithDeadLetter

  @queue = :initiate_fastq_files_s3_cp
  def self.perform(sample_id, unlimited_size = false)
    sample = Sample.find(sample_id)
    Rails.logger.info("Start copying sample #{sample.id}")
    output = sample.initiate_fastq_files_s3_cp(unlimited_size)
    Rails.logger.info("Finished copying sample #{sample.id} success=#{output}")

    WorkflowRun.handle_sample_upload_restart(sample)
  end
end
