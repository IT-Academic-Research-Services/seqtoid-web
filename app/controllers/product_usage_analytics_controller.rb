# CZID-722 (Phase 2b, data API). Admin-only JSON endpoint serving the aggregate,
# no-PII product-usage overview (ProductUsageAnalytics). This is the data seam the
# (separate, exposed) analytics dashboard consumes.
#
# It lives in seqtoid-web on purpose: this is where the CloudWatch client and
# SUPPORT_LOG_GROUP config already are. The dashboard host holds NO cloud credentials
# -- it only calls this endpoint. Keeping the AWS surface in one place is deliberate.
#
# Gated by the same guard AdminController uses: login_required + admin_required
# (admin_required redirects a non-admin to root). NOT namespaced under Admin:: on
# purpose -- the app's shared authenticate_user! redirects to `controller: :auth0`,
# which a namespaced controller would resolve to the non-existent `admin/auth0`; every
# other controller here is top-level, so the admin path is expressed in the route, not
# the class namespace.
#
# The response is aggregate counts only -- ProductUsageAnalytics already guarantees no
# user id reaches its output, and this endpoint adds nothing per-user. Any per-user
# drill-down belongs behind the operator wall (#472 / SupportJourney), never here.
class ProductUsageAnalyticsController < ApplicationController
  before_action :login_required
  before_action :admin_required

  DEFAULT_WINDOW_DAYS = 7
  MAX_WINDOW_DAYS = 90

  def index
    days = window_days
    now = Time.now.utc
    overview = ProductUsageAnalytics.overview(
      window_start: (now - days.days).iso8601,
      window_end: now.iso8601
    )

    if overview.nil?
      # Inert (no SUPPORT_LOG_GROUP configured) or the query could not complete.
      # Report unavailability rather than a 500 so the dashboard renders a clean
      # "no data yet" instead of an error.
      render json: { available: false, window_days: days }, status: :ok
    else
      render json: { available: true, window_days: days, **overview }, status: :ok
    end
  end

  private

  # Clamp the requested window to a sane range. Non-positive / missing -> default.
  def window_days
    requested = params[:days].to_i
    return DEFAULT_WINDOW_DAYS unless requested.positive?

    [requested, MAX_WINDOW_DAYS].min
  end
end
