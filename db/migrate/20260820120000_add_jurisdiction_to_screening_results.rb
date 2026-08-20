# frozen_string_literal: true

# Jurisdiction (zero-tolerance geo) evidence on screening_results: the country that was screened and
# whether it triggered the sanctioned-jurisdiction rule (in-house embargo list OR vendor risk_country).
# Both nullable-safe/defaulted -- additive, no backfill needed (existing rows predate the rule).
class AddJurisdictionToScreeningResults < ActiveRecord::Migration[7.2]
  # Explicit up/down (not change) so the migration is re-runnable -- bin/ci-migrate-check replays a
  # partial-apply state and migrates again. bulk: true combines both adds into one ALTER (Rails/BulkChangeTable).
  def up
    return if column_exists?(:screening_results, :country)

    change_table :screening_results, bulk: true do |t|
      t.string :country
      t.boolean :jurisdiction_risk, default: false, null: false
    end
  end

  def down
    return unless column_exists?(:screening_results, :country)

    change_table :screening_results, bulk: true do |t|
      t.remove :country, :jurisdiction_risk
    end
  end
end
