module AppConfigHelper
  module_function

  def get_app_config(key, default_value = nil)
    # Flags are accessed frequently but don't change that often so we should
    # cache. Value is invalidated by 'after_save :clear_cached_record' but
    # expires_in is set just in case.
    value = Rails.cache.fetch("app_config-#{key}", expires_in: 5.minutes) do
      AppConfig.find_by(key: key).presence&.value
    end
    value || default_value
  end

  def set_app_config(key, value)
    app_config = AppConfig.find_by(key: key)

    if app_config.nil?
      app_config = AppConfig.create(key: key)
    end

    app_config.update(value: value)
  end

  def remove_app_config(key)
    app_config = AppConfig.find_by(key: key)

    if app_config.nil?
      Rails.logger.error("[AppConfigHelper#remove_app_config] could not find key '#{key}'")
    else
      Rails.logger.info("[AppConfigHelper#remove_app_config] removing key '#{key}' with value '#{app_config.value}'")
      app_config.destroy
      Rails.cache.delete("app_config-#{key}")
    end
  end

  # SMP-1709 -- true only when self-service signup is explicitly enabled ("1"). Absent/blank/"0"
  # => false (fail-closed), so any environment without an explicit row disables signup. The dev
  # stage is seeded "1" (SeedResource::AppConfigs); beta/staging/prod are seeded "0". This gates
  # ONLY the self-service signup entry points (landing "Register Now" -> Mutations::CreateUser and
  # the /users/register page); the admin / invite / provisioned-user paths never consult it.
  def self_service_signup_enabled?
    get_app_config(AppConfig::SELF_SERVICE_SIGNUP_ENABLED) == "1"
  end

  def get_json_app_config(key, default_value = nil, raise_error = false)
    value = get_app_config(key)
    begin
      return JSON.parse(value) if value.present? && value.strip != ""
    rescue JSON::ParserError => e
      Rails.logger.error("AppConfigHelper error parsing JSON config key '#{key}'. Error: #{e.message}")
      raise if raise_error
    end
    default_value
  end

  def set_json_app_config(key, value)
    AppConfigHelper.set_app_config(key, JSON.dump(value))
  end

  # Return all app configs that should be sent to the front-end React application.
  def configs_for_context
    # Fetch all app configs in one query.
    app_configs = AppConfig
                  .where(key: [
                           AppConfig::AUTO_ACCOUNT_CREATION_V1,
                           AppConfig::SELF_SERVICE_SIGNUP_ENABLED,
                           AppConfig::MAX_OBJECTS_BULK_DOWNLOAD,
                           AppConfig::MAX_SAMPLES_BULK_DOWNLOAD_ORIGINAL_FILES,
                         ])
                  .map { |app_config| [app_config.key, app_config.value] }
                  .to_h
    {
      autoAccountCreationEnabled: app_configs[AppConfig::AUTO_ACCOUNT_CREATION_V1] == "1",
      # SMP-1709 -- lets the landing page swap the "Register Now" form for a request-access CTA
      # when self-service signup is disabled. Absent row => false (fail-closed).
      selfServiceSignupEnabled: app_configs[AppConfig::SELF_SERVICE_SIGNUP_ENABLED] == "1",
      maxObjectsBulkDownload: app_configs[AppConfig::MAX_OBJECTS_BULK_DOWNLOAD].to_i,
      maxSamplesBulkDownloadOriginalFiles: app_configs[AppConfig::MAX_SAMPLES_BULK_DOWNLOAD_ORIGINAL_FILES].to_i,
    }
  end

  def get_workflow_version(workflow_name)
    return get_app_config(format(AppConfig::WORKFLOW_VERSION_TEMPLATE, workflow_name: workflow_name))
  end

  def set_workflow_version(workflow_name, workflow_version)
    key = format(AppConfig::WORKFLOW_VERSION_TEMPLATE, workflow_name: workflow_name)
    Rails.logger.info("WorkflowUpgradeEvent: Setting #{key} to #{workflow_version}")
    create_workflow_version(workflow_name, workflow_version)
    return set_app_config(key, workflow_version)
  end

  # TODO: Be able to mark workflows as not runnable/deprecated via the Admin Settings page.
  def create_workflow_version(workflow_name, workflow_version)
    unless WorkflowVersion.find_by(workflow: workflow_name, version: workflow_version)
      WorkflowVersion.create(workflow: workflow_name, version: workflow_version, deprecated: false, runnable: true)
    end
  end

  # SMP-1724 -- seed-time setter for a `<workflow>-version` app_config that NEVER downgrades a value
  # an environment has already advanced past.
  #
  # db:seed / seed:migrate run in the migrate PreSync hook on every deploy, reconstitute, and fresh
  # bootstrap. The version-seed migrations set `*-version` app_configs to the values hardcoded in the
  # (necessarily stale) seed snapshot. `set_app_config` overwrites unconditionally, so when such a
  # migration is (re)applied against an env whose live default was bumped forward -- e.g. staging
  # hand-set short-read-mngs to 8.3.16 -- it silently reverts the runtime default to the stale seed
  # value (8.3.15). VersionRetrievalService (CZID-982) does NOT catch this: the stale value is itself
  # catalogued, so dispatch happily runs the OLD WDL. That bit a beta tester on 2026-08-10.
  #
  # Rules:
  #   * absent/blank -> set to the seed value (a fresh bootstrap needs a default).
  #   * live >= seed -> leave the live value untouched (never downgrade a bumped env).
  #   * live <  seed -> advance to the seed value (normal forward bump on a not-yet-current env).
  #
  # Whatever value ends up live is then guaranteed a WorkflowVersion catalog row, so preserving a
  # bumped-but-uncatalogued live value can never leave a default that the fail-closed
  # VersionRetrievalService / SMP-1718 seed assertion would reject. Returns the effective (post-call)
  # version string.
  def seed_workflow_version(workflow_name, seed_version)
    key = format(AppConfig::WORKFLOW_VERSION_TEMPLATE, workflow_name: workflow_name)
    current = AppConfig.find_by(key: key)&.value.to_s.strip

    effective =
      if current.blank? || version_older?(current, seed_version)
        set_app_config(key, seed_version)
        seed_version
      else
        Rails.logger.info(
          "[SMP-1724] preserving #{key}=#{current} (>= seed #{seed_version}); not downgrading on re-seed"
        )
        current
      end

    # Guarantee the LIVE default is catalogued so dispatch never fail-closes on it (SMP-1718).
    create_workflow_version(workflow_name, effective)
    effective
  end

  # True when `lhs` is a strictly older version than `rhs`, by semantic-version ordering. Falls back
  # to conservative "not older" (so the live value is PRESERVED, never downgraded) for anything
  # Gem::Version cannot parse -- a non-semver live value must never be clobbered by a semver seed.
  def version_older?(lhs, rhs)
    Gem::Version.new(lhs.to_s.strip) < Gem::Version.new(rhs.to_s.strip)
  rescue ArgumentError
    false
  end

  def update_default_alignment_config(alignment_config_name)
    alignment_config = AlignmentConfig.find_by(name: alignment_config_name)
    if alignment_config.nil?
      raise "Alignment config does not exist"
    end

    Rails.logger.info("UpgradeEvent: Setting #{AppConfig::DEFAULT_ALIGNMENT_CONFIG_NAME} to #{alignment_config_name}")
    create_workflow_version(AlignmentConfig::NCBI_INDEX, alignment_config_name)
    return set_app_config(AppConfig::DEFAULT_ALIGNMENT_CONFIG_NAME, alignment_config_name)
  end
end
