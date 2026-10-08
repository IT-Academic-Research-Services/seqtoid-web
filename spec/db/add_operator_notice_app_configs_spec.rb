require "rails_helper"

# Exercises the operator-notice seed migration directly. Unlike the SeedResource path (which only runs in
# the already-applied baseline migration), this runs under seed:migrate and so must reach existing
# environments: the banner ships off/empty, the transfer notice ships with its default copy, and an
# operator's out-of-band value is never clobbered.
require Rails.root.join("db/seeds/20261007000000_add_operator_notice_app_configs.rb")

RSpec.describe AddOperatorNoticeAppConfigs do
  subject(:run_migration) { described_class.new.up }

  it "ships the home banner off/empty so it renders nothing" do
    run_migration

    expect(AppConfigHelper.get_app_config(AppConfig::USER_HOME_BANNER_ENABLED)).to eq("0")
    expect(AppConfigHelper.get_app_config(AppConfig::USER_HOME_BANNER_TEXT)).to eq("")
    expect(AppConfigHelper.get_app_config(AppConfig::USER_HOME_BANNER_SEVERITY)).to eq("info")
  end

  it "ships the CZ ID transfer notice with its default copy" do
    run_migration

    expect(AppConfigHelper.get_app_config(AppConfig::CZID_TRANSFER_NOTICE_TEXT))
      .to eq("Data Transfer Notice: Transfers may take up to 7 business days")
  end

  it "is create-only: a re-run adds no duplicate rows" do
    run_migration
    count_after_first = AppConfig.count

    expect { described_class.new.up }.not_to change(AppConfig, :count)
    expect(AppConfig.count).to eq(count_after_first)
  end

  it "never clobbers a value an operator set out-of-band" do
    AppConfig.create!(key: AppConfig::USER_HOME_BANNER_ENABLED, value: "1")
    AppConfig.create!(key: AppConfig::CZID_TRANSFER_NOTICE_TEXT, value: "Custom notice")

    run_migration

    expect(AppConfigHelper.get_app_config(AppConfig::USER_HOME_BANNER_ENABLED)).to eq("1")
    expect(AppConfigHelper.get_app_config(AppConfig::CZID_TRANSFER_NOTICE_TEXT)).to eq("Custom notice")
  end
end
