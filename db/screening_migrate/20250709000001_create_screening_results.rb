# frozen_string_literal: true

# Option A -- the screening service's OWN copy of screening_results, applied by the `screening` connection
# to the ISOLATED screening Aurora cluster (SCREENING_DB_TASKS=true, service role only). It is the
# CONSOLIDATED current schema: the original create (CZID-597) folded together with the later additive
# columns (trace_id, country, jurisdiction_risk) so a fresh cluster reaches today's shape in one step.
#
# if_not_exists throughout so that in the single-DB envs -- where the `screening` connection is a routing
# alias to the primary DB, which ALREADY carries this table from db/migrate -- applying this is a safe
# no-op. See config/database.yml (the screening connection) and app/models/screening_record.rb.
class CreateScreeningResults < ActiveRecord::Migration[7.2]
  def change
    create_table :screening_results, if_not_exists: true do |t|
      t.string :subject_ref, null: false
      t.string :subject_type
      t.string :soptionalid
      t.string :transstatus
      t.string :alert_level, null: false
      t.integer :risk_country
      t.string :list
      t.string :sdistributedid
      t.string :incident_id
      t.string :provider
      t.datetime :screened_at, null: false
      t.string :raw_response_ref
      t.string :trace_id
      # Jurisdiction (zero-tolerance geo) evidence -- the screened country and whether it tripped the
      # sanctioned-jurisdiction rule (our embargo list OR the vendor risk_country).
      t.string :country
      t.boolean :jurisdiction_risk, default: false, null: false
      t.datetime :created_at, precision: 6, null: false
      # No updated_at: rows are append-only / immutable by intent.
    end

    add_index :screening_results, [:subject_ref, :screened_at], if_not_exists: true
    add_index :screening_results, :incident_id, if_not_exists: true
  end
end
