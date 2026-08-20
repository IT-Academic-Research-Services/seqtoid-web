# frozen_string_literal: true

# Jurisdiction (zero-tolerance geo) evidence on screening_results: the country that was screened and
# whether it triggered the sanctioned-jurisdiction rule (in-house embargo list OR vendor risk_country).
# Both nullable-safe/defaulted -- additive, no backfill needed (existing rows predate the rule).
class AddJurisdictionToScreeningResults < ActiveRecord::Migration[7.2]
  # Plain add_column (NOT a bulk change_table): strong_migrations cannot inspect a change_table block
  # and would force a safety_assured wrapper, whereas each add_column here is statically verified safe.
  # That is why the rubocop Rails/BulkChangeTable suggestion is disabled -- the two rules conflict and
  # strong_migrations wins for a migration that must pass the deploy PreSync hook. if_not_exists keeps
  # the migration re-runnable (bin/ci-migrate-check replays a partial-apply state and migrates again).
  # rubocop:disable Rails/BulkChangeTable
  def change
    add_column :screening_results, :country, :string, if_not_exists: true
    add_column :screening_results, :jurisdiction_risk, :boolean, default: false, null: false, if_not_exists: true
  end
  # rubocop:enable Rails/BulkChangeTable
end
