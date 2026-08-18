# Loads config/s3_transfer_file_policy.yml and answers, for a given workflow and
# output-file basename, whether the file should be transferred to a partner
# bucket during a user-data migration.
#
# The policy is EXHAUSTIVE by contract: every file a workflow can emit is listed
# with an explicit transfer/skip decision. A basename that matches no entry and
# no pattern is :unclassified - callers must surface that as an omission rather
# than silently dropping it. See the header of the YAML for the full rationale.
#
# Matching precedence (first match wins):
#   1. exact basename under the workflow's `files:`
#   2. the workflow's own `patterns:` (glob, in file order)
#   3. the top-level cross-workflow `patterns:` (glob, in file order)
#   4. otherwise :unclassified
class S3TransferFilePolicy
  DEFAULT_POLICY_PATH = Rails.root.join("config", "s3_transfer_file_policy.yml").freeze

  TRANSFER = :transfer
  SKIP = :skip
  UNCLASSIFIED = :unclassified

  VALID_STATUSES = %w[reviewed placeholder].freeze

  class UnknownWorkflowError < StandardError
    def initialize(workflow)
      super("No S3 transfer policy defined for workflow '#{workflow}'.")
    end
  end

  # Process-wide memoized instance backed by the shipped policy file.
  def self.instance
    @instance ||= new
  end

  # Test/reload hook.
  def self.reload!
    @instance = nil
  end

  def initialize(path: DEFAULT_POLICY_PATH)
    @policy = YAML.safe_load(File.read(path))
    @global_patterns = @policy.fetch("patterns", {})
    @workflows = @policy.fetch("workflows", {})
  end

  # Whether original uploaded inputs (input_files.source) are transferred.
  def raw_inputs_transfer?
    @policy.dig("raw_inputs", "transfer") == true
  end

  def known_workflow?(workflow)
    @workflows.key?(workflow)
  end

  def workflow_status(workflow)
    workflow_config(workflow)["status"]
  end

  # :transfer, :skip, or :unclassified for one file basename under a workflow.
  def classify(workflow, basename)
    wf = workflow_config(workflow)

    files = wf["files"] || {}
    return decision(files[basename]) if files.key?(basename)

    match = match_pattern(wf["patterns"], basename) || match_pattern(@global_patterns, basename)
    return decision(match) if match

    UNCLASSIFIED
  end

  def transfer?(workflow, basename)
    classify(workflow, basename) == TRANSFER
  end

  private

  def workflow_config(workflow)
    @workflows[workflow] || raise(UnknownWorkflowError, workflow)
  end

  # First glob entry (in insertion order) whose pattern matches; nil if none.
  def match_pattern(patterns, basename)
    return nil if patterns.blank?

    _glob, entry = patterns.find { |glob, _entry| File.fnmatch?(glob, basename) }
    entry
  end

  def decision(entry)
    entry["transfer"] ? TRANSFER : SKIP
  end
end
