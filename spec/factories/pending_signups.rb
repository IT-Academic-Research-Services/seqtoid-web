FactoryBot.define do
  # Option A / piece 5b -- an applicant signup held while screening is in flight. Default is PENDING with a
  # full account payload + callback url, the shape the resolution poller drives a decision callback from.
  factory :pending_signup do
    sequence(:subject_ref) { |n| "User:#{n}" }
    sequence(:screening_id) { |n| "scr-#{n}" }
    callback_url { "http://web/internal/v1/screening_result" }
    account_email { "applicant@ucsf.edu" }
    account_name { "Applicant Name" }
    account_institution { "UCSF" }
    status { PendingSignup::STATUS_PENDING }

    trait :resolved do
      status { PendingSignup::STATUS_RESOLVED }
      decision { PendingSignup::DECISION_APPROVED }
      resolved_at { Time.current }
    end
  end
end
