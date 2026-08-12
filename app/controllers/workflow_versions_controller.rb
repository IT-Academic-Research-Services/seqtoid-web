# CZID-971 (step 5) -- the catalog-registration endpoint the workflow publisher calls.
#
# seqtoid-workflows publishes a version as two immutable artifacts (an ECR image `:v<semver>` and a
# WDL bundle in S3) and then has to tell the app that version exists. It could not use the existing
# admin route for two independent reasons:
#
#   1. AUTH. `home#set_workflow_version` is behind `admin_required`, which is session-based
#      (`current_user`, redirect on failure). CI has no session, and the only token path in the app
#      is Auth0 *user* tokens from the CLI flow -- there is no service identity.
#   2. SEMANTICS. `AppConfigHelper.set_workflow_version` also PROMOTES: it writes the
#      `<workflow>-version` app_config, making the version the environment default. Publishing a
#      version must not silently promote it.
#
# So this endpoint is REGISTER-ONLY: it creates the `workflow_versions` row and never touches
# app_config. Promotion stays a separate, deliberate admin action.
#
# Related: CZID-982 makes the dispatch path actually honour this catalog.
class WorkflowVersionsController < ApplicationController
  # Machine-to-machine: no session, no CSRF token, and none of the human-facing gates (maintenance
  # page, browser check, export-control attestation) are meaningful for a CI caller.
  skip_before_action :authenticate_user!,
                     :verify_authenticity_token,
                     :check_for_maintenance,
                     :require_export_control_attestation,
                     :require_export_control_layer3,
                     :screen_export_control_onboarding,
                     :check_browser,
                     only: [:create]

  before_action :authenticate_publisher!, only: [:create]

  # GET /workflow_versions?workflow=short-read-mngs
  #
  # CZID-975 -- the catalog the upload flow's version dropdown renders. Ordinary session auth (any
  # signed-in user), because selection is per-run for any user (CZID-976), not an admin feature.
  #
  # Newest first, using the catalog's own numeric-segment ordering (CZID-972) rather than a string
  # sort -- otherwise 8.3.9 would be offered above 8.3.15.
  #
  # Non-runnable versions are omitted entirely: they cannot be dispatched
  # (VersionRetrievalService refuses them), so offering them would only produce a failed upload.
  # LOCKED versions (older than the workflow's supported floor) are omitted for the same reason --
  # they are view-only, and the dispatch gate refuses them -- so they never appear as a run choice.
  # Deprecated versions ARE returned, flagged, so the client can show them as a discouraged choice
  # -- they still run, they are just no longer patched.
  def index
    workflow = params[:workflow].to_s.strip
    unless catalogued_workflow_name?(workflow)
      render json: { error: "invalid workflow" }, status: :unprocessable_entity
      return
    end

    # CZID-994 -- an empty list while the feature is off, rather than a 404. The dropdown is already
    # opt-in on availableVersions.length > 0, so the upload flow renders exactly as it did before the
    # feature existed, and callers get a well-formed response instead of an error to special-case.
    # This is presentation only; Sample#selected_workflow_version is what actually gates dispatch.
    versions = if versioned_selection_enabled?
                 WorkflowVersion
                   .where(workflow: workflow, runnable: true)
                   .reject(&:below_supported_floor?)
                   .sort_by { |wv| WorkflowVersion.version_sort_key(wv.version) }
                   .reverse
               else
                 []
               end

    render json: {
      workflow: workflow,
      versions: versions.map do |wv|
        {
          version: wv.version,
          deprecated: wv.deprecated.present?,
          notes: wv.notes,
        }.compact
      end,
    }
  end

  # POST /workflow_versions
  #   { "workflow": "consensus-genome", "version": "3.5.5" }
  #
  # Idempotent: re-registering an identical version succeeds without modifying it, so a republish or
  # a replayed backfill is safe.
  #
  # CZID-973 -- the request may also carry the provenance the publisher computed into the bundle's
  # manifest (image digest, WDL checksum, publish time, backfill tier, engines, notes). All optional,
  # so a caller that predates that metadata still works.
  #
  # Re-registration is an ENRICHMENT, not an overwrite:
  #   * row absent                                   -> create
  #   * row present without a digest                 -> fill in the provenance it never had
  #                                                     (exactly the reconciled rows CZID-982 made)
  #   * row present with the SAME digest             -> no-op
  #   * row present with a DIFFERENT digest          -> 409; a published version is immutable
  def create
    workflow = params[:workflow].to_s.strip
    version = params[:version].to_s.strip

    unless valid_workflow?(workflow) && valid_version?(version)
      render json: { status: "invalid workflow or version" }, status: :unprocessable_entity
      return
    end

    metadata, error = catalog_metadata
    if error
      render json: { status: error }, status: :unprocessable_entity
      return
    end

    existing = WorkflowVersion.find_by(workflow: workflow, version: version)
    return register_existing(existing, metadata, workflow, version) if existing

    WorkflowVersion.create!({ workflow: workflow, version: version, deprecated: false, runnable: true }.merge(metadata))
    Rails.logger.info("[CZID-971] registered workflow version #{workflow} #{version}")
    render json: { status: "registered", workflow: workflow, version: version }, status: :created
  rescue ActiveRecord::RecordNotUnique
    # Concurrent publishes of the same version raced past the find_by. Both callers wanted the same
    # end state, and it now holds.
    render json: { status: "already registered", workflow: workflow, version: version }, status: :ok
  rescue ActiveRecord::RecordInvalid => e
    render json: { status: "invalid: #{e.record.errors.full_messages.join('; ')}" }, status: :unprocessable_entity
  rescue StandardError => e
    Rails.logger.error("[CZID-971] failed to register workflow version: #{e.message}")
    render json: { status: "error" }, status: :internal_server_error
  end

  private

  # Handle a version that is already catalogued. See the contract on #create.
  def register_existing(existing, metadata, workflow, version)
    incoming_digest = metadata[:image_digest]

    if existing.image_digest.present? && incoming_digest.present? && existing.image_digest != incoming_digest
      Rails.logger.warn(
        "[CZID-973] refusing to re-register #{workflow} #{version}: digest #{existing.image_digest} != #{incoming_digest}"
      )
      render json: {
        status: "conflict: already published with a different image digest",
        workflow: workflow,
        version: version,
      }, status: :conflict
      return
    end

    # Only fill in what is missing -- never overwrite recorded provenance.
    fill = metadata.reject { |attribute, _| existing.public_send(attribute).present? }
    if fill.any?
      existing.update!(fill)
      Rails.logger.info("[CZID-973] enriched #{workflow} #{version} with #{fill.keys.join(', ')}")
      render json: { status: "enriched", workflow: workflow, version: version, fields: fill.keys }, status: :ok
    else
      render json: { status: "already registered", workflow: workflow, version: version }, status: :ok
    end
  end

  # Optional provenance from the publisher's manifest. Returns [attributes, error_message]; the
  # error is non-nil when a supplied value is malformed, so a bad publish is rejected rather than
  # silently recorded.
  def catalog_metadata
    attributes = {}

    if params[:image_digest].present?
      digest = params[:image_digest].to_s.strip
      return [nil, "invalid image_digest"] unless digest.match?(WorkflowVersion::IMAGE_DIGEST_FORMAT)

      attributes[:image_digest] = digest
    end

    if params[:wdl_checksum].present?
      checksum = params[:wdl_checksum].to_s.strip
      return [nil, "invalid wdl_checksum"] unless checksum.match?(WorkflowVersion::CHECKSUM_FORMAT)

      attributes[:wdl_checksum] = checksum
    end

    if params[:tier].present?
      tier = params[:tier].to_s.strip
      return [nil, "invalid tier"] unless WorkflowVersion::TIERS.include?(tier)

      attributes[:tier] = tier
    end

    if params[:engines].present?
      engines = Array(params[:engines]).map { |e| e.to_s.strip }
      return [nil, "invalid engines"] if engines.empty? || (engines - WorkflowVersion::ENGINES).any?

      attributes[:engines] = engines
    end

    if params[:published_at].present?
      begin
        attributes[:published_at] = Time.zone.parse(params[:published_at].to_s) ||
                                    raise(ArgumentError, "unparseable")
      rescue ArgumentError
        return [nil, "invalid published_at"]
      end
    end

    attributes[:notes] = params[:notes].to_s.strip.first(1000) if params[:notes].present?

    [attributes, nil]
  end

  # Mirrors the publisher's own validation (scripts/publish_workflow_version.py) so the two ends
  # agree on what a workflow name and a version look like. Hyphens only, deliberately: the publisher
  # only ever registers WDL workflows, which are all hyphenated (consensus-genome, short-read-mngs).
  def valid_workflow?(workflow)
    workflow.match?(/\A[a-z0-9][a-z0-9-]{0,63}\z/)
  end

  # CZID-975 -- what the catalog can be READ for is broader than what the publisher can WRITE. The
  # table also holds the versioned reference data the app pins alongside pipelines, and those use
  # underscores: `ncbi_index_date` and `human_host_genome`. Reusing valid_workflow? here rejected
  # them outright, which is exactly the NCBI-index path this ticket must not regress.
  def catalogued_workflow_name?(workflow)
    workflow.match?(/\A[a-z0-9][a-z0-9_-]{0,63}\z/)
  end

  def valid_version?(version)
    version.match?(/\A\d+\.\d+\.\d+\z/)
  end

  # CZID-994 -- gates only the READ side (the upload dropdown). Registration is deliberately NOT
  # gated: the publisher must keep recording published versions while the feature is dark, otherwise
  # turning the flag on would surface a catalog with a hole in it for everything published meanwhile.
  def versioned_selection_enabled?
    AppConfigHelper.get_app_config(AppConfig::ENABLE_VERSIONED_PIPELINE_SELECTION) == '1'
  end

  # FAIL-CLOSED shared-secret check, mirroring the pattern already used for the export-control
  # callback: no secret configured, a missing header, or a mismatch all deny. Compared in constant
  # time so the endpoint does not leak the token a byte at a time.
  def authenticate_publisher!
    secret = publisher_token
    provided = request.headers["X-Workflow-Publisher-Token"].to_s

    if secret.blank? || provided.blank? || !ActiveSupport::SecurityUtils.secure_compare(provided, secret)
      Rails.logger.warn("[CZID-971] rejected unauthenticated workflow-version registration")
      render json: { status: "unauthorized" }, status: :unauthorized
    end
  end

  # Supplied via Chamber/SSM like the app's other secrets. Absent -> every call is denied, so a
  # misconfigured environment cannot silently accept unauthenticated registrations.
  def publisher_token
    ENV["WORKFLOW_PUBLISHER_TOKEN"]
  end
end
