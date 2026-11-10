# Admin page for feature flags (Feature, app/models/feature.rb): every known flag with its global state,
# group and per-user holders; launch / un-launch globally; grant / revoke for a user by email; and the
# recent change log (feature_flag_events).
#
# Same guard as AdminController and ProductUsageAnalyticsController: login_required + admin_required
# (a non-admin is redirected to root). Top-level, not Admin::, for the reason given in
# ProductUsageAnalyticsController.
#
# Every change is two steps: the form posts without `confirmed`, which renders a confirmation page
# describing exactly what will change; only the re-post with confirmed=1 calls Feature.
class FeatureFlagsController < ApplicationController
  before_action :login_required
  before_action :admin_required
  before_action :load_flag_name, only: [:global_state, :user_grant]

  FLAG_NAME_FORMAT = /\A[A-Za-z0-9_.:-]{1,64}\z/
  RECENT_EVENTS = 50

  # GET /admin/feature_flags
  def index
    @flags = Feature.list
    @groups = Feature::GROUPS.keys.index_with { |group| Feature.store.group_members(group) }
    @events = FeatureFlagEvent.recent(RECENT_EVENTS).includes(:target_user)
    @environment = FeatureFlagEvent.current_environment
  end

  # POST /admin/feature_flags/global  params: name, state (on|off), confirmed
  def global_state
    turn_on = params[:state] == "on"
    @change = {
      path: admin_feature_flags_global_path,
      params: { name: @name, state: turn_on ? "on" : "off" },
      summary: turn_on ? "Launch #{@name} for ALL users" : "Un-launch #{@name} (users keep only per-user and group grants)",
    }
    return render(:confirm) unless confirmed?

    changed = turn_on ? Feature.enable(@name, by: current_user) : Feature.disable(@name, by: current_user)
    state = turn_on ? "launched" : "not launched"
    redirect_to admin_feature_flags_path, notice: changed ? "Done: #{@change[:summary]}." : "No change: #{@name} was already #{state}."
  end

  # POST /admin/feature_flags/user  params: name, email, op (add|remove), confirmed
  def user_grant
    adding = params[:op] == "add"
    email = params[:email].to_s.strip.downcase
    target = User.find_by(email: email)
    return redirect_to(admin_feature_flags_path, alert: "No user with email #{email.presence || '(blank)'}.") if target.nil?

    @change = {
      path: admin_feature_flags_user_path,
      params: { name: @name, email: email, op: adding ? "add" : "remove" },
      summary: adding ? "Grant #{@name} to #{email}" : "Revoke #{@name} from #{email}",
    }
    return render(:confirm) unless confirmed?

    changed = adding ? Feature.enable_for(@name, target, by: current_user) : Feature.disable_for(@name, target, by: current_user)
    state = adding ? "already had" : "had no per-user grant of"
    redirect_to admin_feature_flags_path, notice: changed ? "Done: #{@change[:summary]}." : "No change: #{email} #{state} #{@name}."
  end

  private

  def load_flag_name
    @name = params[:name].to_s.strip
    redirect_to(admin_feature_flags_path, alert: "Invalid flag name.") unless FLAG_NAME_FORMAT.match?(@name)
  end

  def confirmed?
    params[:confirmed] == "1"
  end
end
