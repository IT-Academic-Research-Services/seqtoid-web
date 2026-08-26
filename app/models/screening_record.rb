# frozen_string_literal: true

# Abstract base for the export-control SCREENING models (Option A -- standalone screening service). Every
# screening table (ScreeningResult, Hold, PendingSignup) routes through the `screening` connection defined
# in config/database.yml instead of the primary app database.
#
# In dev / test / the web app the `screening` connection is a ROUTING ALIAS to the primary database (the
# screening tables live in the primary schema.rb, unchanged), so nothing about single-DB behavior moves.
# ONLY the screening-service pods -- which set SCREENING_DB_* + SCREENING_DB_TASKS=true -- resolve this to
# the dedicated, ISOLATED screening Aurora cluster, so the applicant PII held mid-signup and the screening
# evidence never share the app database. See [[vc-signup-screening-flow]] / infra screening-db stack.
#
# It inherits ApplicationRecord for the shared logging/analytics helpers (auto-analytics is opt-in and
# stays OFF for these models), then overrides the connection for the whole screening hierarchy.
class ScreeningRecord < ApplicationRecord
  self.abstract_class = true

  # Single role -- reads and writes both use the screening connection (no read replica). In the single-DB
  # envs this resolves to the primary database (a routing alias); only the service role points it elsewhere.
  connects_to database: { writing: :screening }
end
