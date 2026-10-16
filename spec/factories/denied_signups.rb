FactoryBot.define do
  # A denied applicant signup archived in denied_signups (see DeniedSignup). Default is an AUTO denial for a
  # sanctioned jurisdiction with a full account payload, the shape a later officer clearance reinstates from.
  factory :denied_signup do
    sequence(:subject_ref) { |n| "Signup:denied-#{n}" }
    sequence(:screening_id) { |n| "scr-denied-#{n}" }
    callback_url { "http://web/internal/v1/screening_result" }
    account_email { "denied@example.org" }
    account_name { "Denied Applicant" }
    account_institution { "Example Institute" }
    reason { Hold::REASON_SANCTIONED_JURISDICTION }
    decided_by { DeniedSignup::DECIDED_BY_AUTO }
    denied_at { Time.current }
  end
end
