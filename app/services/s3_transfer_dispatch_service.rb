class S3TransferDispatchService
  # Selects a user's transferable output files (per the declarative policy in
  # config/s3_transfer_file_policy.yml) across their short-read-mngs + long-read-mngs
  # pipeline runs and AMR + consensus-genome workflow runs, writes a tab-separated
  # manifest of source/destination S3 URIs to the samples bucket under
  # `transfer-manifests/`, and submits an AWS Batch job that copies the listed
  # objects into the destination bucket. Each destination URI keeps the source key
  # and only swaps the bucket. Files the policy withholds (e.g. host-genomic /
  # PII-adjacent reads, raw inputs) are never included.

  include Callable

  MANIFEST_PREFIX = "transfer-manifests".freeze

  # Which output files transfer is decided by the declarative policy in
  # config/s3_transfer_file_policy.yml (loaded via S3TransferFilePolicy) - the
  # single source of truth, one explicit transfer/skip decision per file.

  # PipelineRun technology -> policy workflow name. Both short-read-mngs (Illumina)
  # and long-read-mngs (ONT) mNGS runs are PipelineRuns.
  PIPELINE_RUN_WORKFLOW = {
    PipelineRun::TECHNOLOGY_INPUT[:illumina] => "short-read-mngs",
    PipelineRun::TECHNOLOGY_INPUT[:nanopore] => "long-read-mngs",
  }.freeze

  # WorkflowRun workflows we transfer; each `workflow` value is also the policy key.
  TRANSFERABLE_WORKFLOW_RUN_WORKFLOWS = [
    WorkflowRun::WORKFLOW[:amr],
    WorkflowRun::WORKFLOW[:consensus_genome],
  ].freeze

  class JobDefinitionMissingError < StandardError
    def initialize
      super("S3_TRANSFER_JOB_DEFINITION_ARN env var not set.")
    end
  end

  class JobQueueMissingError < StandardError
    def initialize
      super("S3_TRANSFER_JOB_QUEUE_ARN env var not set.")
    end
  end

  class DestinationBucketMissingError < StandardError
    def initialize
      super("S3_TRANSFER_DESTINATION_BUCKET env var not set.")
    end
  end

  class NoFilesError < StandardError
    def initialize(user_id)
      super("No input files found for user #{user_id}.")
    end
  end

  def initialize(user_id)
    @user = User.find(user_id)
    @policy = S3TransferFilePolicy.instance
    # workflow name => Set of relative paths the policy did not classify (omissions).
    @unclassified = Hash.new { |hash, key| hash[key] = Set.new }

    # Per-environment config (set in the web task env via idseq-infra); required,
    # so fail loudly if unset rather than fall back to a hardcoded bucket/account.
    @job_definition = ENV["S3_TRANSFER_JOB_DEFINITION_ARN"].presence
    raise JobDefinitionMissingError if @job_definition.blank?

    @job_queue = ENV["S3_TRANSFER_JOB_QUEUE_ARN"].presence
    raise JobQueueMissingError if @job_queue.blank?

    @destination_bucket = ENV["S3_TRANSFER_DESTINATION_BUCKET"].presence
    raise DestinationBucketMissingError if @destination_bucket.blank?
  end

  def call
    file_paths = fetch_user_files(@user.id)
    log_unclassified
    raise NoFilesError, @user.id if file_paths.empty?

    transfer_job = S3TransferJob.create!(
      user: @user,
      status: S3TransferJob::STATUS[:created],
      destination_bucket: @destination_bucket,
      file_count: file_paths.size
    )

    manifest_body = build_manifest(file_paths)
    manifest_key = "#{MANIFEST_PREFIX}/#{transfer_job.id}.tsv"
    S3Util.upload_to_s3(SAMPLES_BUCKET_NAME, manifest_key, manifest_body)

    manifest_s3_uri = "s3://#{SAMPLES_BUCKET_NAME}/#{manifest_key}"
    submit_resp = submit_batch_job(transfer_job, manifest_s3_uri)

    transfer_job.update!(
      manifest_s3_key: manifest_key,
      batch_job_arn: submit_resp[:job_arn],
      batch_job_id: submit_resp[:job_id],
      status: S3TransferJob::STATUS[:running],
      executed_at: Time.now.utc
    )

    transfer_job
  rescue StandardError => e
    LogUtil.log_error(
      "Error dispatching S3 transfer job for user #{@user&.id}",
      exception: e
    )
    raise
  end

  private

  # S3 object keys (no bucket) for every output file the policy marks transfer:true
  # across the user's short-read-mngs + long-read-mngs pipeline runs and AMR +
  # consensus-genome workflow runs. Files marked :skip are omitted; :unclassified
  # files are recorded in @unclassified (logged by #log_unclassified) rather than
  # silently transferred. Raw inputs are intentionally NOT included (the policy
  # withholds them as host-genomic / PII-adjacent).
  def fetch_user_files(user_id)
    sample_ids = Sample.where(user_id: user_id).pluck(:id)
    return [] if sample_ids.empty?

    keys = []

    PipelineRun
      .non_deprecated
      .non_deleted
      .where(sample_id: sample_ids)
      .where.not(sfn_execution_arn: [nil, ""])
      .find_each do |pipeline_run|
        workflow = PIPELINE_RUN_WORKFLOW[pipeline_run.technology]
        next if workflow.nil?
        next unless pipeline_run.migratable? # short-read >= 7.0.0; ONT exempt

        collect_transferable_keys(pipeline_run.sfn_results_path, workflow, keys)
      end

    WorkflowRun
      .non_deprecated
      .non_deleted
      .where(sample_id: sample_ids, workflow: TRANSFERABLE_WORKFLOW_RUN_WORKFLOWS)
      .where.not(sfn_execution_arn: [nil, ""])
      .find_each do |workflow_run|
        collect_transferable_keys(workflow_run.sfn_results_path, workflow_run.workflow, keys)
      end

    keys.uniq
  end

  # Lists the objects directly under a run's results prefix and appends the S3
  # keys the policy marks transfer:true for the given workflow. Verified against
  # real staging runs: the SFN-WDL harness flattens WDL output subdirectories
  # (assembly/, coverage_viz/) into the results root, and the only nested entries
  # are orchestration artifacts (minimap2-chunks/, sfn-desc/, sfn-hist/). Listing
  # top-level (delimiter "/") therefore captures every real output and skips that
  # cruft. Files the policy does not classify are recorded (see @unclassified).
  def collect_transferable_keys(results_path, workflow, keys)
    return if results_path.blank?

    bucket, prefix_key = S3Util.parse_s3_path(results_path)
    return if bucket != SAMPLES_BUCKET_NAME || prefix_key.blank?

    prefix = prefix_key.end_with?("/") ? prefix_key : "#{prefix_key}/"

    continuation_token = nil
    loop do
      resp = AwsClient[:s3].list_objects_v2(
        bucket: bucket,
        prefix: prefix,
        delimiter: "/",
        continuation_token: continuation_token
      )
      resp.contents.each do |obj|
        basename = obj.key.delete_prefix(prefix)
        next if basename.empty? || basename.include?("/")

        case @policy.classify(workflow, basename)
        when S3TransferFilePolicy::TRANSFER
          keys << obj.key
        when S3TransferFilePolicy::UNCLASSIFIED
          @unclassified[workflow] << basename
        end
      end
      break unless resp.is_truncated

      continuation_token = resp.next_continuation_token
    end
  end

  # Surfaces any output files the policy did not classify so they are visibly
  # flagged for a policy decision instead of being silently dropped.
  def log_unclassified
    return if @unclassified.empty?

    LogUtil.log_message(
      "S3 transfer: unclassified output files skipped for user #{@user.id}; " \
      "review and classify in config/s3_transfer_file_policy.yml",
      user_id: @user.id,
      unclassified_counts: @unclassified.transform_values(&:size),
      unclassified_files: @unclassified.transform_values(&:to_a)
    )
  end

  def build_manifest(file_paths)
    file_paths.map do |path|
      source = "s3://#{SAMPLES_BUCKET_NAME}/#{path}"
      destination = "s3://#{@destination_bucket}/#{path}"
      "#{source}\t#{destination}"
    end.join("\n")
  end

  def submit_batch_job(transfer_job, manifest_s3_uri)
    AwsClient[:batch].submit_job(
      job_name: "czid-#{Rails.env}-s3-transfer-#{transfer_job.id}",
      job_queue: @job_queue,
      job_definition: @job_definition,
      container_overrides: {
        environment: [
          { name: "MANIFEST_S3_URI", value: manifest_s3_uri },
          { name: "DESTINATION_BUCKET", value: @destination_bucket },
        ],
      }
    )
  end
end
