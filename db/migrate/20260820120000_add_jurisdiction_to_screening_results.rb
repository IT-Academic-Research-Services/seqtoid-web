# frozen_string_literal: true

# Jurisdiction (zero-tolerance geo) evidence on screening_results: the country that was screened and
# whether it triggered the sanctioned-jurisdiction rule (in-house embargo list OR vendor risk_country).
# Both nullable-safe/defaulted -- additive, no backfill needed (existing rows predate the rule).
class AddJurisdictionToScreeningResults < ActiveRecord::Migration[7.2]
  def change
    add_column :screening_results, :country, :string
    add_column :screening_results, :jurisdiction_risk, :boolean, default: false, null: false
  end
end
