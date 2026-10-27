FactoryBot.define do
  factory :weekly_sample_upload_usage, class: "WeeklySampleUploadUsage" do
    week_start { WeeklySampleUploadLimit.week_start }
    channel { "web" }
    samples_count { 0 }
  end
end
