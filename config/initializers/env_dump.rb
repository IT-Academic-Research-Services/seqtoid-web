Rails.logger.info "[BOOT] Dumping selected ENV vars before Rails loads:"
ENV.each do |key, value|
  Rails.logger.info "#{key}: #{value}"
end

Rails.logger.info "[BOOT] Rails.env: #{Rails.env&.to_s}"
