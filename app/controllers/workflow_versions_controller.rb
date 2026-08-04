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

  # POST /workflow_versions
  #   { "workflow": "consensus-genome", "version": "3.5.5" }
  #
  # Idempotent: registering a version that is already catalogued succeeds without modifying it, so a
  # republish (or a replayed backfill) is safe.
  def create
    permitted = params.permit(:workflow, :version)
    workflow = permitted[:workflow].to_s.strip
    version = permitted[:version].to_s.strip

    unless valid_workflow?(workflow) && valid_version?(version)
      render json: { status: "invalid workflow or version" }, status: :unprocessable_entity
      return
    end

    existing = WorkflowVersion.find_by(workflow: workflow, version: version)
    if existing
      render json: { status: "already registered", workflow: workflow, version: version }, status: :ok
      return
    end

    WorkflowVersion.create!(workflow: workflow, version: version, deprecated: false, runnable: true)
    Rails.logger.info("[CZID-971] registered workflow version #{workflow} #{version}")
    render json: { status: "registered", workflow: workflow, version: version }, status: :created
  rescue ActiveRecord::RecordNotUnique
    # Concurrent publishes of the same version raced past the find_by. Both callers wanted the same
    # end state, and it now holds.
    render json: { status: "already registered", workflow: workflow, version: version }, status: :ok
  rescue StandardError => e
    Rails.logger.error("[CZID-971] failed to register workflow version: #{e.message}")
    render json: { status: "error" }, status: :internal_server_error
  end

  private

  # Mirrors the publisher's own validation (scripts/publish_workflow_version.py) so the two ends
  # agree on what a workflow name and a version look like.
  def valid_workflow?(workflow)
    workflow.match?(/\A[a-z0-9][a-z0-9-]{0,63}\z/)
  end

  def valid_version?(version)
    version.match?(/\A\d+\.\d+\.\d+\z/)
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
