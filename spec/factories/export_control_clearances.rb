FactoryBot.define do
  # CZID-285 -- Layer 3 screening clearance evidence record. Default factory is a PASSED clearance
  # (screening clear); traits cover the fail-closed branches the gate must DENY. The document-IDV lane was
  # retired (approval = attestation + Visual Compliance, no document-IDV), so verification_status is left
  # nil on new rows and no longer gates the flow.
  factory :export_control_clearance do
    association :user
    screening_result { ExportControlClearance::SCREENING_CLEAR }
    clearance_version { ExportControlClearance::CURRENT_VERSION }
    screening_provider { "reference_stub" }
    ip_address { "203.0.113.7" }
    viewer_country { "US" }
    user_agent { "RSpec" }

    trait :screening_hit do
      screening_result { ExportControlClearance::SCREENING_HIT }
    end

    trait :screening_pending do
      screening_result { ExportControlClearance::SCREENING_PENDING }
    end

    trait :stale_version do
      clearance_version { "v0-old" }
    end
  end
end
