# frozen_string_literal: true

# Option A -- the screening service's OWN copy of holds, applied by the `screening` connection to the
# ISOLATED screening cluster (service role only). CONSOLIDATED current schema: the original create
# (CZID-597) folded with the later additive columns (trace_id + the SMP-1253 adjudication columns:
# disposition / resolution_status / incident_id / resolved_at). if_not_exists so it is a safe no-op in the
# single-DB envs, where the `screening` connection aliases the primary DB that already carries this table.
class CreateHolds < ActiveRecord::Migration[7.2]
  def change
    create_table :holds, if_not_exists: true do |t|
      t.string :subject_ref, null: false
      t.string :subject_type
      t.string :reason, null: false
      t.bigint :screening_result_id
      t.datetime :released_at
      t.string :trace_id
      # SMP-1253 durable adjudication record.
      t.string :disposition
      t.string :resolution_status
      t.string :incident_id
      t.datetime :resolved_at
      t.timestamps precision: 6
    end

    add_index :holds, :screening_result_id, if_not_exists: true
    add_index :holds, [:subject_ref, :released_at], if_not_exists: true
  end
end
