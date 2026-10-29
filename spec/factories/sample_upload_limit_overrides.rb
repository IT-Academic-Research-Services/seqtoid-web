FactoryBot.define do
  factory :sample_upload_limit_override, class: "SampleUploadLimitOverride" do
    approved_by { "approver" }
    reason { "approved collaboration" }
  end
end
