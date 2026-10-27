# Per-user weekly sample upload limits (WeeklySampleUploadLimit).
#
# weekly_sample_upload_usages: samples a user uploaded in one week (Sunday 00:00 Pacific) through one channel
# (cli / web / s3 / basespace). Counted when the upload is accepted, so deleting samples later does not give
# the allowance back. One row per user, week and channel; rows are locked while an upload is checked.
#
# sample_upload_limit_overrides: an approved exception for one user -- higher weekly limits, or none at all.
# NULL limit = the deployment default for that channel.
class CreateWeeklySampleUploadLimits < ActiveRecord::Migration[7.2]
  def change
    create_table :weekly_sample_upload_usages, if_not_exists: true do |t|
      t.bigint :user_id, null: false
      t.date :week_start, null: false, comment: "Sunday the week starts on (America/Los_Angeles)"
      t.string :channel, null: false, limit: 16, comment: "cli, web, s3 or basespace"
      t.integer :samples_count, null: false, default: 0
      t.timestamps
      t.index [:user_id, :week_start, :channel], unique: true, name: "index_weekly_sample_upload_usages_unique"
    end

    create_table :sample_upload_limit_overrides, if_not_exists: true do |t|
      t.bigint :user_id, null: false
      t.boolean :unlimited, null: false, default: false, comment: "No weekly limit at all for this user"
      t.integer :cli_weekly_limit, null: true
      t.integer :web_weekly_limit, null: true
      t.integer :s3_weekly_limit, null: true
      t.integer :basespace_weekly_limit, null: true
      t.integer :total_weekly_limit, null: true
      t.datetime :expires_at, null: true, comment: "NULL = until removed"
      t.string :approved_by, null: false, comment: "Who approved the exception"
      t.text :reason, null: false
      t.timestamps
      t.index :user_id, unique: true
    end
  end
end
