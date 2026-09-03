# frozen_string_literal: true

# Post-import safety check: confirms the S3 objects the imported rows point at
# actually exist in the destination bucket.
#
# A migration has two INDEPENDENT halves: the DB import (which rewrites each run's
# stored S3 location to the destination bucket) and the S3 file copy (which moves
# the objects there). Nothing otherwise confirms the copy delivered what the DB
# now references. A gap -- a missed copy, a wrong bucket, a policy hole, a
# partially-failed Batch job -- leaves rows pointing at objects that were never
# transferred: the sample imports "successfully", then its report/downloads 404.
#
# This spot-checks a sample of the imported user's pipeline-run and workflow-run
# output prefixes: for each, it lists the destination prefix and flags any that
# hold no objects. Callers (see rake import_user_data:verify) fail closed when
# anything is missing, turning a silent partial failure into an early, explicit one.
class ImportS3ResolvabilityService
  include Callable

  DEFAULT_SAMPLE_SIZE = 25

  Result = Struct.new(:checked, :missing, keyword_init: true) do
    def ok?
      missing.empty?
    end
  end

  def initialize(user_id, sample_size: DEFAULT_SAMPLE_SIZE)
    @user_id = user_id
    @sample_size = sample_size
  end

  def call
    prefixes = result_prefixes
    missing = prefixes.reject { |path| prefix_populated?(path) }
    Result.new(checked: prefixes, missing: missing)
  end

  private

  # sfn_results_path for a sample of the user's migrated runs -- the S3 locations
  # the copied outputs should live under (after the import's bucket rewrite). Only
  # non-deprecated / non-deleted runs migrate, so only those are checked.
  def result_prefixes
    sample_ids = Sample.where(user_id: @user_id).pluck(:id)
    return [] if sample_ids.empty?

    runs = PipelineRun.non_deprecated.non_deleted.where(sample_id: sample_ids).limit(@sample_size).to_a
    runs += WorkflowRun.non_deprecated.non_deleted.where(sample_id: sample_ids).limit(@sample_size).to_a
    runs.filter_map { |run| run.sfn_results_path.presence }.uniq.first(@sample_size)
  end

  # True if at least one object exists under the results prefix in its bucket.
  def prefix_populated?(results_path)
    bucket, key = S3Util.parse_s3_path(results_path)
    return false if bucket.blank? || key.blank?

    prefix = key.end_with?("/") ? key : "#{key}/"
    resp = AwsClient[:s3].list_objects_v2(bucket: bucket, prefix: prefix, max_keys: 1)
    resp.contents.present?
  end
end
