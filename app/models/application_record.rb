class ApplicationRecord < ActiveRecord::Base
  self.abstract_class = true

  # MySQL sorts NULLs as the lowest value (NULLs first on ASC, last on DESC);
  # PostgreSQL defaults to the opposite. Append the result of this to a nullable
  # sort column's ORDER BY direction to preserve MySQL's ordering after the
  # Postgres migration (bug-#011 parity). Tiebreaker columns (id) are never NULL.
  def self.mysql_nulls(_order_dir)
    # MySQL orders NULLs natively (NULLs first on ASC, last on DESC) and does not
    # support the Postgres "NULLS FIRST/LAST" syntax, so emit nothing.
    ""
  end

  # order_dir is interpolated directly into raw ORDER BY strings in the various
  # sort_* model methods, so clamp it to an allow-list before use — the same
  # defense the sort_key already gets. Anything that isn't asc/desc falls back
  # to "asc". Defense-in-depth against SQL injection / unexpected ordering.
  # (CZID-51 / APP-4)
  ORDER_DIRECTIONS = %w[asc desc].freeze
  def self.safe_order_dir(order_dir)
    ORDER_DIRECTIONS.include?(order_dir.to_s.downcase) ? order_dir.to_s.downcase : "asc"
  end

  # We have auto-analytics tracking set up for specific DB models we flag.
  # For models that are flagged, we fire off tracking events for any create,
  # change, or delete of that model. Originally, we did this for all models,
  # but it turned out we didn't actually use much of that data, so now we have
  # this opt-in approach. If a model should have auto-analytics enabled, add
  # an `ENABLE_MODEL_AUTO_ANALYTICS` constant with `true` to that model's code.
  # We set this constant here at the `ApplicationRecord` level so we can rely
  # on a default value of `false` when a given model does not explicitly set it
  # since all models inherit from ApplicationRecord.
  ENABLE_MODEL_AUTO_ANALYTICS = false
  # NOTE: Batch ActiveRecord operations such as update_all and delete_all do not
  # fire callbacks.
  after_create { |record| log_analytics record, "created" }
  after_update { |record| log_analytics record, "updated" }
  after_destroy { |record| log_analytics record, "destroyed" }

  before_save :log_errors, if: proc { |m| m.errors.any? }

  def log_errors
    msg = errors.full_messages.join("\n")
    LogUtil.log_error(msg)
    Rails.logger.error("Backtrace:\n\t#{caller.join("\n\t")}")
  end

  # See also EventDictionary
  def log_analytics(record, action)
    # Short-circuit to no-op if model not explicitly marked for auto-analytics.
    # See above in this file for more info on DB model auto-analytics.
    return unless record.class.const_get :ENABLE_MODEL_AUTO_ANALYTICS

    # example: "visualization_updated"
    event = "#{record.class.name.underscore}_#{action}"

    properties = {
      # There should always be an id but just in case...
      id: record.respond_to?(:id) ? record.id : nil,
      # Add string name for convenience if available, except for people's names,
      # which are PII and thus prohibited from Google Analytics.
      name: record.respond_to?(:name) && record.class.name != User.name ? record.name : nil,
      # Set common belongs_to IDs if available
      user_id: record.respond_to?(:user_id) ? record.user_id : nil,
      project_id: record.respond_to?(:project_id) ? record.project_id : nil,
      sample_id: record.respond_to?(:sample_id) ? record.sample_id : nil,
      pipeline_run_id: record.respond_to?(:pipeline_run_id) ? record.pipeline_run_id : nil,
    }

    # Merge status changes, important for updates, for example:
    # "status", "job_status", "command_status"
    properties = properties.merge(
      record.attributes.select { |k, _v| k.include?("status") }
    )

    # Remove empty keys
    properties = properties.delete_if { |_k, v| v.nil? }

    # log_analytics_event will never block
    MetricUtil.log_analytics_event(
      event,
      Logging::CurrentContext.user,
      properties,
      Logging::CurrentContext.request
    )
    Rails.logger.debug("Event '#{event}' logged with properties #{properties}")
  end
end
