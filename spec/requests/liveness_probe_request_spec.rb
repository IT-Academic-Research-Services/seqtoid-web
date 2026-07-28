# frozen_string_literal: true

require "rails_helper"

# SMP-1473: /up is the SHALLOW liveness endpoint (Rails' built-in health check) -- a static 200 with
# NO database / cache / OpenSearch touch, served without authentication. The k8s livenessProbe uses
# it (instead of the deep /health_check) so a dependency brownout can never restart the web pod:
# liveness proves the process is up, readiness proves deps are reachable.
RSpec.describe "Liveness probe", type: :request do
  it "returns 200 without authentication and without touching any dependency" do
    get "/up"

    expect(response).to have_http_status(:ok)
  end

  it "is a distinct, shallower path than the deep readiness check (/health_check)" do
    # Guards against anyone repointing /up at the dependency-touching health_check.
    expect(Rails.application.routes.recognize_path("/up")).to eq(controller: "rails/health", action: "show")
  end
end
