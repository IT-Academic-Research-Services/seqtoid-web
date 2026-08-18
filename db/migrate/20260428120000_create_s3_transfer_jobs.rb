class CreateS3TransferJobs < ActiveRecord::Migration[7.0]
  def change
    create_table :s3_transfer_jobs do |t|
      t.bigint :user_id, null: false
      t.string :status, null: false, default: "CREATED"
      t.string :batch_job_arn
      t.string :batch_job_id
      t.string :manifest_s3_key
      t.string :destination_bucket
      t.integer :file_count
      t.text :error_message
      t.datetime :executed_at
      t.float :time_to_finalized
      t.datetime :created_at, precision: 6, null: false
      t.datetime :updated_at, precision: 6, null: false

      t.index :user_id
      t.index :status
      t.index :batch_job_arn
    end
  end
end
