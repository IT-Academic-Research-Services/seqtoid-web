class AppConfig < ApplicationRecord
  # CZID-330 — when this is "1", the export-control / Terms-of-Use click-through attestation gate is
  # ENFORCED: a logged-in user without a current accepted attestation is redirected to the attestation
  # page and cannot reach the app until they accept. Defaults OFF ("" / nil) so the mechanism ships
  # DARK — enforcement go-live is gated on counsel sign-off (CZID-292/335), never flipped by engineering.
  ENABLE_EXPORT_CONTROL_ATTESTATION = 'enable_export_control_attestation'.freeze
  # CZID-285/286 — when this is "1", the Layer 3 export-control gate is ENFORCED: a logged-in user without
  # a current, affirmatively-passed clearance (denied-party screening clear) is redirected
  # to the clearance flow and cannot reach the app until cleared. Defaults OFF ("" / nil) so this ships
  # DARK — go-live is gated on counsel + vendor sign-off (CZID-292/278/335), never flipped by engineering.
  ENABLE_EXPORT_CONTROL_LAYER3 = 'enable_export_control_layer3'.freeze
  # CZID-286 — when this is "1" (AND Layer 3 above is on), device/location attestation is ALSO required:
  # a cleared user must additionally hold a current, server-verified device-location attestation. Separate
  # flag so device attestation can be scoped to the highest-sensitivity flows only. Defaults OFF (dark);
  # go-live is counsel/vendor-gated. TODO(counsel/product): which flows require it.
  ENABLE_EXPORT_CONTROL_DEVICE_ATTESTATION = 'enable_export_control_device_attestation'.freeze
  # CZID-596/599 -- when this is "1", the Descartes Visual Compliance restricted-party SCREENING service
  # (export-control Layer 3) is ACTIVE: ScreeningService may call the SearchEntity API and place holds.
  # Defaults OFF ("" / nil) so the screening core ships DARK and is NEVER invoked -- ScreeningService's
  # enabled?/screen_if_enabled short-circuit to a full BYPASS (no call, no hold, normal behavior) when
  # this is off. Go-live is counsel + vendor gated (CZID-335), never flipped by engineering. This is
  # SEPARATE from ENABLE_EXPORT_CONTROL_LAYER3 (the gate flag): the screening core can be exercised in a
  # sandbox with this flag while the user-facing gate stays off.
  ENABLE_DESCARTES_SCREENING = 'enable_descartes_screening'.freeze
  # CZID-994 -- when this is "1", users may pick a PIPELINE VERSION per run (CZID-975/976): the
  # upload flow offers a version dropdown and dispatch honours the selection. Defaults OFF ("" / nil)
  # so the versioned-pipeline catalog ships DARK -- the catalog, the publisher and the registration
  # endpoint all keep working and accumulating versions, but no user-visible behavior changes and
  # every run resolves exactly as it does today (project pin / configured default).
  #
  # Gated in TWO places, because the UI is only cosmetic:
  #   - WorkflowVersionsController#index returns an empty version list, so the dropdown does not
  #     render (it is already opt-in on availableVersions.length > 0); and
  #   - Sample#selected_workflow_version returns nil, so a selection that was persisted earlier or
  #     crafted directly against the API is IGNORED at dispatch.
  # The second is the real gate; the first only keeps the UI honest.
  ENABLE_VERSIONED_PIPELINE_SELECTION = 'enable_versioned_pipeline_selection'.freeze
  # CZID-600 -- export-control Layer 3 screening POLICY config. These carry counsel's operational choices
  # (list scope, whitelist, cadence, hit-handling) as runtime config so they are drop-in without a deploy.
  # They hold NO secret values (secrets are ENV/Chamber -- see ExportControl::ScreeningPolicy). Each is
  # read through ExportControl::ScreeningPolicy and ships INERT / fail-closed by default, so the feature
  # stays dark until counsel provisions values. Go-live is counsel + vendor gated (CZID-335).
  #
  # Which Descartes RPS list-groups to search (maps to the SearchEntity srpsgroupbypass field). Accepts
  # counsel's group NAMES (comma/space/pipe separated, case-insensitive: Export, Munitions, GSA, Police,
  # Banking, International) OR the raw numerals ("12"). Blank/unset => send empty => Descartes profile
  # default. For our export-control use the relevant groups are Export (1) + Munitions (2).
  EXPORT_CONTROL_RPS_GROUPS = 'export_control_rps_groups'.freeze
  # JSON array of known-good institutional subjects to allow past a screening hold (the WL/AL allow-table
  # -- cuts false positives for established UCSF users). Each entry matches a subject_ref ("User:42") or
  # an email domain ("ucsf.edu" / "@ucsf.edu"), case-insensitive. Blank/unset => NOBODY is whitelisted
  # (fail-closed default). Example: ["ucsf.edu", "User:1"].
  EXPORT_CONTROL_SCREENING_WHITELIST = 'export_control_screening_whitelist'.freeze
  # (Removed) EXPORT_CONTROL_IDV_WHITELIST -- the document-IDV lane was retired (approval = attestation +
  # Visual Compliance denied-party screening, with NO document-IDV; legal-approved 2026-08-24). Nothing in
  # the live flow reads an IDV allow-table any more. Any live env AppConfig row named
  # 'export_control_idv_whitelist' is now inert and can be deleted operationally once this deploys.
  # Re-screen cadence in DAYS -- how long a passing screen stays valid before a re-screen is due. Blank,
  # zero, or non-positive => always re-screen (most conservative). Counsel sets the operational value.
  EXPORT_CONTROL_RESCREEN_CADENCE_DAYS = 'export_control_rescreen_cadence_days'.freeze
  # Hit-handling policy applied to a screening hold: "block" (deny outright), "hold" (place a hold and
  # await human Incident-Manager adjudication -- DEFAULT), or "report" (hold + emit a report signal).
  # Unknown/blank => "hold" (fail-closed; the policy is NEVER "allow" on a hit). Counsel owns the
  # legally-correct response to a hit.
  EXPORT_CONTROL_HIT_HANDLING = 'export_control_hit_handling'.freeze
  # CZID-599 -- per-gate-point toggles for the LIVE export-control screening gate (ExportControlScreeningGate).
  # Each turns the ScreeningService caller ON at ONE point, and ONLY when the master
  # AppConfig::ENABLE_EXPORT_CONTROL_LAYER3 is also "1". Both default OFF, so the gate hooks are a full
  # PASS-THROUGH (no screen call, no hold, normal user flow) until counsel + the license enable them.
  # Separate flags so the onboarding backstop and the result-release backstop can be turned on
  # independently. Screening is ADDITIONALLY gated by ENABLE_DESCARTES_SCREENING (screen_if_enabled), so
  # this ships triple-dark. Go-live is counsel + vendor gated (CZID-335), never flipped by engineering.
  ENABLE_EXPORT_CONTROL_SCREEN_ONBOARDING = 'enable_export_control_screen_onboarding'.freeze
  ENABLE_EXPORT_CONTROL_SCREEN_RELEASE = 'enable_export_control_screen_release'.freeze
  # SMP-1687 -- comma/space/semicolon-separated email recipient(s) notified when a screening HOLD is
  # placed (ExportControl::ComplianceNotifier). Without it a hold is SILENT: the user is blocked
  # fail-closed but nobody at UCSF is told there is something to adjudicate in the Descartes Incident
  # Manager, so the user stays blocked indefinitely. Blank/unset => NO notification is sent (inert --
  # matches the screening core's off-by-default posture; notification never blocks or breaks the
  # screening path). Carries NO secret and NO screened-party PII. Example: "export-compliance@ucsf.edu".
  EXPORT_CONTROL_COMPLIANCE_RECIPIENT = 'export_control_compliance_recipient'.freeze
  # CZID-598 -- watermark (ISO-8601 UTC string, no offset) for the Descartes Incident Manager resolution
  # poller (ResolveScreeningHolds). Records the "To" bound of the last fully-processed IMTimeStampSearch
  # window; the next poll starts its "From" here. Advanced ONLY after a reply is fully processed, so a
  # failed poll re-covers the same window (idempotent re-processing). Empty/unset => first poll uses the
  # API default 24h look-back. Inert until ENABLE_DESCARTES_SCREENING is on (the job self-skips when off).
  DESCARTES_RESOLUTION_POLL_CURSOR = 'descartes_resolution_poll_cursor'.freeze
  # CZID-285/596 -- selects the denied/restricted-party SCREENING vendor that
  # ExportControl::DeniedPartyScreeningProvider.provider_module resolves to (Path A: the
  # ExportControlClearancesController screening call). Accepts the committed provider name: "descartes"
  # routes to Providers::Descartes; "reference_stub" (or ANY unknown/blank value) FAILS CLOSED to
  # Providers::ReferenceStub, which returns PENDING => deny. Defaults to "reference_stub" so behaviour is
  # unchanged when unset, and there is NO value that opens a permissive path. Runtime-configurable so the
  # go-live switch (and rollback) is a config row, not a code deploy. Go-live is counsel + vendor gated
  # (CZID-335) and additionally requires ENABLE_DESCARTES_SCREENING for Descartes to place holds.
  EXPORT_CONTROL_SCREENING_PROVIDER = 'export_control_screening_provider'.freeze
  # When this is "1", all requests other than the landing page will be re-directed to the maintenance page.
  DISABLE_SITE_FOR_MAINTENANCE = 'disable_site_for_maintenance'.freeze
  # When this is "1", the Video Tour banner on the landing page will be shown.
  SHOW_LANDING_VIDEO_BANNER = 'show_landing_video_banner'.freeze
  # JSON array containing the number of the stages allowed to auto restart. Ex: [1, 3]
  AUTO_RESTART_ALLOWED_STAGES = 'auto_restart_allowed_stages'.freeze
  # The ECR image to use for the s3 tar writer service. Defaults to "idseq-s3-tar-writer:latest"
  S3_TAR_WRITER_SERVICE_ECR_IMAGE = 's3_tar_writer_service_ecr_image'.freeze
  # SMP-1868 rollout flag. When this is "1", bulk-download callback URLs are generated WITHOUT the
  # access_token in the path and the token is instead passed to the s3-tar-writer job via --auth-token
  # (sent as the X-Access-Token header on each callback). Leave "0"/unset until the header-aware
  # s3-tar-writer image is deployed, otherwise the old image errors on the unknown --auth-token flag.
  # The server accepts the token from either the header or the legacy path segment regardless of this
  # flag, so in-flight callbacks are never broken.
  BULK_DOWNLOAD_CALLBACK_TOKEN_IN_HEADER = 'bulk_download_callback_token_in_header'.freeze
  # The maximum number of objects (samples or workflow runs) that can be part of one bulk download.
  MAX_OBJECTS_BULK_DOWNLOAD = 'max_objects_bulk_download'.freeze
  # The maximum number of samples that can be part of an original input files bulk download.
  # Original input file downloads are significantly bigger and slower than other downloads, so a separate limit is needed.
  MAX_SAMPLES_BULK_DOWNLOAD_ORIGINAL_FILES = 'max_samples_bulk_download_original_files'.freeze
  # When this is "1", the announcement banner on the top of the site header will be enabled.
  # Other conditions may check a time constraint.
  SHOW_ANNOUNCEMENT_BANNER = 'show_announcement_banner'.freeze
  # When this is not "", the emergency announcement banner on the top of the site header will be enabled.
  # The emergency announcement banner with display the specified message.
  SHOW_EMERGENCY_BANNER_MESSAGE = 'show_emergency_banner_message'.freeze
  # The ARN of the mNGS pipeline's Step Function
  SFN_MNGS_ARN = 'sfn_mngs_arn'.freeze
  SFN_ARN = 'sfn_arn'.freeze
  # The ARN of a single stage pipeline's Step Function
  SFN_SINGLE_WDL_ARN = 'sfn_single_wdl_arn'.freeze
  SFN_CG_ARN = 'sfn_cg_arn'.freeze
  # When this is "1", the COVID-19 Public Site banner on the landing page will be shown.
  SHOW_LANDING_PUBLIC_SITE_BANNER = 'show_landing_public_site_banner'.freeze
  # List of launched features still guarded by a flag.
  # Use the features rake tasks for editing this key
  LAUNCHED_FEATURES = 'launched_features'.freeze
  # The projects to apply the following two defaults to.
  # Stored as a JSON array of project_ids.
  # This is intended to be a temporary short-term mechanism to service critical projects with our partners.
  SUBSAMPLE_WHITELIST_PROJECT_IDS = 'subsample_whitelist_project_ids'.freeze
  # Default subsample for special biohub samples.
  SUBSAMPLE_WHITELIST_DEFAULT_SUBSAMPLE = 'subsample_whitelist_default_subsample'.freeze
  # Default max_input_fragments for special biohub samples.
  SUBSAMPLE_WHITELIST_DEFAULT_MAX_INPUT_FRAGMENTS = 'subsample_whitelist_default_max_input_fragments'.freeze
  # For controlling caching of report page
  DISABLE_REPORT_CACHING = 'disable_report_caching'.freeze
  # Set the size limit for files uploaded from S3, in gigabytes.
  S3_SAMPLE_UPLOAD_FILE_SIZE_LIMIT = 's3_sample_upload_file_size_limit'.freeze
  # Switch to enable view-only project snapshots that are visible to logged-out users.
  ENABLE_SNAPSHOT_SHARING = 'enable_snapshot_sharing'.freeze
  # Templates versions
  WORKFLOW_VERSION_TEMPLATE = "%<workflow_name>s-version".freeze
  # When this is "1", Pipeline Run status updates will be in HandleSfnNotifications instead of PipelineMonitor and ResultMonitor.
  ENABLE_SFN_NOTIFICATIONS = "enable_sfn_notifications".freeze
  # When this is "1", filtering by taxon will bypass ES and instead return a predefined set of 5 taxa. Mainly intended to be used by developers on M1 since ES is currently incompatible.
  BYPASS_ES_TAXON_SEARCH = "bypass_es_taxon_search".freeze
  # When this is "1", PipelineReportService will return the decimal type columns for rpm, percent_identity, and alignment_length (instead of the float type columns)
  PIPELINE_REPORT_SERVICE_USE_DECIMAL_TYPE_COLUMNS = "pipeline_report_service_use_decimal_type_columns".freeze
  # When this is "1", automatic account creation will be enabled.
  AUTO_ACCOUNT_CREATION_V1 = "auto_account_creation_v1".freeze
  # SMP-1709 -- when this is "1", self-service signup (a logged-out visitor creating their own
  # account from the landing page's "Register Now" form -> Mutations::CreateUser, and the
  # /users/register confirmation page) is ENABLED. When "0"/unset it is DISABLED: the closed,
  # invite-only beta provisions users (admin-created / project-shared / VC-screened), so nobody
  # can self-register. Defaults OFF (fail-closed) so any environment WITHOUT an explicit row --
  # beta/staging/prod -- disables signup; the seed (SeedResource::AppConfigs) only sets it "1" in
  # the dev stage. This is INDEPENDENT of AUTO_ACCOUNT_CREATION_V1 (which also governs the profile
  # form and self-service profile updates); this flag gates ONLY the self-service signup entry
  # points and NEVER the admin / invite / provisioned-user paths.
  SELF_SERVICE_SIGNUP_ENABLED = "self_service_signup_enabled".freeze
  # When this is "0", old unclaimed accounts will be logged in Sentry, but not deleted. (Monitor mode.)
  # When this is "1", old unclaimed accounts will be deleted. (Deletion mode.)
  ENABLE_DELETE_UNCLAIMED_USER_ACCOUNTS = "auto_delete_unclaimed_accounts".freeze
  # Folder name in S3 of latest version of CARD databases to use for AMR.
  # Initially set to "card-3.2.6-wildcard-4.0.0". Must follow pattern of
  # "card-{version}-wildcard-{version}."
  CARD_FOLDER = "card_folder".freeze
  # The default alignment config to use when dispatching an mNGS run.
  # Initially set to "2021-01-22".
  DEFAULT_ALIGNMENT_CONFIG_NAME = "default_alignment_config_name".freeze
  # When this is "1", automatically delete old BulkDownloads via scheduled job.
  AUTO_DELETE_OLD_BULK_DOWNLOADS = "auto_delete_old_bulk_downloads".freeze
  # When this is "1", the user profile form will be saved locally
  LOCAL_USER_PROFILE = "local_user_profile".freeze
  # CZID-523 -- JSON array of approved institutional email domains, e.g. ["ucsf.edu", "chanzuckerberg.com"].
  # When set to a non-empty list, new/updated user accounts must have an email whose domain matches an
  # entry (exact match or a subdomain of an entry). When unset/empty, domain enforcement is OFF and any
  # email is accepted -- so this ships DARK and is opt-in per deployment (UCSF go-live sets the list).
  # An ENV var ALLOWED_EMAIL_DOMAINS (comma-separated) is used as a fallback when this key is unset.
  ALLOWED_EMAIL_DOMAINS = "allowed_email_domains".freeze
  # CZID-520 -- when this is "1", the EnforceDataRetention job actually deletes expired sample data
  # (routing through the vetted soft-delete -> HardDeleteObjects path). When unset/"0" the job runs in
  # DRY-RUN mode: it logs what it WOULD delete but deletes nothing. Ships OFF so retention enforcement
  # is opt-in per deployment and never fires by accident.
  ENABLE_DATA_RETENTION_ENFORCEMENT = "enable_data_retention_enforcement".freeze
  # CZID-520 -- the retention window in days. Sample runs/outputs older than this are considered expired.
  # Stored as a plain integer string, e.g. "90". When unset the job uses EnforceDataRetention::DEFAULT_
  # RETENTION_DAYS. A configured value below EnforceDataRetention::MIN_RETENTION_DAYS is rejected (the job
  # aborts without deleting) so a fat-fingered small window cannot wipe recent data.
  DATA_RETENTION_DAYS = "data_retention_days".freeze

  after_save :clear_cached_record

  def clear_cached_record
    Rails.cache.delete("app_config-#{key}")
  end
end
