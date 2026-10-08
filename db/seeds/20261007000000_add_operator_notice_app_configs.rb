# Seed the operator-editable notice AppConfig keys. This runs under `seed:migrate` (the deploy
# migrate-job appends it, and sandbox:seed_once runs it too), so unlike SeedResource::AppConfigs -- which
# only runs inside the already-applied baseline seed migration -- this reaches EXISTING environments and
# preview sandboxes on their next deploy/sync, not just a fresh bootstrap.
#
#   * The home banner ships OFF/empty (enabled "0", text "", severity "info"), so it renders NOTHING
#     until an operator turns it on.
#   * CZID_TRANSFER_NOTICE_TEXT ships WITH its default copy, so the notice is visible next to the CZ ID
#     transfer fields on the signup form as soon as this applies.
#
# Create-only: a key already present (e.g. one an operator set out-of-band, or a re-run) is left
# untouched, so this never clobbers a live value. SeedMigration also tracks this migration, so it runs
# at most once per schema regardless.
class AddOperatorNoticeAppConfigs < SeedMigration::Migration
  SEEDS = {
    AppConfig::USER_HOME_BANNER_ENABLED => "0",
    AppConfig::USER_HOME_BANNER_TEXT => "",
    AppConfig::USER_HOME_BANNER_SEVERITY => "info",
    AppConfig::CZID_TRANSFER_NOTICE_TEXT => "Data Transfer Notice: Transfers may take up to 7 business days",
  }.freeze

  def up
    SEEDS.each do |key, value|
      AppConfig.create!(key: key, value: value) unless AppConfig.exists?(key: key)
    end
  end

  def down
    SEEDS.each_key { |key| AppConfigHelper.remove_app_config(key) }
  end
end
