# Append-only change log for feature flags (Feature, app/models/feature.rb). Every Feature mutation that
# changes something writes one row in the same transaction as the change: who (actor_user_id, or
# actor_label for a non-user actor such as a rake task), what (feature, action, scope, target), and where
# (environment = Rails.env plus ENV["ENVIRONMENT"] when set). Never updated or deleted by the app.
class CreateFeatureFlagEvents < ActiveRecord::Migration[7.2]
  def change
    create_table :feature_flag_events, charset: "utf8mb4", collation: "utf8mb4_unicode_ci", if_not_exists: true do |t|
      t.string :feature, null: true, comment: "Flag name; NULL for a group membership change"
      t.string :action, null: false, limit: 32, comment: "enable, disable, add_member or remove_member"
      t.string :scope, null: false, limit: 16, comment: "global, user or group"
      t.string :group_name, null: true, limit: 64, comment: "Group for scope=group"
      t.bigint :target_user_id, null: true, comment: "User the change applies to (scope=user, or a member)"
      t.string :target_member, null: true, comment: "Group member as given (user id or email)"
      t.bigint :actor_user_id, null: true, comment: "User who made the change; NULL for a non-user actor"
      t.string :actor_label, null: false, comment: "Actor email, or e.g. 'rake features:launch'"
      t.string :environment, null: false, limit: 64, comment: "Rails.env, plus ENV['ENVIRONMENT'] when set"
      t.datetime :created_at, null: false, precision: 6
      t.index :feature
      t.index :created_at
    end
  end
end
