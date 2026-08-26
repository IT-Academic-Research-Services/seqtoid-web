require 'shellwords'

class BulkDownload < ApplicationRecord
  include AppConfigHelper
  include SamplesHelper
  include PipelineOutputsHelper
  include PipelineRunsHelper
  include BulkDownloadTypesHelper
  include ParameterSanitization
  include Rails.application.routes.url_helpers
  has_and_belongs_to_many :pipeline_runs
  has_and_belongs_to_many :workflow_runs
  belongs_to :user
  has_secure_token :access_token
  scope :non_deleted, -> { where(deleted_at: nil) }
  after_destroy :cleanup_s3

  STATUS_WAITING = "waiting".freeze
  STATUS_RUNNING = "running".freeze
  STATUS_ERROR = "error".freeze
  STATUS_SUCCESS = "success".freeze
  OUTPUT_DOWNLOAD_EXPIRATION = 86_400 # seconds
  PROGRESS_UPDATE_DELAY = 15 # Minimum number of seconds between progress updates.
  ECS_TASK_NAME = "bulk_downloads".freeze
  # [CZID-9274] We auto-delete BulkDownload and its S3 files via DeleteOldBulkDownloads job.
  AUTO_DELETE_AFTER_NUM_DAYS = 7

  # AWS Batch target for the s3_tar_writer job (migration off aegea -> EKS/Batch; #846/SMP-1477).
  # Provisioned in cypherid-web-infra dev/batch/bulk-download.tf. Overridable per env; the defaults
  # follow the same `${ENVIRONMENT}` naming the infra uses.
  BULK_DOWNLOAD_BATCH_JOB_QUEUE = ENV["BULK_DOWNLOAD_BATCH_JOB_QUEUE"].presence ||
                                  "idseq-#{ENV.fetch('ENVIRONMENT', 'dev')}-lomem"
  BULK_DOWNLOAD_BATCH_JOB_DEFINITION = ENV["BULK_DOWNLOAD_BATCH_JOB_DEFINITION"].presence ||
                                       "seqtoid-web-#{ENV.fetch('ENVIRONMENT', 'dev')}-bulk-download"

  # K8s-Job launcher target (latency: <30s on the dedicated warm bulk-download node; #846/SMP-1477).
  # The tar runs as a Job on the tainted `seqtoid.io/pool=bulk-download` NodePool, as the IRSA SA
  # seqtoid-web-bulk-download. Env-overridable; defaults match cypherid-web-infra.
  BULK_DOWNLOAD_JOB_IMAGE = ENV["BULK_DOWNLOAD_JOB_IMAGE"].presence ||
                            "#{ENV.fetch('AWS_ACCOUNT_ID', '491013321714')}.dkr.ecr.#{ENV.fetch('AWS_REGION', 'us-west-2')}.amazonaws.com/idseq-s3-tar-writer:latest"
  BULK_DOWNLOAD_JOB_SA   = ENV["BULK_DOWNLOAD_JOB_SA"].presence || "seqtoid-web-bulk-download"
  BULK_DOWNLOAD_POOL     = ENV["BULK_DOWNLOAD_POOL"].presence || "bulk-download"
  BULK_DOWNLOAD_JOB_CPU  = ENV["BULK_DOWNLOAD_JOB_CPU"].presence || "2"
  BULK_DOWNLOAD_JOB_MEM  = ENV["BULK_DOWNLOAD_JOB_MEM"].presence || "4Gi"

  before_save :convert_params_to_json

  attr_writer :params

  # Raised when the shelled-out ECS/aegea kickoff command exits non-zero. Wraps
  # the failure with a clean, human-readable message instead of re-raising the
  # raw Python traceback that the subprocess emitted on stderr (see #532).
  class KickoffError < StandardError; end

  validates :status, presence: true, inclusion: { in: [STATUS_WAITING, STATUS_RUNNING, STATUS_ERROR, STATUS_SUCCESS] }
  validate :params_checks

  # This is a wrapper around the params_json field that exposes params_json as a Hash via "params".
  # You should not ever access params_json or @params directly. Call "params" instead.
  # If you read and write to params, params_json will be updated automatically when you save.
  def params
    # Load params from params_json if necessary.
    if @params.nil? && params_json
      @params = JSON.parse(params_json)
    end
    @params
  end

  def convert_params_to_json
    # Convert params to JSON right before saving.
    if params
      self.params_json = params.to_json
    end
  end

  def params_checks
    if download_type == BulkDownloadTypesHelper::SAMPLE_TAXON_REPORT_BULK_DOWNLOAD_TYPE && get_param_value("workflow") == WorkflowRun::WORKFLOW[:short_read_mngs]
      errors.add(:params, "background value must be an integer") unless get_param_value("background").nil? || get_param_value("background").is_a?(Integer)
    end

    if download_type == BulkDownloadTypesHelper::COMBINED_SAMPLE_TAXON_RESULTS_BULK_DOWNLOAD_TYPE
      metric = get_param_value("metric")
      workflow = get_param_value("workflow")
      all_metrics = WorkflowRun::WORKFLOW_METRICS[workflow]
      errors.add(:params, "metrics value is invalid") unless all_metrics && all_metrics.pluck(:value).include?(metric)

      if ["NT.zscore", "NR.zscore"].include?(metric)
        errors.add(:params, "background value must be an integer") unless get_param_value("background").is_a? Integer
      end
    end

    if download_type == BulkDownloadTypesHelper::READS_NON_HOST_BULK_DOWNLOAD_TYPE
      taxa_with_reads = get_param_value("taxa_with_reads")
      errors.add(:params, "taxa_with_reads must be all or an integer") unless taxa_with_reads.is_a?(Integer) || taxa_with_reads == "all"

      if taxa_with_reads == "all"
        errors.add(:params, "file_format must be .fasta or .fastq") unless [".fasta", ".fastq"].include?(get_param_value("file_format"))
      end
    end

    if download_type == BulkDownloadTypesHelper::CONTIGS_NON_HOST_BULK_DOWNLOAD_TYPE
      taxa_with_contigs = get_param_value("taxa_with_contigs")
      errors.add(:params, "taxa_with_contigs must be all or an integer") unless taxa_with_contigs.is_a?(Integer) || taxa_with_contigs == "all"
    end

    if download_type == BulkDownloadTypesHelper::CONSENSUS_GENOME_DOWNLOAD_TYPE
      errors.add(:params, "download_format must be Separate Files or Single File (Concatenated)") unless [BulkDownloadTypesHelper::SEPARATE_FILES_DOWNLOAD, BulkDownloadTypesHelper::SINGLE_FILE_CONCATENATED_DOWNLOAD].include?(get_param_value("download_format"))
    end

    if download_type == BulkDownloadTypesHelper::BIOM_FORMAT_DOWNLOAD_TYPE
      valid_count_types = ["NT", "NR"]
      valid_operators = [">=", "<="]

      metric_string = get_param_value("metric")
      count_type, metric = BulkDownloadsHelper.parse_metric_string(metric_string)
      errors.add(:params, "count type is invalid") unless valid_count_types.include?(count_type)
      errors.add(:params, "metric value is invalid") unless BulkDownloadsHelper::METRIC_MAP.value?(metric)

      background_id = get_param_value("background_id")
      errors.add(:params, "background value must be an integer") unless background_id.nil? || background_id.is_a?(Integer)

      categories = get_param_value("categories")
      errors.add(:params, "category is invalid") unless categories.blank? || (categories - [
        "Bacteria", "Archaea", "Eukaryota", "Viruses", "Viroids",
      ]).empty?

      threshold_filters = get_param_value("filter_by")
      threshold_filters.present? && threshold_filters.each do |threshold_filter|
        threshold_count_type, threshold_metric = BulkDownloadsHelper.parse_metric_string(threshold_filter["metric"])
        errors.add(:params, "threshold filter contains invalid count type") unless valid_count_types.include?(threshold_count_type)
        errors.add(:params, "threshold filter contains invalid metric") unless BulkDownloadsHelper::METRIC_MAP.value?(threshold_metric)

        errors.add(:params, "threshold filter contains invalid operator") unless valid_operators.include?(threshold_filter["operator"])
      end
    end
  end

  # Only bulk downloads created by the user, and not marked for deletion
  def self.viewable(user)
    if user.admin?
      all
    else
      user.bulk_downloads
    end.non_deleted
  end

  def validate_access_token(access_token)
    return self.access_token.present? && self.access_token == access_token
  end

  def output_file_presigned_url
    if status != STATUS_SUCCESS
      return nil
    end

    begin
      filename = BulkDownloadTypesHelper.bulk_download_type_display_name(download_type)
      filename += if download_type == CONSENSUS_GENOME_DOWNLOAD_TYPE && get_param_value("download_format") == BulkDownloadTypesHelper::SINGLE_FILE_CONCATENATED_DOWNLOAD
                    ".fa"
                  elsif download_type == BIOM_FORMAT_DOWNLOAD_TYPE
                    ".biom"
                  else
                    ".tar.gz"
                  end

      return S3_PRESIGNER.presigned_url(:get_object,
                                        bucket: download_bucket_name,
                                        key: download_output_key,
                                        expires_in: OUTPUT_DOWNLOAD_EXPIRATION,
                                        response_content_disposition: "attachment; filename=\"#{filename}\"").to_s
    rescue StandardError => e
      # SMP-1748: never log access_token. It is our own single-use callback bearer token
      # (has_secure_token, embedded as a path segment in the success/error/progress routes),
      # so writing it verbatim put a live credential into the Rails log -> CloudWatch/Loki.
      # A fingerprint would add nothing here: there is exactly one token per bulk download and
      # it is nulled on the first callback, so it is useless as a correlation key. The record
      # id is the identifier an operator can actually act on, so log that instead.
      LogUtil.log_error("BulkDownloadPresignError: #{e.inspect}", exception: e, bulk_download_id: id)
    end
    nil
  end

  def server_host
    # SMP-1636 / #950: normalize to include a scheme. env-staging's SERVER_DOMAIN is bare
    # (env-staging.seqtoid.org) while dev's carries https://; a schemeless callback url makes the
    # s3-tar-writer's status ping go http -> 301 -> https (urllib3 FutureWarning) instead of straight
    # to https. Default a schemeless value to https so every env builds a proper callback url.
    domain = ENV["SERVER_DOMAIN"]
    return domain if domain.blank?

    domain.match?(%r{\Ahttps?://}) ? domain : "https://#{domain}"
  end

  def log_stream_name
    if ecs_task_arn.nil?
      nil
    else
      "#{ECS_TASK_NAME}/#{ECS_TASK_NAME}/#{ecs_task_arn.split('/')[-1]}"
    end
  end

  def log_url
    if execution_type == BulkDownloadTypesHelper::ECS_EXECUTION_TYPE && log_stream_name
      AwsUtil.get_cloudwatch_url("bulk_downloads", log_stream_name)
    end
  end

  # The callback routes embed the access_token as a path segment, so generating one with a nil token
  # raises an opaque ActionController::UrlGenerationError rather than returning a url (Sentry
  # DEV-RAILS-PROJECT-28). access_token is single-use: success_with_token / error_with_token null it
  # once the download reaches a terminal state, so ANY path that rebuilds the task command for an
  # already-finished download hits nil. Guard it the same way server_host is guarded, and return nil.

  # The Rails success url that the s3_tar_writer task can ping once it succeeds.
  def success_url
    return nil if server_host.blank? || access_token.blank?

    "#{server_host}#{bulk_downloads_success_path(access_token: access_token, id: id)}"
  end

  # The Rails error url that the s3_tar_writer task can ping if it fails.
  def error_url
    return nil if server_host.blank? || access_token.blank?

    "#{server_host}#{bulk_downloads_error_path(access_token: access_token, id: id)}"
  end

  # The Rails progress url that the s3_tar_writer task can ping to update progress.
  def progress_url
    return nil if server_host.blank? || access_token.blank?

    "#{server_host}#{bulk_downloads_progress_path(access_token: access_token, id: id)}"
  end

  # The aegea ECS bulk-download tasks (cluster + executable-file bucket) are only
  # provisioned per deployment stage (test/staging/prod); there is no "development"
  # aegea cluster/bucket. So on a local `development` boot the ECS cluster and
  # executable-file S3 bucket must be redirected to a real deployment stage. We derive
  # that stage from ENV["ENVIRONMENT"] -- the same var the SFN ARNs are driven from
  # (#385) -- defaulting to "staging" so a dev-env bulk download submits to the staging
  # cluster/bucket instead of a non-existent `*-development` one (#186).
  # NB: this only governs the cluster/bucket; task_role stays keyed on Rails.env, matching
  # the prior behavior (the download IAM role IS provisioned per Rails env).
  AEGEA_DEV_FALLBACK_STAGE = "staging".freeze

  def aegea_deployment_stage
    ENV["ENVIRONMENT"].presence || AEGEA_DEV_FALLBACK_STAGE
  end

  # Returned as an array of strings
  def aegea_ecs_submit_command(
    executable_file_path: nil,
    task_role: "czi-infectious-disease-downloads-#{Rails.env}", # role is provisioned per Rails env
    ecs_cluster: "idseq-fargate-tasks-#{Rails.env}",
    executable_s3_bucket: S3_AEGEA_ECS_EXECUTE_BUCKET,
    ecr_image: "idseq-s3-tar-writer:latest",
    fargate_cpu: "4096",
    fargate_memory: "8192"
  )
    config_ecr_image = get_app_config(AppConfig::S3_TAR_WRITER_SERVICE_ECR_IMAGE)
    unless config_ecr_image.nil?
      ecr_image = config_ecr_image
    end

    # In local development there is no `*-development` aegea cluster/bucket, so redirect
    # to a real deployment stage (ENV["ENVIRONMENT"], default "staging"). See #186.
    if Rails.env.development?
      ecs_cluster = "idseq-fargate-tasks-#{aegea_deployment_stage}"
      executable_s3_bucket = "aegea-ecs-execute-#{aegea_deployment_stage}"
    end

    command_flag = "--execute=#{executable_file_path}"

    command = ["aegea", "ecs", "run",
               command_flag,
               "--task-role", task_role,
               "--task-name", ECS_TASK_NAME,
               "--ecr-image", ecr_image,
               "--fargate-cpu", fargate_cpu,
               "--fargate-memory", fargate_memory,
               "--cluster", ecs_cluster,]

    if executable_file_path.present?
      command += ["--staging-s3-bucket", executable_s3_bucket]
    end

    command
  end

  # Returned as an array of strings
  def s3_tar_writer_command(
    src_urls,
    tar_names,
    dest_url,
    success_url: self.success_url,
    error_url: self.error_url,
    progress_url: self.progress_url
  )
    # Fail fast on a malformed src/tar mapping before it reaches the tar job. A nil/blank src url
    # gets stringified to "" downstream (the SMP-1488 Batch/K8s `.map(&:to_s)`) and would silently
    # produce a broken or incomplete archive; a src/tar length mismatch mis-maps file contents to
    # file names. Rather than hide that behind a clean failure, log exactly which outputs are missing
    # (tar name -> sample/project) so the ROOT cause -- a selected run with no output S3 path -- can
    # be found and fixed, then raise a clear typed error (same style as SUCCESS_URL_REQUIRED).
    if src_urls.blank? || src_urls.any?(&:blank?)
      missing = tar_names.each_with_index.select { |_name, i| src_urls[i].blank? }.map(&:first)
      LogUtil.log_error(
        "BulkDownloadIncompleteSrcUrls: bulk download #{id} (#{download_type}) has missing source files; " \
        "refusing to launch a tar job that would yield a broken archive.",
        bulk_download_id: id,
        download_type: download_type,
        src_url_count: src_urls&.length,
        tar_name_count: tar_names&.length,
        missing_output_files: missing
      )
      raise BulkDownloadsHelper::INCOMPLETE_SRC_URLS
    end
    if src_urls.length != tar_names.length
      LogUtil.log_error(
        "BulkDownloadSrcTarMismatch: bulk download #{id} (#{download_type}) built #{src_urls.length} source " \
        "urls but #{tar_names.length} tar names; file contents would be mis-mapped to file names.",
        bulk_download_id: id,
        download_type: download_type,
        src_url_count: src_urls.length,
        tar_name_count: tar_names.length
      )
      raise BulkDownloadsHelper::SRC_TAR_NAME_MISMATCH
    end

    command = ["python", "s3_tar_writer.py",
               "--src-urls", *src_urls,
               # these can be based on user generated strings so we need to strip leading - to prevent
               # them from being interpreted as flags
               "--tar-names", *tar_names.map { |s| s.sub(/^-*/, '') },
               "--dest-url", dest_url,
               "--progress-delay", PROGRESS_UPDATE_DELAY,]

    # The success url is mandatory.
    if success_url
      command += ["--success-url", success_url]
    else
      raise BulkDownloadsHelper::SUCCESS_URL_REQUIRED
    end
    if error_url
      command += ["--error-url", error_url]
    end
    if progress_url
      command += ["--progress-url", progress_url]
    end
    command
  end

  def download_bucket_name
    ENV['SAMPLES_BUCKET_NAME_V1']
  end

  def download_output_prefix
    "downloads/#{id}"
  end

  def download_output_key
    download_key = "#{download_output_prefix}/#{BulkDownloadTypesHelper.bulk_download_type_display_name(download_type)}"
    if download_type == CONSENSUS_GENOME_DOWNLOAD_TYPE && get_param_value("download_format") == BulkDownloadTypesHelper::SINGLE_FILE_CONCATENATED_DOWNLOAD
      "#{download_key}.fa"
    elsif download_type == BIOM_FORMAT_DOWNLOAD_TYPE
      "#{download_key}.biom"
    else
      "#{download_key}.tar.gz"
    end
  end

  def fetch_output_file_size
    s3_response = S3_CLIENT.head_object(bucket: download_bucket_name, key: download_output_key)
    return s3_response.content_length
  rescue StandardError => e
    LogUtil.log_error("BulkDownloadsFileSizeError: Failed to get file size for bulk download id #{id}: #{e}", exception: e, bulk_download_id: id)
  end

  # The s3 url that the tar.gz file will be uploaded to.
  def download_output_url
    "s3://#{download_bucket_name}/#{download_output_key}"
  end

  def create_local_exec_file(shell_command)
    executable_file = Tempfile.new
    executable_file.write(shell_command)
    executable_file.close
    executable_file
  end

  def kickoff_ecs_task(
    shell_command_array
  )
    executable_file = nil
    shell_command_escaped = shell_command_array.map { |s| Shellwords.escape(s) }.join(" ")
    executable_file = create_local_exec_file(shell_command_escaped)
    aegea_command = aegea_ecs_submit_command(executable_file_path: executable_file.path.to_s)

    # aegea shells out to AWS (ECS/Batch/ECR/S3) and fails intermittently on
    # throttling / capacity / transient network / 5xx / timeouts. AegeaRetry
    # retries only those transient signals with exponential backoff + jitter and
    # surfaces permanent failures (bad args, unknown cluster, AccessDenied)
    # immediately with the real stderr. First-try success behaves exactly as
    # a bare Open3.capture3.
    command_stdout, command_stderr, status = AegeaRetry.capture3(*aegea_command)
    if status.exitstatus.zero?
      output = JSON.parse(command_stdout)
      # Store the taskArn for debugging purposes.
      self.ecs_task_arn = output['taskArn']
      self.status = STATUS_RUNNING
      save!
    else
      self.status = STATUS_ERROR
      self.error_message = BulkDownloadsHelper::KICKOFF_FAILURE
      save!
      # Log the raw subprocess stderr (which may carry a Python traceback) for
      # debugging, but raise a typed error with a clean, human-readable message
      # rather than re-raising the raw traceback string (see #532).
      LogUtil.log_error(
        "BulkDownloadKickoffError: aegea ECS kickoff failed for bulk download #{id}: #{command_stderr}",
        bulk_download_id: id
      )
      raise KickoffError, BulkDownloadsHelper::KICKOFF_FAILURE
    end
  ensure
    if executable_file.present?
      executable_file.unlink
    end
  end

  # Submit the s3_tar_writer job to AWS Batch (replaces the aegea -> ECS-Fargate shell-out;
  # #846/SMP-1477). The s3_tar_writer image is launcher-agnostic, so the command array is passed
  # straight through as a Batch container override -- no local exec file, no aegea staging bucket,
  # and no shell escaping (exec-form args are passed literally). Same status semantics as the old
  # path: RUNNING on a successful submit, ERROR + typed KickoffError on failure.
  def kickoff_batch_job(command_array)
    response = BATCH_CLIENT.submit_job(
      job_name: "bulk-download-#{id}",
      job_queue: BULK_DOWNLOAD_BATCH_JOB_QUEUE,
      job_definition: BULK_DOWNLOAD_BATCH_JOB_DEFINITION,
      # Batch requires every command element to be a String. The command array can carry
      # non-strings (e.g. PROGRESS_UPDATE_DELAY, an Integer); the old aegea path shell-joined
      # them so this never surfaced. Stringify so submit_job param validation passes.
      container_overrides: { command: command_array.map(&:to_s) }
    )
    # Reuse the existing column to store the Batch job ARN (no migration).
    self.ecs_task_arn = response.job_arn
    self.status = STATUS_RUNNING
    save!
  rescue Aws::Errors::ServiceError => e
    self.status = STATUS_ERROR
    self.error_message = BulkDownloadsHelper::KICKOFF_FAILURE
    save!
    LogUtil.log_error(
      "BulkDownloadKickoffError: Batch submit_job failed for bulk download #{id}: #{e.class}: #{e.message}",
      exception: e,
      bulk_download_id: id
    )
    raise KickoffError, BulkDownloadsHelper::KICKOFF_FAILURE
  end

  # Launch the s3_tar_writer as a K8s Job on the dedicated warm bulk-download node (#846/SMP-1477).
  # Replaces the Batch submit_job: no instance cold-start (the warm-keeper holds a node), dedicated
  # + right-sized, EKS-native. Same status semantics; stores the Job name in ecs_task_arn.
  def kickoff_k8s_job(command_array)
    client = KubeJobClient.new
    result = client.create_job(build_k8s_job_manifest(command_array))
    self.ecs_task_arn = result.dig("metadata", "name")
    self.status = STATUS_RUNNING
    save!
  rescue StandardError => e
    self.status = STATUS_ERROR
    self.error_message = BulkDownloadsHelper::KICKOFF_FAILURE
    save!
    LogUtil.log_error(
      "BulkDownloadKickoffError: K8s Job create failed for bulk download #{id}: #{e.class}: #{e.message}",
      exception: e,
      bulk_download_id: id
    )
    raise KickoffError, BulkDownloadsHelper::KICKOFF_FAILURE
  end

  # The tar Job: dedicated tainted pool, IRSA SA for S3, default priority (preempts the warm-keeper),
  # right-sized requests, auto-cleanup via ttlSecondsAfterFinished. Command elements are stringified.
  def build_k8s_job_manifest(command_array)
    labels = { "app" => "bulk-download", "seqtoid.io/bulk-download-id" => id.to_s }
    {
      apiVersion: "batch/v1",
      kind: "Job",
      metadata: { name: "bulk-download-#{id}", labels: labels },
      spec: {
        # SMP-1636 / #950: 0 (was 1). A tar-writer failure is deterministic, so a retry re-does the
        # whole tar for no benefit AND re-pings the single-use callback token, which attempt 1 already
        # consumed -> a spurious 401 on the retry's status ping (the download is already correctly
        # marked errored by attempt 1). One attempt = one ping, no token replay, no phantom 401.
        backoffLimit: 0,
        ttlSecondsAfterFinished: 3600,   # auto-delete the finished Job after 1h
        activeDeadlineSeconds: 10_800,   # 3h cap
        template: {
          metadata: { labels: labels },
          spec: {
            serviceAccountName: BULK_DOWNLOAD_JOB_SA,
            restartPolicy: "Never",
            nodeSelector: { "seqtoid.io/pool" => BULK_DOWNLOAD_POOL },
            tolerations: [{ key: "seqtoid.io/pool", value: BULK_DOWNLOAD_POOL, effect: "NoSchedule" }],
            containers: [{
              name: "s3-tar-writer",
              image: BULK_DOWNLOAD_JOB_IMAGE,
              command: command_array.map(&:to_s),
              resources: {
                requests: { cpu: BULK_DOWNLOAD_JOB_CPU, memory: BULK_DOWNLOAD_JOB_MEM },
                limits: { cpu: BULK_DOWNLOAD_JOB_CPU, memory: BULK_DOWNLOAD_JOB_MEM },
              },
            }],
          },
        },
      },
    }
  end

  def get_param_field(key, field)
    params.dig(key, field)
  rescue StandardError
    # If params is nil or malformed, will return nil
    nil
  end

  def get_param_value(key)
    get_param_field(key, "value")
  end

  def get_param_display_name(key)
    get_param_field(key, "displayName")
  end

  # cleaned_project_names is a map from project id to cleaned project name
  # The prefix is designed to be <= 75 chars.
  # Bulk downloads should ensure that the suffix they add (e.g. contigs_nh.fasta, reads_per_gene.star.tab)
  # is <= 25 chars, so that the total file name is <= 100 chars.
  def get_output_file_prefix(sample, cleaned_project_names)
    # Truncate the project name to 100 chars.
    project_name_truncated = cleaned_project_names[sample.project_id][0...100]
    sample_id_str = "_#{sample.id}_"
    # Truncate the sample name to 65 chars (we keep the truncation fixed so users can parse the file name easier)
    # However, if we ever get to 100M samples, we will need to truncate further.
    max_sample_name_length = [65, 75 - sample_id_str.length].min
    sample_name_truncated = sample.name[0...max_sample_name_length]

    "#{project_name_truncated}_#{sample.project_id}/#{sample_name_truncated}#{sample_id_str}"
  end

  def get_accession_id(workflow_run)
    accession_id = workflow_run.inputs&.[]("accession_id")
    if accession_id
      # Should not be necessary but sanitizing out of an abundance of caution
      sanitize_accession_id(accession_id)
    end
  end

  def get_accession_id_prefix(workflow_run, include_ending_underscore: true)
    accession_id = get_accession_id(workflow_run)
    if accession_id.present?
      include_ending_underscore ? accession_id + "_" : accession_id
    end
  end

  def bulk_download_ecs_task_command
    # Order both pipeline runs and samples by ascending sample id.
    # This ensures that the download src-urls and tar-names have the same order which is critical to
    # mapping the file content to the correct file name.
    if pipeline_runs.present?
      pipeline_runs_ordered = pipeline_runs.order(:sample_id)
      samples_ordered = Sample.where(id: pipeline_runs_ordered.map(&:sample_id)).order(:id)
    else
      workflow_runs_ordered = workflow_runs.order(:sample_id)
      samples_ordered = Sample.where(id: workflow_runs_ordered.map(&:sample_id)).order(:id)
    end
    projects = Project.where(id: samples_ordered.pluck(:project_id))

    # Compute cleaned project name once instead of once per sample.
    cleaned_project_names = {}
    projects.each do |project|
      cleaned_project_names[project.id] = project.cleaned_project_name
    end

    download_src_urls = nil
    download_tar_names = nil

    # if download_type == ORIGINAL_INPUT_FILE_BULK_DOWNLOAD_TYPE
    #   samples_ordered = samples_ordered.includes(:input_files)
    #
    #   download_src_urls = samples_ordered.map(&:input_file_s3_paths).flatten
    #
    #   # File output name notes:
    #   # We use the sample name in the output file names (instead of the original input file names)
    #   # because the sample name is what's visible on the UI and because the original file names might be non-unique.
    #   # We include the project id because the cleaned project names might be non-unique.
    #   download_tar_names = samples_ordered.map do |sample|
    #     input_fastq_index = 0
    #     sample.input_files.map do |input_file|
    #       if input_file.file_type == InputFile::FILE_TYPE_FASTQ
    #         if sample.input_files.fastq.count < 2
    #           # Single-end sample
    #           "#{get_output_file_prefix(sample, cleaned_project_names)}" \
    #               "original.#{input_file.file_extension}"
    #         else
    #           # Paired-end sample
    #           # We assume that the first input fastq file is R1 and the second input fastq file is R2. This is the convention that the pipeline follows.
    #           input_fastq_index += 1
    #           "#{get_output_file_prefix(sample, cleaned_project_names)}" \
    #             "original_R#{input_fastq_index}.#{input_file.file_extension}"
    #         end
    #       elsif input_file.file_type == InputFile::FILE_TYPE_REFERENCE_SEQUENCE
    #         "#{get_output_file_prefix(sample, cleaned_project_names)}" \
    #           "original_reference_sequence.#{input_file.file_extension}"
    #       elsif input_file.file_type == InputFile::FILE_TYPE_PRIMER_BED
    #         "#{get_output_file_prefix(sample, cleaned_project_names)}" \
    #           "original_primer.#{input_file.file_extension}"
    #       end
    #     end
    #   end.flatten
    # end

    if download_type == UNMAPPED_READS_BULK_DOWNLOAD_TYPE
      download_src_urls = pipeline_runs_ordered.map(&:unidentified_fasta_s3_path)

      download_tar_names = samples_ordered.map do |sample|
        "#{get_output_file_prefix(sample, cleaned_project_names)}" \
          "unmapped.fasta"
      end
    end

    if download_type == READS_NON_HOST_BULK_DOWNLOAD_TYPE && get_param_value("file_format") == ".fasta"
      download_src_urls = pipeline_runs_ordered.map(&:annotated_fasta_s3_path)

      download_tar_names = samples_ordered.map do |sample|
        "#{get_output_file_prefix(sample, cleaned_project_names)}" \
          "reads_nh.fasta"
      end
    end

    if download_type == READS_NON_HOST_BULK_DOWNLOAD_TYPE && get_param_value("file_format") == ".fastq"
      pipeline_runs_ordered = pipeline_runs_ordered.includes(sample: [:input_files])

      download_src_urls = pipeline_runs_ordered.map(&:nonhost_fastq_s3_paths).flatten

      download_tar_names = pipeline_runs_ordered.map do |pipeline_run|
        sample = pipeline_run.sample
        # file_ext will always be fastq for ONT samples
        file_ext = sample.fasta_input? ? 'fasta' : 'fastq'
        # We assume that the first input file is R1 and the second input file is R2 for Illumina. This is the convention that the pipeline follows.
        # Nanopore samples will only have one input file and it will always be .fastq.
        if sample.initial_workflow == WorkflowRun::WORKFLOW[:short_read_mngs]
          sample.input_files.map.with_index do |_input_file, input_file_index|
            # Include the project id because the cleaned project names might have duplicates as well.
            "#{get_output_file_prefix(sample, cleaned_project_names)}" \
              "reads_nh_R#{input_file_index + 1}.#{file_ext}"
          end
        else
          "#{get_output_file_prefix(sample, cleaned_project_names)}" \
            "reads_nh.#{file_ext}"
        end
      end.flatten
    end

    if download_type == CONTIGS_NON_HOST_BULK_DOWNLOAD_TYPE
      download_src_urls = pipeline_runs_ordered.map(&:contigs_fasta_s3_path)

      download_tar_names = samples_ordered.map do |sample|
        "#{get_output_file_prefix(sample, cleaned_project_names)}" \
            "contigs_nh.fasta"
      end
    end

    if download_type == HOST_GENE_COUNTS_BULK_DOWNLOAD_TYPE
      # Name of "host gene counts" is historical. v8+ short read now serves
      # host transcript info instead, but type left alone for legacy reasons.
      download_src_urls, download_tar_names = pipeline_runs_ordered.each_with_object([[], []]).with_index do |(pr, result), pr_index|
        # samples_ordered and pipeline_runs_ordered are ordered by sample_id, so we can use the pipeline run index to get the associated sample
        download_tar_name = get_output_file_prefix(samples_ordered[pr_index], cleaned_project_names).to_s
        download_tar_name += pipeline_version_uses_new_host_filtering_stage(pr.pipeline_version) ? "reads_per_transcript.kallisto.tsv" : "reads_per_gene.star.tab"

        result[0] << pr.host_count_s3_path
        result[1] << download_tar_name
      end
    end

    if download_type == CONSENSUS_GENOME_DOWNLOAD_TYPE
      download_src_urls = workflow_runs_ordered.map { |run| run.output_path(ConsensusGenomeWorkflowRun::OUTPUT_CONSENSUS) }

      download_tar_names = workflow_runs_ordered.map do |run|
        "#{get_output_file_prefix(run.sample, cleaned_project_names)}" \
        "#{get_accession_id_prefix(run)}" \
          "consensus.fa"
      end
    end

    if download_type == CONSENSUS_GENOME_INTERMEDIATE_OUTPUT_FILES_BULK_DOWNLOAD_TYPE
      download_src_urls = workflow_runs_ordered.map { |run| run.output_path(ConsensusGenomeWorkflowRun::OUTPUT_ZIP) }

      download_tar_names = workflow_runs_ordered.map do |run|
        "#{get_output_file_prefix(run.sample, cleaned_project_names)}" \
        "#{get_accession_id_prefix(run, include_ending_underscore: false)}/"
      end
    end

    if download_type == AMR_RESULTS_BULK_DOWNLOAD
      download_src_urls = workflow_runs_ordered.map { |run| run.output_path(AmrWorkflowRun::OUTPUT_ZIP) }

      download_tar_names = workflow_runs_ordered.map do |run|
        get_output_file_prefix(run.sample, cleaned_project_names).to_s
      end
    end

    if download_type == AMR_CONTIGS_BULK_DOWNLOAD
      download_src_urls = workflow_runs_ordered.map { |run| run.output_path(AmrWorkflowRun::OUTPUT_CONTIGS) }

      download_tar_names = workflow_runs_ordered.map do |run|
        "#{get_output_file_prefix(run.sample, cleaned_project_names)}" \
          "contigs.fa"
      end
    end

    if download_src_urls.present? && download_tar_names.present?
      return s3_tar_writer_command(
        download_src_urls,
        download_tar_names,
        download_output_url
      )
    end

    return nil
  end

  # Wrapper function to make testing easier.
  def progress_update_delay
    PROGRESS_UPDATE_DELAY
  end

  # Raised when the biom CLI conversion fails, so the failure surfaces as a typed error
  # carrying the CLI stderr instead of a bare RuntimeError whose message is the raw Python
  # biom traceback (#555).
  class BiomConversionError < StandardError; end

  def create_biom_file(metrics_path, metadata_path, taxon_lineage_path)
    # A header-only metrics file means no species-level taxa passed the selected filters;
    # biom convert cannot build a 0-observation table, so fail fast with a clear message
    # instead of shelling out to a guaranteed non-zero exit (#555).
    if File.foreach(metrics_path).count <= 1
      self.status = STATUS_ERROR
      raise BiomConversionError, "No taxa matched the selected filters, so a BIOM file could not be generated."
    end

    output_biom = "/tmp/#{id.to_s.shellescape}_output.biom"
    output_biom_metadata = "/tmp/#{id.to_s.shellescape}_output_metadata.biom"
    stdout, stderr, status = Open3.capture3("biom", "convert", "-i", metrics_path, "-o", output_biom.shellescape, '--table-type=OTU table', "--to-json")
    if status.exitstatus.zero?
      stdout, stderr, status = Open3.capture3(
        "biom", "add-metadata", "-i", output_biom.shellescape, "-o", output_biom_metadata.shellescape,
        "--sample-metadata-fp", metadata_path, "--observation-metadata-fp", taxon_lineage_path,
        "--output-as-json"
      )
      if status.exitstatus.zero?
        return output_biom_metadata
      else
        self.status = STATUS_ERROR
        LogUtil.log_error("biom add-metadata failed: #{stdout}, #{stderr}")
        raise BiomConversionError, "biom add-metadata failed: #{stderr}"
      end
    else
      self.status = STATUS_ERROR
      LogUtil.log_error("biom convert failed: #{stdout}, #{stderr}")
      raise BiomConversionError, "biom convert failed: #{stderr}"
    end
  end

  def write_output_files_to_s3_tar_writer(s3_tar_writer)
    failed_sample_ids = []
    # The last time since we updated the progress.
    last_progress_time = Time.now.to_f

    samples = Sample.where(id: pipeline_runs.pluck(:sample_id))
    projects = Project.where(id: samples.pluck(:project_id))

    # Compute cleaned project name once instead of once per sample.
    cleaned_project_names = {}
    projects.each do |project|
      cleaned_project_names[project.id] = project.cleaned_project_name
    end

    # Bulk-include data for performance based on the download type.
    pipeline_runs_with_includes = if download_type == SAMPLE_TAXON_REPORT_BULK_DOWNLOAD_TYPE
                                    pipeline_runs.includes(sample: [:project])
                                  elsif download_type == CONTIG_SUMMARY_REPORT_BULK_DOWNLOAD_TYPE
                                    pipeline_runs.includes(:contigs, :sample)
                                  elsif download_type == READS_NON_HOST_BULK_DOWNLOAD_TYPE
                                    # We avoid pre-fetching "taxon_byteranges" here, even though it has to be fetched once per pipeline_run in the code below,
                                    # because of the potentially large number of taxon_byteranges per pipeline_run.
                                    pipeline_runs.includes(:sample)
                                  elsif download_type == CONTIGS_NON_HOST_BULK_DOWNLOAD_TYPE
                                    # Pre-fetching contigs here doesn't prevent multiple queries for contig in get_contigs_for_taxid.
                                    # TODO(mark): Investigate why, if performance of this bulk download ever becomes an issue.
                                    pipeline_runs.includes(:sample)
                                  else
                                    pipeline_runs
                                  end

    # Get the tax_level for the selected taxid by looking at the first available TaxonCount entry.
    # Since TaxonCount isn't normalized, any TaxonCount entry would provide the same information.
    if download_type == READS_NON_HOST_BULK_DOWNLOAD_TYPE
      taxid = get_param_value("taxa_with_reads")

      # Get the corresonding TaxonLineage for this taxid.
      alignment_config_ids = pipeline_runs_with_includes.pluck(:alignment_config_id).uniq
      max_lineage_version  = AlignmentConfig.max_lineage_version(alignment_config_ids)
      taxon_lineage = TaxonLineage.versioned_lineages(taxid, max_lineage_version).first

      if taxon_lineage.nil?
        raise BulkDownloadsHelper::READS_NON_HOST_TAXON_LINEAGE_EXPECTED_TEMPLATE % taxid
      end

      tax_level = taxon_lineage.tax_level
    end

    pipeline_runs_with_includes.map.with_index do |pipeline_run, index|
      begin
        Rails.logger.info("Processing pipeline run #{pipeline_run.id} (#{index + 1} of #{pipeline_runs.length})...")
        if download_type == SAMPLE_TAXON_REPORT_BULK_DOWNLOAD_TYPE
          # Disable parallel fetching to avoid autoloading errors resulting from threading inside resque job.
          report_csv = PipelineReportService.call(pipeline_run, get_param_value("background"), csv: true)
          s3_tar_writer.add_file_with_data(
            "#{get_output_file_prefix(pipeline_run.sample, cleaned_project_names)}" \
              "taxon_report.csv",
            report_csv
          )
        elsif download_type == CONTIG_SUMMARY_REPORT_BULK_DOWNLOAD_TYPE
          contig_mapping_table_csv = pipeline_run.generate_contig_mapping_table_csv
          s3_tar_writer.add_file_with_data(
            "#{get_output_file_prefix(pipeline_run.sample, cleaned_project_names)}" \
              "contig_summary_report.csv",
            contig_mapping_table_csv
          )
        elsif download_type == READS_NON_HOST_BULK_DOWNLOAD_TYPE
          reads_nonhost_for_taxid_fasta = get_taxon_fasta_from_pipeline_run_combined_nt_nr(pipeline_run, taxid, tax_level)
          # If there were no reads for a particular pipeline run, output an empty file.
          if reads_nonhost_for_taxid_fasta.nil?
            reads_nonhost_for_taxid_fasta = ""
          end

          # Truncate the taxon so that the total size of the file suffix is 25 characters max.
          taxon_truncated = get_param_display_name('taxa_with_reads')[0...10]

          s3_tar_writer.add_file_with_data(
            "#{get_output_file_prefix(pipeline_run.sample, cleaned_project_names)}" \
              "reads_nh_#{taxon_truncated}.fasta",
            reads_nonhost_for_taxid_fasta
          )
        elsif download_type == CONTIGS_NON_HOST_BULK_DOWNLOAD_TYPE
          contigs = pipeline_run.get_contigs_for_taxid(get_param_value("taxa_with_contigs").to_i)
          contigs_nonhost_for_taxid_fasta = ''
          contigs.each { |contig| contigs_nonhost_for_taxid_fasta += contig.to_fa }

          # Truncate the taxon so that the total size of the file suffix is 25 characters max.
          taxon_truncated = get_param_display_name('taxa_with_contigs')[0...8]

          s3_tar_writer.add_file_with_data(
            "#{get_output_file_prefix(pipeline_run.sample, cleaned_project_names)}" \
              "contigs_nh_#{taxon_truncated}.fasta",
            contigs_nonhost_for_taxid_fasta
          )
        end
      rescue StandardError => e
        Rails.logger.error(e)
        failed_sample_ids << pipeline_run.sample.id
      end

      cur_time = Time.now.to_f
      if cur_time - last_progress_time > progress_update_delay
        progress = (index + 1).to_f / pipeline_runs.length
        update(progress: progress)
        Rails.logger.info(format("Updated progress. %3.1f complete.", progress))
        last_progress_time = cur_time
      end
    end

    unless failed_sample_ids.empty?
      LogUtil.log_error(
        "BulkDownloadFailedSamplesError(id #{id}): The following samples failed to process: #{failed_sample_ids}",
        bulk_download_id: id,
        failed_sample_ids: failed_sample_ids
      )
      update(error_message: BulkDownloadsHelper::FAILED_SAMPLES_ERROR_TEMPLATE % failed_sample_ids.length)
    end
  end

  def get_technology(pipeline_runs)
    # check if only 1 technology
    raise "Cannot run bulk download on mix of short-read-mngs and long-read-mngs" unless pipeline_runs.pluck(:technology).uniq.size == 1

    pipeline_runs.first.technology
  end

  def generate_download_file
    if download_type == CONSENSUS_GENOME_DOWNLOAD_TYPE
      update(status: STATUS_RUNNING)
      workflow_runs_ordered = workflow_runs.order(:sample_id)
      workflow_run_ids = workflow_runs_ordered.pluck(:id)

      # Add the accession ids to the fasta headers
      headers = {}
      workflow_runs_ordered.includes(:sample).map do |run|
        headers[run.id] = ">#{run.sample.name}_#{get_accession_id(run)}\n"
      end

      Rails.logger.info("Starting concatenation...")
      content = ConsensusGenomeConcatService.call(workflow_run_ids, headers: headers)

      Rails.logger.info("Uploading concatenated file to S3...")
      S3Util.upload_to_s3(download_bucket_name, download_output_key, content)

      Rails.logger.info("Success!")
    elsif download_type == BIOM_FORMAT_DOWNLOAD_TYPE
      Rails.logger.info("Generating biom file for #{pipeline_runs.length} samples...")
      metrics_path, metadata_path, taxon_lineage_path = BulkDownloadsHelper.generate_biom_format_file(
        pipeline_runs,
        get_param_value("metric"),
        get_param_value("background"),
        get_param_value("categories"),
        get_param_value("filter_by"),
        id
      )
      biom_file = create_biom_file(metrics_path, metadata_path, taxon_lineage_path)
      S3Util.upload_to_s3(download_bucket_name, download_output_key, File.read(biom_file))
    else
      start_time = Time.now.to_f

      update(status: STATUS_RUNNING)

      s3_tar_writer = S3TarWriter.new(download_output_url)
      Rails.logger.info("Starting tarfile streaming to #{download_output_url}...")
      s3_tar_writer.start_streaming

      if download_type == SAMPLE_OVERVIEW_BULK_DOWNLOAD_TYPE
        Rails.logger.info("Generating sample overviews for #{pipeline_runs.length} samples...")
        technology = get_technology(pipeline_runs) # ONT or Illumina
        samples = Sample.where(id: pipeline_runs.pluck(:sample_id))
        pipeline_runs_by_sample_id = pipeline_runs.index_by(&:sample_id)
        sample_overviews_csv = generate_sample_list_csv(samples, selected_pipeline_runs_by_sample_id: pipeline_runs_by_sample_id, include_all_metadata: get_param_value("include_metadata"), technology: technology)

        s3_tar_writer.add_file_with_data("sample_overviews.csv", sample_overviews_csv)
      elsif download_type == CONSENSUS_GENOME_OVERVIEW_BULK_DOWNLOAD_TYPE
        Rails.logger.info("Generating consensus genome overviews for #{workflow_runs.length} consensus genomes...")
        consensus_genome_overviews_csv = BulkDownloadsHelper.generate_cg_overview_csv(
          workflow_runs: workflow_runs,
          include_metadata: get_param_value("include_metadata")
        )

        s3_tar_writer.add_file_with_data("consensus_genome_overviews.csv", consensus_genome_overviews_csv)
      elsif download_type == AMR_COMBINED_RESULTS_BULK_DOWNLOAD
        Rails.logger.info("Generating AMR combined results CSV for #{workflow_runs.length} antimicrobial resistances...")
        amr_combined_results_csv = AmrResultsConcatService.call(workflow_runs.map(&:id))

        s3_tar_writer.add_file_with_data("combined_amr_results.csv", amr_combined_results_csv)
      elsif download_type == COMBINED_SAMPLE_TAXON_RESULTS_BULK_DOWNLOAD_TYPE
        metric = get_param_value("metric")
        workflow = get_param_value("workflow")
        Rails.logger.info("Generating combined sample taxon results for #{metric} for #{pipeline_runs.length} samples...")
        samples = Sample.where(id: pipeline_runs.pluck(:sample_id))

        # In ont_v1, backgrounds are not supported for long-read-mngs samples.
        # For long-read-mngs samples, background_id is nil
        background_id = if workflow == WorkflowRun::WORKFLOW[:short_read_mngs]
                          # If the metric is NT.zscore or NR.zscore, the background param is required.
                          # For other metrics, it doesn't affect the metric calculation, so we set it to a default.
                          # Note that we are using heatmap helper functions to calculate all the metrics at once, so the background id is required even if we don't need it.
                          get_param_value("background") || samples.first.default_background_id
                        end

        result = BulkDownloadsHelper.generate_combined_sample_taxon_results_csv(samples, background_id, metric)
        s3_tar_writer.add_file_with_data("combined_sample_taxon_results_#{metric}.csv", result[:csv_str])

        unless result[:failed_sample_ids].empty?
          LogUtil.log_error(
            "BulkDownloadFailedSamplesError(id #{id}): The following samples failed to process or had no data for the metric: #{result[:failed_sample_ids]}",
            bulk_download_id: id,
            failed_sample_ids: result[:failed_sample_ids]
          )
          update(error_message: BulkDownloadsHelper::COMBINED_SAMPLE_TAXON_RESULTS_ERROR_TEMPLATE % result[:failed_sample_ids].length)
        end
      elsif download_type == SAMPLE_METADATA_BULK_DOWNLOAD_TYPE
        Rails.logger.info("Generating sample metadata for #{pipeline_runs.length} samples...")
        samples = Sample.where(id: pipeline_runs.pluck(:sample_id)).or(Sample.where(id: workflow_runs.pluck(:sample_id)))

        sample_metadata_csv = BulkDownloadsHelper.generate_metadata_csv(samples)

        s3_tar_writer.add_file_with_data("sample_metadata.csv", sample_metadata_csv)
      else
        write_output_files_to_s3_tar_writer(s3_tar_writer)
      end

      Rails.logger.info("Closing s3 tar writer...")
      s3_tar_writer.close

      Rails.logger.info("Waiting for streaming to complete...")
      unless s3_tar_writer.process_status.success?
        raise BulkDownloadsHelper::BULK_DOWNLOAD_GENERATION_FAILED
      end

      Rails.logger.info("Success!")
      Rails.logger.info(format("Tarfile of size %s written successfully in %3.1f seconds", ActiveSupport::NumberHelper.number_to_human_size(s3_tar_writer.total_size_processed), Time.now.to_f - start_time))
    end
    verify_and_mark_success
  rescue StandardError
    update(status: STATUS_ERROR)
    raise
  end

  def verify_and_mark_success
    update(status: STATUS_SUCCESS)

    output_file_size = fetch_output_file_size # will raise an error if file is not found

    if output_file_size
      update(output_file_size: output_file_size)
    end
  end

  def download_display_name
    display_name = BulkDownloadTypesHelper.bulk_download_type_display_name(download_type)

    # For reads non-host and contigs non-host for a single taxon, add the name of the taxon.
    if download_type == READS_NON_HOST_BULK_DOWNLOAD_TYPE && get_param_value("taxa_with_reads") != "all"
      display_name += " - #{get_param_display_name('taxa_with_reads')}"
    end

    if download_type == CONTIGS_NON_HOST_BULK_DOWNLOAD_TYPE && get_param_value("taxa_with_contigs") != "all"
      display_name += " - #{get_param_display_name('taxa_with_contigs')}"
    end

    display_name
  end

  def execution_type
    execution_type = BulkDownloadTypesHelper.bulk_download_type(download_type)[:execution_type]
    if [RESQUE_EXECUTION_TYPE, ECS_EXECUTION_TYPE, MANUAL_UPLOAD_TYPE]
       .include?(execution_type)
      return execution_type
    end

    if download_type == READS_NON_HOST_BULK_DOWNLOAD_TYPE
      return get_param_value("taxa_with_reads") == "all" ? ECS_EXECUTION_TYPE : RESQUE_EXECUTION_TYPE
    end

    if download_type == CONTIGS_NON_HOST_BULK_DOWNLOAD_TYPE
      return get_param_value("taxa_with_contigs") == "all" ? ECS_EXECUTION_TYPE : RESQUE_EXECUTION_TYPE
    end

    if download_type == CONSENSUS_GENOME_DOWNLOAD_TYPE
      return get_param_value("download_format") == BulkDownloadTypesHelper::SEPARATE_FILES_DOWNLOAD ? ECS_EXECUTION_TYPE : RESQUE_EXECUTION_TYPE
    end

    # Should never happen
    raise BulkDownloadsHelper::UNKNOWN_EXECUTION_TYPE
  end

  def kickoff_resque_task
    Resque.enqueue(GenerateBulkDownload, id)
  end

  def kickoff
    current_execution_type = execution_type
    if current_execution_type == ECS_EXECUTION_TYPE
      ecs_task_command = bulk_download_ecs_task_command
      unless ecs_task_command.nil?
        # Migrated off aegea -> a K8s Job on the dedicated warm bulk-download node (#846/SMP-1477).
        # (kickoff_batch_job is kept as a fallback until the K8s path is proven, then removed.)
        kickoff_k8s_job(ecs_task_command)
      end
    end
    if current_execution_type == RESQUE_EXECUTION_TYPE
      kickoff_resque_task
    end
  end

  def cleanup_s3
    S3Util.delete_s3_prefix("s3://#{download_bucket_name}/#{download_output_prefix}/")
  end
end
