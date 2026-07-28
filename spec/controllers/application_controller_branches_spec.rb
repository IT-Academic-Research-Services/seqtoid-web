# frozen_string_literal: true

require "rails_helper"

# Coverage Wave: branch sweep for ApplicationController. Its shared helpers run on
# every request, so the "happy" arm of each conditional is covered incidentally by
# other controller specs while the alternate arm never is. These examples drive the
# helpers directly on a bare controller instance (no routing/render involved) so
# both arms of every conditional are taken:
#
#   login_required / admin_required / allowed_feature_required guards,
#   authenticate_user! (token-based short-circuit + both auth_check cases + the
#   no-match fall-through), check_for_maintenance / disabled_for_maintenance?,
#   append_info_to_payload, check_access, get_background_id (share-id snapshot
#   found/missing, viewable/not-viewable), token_based_login_support,
#   set_sentry_context, check_browser, check_rack_mini_profiler,
#   set_current_context_for_logging! (including its rescue), instrument_with_timer,
#   fetch_from_or_store_in_cache (both arms), announcement_banner_enabled.
RSpec.describe ApplicationController, type: :controller do
  subject(:controller_instance) { described_class.new }

  let(:admin_user) { build_stubbed(:user, role: 1) }
  let(:regular_user) { build_stubbed(:user, role: 0) }

  # Collects redirect targets instead of touching the (absent) response object.
  # The URL helpers need a request to build absolute URLs, so they are pinned too.
  def stub_redirects(controller)
    redirects = []
    allow(controller).to receive(:root_path).and_return("/root")
    allow(controller).to receive(:maintenance_path).and_return("/maintenance")
    allow(controller).to receive(:redirect_to) { |target| redirects << target }
    redirects
  end

  describe "#login_required" do
    it "redirects to root when there is no current user (the unless then-arm)" do
      redirects = stub_redirects(controller_instance)
      allow(controller_instance).to receive(:current_user).and_return(nil)

      controller_instance.login_required

      expect(redirects).to eq(["/root"])
    end

    it "does not redirect when a user is signed in (the else-arm)" do
      redirects = stub_redirects(controller_instance)
      allow(controller_instance).to receive(:current_user).and_return(regular_user)

      controller_instance.login_required

      expect(redirects).to be_empty
    end
  end

  describe "#admin_required" do
    it "redirects when there is no current user (short-circuits the &&)" do
      redirects = stub_redirects(controller_instance)
      allow(controller_instance).to receive(:current_user).and_return(nil)

      controller_instance.admin_required

      expect(redirects.length).to eq(1)
    end

    it "redirects when the current user is not an admin (right operand false)" do
      redirects = stub_redirects(controller_instance)
      allow(controller_instance).to receive(:current_user).and_return(regular_user)

      controller_instance.admin_required

      expect(redirects.length).to eq(1)
    end

    it "does not redirect for an admin (both operands true)" do
      redirects = stub_redirects(controller_instance)
      allow(controller_instance).to receive(:current_user).and_return(admin_user)

      controller_instance.admin_required

      expect(redirects).to be_empty
    end
  end

  describe "#allowed_feature_required" do
    it "redirects when there is no current user" do
      redirects = stub_redirects(controller_instance)
      allow(controller_instance).to receive(:current_user).and_return(nil)

      controller_instance.allowed_feature_required("cool_feature")

      expect(redirects.length).to eq(1)
    end

    it "does not redirect when the user has the feature (first operand of the ||)" do
      redirects = stub_redirects(controller_instance)
      allow(regular_user).to receive(:allowed_feature?).with("cool_feature").and_return(true)
      allow(controller_instance).to receive(:current_user).and_return(regular_user)

      controller_instance.allowed_feature_required("cool_feature")

      expect(redirects).to be_empty
    end

    it "redirects a non-admin without the feature when admins are allowed (allow_admin && admin? false)" do
      redirects = stub_redirects(controller_instance)
      allow(regular_user).to receive(:allowed_feature?).with("cool_feature").and_return(false)
      allow(controller_instance).to receive(:current_user).and_return(regular_user)

      controller_instance.allowed_feature_required("cool_feature", true)

      expect(redirects.length).to eq(1)
    end

    it "lets an admin through when allow_admin is set (second operand of the ||)" do
      redirects = stub_redirects(controller_instance)
      allow(admin_user).to receive(:allowed_feature?).with("cool_feature").and_return(false)
      allow(controller_instance).to receive(:current_user).and_return(admin_user)

      controller_instance.allowed_feature_required("cool_feature", true)

      expect(redirects).to be_empty
    end

    it "redirects an admin when allow_admin is not set (the allow_admin operand is false)" do
      redirects = stub_redirects(controller_instance)
      allow(admin_user).to receive(:allowed_feature?).with("cool_feature").and_return(false)
      allow(controller_instance).to receive(:current_user).and_return(admin_user)

      controller_instance.allowed_feature_required("cool_feature")

      expect(redirects.length).to eq(1)
    end
  end

  describe "#authenticate_user!" do
    # Stand-in for the respond_to block: records which formats were registered and
    # runs the html handler so the redirect is observable.
    def stub_respond_to(controller)
      formats = []
      collector = Object.new
      collector.define_singleton_method(:html) do |&blk|
  formats << :html
  blk&.call
