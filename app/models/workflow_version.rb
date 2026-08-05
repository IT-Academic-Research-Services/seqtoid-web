class WorkflowVersion < ApplicationRecord
  # CZID-972 -- version ordering is NUMERIC-SEGMENT aware, not lexical.
  #
  # `ORDER BY version DESC` is a string sort, so "8.3.9" sorts above "8.3.11" and "0.7.8" above
  # "0.7.12". That is not a future risk: on dev today it already resolves short-read-mngs to 8.3.3
  # instead of 8.3.15, and long-read-mngs to 0.7.8 instead of 0.7.12. Backfilling the catalog
  # (CZID-974) makes it much worse -- short-read-mngs alone has 108 released versions upstream.
  #
  # This table deliberately holds more than semver, so the key handles every shape actually present:
  #
  #   semver         "8.3.15"         -> [[8, 3, 15], 1, ""]
  #   ISO date       "2024-02-06"     -> [[2024, 2, 6], 1, ""]     (ncbi_index_date)
  #   bare integer   "2"              -> [[2], 1, ""]              (human_host_genome)
  #   commit-tagged  "8.2.3-b9b4ab1"  -> [[8, 2, 3], 0, "b9b4ab1"]
  #
  # The trailing pair orders a commit-tagged build BELOW the clean release of the same number, which
  # matches semver's pre-release rule and the intent of scripts/release.sh appending the commit when
  # tagging off main.
  #
  # Sorting happens in Ruby rather than SQL because the formats are mixed; the row count per
  # workflow is bounded (hundreds at most), so this is not a meaningful cost.
  SEGMENT_SEPARATOR = /[.-]/

  # A comparable key for `version`. Keys are compared element-wise, and every element is the same
  # type across keys, so Array#<=> is well defined for any pair.
  def self.version_sort_key(version)
    segments = version.to_s.strip.split(SEGMENT_SEPARATOR)
    numeric = segments.take_while { |s| s.match?(/\A\d+\z/) }.map(&:to_i)
    suffix = segments.drop(numeric.length).join("-")
    # 1 = no suffix (a clean release), 0 = suffixed (a pre-release/commit build) -> clean sorts higher.
    [numeric, suffix.empty? ? 1 : 0, suffix]
  end

  # True when `version` falls under `prefix`, compared SEGMENT-wise rather than as a string.
  #
  # A plain `LIKE '8.1%'` also matches "8.10.5", which is a different minor line entirely. That is
  # latent today only because no workflow has reached a double-digit minor; with the full upstream
  # history backfilled it stops being latent.
  def self.version_matches_prefix?(version, prefix)
    prefix_segments = version_sort_key(prefix).first
    # A prefix with no leading numeric segment is an arbitrary identifier, not a version line -- an
    # AlignmentConfig may be named anything, and projects pin ncbi_index_date to that name. There is
    # no segment structure to compare, so keep the original string-prefix behaviour for those rather
    # than refusing to match (which would break pinned alignment configs).
    return version.to_s.start_with?(prefix.to_s) if prefix_segments.empty?

    version_sort_key(version).first.take(prefix_segments.length) == prefix_segments
  end

  # Returns latest value of `version` for specified workflow / versioned attribute.
  # Ex: WorkflowVersion.latest_version_of(HostGenome::HUMAN_HOST) ==> "2"
  def self.latest_version_of(workflow)
    latest = WorkflowVersion.where(workflow: workflow).pluck(:version).max_by { |v| version_sort_key(v) }
    if latest.nil?
      raise ErrorHelper::VersionControlErrors.workflow_name_not_found(workflow)
    end

    latest
  end
end
