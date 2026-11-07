# Boot-time ENV diagnostic. We log which vars are set (handy for debugging config
# drift across ECS/EKS), but REDACT anything that looks like a credential so secrets
# never land in stdout / pod logs / log aggregation (#480). The key is still shown so
# you can confirm a var is present; only sensitive values are masked.
SENSITIVE_ENV_PATTERN = /PASSWORD|SECRET|TOKEN|_KEY|KEY_BASE|CREDENTIAL|PRIVATE|DSN/i

Rails.logger.info("[BOOT] Dumping selected ENV vars before Rails loads (secrets redacted):", module: "boot")
ENV.each do |key, value|
  Rails.logger.info("#{key}: #{key.match?(SENSITIVE_ENV_PATTERN) ? '[REDACTED]' : value}", module: "boot")
end

Rails.logger.info("[BOOT] Rails.env: #{Rails.env&.to_s}", module: "boot")
