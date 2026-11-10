namespace "features" do
  # rake features:launch[<feature_name>]
  task :launch, [:feature_name] => :environment do |_, args|
    if args[:feature_name].nil?
      puts "No feature specified to launch"
      next
    end

    new_features = AppConfigHelper.get_json_app_config(AppConfig::LAUNCHED_FEATURES, []) | [args[:feature_name]]
    AppConfigHelper.set_json_app_config(AppConfig::LAUNCHED_FEATURES, new_features)
    puts "Add feature: #{args[:feature_name]}"
    puts "Currently launched: #{new_features}"
  end

  # rake features:remove[<feature_name>]
  task :remove, [:feature_name] => :environment do |_, args|
    features = AppConfigHelper.get_json_app_config(AppConfig::LAUNCHED_FEATURES, [])
    if features.include?(args[:feature_name])
      features -= [args[:feature_name]]
      AppConfigHelper.set_json_app_config(AppConfig::LAUNCHED_FEATURES, features)
      puts "Removed feature: #{args[:feature_name]}"
    else
      puts "Feature is not launched: #{args[:feature_name]}"
    end
    puts "Currently launched: #{features}"
  end

  # rake features:list
  task list: :environment do
    features = AppConfigHelper.get_json_app_config(AppConfig::LAUNCHED_FEATURES, [])
    puts "Currently launched: #{features}"
  end
end

# Opt-in cleanup for users.allowed_features columns polluted by the old User#add_allowed_feature /
# #remove_allowed_feature, which saved the MERGED list (own grants | LAUNCHED_FEATURES) into the user's
# own column. A polluted user keeps every feature that was launched at the time even after it is
# un-launched. Dry run unless APPLY=1; prints every row it would change (before -> after).
#
# There is no record of which per-user grants were deliberate, so a launched feature found in a user's
# column is either pollution OR a real grant made before the feature was launched. The two modes:
#
#   MODE=superset (default, conservative): only touch columns that contain EVERY currently launched
#     feature -- the signature of the bug, which copied the whole launched list in one write. Columns
#     that hold only SOME launched features are listed as "ambiguous" and left alone for a human.
#   MODE=all: strip every currently launched feature from every column. Also removes legitimate
#     pre-launch grants; only use it if un-launching must take effect for everyone.
#
# Either way the effective feature set of every user is UNCHANGED at the time of the run (launched
# features stay on through LAUNCHED_FEATURES); the cleanup only matters once a feature is un-launched.
#
#   rake features:cleanup_user_columns
#   rake features:cleanup_user_columns APPLY=1
#   rake features:cleanup_user_columns MODE=all APPLY=1
namespace "features" do
  desc "Remove launched features copied into users.allowed_features by the old add path (dry run unless APPLY=1)"
  task cleanup_user_columns: :environment do
    apply = ENV["APPLY"] == "1"
    mode = (ENV["MODE"].presence || "superset").downcase
    abort("MODE must be superset or all, got #{mode}") unless ["superset", "all"].include?(mode)

    launched = AppConfigHelper.get_json_app_config(AppConfig::LAUNCHED_FEATURES, [])
    puts "mode=#{mode} apply=#{apply} launched=#{launched.inspect}"
    if launched.empty?
      puts "nothing is launched; nothing to clean"
      next
    end

    changed = 0
    ambiguous = 0
    User.where.not(allowed_features: [nil, "", "[]"]).find_each do |user|
      own = user.user_allowed_feature_list
      overlap = own & launched
      next if overlap.empty?

      if mode == "superset" && (launched - own).any?
        ambiguous += 1
        puts "ambiguous user_id=#{user.id} keeps #{overlap.inspect} (holds only some launched features)"
        next
      end

      after = own - launched
      changed += 1
      puts "#{apply ? 'cleaned' : 'would clean'} user_id=#{user.id} #{own.inspect} -> #{after.inspect}"
      user.update!(allowed_features: JSON.dump(after)) if apply
    end

    puts "#{apply ? 'changed' : 'would change'}: #{changed}, ambiguous (left alone): #{ambiguous}"
    puts "dry run: nothing changed (APPLY=1 to write)" unless apply
  end
end
