# frozen_string_literal: true

# Filter out spammy "ActiveRecord::SchemaMigration Load" messages
ActiveSupport.on_load(:active_record) do
  ActiveRecord::LogSubscriber.class_eval do
    alias_method :old_sql, :sql

    def sql(event)
      payload = event.payload

      # Filter out schema migrations and internal metadata spam
      return if payload[:name] == 'ActiveRecord::SchemaMigration Load'
      return if payload[:name] == 'ActiveRecord::InternalMetadata Load'
      return if payload[:sql] =~ /schema_migrations/

      old_sql(event)
    end
  end
end
