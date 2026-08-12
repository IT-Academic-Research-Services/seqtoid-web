# Fetches the appropriate version of a workflow to run for samples in a given project
# and validates that the version is runnable.
# If the user specifies a prefix to use (not currently enabled),
# validate that prefix. If the project is pinned to a particular
# version for the workflow, return that version.
# Otherwise, return the latest version available for the workflow.
class VersionRetrievalService
  include Callable
  include ErrorHelper

  def initialize(project_id, workflow, user_specified_prefix = nil)
    @project_id = project_id
    @workflow = workflow
    @existing_version_prefix = ProjectWorkflowVersion.find_by(project_id: project_id, workflow: workflow)&.version_prefix
    # user_specified_prefix can be any MAJOR number (8), MAJOR.PATCH number (8.1), or MAJOR.PATCH.MINOR number (8.1.2)
    @user_specified_prefix = user_specified_prefix
  end

  def call
    fetch_and_validate_version_to_run
  end

  private

  def default_version
    if @workflow == AlignmentConfig::NCBI_INDEX
      AlignmentConfig.default_name
    elsif @workflow == HostGenome::HUMAN_HOST
      WorkflowVersion.latest_version_of(HostGenome::HUMAN_HOST)
    else
      AppConfigHelper.get_workflow_version(@workflow)
    end
  end

  def fetch_and_validate_version_to_run
    if @user_specified_prefix
      # CZID-976 -- a user-specified version WINS over the project pin.
      #
      # This branch used to raise project_workflow_version_already_pinned whenever the project was
      # pinned. That made per-run selection impossible in practice, not just awkward: the dev census
      # on 2026-08-04 found ALL 33 projects pinned at a major prefix, so every selection would have
      # raised. The pin is now what supplies the DEFAULT (see the branches below); an explicit choice
      # overrides it for this run only.
      #
      # Pinning itself is unchanged -- ProjectWorkflowVersion still exists and still decides what
      # happens when the user expresses no preference. Only precedence changed.
      #
      # LITERAL SELECTION -- an explicit choice runs EXACTLY as chosen; it is NOT expanded to the
      # latest version sharing its prefix. Selecting "8.0.0" runs 8.0.0, never 8.3.15. The old
      # latest-of-prefix expansion here silently substituted a different version than the one the
      # dropdown showed, so the user believed they were running a version they were not. The
      # per-run selector only ever submits full, catalogued version strings, so exact resolution is
      # the correct and unambiguous behaviour; a prefix that names no catalog entry is an honest
      # not-found rather than a silent upgrade. Prefix expansion still lives on the pin/default path
      # below, where "no selection" legitimately means "latest of what this project is pinned to".
      prepare_exact_workflow_version(validated_user_prefix)
    elsif !@existing_version_prefix || (default_version && default_version.start_with?(@existing_version_prefix))
      # Allows us to use the version set in app_config even if it's not the latest version
      validated_default_version
    else
      prepare_specific_workflow_version_for_upload(@existing_version_prefix)
    end
  end

  # CZID-982 -- the default path used to return the app_config value verbatim, with no catalog
  # lookup and no validation, which meant `runnable` / `deprecated` gated nothing in practice.
  #
  # Every project is pinned at a MAJOR prefix ("8", "0", "1", "3") and the app_config default shares
  # that major ("8.3.15"), so `start_with?` is always true and this branch is the only one real runs
  # take. Staging proved the consequence: all 137 runs there executed at versions with no
  # `workflow_versions` row at all.
  #
  # Fail closed. An app_config default naming an uncatalogued version is a configuration error we
  # want loud, not a run we want to silently let through -- and deliberately NOT an auto-create,
  # since silent creation is what let the drift accumulate unseen. The seed migration
  # ReconcileWorkflowVersionCatalog registers the currently-configured versions so this cannot break
  # a working environment; from here on rows come from the publisher (CZID-971).
  #
  # NOTE this also means a default marked `deprecated` now raises, where before it ran. That is a
  # deliberate behaviour change: it is the same treatment the pinned path has always applied
  # (prepare_specific_workflow_version_for_upload), and having the two paths disagree about what the
  # flags mean is the actual bug. A deprecated DEFAULT is a configuration mistake worth surfacing.
  def validated_default_version
    version = default_version
    return version if version.blank? # nothing configured -- unchanged behavior, callers already handle nil

    catalog_entry = WorkflowVersion.find_by(workflow: @workflow, version: version)
    if catalog_entry.nil?
      raise VersionControlErrors.workflow_version_not_catalogued(@workflow, version)
    end

    handle_workflow_version_issues(catalog_entry.version, catalog_entry.deprecated, catalog_entry.runnable)
    version
  end

  # CZID-976 -- the user-specified prefix is now END-USER input, not an admin-only field, and it
  # reaches a `LIKE '<prefix>%'` query. Validate its shape strictly before it gets anywhere near
  # that, independently of Arel's escaping: a MAJOR ("8"), MAJOR.MINOR ("8.1") or full version
  # ("8.1.2") and nothing else.
  #
  # Rejecting here rather than letting it fall through to "no versions match" keeps a malformed
  # selection a clear bad-request instead of a confusing not-found. Sample validates the same shape
  # at the upload boundary, so a bad value is a 4xx there; this is defence in depth for every other
  # caller (rerun, admin tooling, anything that constructs the service directly).
  def validated_user_prefix
    prefix = @user_specified_prefix.to_s.strip
    unless prefix.match?(WorkflowVersion::USER_VERSION_PREFIX_FORMAT)
      raise VersionControlErrors.invalid_user_specified_version(@workflow, @user_specified_prefix)
    end

    prefix
  end

  def prepare_specific_workflow_version_for_upload(prefix)
    version, deprecated, runnable = fetch_latest_version_for_version_prefix(prefix).values_at(:version, :deprecated, :runnable)
    handle_workflow_version_issues(version, deprecated, runnable)
    version
  end

  # LITERAL SELECTION -- resolve an explicit user choice to that EXACT catalogued version. No
  # prefix expansion: the value must name a real workflow_versions row or it is a clear not-found.
  # This is what keeps "what the dropdown shows" identical to "what runs". The same catalog gate the
  # pinned path applies (runnable / deprecated) still runs here.
  def prepare_exact_workflow_version(version)
    catalog_entry = WorkflowVersion.find_by(workflow: @workflow, version: version)
    if catalog_entry.nil?
      raise VersionControlErrors.workflow_version_not_found(@workflow, version)
    end

    handle_workflow_version_issues(catalog_entry.version, catalog_entry.deprecated, catalog_entry.runnable)
    catalog_entry.version
  end

  def handle_workflow_version_issues(version, deprecated, runnable)
    # In the future, surface the error to the user when the user is allowed to control their workflow versions
    # For now, we'll just raise an error
    if !runnable
      raise VersionControlErrors.workflow_version_not_runnable(@workflow, version)
    elsif deprecated
      raise VersionControlErrors.workflow_version_deprecated(@workflow, version)
    end
  end

  # Given a version_prefix, return the latest version of the workflow that matches the version_prefix
  # i.e. if the latest short-read-mngs version is 8.1.2 and version_prefix is 8.1, return 8.1.2
  #
  # CZID-972: both halves of this were string operations and both were wrong.
  #
  #   * `LIKE '<prefix>%'` also matches a different minor line -- prefix "8.1" matches "8.10.5".
  #     The LIKE is kept as a cheap DB-side narrowing (it is always a superset), then the candidates
  #     are filtered SEGMENT-wise.
  #   * `ORDER BY version DESC` is a lexical sort, so it picks "8.1.9" over "8.1.11".
  #
  # See WorkflowVersion.version_sort_key for the ordering, which also covers the non-semver formats
  # this table holds (ISO dates for ncbi_index_date, bare integers for human_host_genome).
  def fetch_latest_version_for_version_prefix(version_prefix)
    version = WorkflowVersion.arel_table[:version]
    candidates = WorkflowVersion
                 .where(workflow: @workflow)
                 .where(version.matches("#{version_prefix}%"))
                 .select { |wv| WorkflowVersion.version_matches_prefix?(wv.version, version_prefix) }

    if candidates.empty?
      raise VersionControlErrors.workflow_version_not_found(@workflow, version_prefix)
    end

    candidates.max_by { |wv| WorkflowVersion.version_sort_key(wv.version) }
  end
end
