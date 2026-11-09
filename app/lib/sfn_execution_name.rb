# Prefix for Step Functions execution names.
#
# Several deployments can dispatch to the SAME state machines: dev and every per-PR preview
# sandbox all run against dev's. They also all run Rails.env=development, so by default they
# mint names in one namespace ("idseq-development-<project>-<sample>-<run>-<ts>"), and the run
# ids inside those names overlap because each preview has its own database.
#
# The execution name is the one field of a "Step Functions Execution Status Change" event that
# says which deployment started it, so it is what an SNS subscription filter policy routes on.
# Setting SFN_EXECUTION_NAME_PREFIX gives a deployment its own namespace (a preview uses
# "idseq-pr-<N>"). When it is unset, every caller gets exactly the name it built before.
module SfnExecutionName
  ENV_KEY = "SFN_EXECUTION_NAME_PREFIX".freeze
  # Step Functions allows [0-9A-Za-z_-] in an execution name (80 chars max overall).
  VALID_PREFIX = /\A[0-9A-Za-z_-]{1,40}\z/

  # Returns the deployment's configured prefix, or `default` when none is configured.
  def self.prefix(default)
    override = ENV[ENV_KEY].to_s.strip
    return default if override.empty?

    unless override.match?(VALID_PREFIX)
      # Fail at dispatch with a message that names the setting, instead of an opaque
      # Aws::States ValidationException for every pipeline this deployment starts.
      raise ArgumentError, "#{ENV_KEY}=#{override.inspect} is not a valid Step Functions name prefix " \
                           "(allowed: 1-40 of [0-9A-Za-z_-])"
    end

    override
  end
end