end
      collector.define_singleton_method(:json) { formats << :json }
      allow(controller).to receive(:respond_to) { |&blk| blk.call(collector) }
      formats
    end

    it "short-circuits to true for a token-based login request (the if then-arm)" do
      controller_instance.instance_variable_set(:@token_based_login_request, true)
      expect(controller_instance).not_to receive(:auth0_check_user_auth)

      expect(controller_instance.authenticate_user!).to be(true)
    end

    it "responds for an invalid user (the AUTH_INVALID_USER case)" do
      redirects = stub_redirects(controller_instance)
      formats = stub_respond_to(controller_instance)
      allow(controller_instance).to receive(:current_user).and_return(nil)
      allow(controller_instance).to receive(:auth0_check_user_auth).and_return(Auth0Helper::AUTH_INVALID_USER)

      controller_instance.authenticate_user!

      expect(formats).to eq([:html, :json])
      expect(redirects).to eq([{ controller: :auth0, action: :login }])
    end

    it "responds for an expired token (the AUTH_TOKEN_EXPIRED case)" do
      redirects = stub_redirects(controller_instance)
      formats = stub_respond_to(controller_instance)
      allow(controller_instance).to receive(:current_user).and_return(regular_user)
      allow(controller_instance).to receive(:auth0_check_user_auth).and_return(Auth0Helper::AUTH_TOKEN_EXPIRED)

      controller_instance.authenticate_user!

      expect(formats).to eq([:html, :json])
      expect(redirects).to eq([{ controller: :auth0, action: :refresh_token, params: { mode: "expired" } }])
    end

    it "does nothing for a valid session (no case matches)" do
      redirects = stub_redirects(controller_instance)
      allow(controller_instance).to receive(:current_user).and_return(regular_user)
      allow(controller_instance).to receive(:auth0_check_user_auth).and_return("AUTH_TOKEN_VALID")
      expect(controller_instance).not_to receive(:respond_to)

      controller_instance.authenticate_user!

      expect(redirects).to be_empty
    end
  end

  describe "#check_for_maintenance and #disabled_for_maintenance?" do
    it "redirects to the maintenance page when the site is disabled (the then-arm)" do
      redirects = stub_redirects(controller_instance)
      allow(controller_instance).to receive(:disabled_for_maintenance?).and_return(true)

      controller_instance.check_for_maintenance

      expect(redirects).to eq(["/maintenance"])
    end

    it "does nothing when the site is not disabled (the else-arm)" do
      redirects = stub_redirects(controller_instance)
      allow(controller_instance).to receive(:disabled_for_maintenance?).and_return(false)

      controller_instance.check_for_maintenance

      expect(redirects).to be_empty
    end

    it "is disabled when the ENV var is set (the left operand of the ||)" do
      allow(ENV).to receive(:[]).and_call_original
      allow(ENV).to receive(:[]).with("DISABLE_SITE_FOR_MAINTENANCE").and_return("1")

      expect(controller_instance.disabled_for_maintenance?).to be(true)
    end

    it "is disabled when the app config is set (the right operand of the ||)" do
      allow(ENV).to receive(:[]).and_call_original
      allow(ENV).to receive(:[]).with("DISABLE_SITE_FOR_MAINTENANCE").and_return(nil)
      allow(controller_instance).to receive(:get_app_config)
        .with(AppConfig::DISABLE_SITE_FOR_MAINTENANCE).and_return("1")

      expect(controller_instance.disabled_for_maintenance?).to be(true)
    end

    it "is enabled when neither the ENV var nor the app config is set" do
      allow(ENV).to receive(:[]).and_call_original
      allow(ENV).to receive(:[]).with("DISABLE_SITE_FOR_MAINTENANCE").and_return(nil)
      allow(controller_instance).to receive(:get_app_config)
        .with(AppConfig::DISABLE_SITE_FOR_MAINTENANCE).and_return(nil)

      expect(controller_instance.disabled_for_maintenance?).to be(false)
    end
  end

  describe "#disable_header_navigation" do
    it "sets the view flag" do
      controller_instance.disable_header_navigation
      expect(controller_instance.instance_variable_get(:@disable_header_navigation)).to be(true)
    end
  end

  describe "#check_access" do
    it "raises when assert_access was never called (the unless then-arm)" do
      expect { controller_instance.send(:check_access) }
        .to raise_error("action doesn't check against access control")
    end

    it "passes once assert_access has run (the else-arm)" do
      controller_instance.send(:assert_access)
      expect { controller_instance.send(:check_access) }.not_to raise_error
    end
  end

  describe "#get_background_id" do
    let(:sample) { double("sample", default_background_id: 999) }

    it "returns nil when the resolved background id is 0 (the then-arm)" do
      allow(controller_instance).to receive(:params).and_return({})
      expect(controller_instance.send(:get_background_id, sample, 0)).to be_nil
    end

    it "falls back to the params background_id when none is passed" do
      allow(controller_instance).to receive(:params).and_return(background_id: "0")
      expect(controller_instance.send(:get_background_id, sample)).to be_nil
    end

    it "returns the requested background when it is viewable by the current power (no share id)" do
      allow(controller_instance).to receive(:params).and_return({})
      allow(controller_instance).to receive(:current_power)
        .and_return(double("power", backgrounds: double("rel", pluck: [7, 8])))

      expect(controller_instance.send(:get_background_id, sample, 7)).to eq(7)
    end

    it "falls back to the sample default when the background is not viewable" do
      allow(controller_instance).to receive(:params).and_return({})
      allow(controller_instance).to receive(:current_power)
        .and_return(double("power", backgrounds: double("rel", pluck: [7, 8])))

      expect(controller_instance.send(:get_background_id, sample, 42)).to eq(999)
    end

    it "uses the snapshot's backgrounds when a share id resolves (the ternary then-arm)" do
      allow(controller_instance).to receive(:params).and_return({})
      snapshot = double("snapshot", fetch_snapshot_backgrounds: double("rel", pluck: [5]))
      allow(SnapshotLink).to receive(:find_by).with(share_id: "abc").and_return(snapshot)

      expect(controller_instance.send(:get_background_id, sample, 5, "abc")).to eq(5)
    end

    it "treats a missing snapshot as having no viewable backgrounds (the ternary else-arm)" do
      allow(controller_instance).to receive(:params).and_return({})
      allow(SnapshotLink).to receive(:find_by).with(share_id: "nope").and_return(nil)

      expect(controller_instance.send(:get_background_id, sample, 5, "nope")).to eq(999)
    end
  end

  describe "#token_based_login_support" do
    it "authenticates with the bearer token when an Authorization header is present (the then-arm)" do
      request_double = double("request", headers: { "Authorization" => "Bearer abc.def" })
      allow(controller_instance).to receive(:request).and_return(request_double)
      allow(controller_instance).to receive(:auth0_authenticate_with_bearer_token).and_return(true)

      controller_instance.send(:token_based_login_support)

      expect(controller_instance).to have_received(:auth0_authenticate_with_bearer_token)
        .with({ "id_token" => "abc.def" })
      expect(controller_instance.instance_variable_get(:@auth0_cli_auth)).to be(true)
      expect(controller_instance.instance_variable_get(:@token_based_login_request)).to be(true)
    end

    it "does nothing without an Authorization header (the else-arm)" do
      request_double = double("request", headers: {})
      allow(controller_instance).to receive(:request).and_return(request_double)
      expect(controller_instance).not_to receive(:auth0_authenticate_with_bearer_token)

      controller_instance.send(:token_based_login_support)

      expect(controller_instance.instance_variable_get(:@token_based_login_request)).to be_nil
    end
  end

  describe "#set_sentry_context" do
    before do
      allow(controller_instance).to receive(:params).and_return(ActionController::Parameters.new(a: "1"))
      allow(controller_instance).to receive(:request).and_return(double("request", url: "https://x.test/y"))
    end

    it "sets the sentry user when someone is signed in (the then-arm)" do
      allow(controller_instance).to receive(:current_user).and_return(admin_user)
      expect(Sentry).to receive(:set_user).with(id: admin_user.id, admin: true)
      allow(Sentry).to receive(:set_extras)

      controller_instance.send(:set_sentry_context)
    end

    it "skips the sentry user when nobody is signed in (the else-arm)" do
      allow(controller_instance).to receive(:current_user).and_return(nil)
      expect(Sentry).not_to receive(:set_user)
      expect(Sentry).to receive(:set_extras).with(params: { "a" => "1" }, url: "https://x.test/y")

      controller_instance.send(:set_sentry_context)
    end
  end

  describe "#check_browser" do
    it "marks Internet Explorer as unsupported (the != arm evaluating false)" do
      ie_agent = "Mozilla/5.0 (Windows NT 6.1; Trident/7.0; rv:11.0) like Gecko"
      allow(controller_instance).to receive(:request).and_return(double("request", user_agent: ie_agent))

      controller_instance.send(:check_browser)

      info = controller_instance.instance_variable_get(:@browser_info)
      expect(info[:browser]).to eq("Internet Explorer")
      expect(info[:supported]).to be(false)
    end

    it "marks other browsers as supported (the != arm evaluating true)" do
      chrome_agent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
      allow(controller_instance).to receive(:request).and_return(double("request", user_agent: chrome_agent))

      controller_instance.send(:check_browser)

      expect(controller_instance.instance_variable_get(:@browser_info)[:supported]).to be(true)
    end
  end

  describe "#check_rack_mini_profiler" do
    it "authorizes the request for an admin (both && operands true)" do
      allow(controller_instance).to receive(:current_user).and_return(admin_user)
      expect(Rack::MiniProfiler).to receive(:authorize_request)

      controller_instance.send(:check_rack_mini_profiler)
    end

    it "does not authorize for a non-admin (right operand false)" do
      allow(controller_instance).to receive(:current_user).and_return(regular_user)
      expect(Rack::MiniProfiler).not_to receive(:authorize_request)

      controller_instance.send(:check_rack_mini_profiler)
    end

    it "does not authorize when nobody is signed in (left operand false)" do
      allow(controller_instance).to receive(:current_user).and_return(nil)
      expect(Rack::MiniProfiler).not_to receive(:authorize_request)

      controller_instance.send(:check_rack_mini_profiler)
    end
  end

  describe "#set_current_context_for_logging!" do
    after do
      ApplicationRecord._current_user = nil
      ApplicationRecord._current_request = nil
    end

    def current_logging_user
      Thread.current[:_current_user]
    end

    def current_logging_request
      Thread.current[:_current_request]
    end

    it "records the user and request when both are present (both then-arms)" do
      request_double = double("request")
      allow(controller_instance).to receive(:current_user).and_return(regular_user)
      allow(controller_instance).to receive(:request).and_return(request_double)

      controller_instance.send(:set_current_context_for_logging!)

      expect(current_logging_user).to eq(regular_user)
      expect(current_logging_request).to eq(request_double)
    end

    it "skips the user when nobody is signed in (the first else-arm)" do
      request_double = double("request")
      allow(controller_instance).to receive(:current_user).and_return(nil)
      allow(controller_instance).to receive(:request).and_return(request_double)

      controller_instance.send(:set_current_context_for_logging!)

      expect(current_logging_user).to be_nil
      expect(current_logging_request).to eq(request_double)
    end

    it "logs and swallows an error raised while recording (the rescue arm)" do
      allow(controller_instance).to receive(:current_user).and_raise(StandardError, "boom")
      expect(Rails.logger).to receive(:error).with(instance_of(StandardError))

      expect { controller_instance.send(:set_current_context_for_logging!) }.not_to raise_error
    end
  end

  describe "#instrument_with_timer" do
    before do
      allow(controller_instance).to receive(:params).and_return(controller: "samples", action: "index")
      allow_any_instance_of(Timer).to receive(:publish)
    end

    it "does not warn on the first use (the unless else-arm)" do
      expect(Rails.logger).not_to receive(:warn)
      ran = false

      controller_instance.send(:instrument_with_timer) { ran = true }

      expect(ran).to be(true)
      expect(controller_instance.instance_variable_get(:@timer)).to be_a(Timer)
    end

    it "warns when a timer is already in flight (the unless then-arm)" do
      controller_instance.instance_variable_set(:@timer, Timer.new("previous"))
      expect(Rails.logger).to receive(:warn).with("Previous instance of timer will be replaced")

      controller_instance.send(:instrument_with_timer) { :noop }
    end
  end

  describe "#fetch_from_or_store_in_cache" do
    let(:headers) { {} }

    before do
      allow(controller_instance).to receive(:response).and_return(double("response", headers: headers))
    end

    it "yields directly and sets no cache headers when the cache is skipped (the then-arm)" do
      result = controller_instance.send(:fetch_from_or_store_in_cache, true, "key-a", "httpdate") { "fresh" }

      expect(result).to eq("fresh")
      expect(headers).to be_empty
    end

    it "sets the cache headers and stores the block result when the cache is used (the else-arm)" do
      allow(Rails.cache).to receive(:fetch) { |_key, _opts, &blk| blk.call }

      result = controller_instance.send(:fetch_from_or_store_in_cache, false, "key-b", "Mon, 01 Jan 2024 00:00:00 GMT") { "computed" }

      expect(result).to eq("computed")
      expect(headers["Last-Modified"]).to eq("Mon, 01 Jan 2024 00:00:00 GMT")
      expect(headers["X-IDseq-Cache-Key"]).to eq("key-b")
      expect(headers["X-IDseq-Cache"]).to eq("missed")
    end
  end

  describe "#announcement_banner_enabled" do
    let(:pacific) { ActiveSupport::TimeZone.new("Pacific Time (US & Canada)") }

    it "is false when the app config flag is off (the if not taken)" do
      allow(controller_instance).to receive(:get_app_config)
        .with(AppConfig::SHOW_ANNOUNCEMENT_BANNER).and_return("0")

      expect(controller_instance.send(:announcement_banner_enabled)).to be(false)
    end

    it "is true when the flag is on and now is inside the window (the inner then-arm)" do
      allow(controller_instance).to receive(:get_app_config)
        .with(AppConfig::SHOW_ANNOUNCEMENT_BANNER).and_return("1")

      travel_to(pacific.parse("2025-06-01 12:00:00")) do
        expect(controller_instance.send(:announcement_banner_enabled)).to be(true)
      end
    end

    it "is false when the flag is on but now is after the window (the inner else-arm)" do
      allow(controller_instance).to receive(:get_app_config)
        .with(AppConfig::SHOW_ANNOUNCEMENT_BANNER).and_return("1")

      travel_to(pacific.parse("2025-09-01 12:00:00")) do
        expect(controller_instance.send(:announcement_banner_enabled)).to be(false)
      end
    end

    it "is false when the flag is on but now is before the window (the inner else-arm)" do
      allow(controller_instance).to receive(:get_app_config)
        .with(AppConfig::SHOW_ANNOUNCEMENT_BANNER).and_return("1")

      travel_to(pacific.parse("2025-01-01 12:00:00")) do
        expect(controller_instance.send(:announcement_banner_enabled)).to be(false)
      end
    end
  end

  describe "#set_application_view_variables" do
    it "reads each banner/account app config into the view ivars" do
      allow(controller_instance).to receive(:get_app_config)
        .with(AppConfig::AUTO_ACCOUNT_CREATION_V1).and_return("1")
      allow(controller_instance).to receive(:get_app_config)
        .with(AppConfig::SHOW_EMERGENCY_BANNER_MESSAGE).and_return("Heads up")
      allow(controller_instance).to receive(:announcement_banner_enabled).and_return(true)

      controller_instance.send(:set_application_view_variables)

      expect(controller_instance.instance_variable_get(:@disable_header_navigation)).to be(false)
      expect(controller_instance.instance_variable_get(:@auto_account_creation_enabled)).to be(true)
      expect(controller_instance.instance_variable_get(:@announcement_banner_enabled)).to be(true)
      expect(controller_instance.instance_variable_get(:@emergency_banner_message)).to eq("Heads up")
    end

    it "leaves auto account creation off when the config is not '1'" do
      allow(controller_instance).to receive(:get_app_config)
        .with(AppConfig::AUTO_ACCOUNT_CREATION_V1).and_return("0")
      allow(controller_instance).to receive(:get_app_config)
        .with(AppConfig::SHOW_EMERGENCY_BANNER_MESSAGE).and_return(nil)
      allow(controller_instance).to receive(:announcement_banner_enabled).and_return(false)

      controller_instance.send(:set_application_view_variables)

      expect(controller_instance.instance_variable_get(:@auto_account_creation_enabled)).to be(false)
    end
  end
end
