# frozen_string_literal: true

# Sets the environment DEFAULT workflow version a run dispatches. Shared core for the machine/token
# flip endpoint (WorkflowVersionsController#set_default). Verifies the WDL bundle actually exists in
# this env's workflows bucket BEFORE flipping (fail closed -- never point the env at a missing bundle),
# then calls AppConfigHelper.set_workflow_version, which registers the workflow_versions catalog row
# AND sets the `<workflow>-version` app_config default that VersionRetrievalService resolves.
# Idempotent: setting the current version just re-asserts it.
class SetDefaultWorkflowVersionService
  Result = Struct.new(:ok, :previous, :error, keyword_init: true)

  def self.call(workflow:, version:)
    new(workflow, version).call
  end

  def initialize(workflow, version)
    @workflow = workflow.to_s
    @version = version.to_s
  end

  def call
    previous = AppConfigHelper.get_workflow_version(@workflow)
    return Result.new(ok: false, previous: previous, error: not_found_message) unless wdl_bundle_present?

    AppConfigHelper.set_workflow_version(@workflow, @version)
    Rails.logger.info("WorkflowUpgradeEvent: default #{@workflow} #{previous.inspect} -> #{@version}")
    Result.new(ok: true, previous: previous)
  rescue Aws::S3::Errors::AccessDenied, Aws::S3::Errors::NoSuchKey
    Result.new(ok: false, previous: previous, error: not_found_message)
  end

  private

  def not_found_message
    "wdl bundle for #{@workflow}-v#{@version} not found"
  end

  # Mirrors home#check_valid_workflow: the bundle's entrypoint WDL must exist and be non-empty.
  def wdl_bundle_present?
    filename = @workflow == WorkflowRun::WORKFLOW[:short_read_mngs] ? "host_filter.wdl" : "run.wdl"
    key = "#{@workflow}-v#{@version}/#{filename}"
    response = AwsClient[:s3].get_object(bucket: S3_WORKFLOWS_BUCKET, key: key)
    response[:content_length].to_i.positive?
  end
end
