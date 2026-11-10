# Storage backend for Feature, on the storage that already existed before the facade:
#   * global (launched) flags -- AppConfig LAUNCHED_FEATURES, a JSON array of names;
#   * per-user grants         -- users.allowed_features, a JSON array of names per user;
#   * groups                  -- two AppConfig keys per group (see Feature::GROUPS).
# Feature talks to its store only through these methods, so a different store (a table, an external
# service) can replace this one later without touching any call site.
module Feature
  class AppConfigStore
    def launched
      AppConfigHelper.get_json_app_config(AppConfig::LAUNCHED_FEATURES, [])
    end

    def write_launched(names)
      AppConfigHelper.set_json_app_config(AppConfig::LAUNCHED_FEATURES, names)
    end

    def user_features(user)
      user.user_allowed_feature_list
    end

    def write_user_features(user, names)
      user.update!(allowed_features: JSON.dump(names))
    end

    # {user_id => {email:, features: [...]}} for every user holding at least one per-user grant.
    def all_user_features
      User.where.not(allowed_features: [nil, "", "[]"]).pluck(:id, :email, :allowed_features).to_h do |id, email, raw|
        [id, { email: email, features: parse_list(raw) }]
      end
    end

    def group_features(group)
      AppConfigHelper.get_json_app_config(Feature::GROUPS.fetch(group)[:features_key], [])
    end

    def write_group_features(group, names)
      AppConfigHelper.set_json_app_config(Feature::GROUPS.fetch(group)[:features_key], names)
    end

    def group_members(group)
      AppConfigHelper.get_json_app_config(Feature::GROUPS.fetch(group)[:members_key], [])
    end

    def write_group_members(group, members)
      AppConfigHelper.set_json_app_config(Feature::GROUPS.fetch(group)[:members_key], members)
    end

    private

    def parse_list(raw)
      list = JSON.parse(raw)
      list.is_a?(Array) ? list : []
    rescue JSON::ParserError
      []
    end
  end
end
