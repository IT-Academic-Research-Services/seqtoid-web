class WorkflowVersion < ApplicationRecord
  # CZID-973 -- this table is the CATALOG: the source of truth for which workflow versions exist and
  # what each one resolves to. Rows are written by the publisher (CZID-971) via
  # WorkflowVersionsController, not by hand. `db/seeds` is no longer the place to declare that a
  # version exists -- a version that is not published is not in the catalog, and CZID-982 means an
  # uncatalogued version cannot be dispatched.

  # Backfill classification (CZID-974). Nil means the row was never classified by the backfill --
  # true of the seeded rows and of everything the CZID-982 reconciliation created.
  TIER_FULL = "full".freeze              # image built and validated
  TIER_LAZY = "lazy".freeze              # WDL + manifest published; image built on first request
  TIER_RECORD_ONLY = "record_only".freeze # catalogued for provenance, not buildable
  TIERS = [TIER_FULL, TIER_LAZY, TIER_RECORD_ONLY].freeze

  # Runners that can execute a version. SWIPE/SFN is the engine today; the K8s runner (CZID-978) is
  # opted in per version rather than switched on globally.
  ENGINE_SWIPE = "swipe".freeze
  ENGINE_K8S = "k8s".freeze
  ENGINES = [ENGINE_SWIPE, ENGINE_K8S].freeze
  DEFAULT_ENGINES = [ENGINE_SWIPE].freeze

  IMAGE_DIGEST_FORMAT = /\Asha256:[0-9a-f]{64}\z/
  CHECKSUM_FORMAT = /\A[0-9a-f]{64}\z/

  # CZID-976 -- the shape a USER may select: a major ("8"), major.minor ("8.1") or full version
  # ("8.1.2"). Lives here with the rest of the version-shape knowledge because both the upload
  # boundary (Sample) and the resolver (VersionRetrievalService) have to agree on it -- the value
  # reaches a `LIKE '<prefix>%'` query, so it is validated at both ends.
  USER_VERSION_PREFIX_FORMAT = /\A\d+(\.\d+){0,2}\z/

  validates :tier, inclusion: { in: TIERS }, allow_nil: true
  validates :image_digest, format: { with: IMAGE_DIGEST_FORMAT }, allow_nil: true
  validates :wdl_checksum, format: { with: CHECKSUM_FORMAT }, allow_nil: true
  validate :engines_are_known

  # A row with no engines cannot be dispatched anywhere, which is never what the caller meant.
  before_validation { self.engines = DEFAULT_ENGINES if engines.blank? }

  # Versions this engine may run. Kept as a Ruby filter rather than a JSON query because the row
  # count per workflow is bounded and it stays portable across the DB variants in play.
  def self.runnable_on(engine)
    where(runnable: true).select { |wv| wv.runs_on?(engine) }
  end

  def runs_on?(engine)
    Array(engines).include?(engine)
  end

  # True once the publisher has recorded what this version actually resolves to. Rows that predate
  # the publisher report false rather than pretending to provenance they do not have.
  def reproducible?
    image_digest.present? && wdl_checksum.present?
  end

  # CZID-977 -- may this workflow version run against this NCBI index vintage?
  #
  # The real constraint on an older pipeline is the reference data, not the WDL, and the failure is
  # SILENT: a mismatched pair runs to completion and can simply be wrong. Pipeline version and index
  # vintage are pinned independently, so nothing else checks this.
  #
  # An unrecorded bound means "unconstrained", NOT "incompatible". The boundaries are a scientific
  # judgment about reference-data format and content that this codebase does not record anywhere, so
  # a version with no bounds behaves exactly as it does today. Populating the bounds is what turns
  # this from a mechanism into a mitigation.
  #
  # Comparison reuses version_sort_key, which already orders these ISO dates correctly (CZID-972).
  def compatible_with_index?(index_version)
    return true if index_version.blank?

    # NOTE: version_sort_key returns an Array, which defines <=> but NOT < or >. Comparing with the
    # operators raises NoMethodError, so the spaceship result is compared explicitly.
    index_key = self.class.version_sort_key(index_version)
    if min_index_version.present? &&
       (index_key <=> self.class.version_sort_key(min_index_version)).negative?
      return false
    end
    if max_index_version.present? &&
       (index_key <=> self.class.version_sort_key(max_index_version)).positive?
      return false
    end

    true
  end

  # Human-readable bound for an error or a UI hint, or nil when unconstrained.
  def index_compatibility_range
    return nil if min_index_version.blank? && max_index_version.blank?

    "#{min_index_version.presence || 'any'} to #{max_index_version.presence || 'any'}"
  end

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

  private

  def engines_are_known
    listed = Array(engines)
    unknown = listed - ENGINES
    errors.add(:engines, "contains unknown engines: #{unknown.join(', ')}") if unknown.any?
  end
end
