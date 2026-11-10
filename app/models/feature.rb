# Feature flags: the ONE evaluation path for "is feature X on (for user U)?" and the only place that
# should change a flag. Homegrown on purpose -- it extends the storage the app already had instead of
# adding a flag library.
#
# A flag name is a plain string ("AMR", "sorting_v0"); symbols are accepted. A flag is ON for a user when
# ANY of these holds:
#   1. it is launched globally   (Feature.enable / disable)
#   2. it is granted to the user (Feature.enable_for / disable_for)
#   3. it is enabled for a group the user belongs to (Feature.enable_for_group / add_to_group)
# There is no per-user OFF switch: a launched flag is on for everyone.
#
# Groups (only "beta_testers" today) live in two AppConfig keys each, so they can also be edited from the
# admin AppConfig page or the console:
#   feature_group_beta_testers_features -- JSON array of flag names, e.g. ["annotation"]
#   feature_group_beta_testers_members  -- JSON array of user ids and/or emails, e.g. [42, "a@ucsf.edu"]
#                                          (emails match case-insensitively)
#
# Every mutation takes `by:` -- the acting User, or a String naming a non-user actor ("rake", "console") --
# and writes a FeatureFlagEvent row (the change log) when it changes something.
#
# Storage sits behind Feature.store (Feature::AppConfigStore), so a different backend can be swapped in
# later without changing any call site.
module Feature
  # Flags known to the code base, with what they gate. Feature.list shows these even when nobody has them.
  REGISTRY = {
    "AMR" => "Deprecated AMR pipeline results (kept readable for published papers).",
    "annotation" => "Taxon annotation on the sample report.",
    "edit_snapshot_links" => "Create and edit project snapshot links.",
    "heatmap_elasticsearch" => "Heatmap backed by Elasticsearch.",
    "sorting_v0" => "Server-side sample sorting on My Data.",
    "sorting_v0_admin" => "Server-side sample sorting on every domain (admin testing; slow).",
  }.freeze

  GROUPS = {
    "beta_testers" => {
      features_key: AppConfig::FEATURE_GROUP_BETA_TESTERS_FEATURES,
      members_key: AppConfig::FEATURE_GROUP_BETA_TESTERS_MEMBERS,
    },
  }.freeze

  Status = Struct.new(:name, :description, :global, :groups, :users, keyword_init: true)

  module_function

  def store
    @store ||= AppConfigStore.new
  end

  def store=(new_store)
    @store = new_store
  end

  # ---- evaluation ----------------------------------------------------------------------------------

  def enabled?(name, user = nil)
    name = name.to_s
    return true if store.launched.include?(name)
    return false if user.nil?

    store.user_features(user).include?(name) || group_features_for(user).include?(name)
  end

  # Every flag that is on for `user` (what the front end receives as allowedFeatures).
  def enabled_list(user)
    store.user_features(user) | store.launched | group_features_for(user)
  end

  def group_features_for(user)
    GROUPS.keys.select { |group| member?(group, user) }.flat_map { |group| store.group_features(group) }.uniq
  end

  def member?(group, user)
    return false if user.nil?

    email = user.email.to_s.downcase
    store.group_members(group).any? { |m| m.to_s == user.id.to_s || (email.present? && m.to_s.downcase == email) }
  end

  # One Status per known flag: the registry, plus every launched, group and per-user flag found in storage.
  def list
    launched = store.launched
    per_user = store.all_user_features
    group_flags = GROUPS.keys.index_with { |group| store.group_features(group) }
    names = REGISTRY.keys | launched | group_flags.values.flatten | per_user.values.flat_map { |u| u[:features] }

    names.uniq.sort_by(&:downcase).map do |name|
      Status.new(
        name: name,
        description: REGISTRY[name],
        global: launched.include?(name),
        groups: group_flags.select { |_, flags| flags.include?(name) }.keys,
        users: per_user.select { |_, u| u[:features].include?(name) }.map { |id, u| { id: id, email: u[:email] } }
      )
    end
  end

  # ---- mutations ------------------------------------------------------------------------------------
  # Each returns true when it changed something. A change and its FeatureFlagEvent row are written in one
  # transaction, so there is never a change without a log row (or the reverse). A no-op writes nothing.
  #
  # Cache: global and group flags are AppConfig rows. AppConfig busts its Rails.cache key on save and on
  # commit, and the cache is shared by every pod when it is Redis; every deployed env currently runs
  # :null_store (no cache at all), so a change is visible to every pod on its next request.

  def enable(name, by:)
    name = name.to_s
    mutate(by, { feature: name, action: "enable", scope: "global" }) do
      change_list(store.launched, name, :add) { |list| store.write_launched(list) }
    end
  end

  def disable(name, by:)
    name = name.to_s
    mutate(by, { feature: name, action: "disable", scope: "global" }) do
      change_list(store.launched, name, :remove) { |list| store.write_launched(list) }
    end
  end

  def enable_for(name, user, by:)
    name = name.to_s
    mutate(by, { feature: name, action: "enable", scope: "user", target_user_id: user.id }) do
      change_list(store.user_features(user), name, :add) { |list| store.write_user_features(user, list) }
    end
  end

  def disable_for(name, user, by:)
    name = name.to_s
    mutate(by, { feature: name, action: "disable", scope: "user", target_user_id: user.id }) do
      change_list(store.user_features(user), name, :remove) { |list| store.write_user_features(user, list) }
    end
  end

  def enable_for_group(name, group, by:)
    name = name.to_s
    group = group.to_s
    mutate(by, { feature: name, action: "enable", scope: "group", group_name: group }) do
      change_list(store.group_features(group), name, :add) { |list| store.write_group_features(group, list) }
    end
  end

  def disable_for_group(name, group, by:)
    name = name.to_s
    group = group.to_s
    mutate(by, { feature: name, action: "disable", scope: "group", group_name: group }) do
      change_list(store.group_features(group), name, :remove) { |list| store.write_group_features(group, list) }
    end
  end

  # `member` is a User, a user id, or an email.
  def add_to_group(member, group, by:)
    change_membership(member, group.to_s, :add, by)
  end

  def remove_from_group(member, group, by:)
    change_membership(member, group.to_s, :remove, by)
  end

  def change_membership(member, group, operation, by)
    member = normalize_member(member)
    target = member.is_a?(Integer) ? User.find_by(id: member) : User.find_by(email: member)
    event = {
      feature: nil, action: operation == :add ? "add_member" : "remove_member", scope: "group",
      group_name: group, target_user_id: target&.id, target_member: member.to_s,
    }
    mutate(by, event) do
      change_list(store.group_members(group), member, operation) { |list| store.write_group_members(group, list) }
    end
  end

  def mutate(actor, event)
    require_actor!(actor)
    ActiveRecord::Base.transaction do
      changed = yield
      if changed
        FeatureFlagEvent.create!(
          **event,
          actor_user_id: actor.is_a?(User) ? actor.id : nil,
          actor_label: actor.is_a?(User) ? actor.email : actor.strip,
          environment: FeatureFlagEvent.current_environment
        )
      end
      changed
    end
  end

  def change_list(current, item, operation)
    present = current.include?(item)
    return false if operation == :add ? present : !present

    yield(operation == :add ? current + [item] : current - [item])
    true
  end

  def require_actor!(actor)
    return if actor.is_a?(User) || (actor.is_a?(String) && actor.strip.present?)

    raise ArgumentError, "Feature mutations need by: <User or non-blank String>, got #{actor.inspect}"
  end

  # User ids are stored as Integers, emails lower-cased, so add/remove match what is already stored.
  def normalize_member(member)
    return member.id if member.is_a?(User)
    return member if member.is_a?(Integer)

    member.to_s.strip.match?(/\A\d+\z/) ? member.to_s.strip.to_i : member.to_s.strip.downcase
  end

  private_class_method :change_membership, :mutate, :change_list, :require_actor!, :normalize_member
end
