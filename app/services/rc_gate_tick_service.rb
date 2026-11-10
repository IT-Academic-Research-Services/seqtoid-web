# One tick of the release-candidate (RC) AUPR gate. Run on a schedule (CronJob -> rake rc_gate:tick)
# on dev while dev is pinned to an RC build. Each tick is stateless: everything it needs is either in
# the RC's result.json on S3 or in the DB, so a pod restart or spot-node loss between ticks is harmless.
#
# Flow (each tick advances at most one step, then records state):
#   not pinned to an RC              -> no-op
#   result.json already terminal     -> no-op
#   ensure project "RC Benchmarks" (owned by RC_GATE_OWNER_EMAIL, short-read-mngs pinned to
#   RC_GATE_SRM_VERSION) and the gate sample (created through the normal S3 upload path, which
#   copies the fastqs and kicks off the mNGS pipeline by itself)
#   pipeline running                 -> state "running"
#   pipeline succeeded               -> find-or-create the benchmark vs RC_GATE_TRUTH_FILE
#   benchmark finished               -> state "succeeded" with metrics + report digest
#   any failure, or older than RC_GATE_TIMEOUT_HOURS -> state "failed" with an error
#
# Status advances on dev via Shoryuken + SFN notifications; this tick only reads it.
#
# To re-run a gate for the same RC, delete both result.json and the gate sample.
class RcGateTickService
  include Callable

  SCHEMA = 1
  PROJECT_NAME = "RC Benchmarks".freeze
  HOST_GENOME = "Human".freeze
  SRM = WorkflowRun::WORKFLOW[:short_read_mngs]
  TERMINAL_STATES = ["succeeded", "failed"].freeze
  RC_ID_FORMAT = /\A[A-Za-z0-9][A-Za-z0-9._-]*\z/
  # Required metadata for a human-host sample; the gate sample is synthetic.
  SAMPLE_METADATA = {
    "sample_type" => "Synthetic benchmark",
    "nucleotide_type" => "DNA",
    "collection_date" => "2026-01",
    "collection_location_v2" => "California, USA",
    "water_control" => "No",
  }.freeze
  BENCHMARK_SUCCEEDED = [WorkflowRun::STATUS[:succeeded], WorkflowRun::STATUS[:succeeded_with_issue]].freeze
  BENCHMARK_FAILED = [WorkflowRun::STATUS[:failed], WorkflowRun::STATUS[:timed_out], WorkflowRun::STATUS[:aborted]].freeze

  # A deterministic gate failure: recorded as state "failed" in result.json.
  class GateError < StandardError; end

  # Helper host for the shared upload path (SamplesHelper#upload_samples_with_metadata).
  class Uploader
    include SamplesHelper
  end

  def initialize(env: ENV, now: Time.now.utc)
    @env = env
    @now = now.utc
  end

  # Returns the state written (or :not_pinned / :already_terminal).
  def call
    return :not_pinned unless @env["DEV_PIN_KIND"] == "rc" && @env["DEV_PIN_RC"].present?

    # Written verbatim: CI treats a result whose rc differs from DEV_PIN_RC as stale.
    @rc = @env["DEV_PIN_RC"]
    raise ArgumentError, "DEV_PIN_RC '#{@rc}' is not a valid RC id" unless @rc.match?(RC_ID_FORMAT)

    @bucket, @key = results_location
    previous = read_result
    return :already_terminal if previous && TERMINAL_STATES.include?(previous["state"])

    @result = base_result(previous)
    advance
    write_result
    @result["state"]
  rescue GateError => e
    fail_with(e.message)
    write_result
    "failed"
  end

  # sha256 over the run's taxon report rows, sorted canonically so row order never matters.
  # rows: [tax_id, tax_level, count_type, count, rpm]
  def self.report_digest(rows)
    lines = rows.map do |tax_id, tax_level, count_type, count, rpm|
      [tax_id.to_i, tax_level.to_i, count_type.to_s, count.to_i, rpm.nil? ? "null" : format("%.4f", rpm.to_f.round(4))]
    end
    body = lines.sort_by { |l| l.map(&:to_s) }.map { |l| l.join("\t") }.join("\n")
    "sha256:#{Digest::SHA256.hexdigest(body)}"
  end

  private

  def advance
    started = Time.iso8601(@result["started_at"])
    if @now - started > timeout_hours * 3600
      return fail_with("timeout: gate not finished within #{timeout_hours}h of #{@result['started_at']}")
    end

    config = required_config
    owner = User.find_by(email: config[:owner_email]) or raise GateError, "RC_GATE_OWNER_EMAIL user '#{config[:owner_email]}' not found"
    project = ensure_project(owner)
    sample = find_or_create_sample(project, owner)
    @result["sample_id"] = sample.id
    raise GateError, "sample upload failed: #{sample.upload_error}" if sample.upload_error.present?

    pr = sample.pipeline_runs.order(:id).last
    return running if pr.nil?

    @result["pipeline_run_id"] = pr.id
    # Raw PipelineRun#job_status; a successful short-read-mngs run ends at "CHECKED".
    @result["pipeline_status"] = pr.job_status
    if pr.wdl_version.present? && !WorkflowVersion.version_matches_prefix?(pr.wdl_version, srm_version)
      raise GateError, "pipeline run #{pr.id} ran short-read-mngs #{pr.wdl_version}, expected #{srm_version}"
    end
    raise GateError, "pipeline run #{pr.id} failed (#{pr.job_status})" if pr.failed?
    return running unless pr.ready_for_cache?

    rows = TaxonCount.where(pipeline_run_id: pr.id).pluck(:tax_id, :tax_level, :count_type, :count, :rpm)
    @result["report_digest"] = self.class.report_digest(rows)
    @result["report_rows"] = rows.size

    bwr = find_or_create_benchmark(project, owner, pr, config[:truth_file])
    @result["benchmark_workflow_run_id"] = bwr.id
    raise GateError, "benchmark workflow run #{bwr.id} #{bwr.status}" if BENCHMARK_FAILED.include?(bwr.status)
    return running unless BENCHMARK_SUCCEEDED.include?(bwr.status)

    metrics = bwr.workflow_by_class.results(cacheable_only: true)["benchmark_metrics"]
    raise GateError, "benchmark workflow run #{bwr.id} has no metrics" if metrics.blank?

    metrics = metrics.stringify_keys
    @result["metrics"] = ["nt_aupr", "nr_aupr", "nt_l2_norm", "nr_l2_norm", "correlation"].index_with { |k| metrics[k] }
    @result["state"] = "succeeded"
    @result["completed_at"] = iso(@now)
  end

  def running
    @result["state"] = "running"
  end

  def fail_with(message)
    @result["state"] = "failed"
    @result["error"] = message
    @result["completed_at"] = iso(@now)
  end

  def required_config
    config = {
      owner_email: @env["RC_GATE_OWNER_EMAIL"].to_s.strip,
      fastqs: @env["RC_GATE_FASTQS"].to_s.split(/[,\s]+/).reject(&:blank?),
      truth_file: @env["RC_GATE_TRUTH_FILE"].to_s.strip,
      dataset: dataset,
      srm_version: srm_version,
    }
    missing = config.select { |_k, v| v.blank? }.keys
    raise GateError, "missing RC gate config: #{missing.join(', ')}" if missing.any?
    raise GateError, "RC_GATE_FASTQS must be 1 or 2 s3:// URIs" unless config[:fastqs].size.between?(1, 2) && config[:fastqs].all? { |f| f.start_with?("s3://") }

    @fastqs = config[:fastqs]
    config
  end

  def ensure_project(owner)
    project = Project.find_by(name: PROJECT_NAME)
    if project.nil?
      project = Project.new(name: PROJECT_NAME, public_access: 0,
                            description: "Release-candidate AUPR gate samples (rc_gate:tick)")
      project.users << owner
      project.creator_id = owner.id
      project.save!
      # Same pins a project created through ProjectsController#create gets.
      project.pin_to_major_versions
      project.pin_default_alignment_config
      project.pin_latest_human_version
    elsif !project.users.exists?(owner.id)
      raise GateError, "project '#{PROJECT_NAME}' exists but #{owner.email} is not a member"
    end

    pin = ProjectWorkflowVersion.find_or_initialize_by(project_id: project.id, workflow: SRM)
    pin.update!(version_prefix: srm_version) if pin.version_prefix != srm_version
    project
  end

  def find_or_create_sample(project, owner)
    name = "rc-gate #{@rc} #{dataset}"
    existing = Sample.find_by(project_id: project.id, name: name)
    return existing if existing

    assert_srm_dispatchable!(project)
    attributes = {
      name: name,
      project_id: project.id,
      host_genome_name: HOST_GENOME,
      workflows: [SRM],
      input_files_attributes: @fastqs.map do |uri|
        { name: File.basename(uri), source: uri, source_type: InputFile::SOURCE_TYPE_S3,
          upload_client: InputFile::UPLOAD_CLIENT_WEB, file_type: InputFile::FILE_TYPE_FASTQ, }
      end,
    }.with_indifferent_access
    response = Uploader.new.upload_samples_with_metadata([attributes], { name => SAMPLE_METADATA.dup }, owner)
    sample = response["samples"].first
    raise GateError, "gate sample upload failed: #{response['errors'].map(&:to_s).join('; ')}" if sample.nil?

    missing = sample.missing_required_metadata_fields
    raise GateError, "gate sample missing required metadata: #{missing.map(&:name).join(', ')}" if missing.any?

    sample
  end

  # Fail before uploading anything if dev cannot run the pinned version.
  def assert_srm_dispatchable!(project)
    resolved = VersionRetrievalService.call(project.id, SRM)
    unless resolved.present? && WorkflowVersion.version_matches_prefix?(resolved, srm_version)
      raise GateError, "short-read-mngs pinned to #{srm_version} resolves to #{resolved.inspect} on this environment"
    end
  rescue GateError
    raise
  rescue StandardError => e
    raise GateError, "dev cannot dispatch short-read-mngs #{srm_version}: #{e.message}"
  end

  def find_or_create_benchmark(project, owner, pipeline_run, truth_file)
    truth = truth_file.start_with?("s3://") ? truth_file : "#{BenchmarkWorkflowRun::AWS_S3_TRUTH_FILES_BUCKET}#{truth_file}"
    name = "rc-gate #{@rc} #{dataset} benchmark"
    existing = Sample.find_by(project_id: project.id, name: name)
    if existing
      wr = existing.workflow_runs.where(workflow: WorkflowRun::WORKFLOW[:benchmark]).order(:id).last
      return wr if wr
    end

    BenchmarkCreationService.call(
      run_ids: [pipeline_run.id], workflow_benchmarked: SRM, project_id: project.id,
      user_id: owner.id, sample_name: name, ground_truth_file: truth
    )
  end

  def base_result(previous)
    previous ||= {}
    {
      "schema" => SCHEMA,
      "rc" => @rc,
      "image_tag" => @env["RC_GATE_IMAGE_TAG"].presence,
      "dataset" => dataset,
      "srm_version" => srm_version,
      "state" => "running",
      "sample_id" => nil,
      "pipeline_run_id" => nil,
      "pipeline_status" => nil,
      "benchmark_workflow_run_id" => nil,
      "metrics" => nil,
      "report_digest" => nil,
      "report_rows" => nil,
      "started_at" => previous["started_at"].presence || iso(@now),
      "updated_at" => iso(@now),
      "completed_at" => nil,
      "error" => nil,
    }
  end

  def dataset
    @env["RC_GATE_DATASET"].to_s.strip.presence
  end

  def srm_version
    @env["RC_GATE_SRM_VERSION"].to_s.strip.presence
  end

  def timeout_hours
    (@env["RC_GATE_TIMEOUT_HOURS"].presence || 6).to_f
  end

  def iso(time)
    time.utc.iso8601
  end

  def results_location
    prefix = @env["RC_GATE_RESULTS_PREFIX"].to_s.strip
    raise ArgumentError, "RC_GATE_RESULTS_PREFIX must be an s3:// URI" unless prefix.start_with?("s3://")

    bucket, key_prefix = prefix.delete_prefix("s3://").split("/", 2)
    key = [key_prefix.to_s.chomp("/"), @rc, "result.json"].reject(&:blank?).join("/")
    [bucket, key]
  end

  # NoSuchKey = no result yet. Anything else (AccessDenied included) raises: never start runs blind.
  def read_result
    body = AwsClient[:s3].get_object(bucket: @bucket, key: @key).body.read
    JSON.parse(body)
  rescue Aws::S3::Errors::NoSuchKey
    nil
  end

  def write_result
    AwsClient[:s3].put_object(bucket: @bucket, key: @key, body: JSON.pretty_generate(@result),
                              content_type: "application/json")
  end
end
