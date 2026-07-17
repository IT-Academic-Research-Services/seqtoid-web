require "rails_helper"

# CZID-722 (Phase 1). SupportJourney is a PURE transform over the action-log steps
# that SupportActionLogQuery already returns -- so these specs feed it synthetic step
# rows directly (no AWS, no CloudWatch), the way support_action_log_query_spec stubs
# the client. Each test pins one behaviour of the journey: sessionization, timing,
# error anchoring, and funnel reach/drop/complete.
describe SupportJourney do
  # Build a step hash in the shape SupportActionLogQuery#recent_steps emits.
  def step(action, at:, outcome: "ok", error_class: nil)
    { at: at, action: action, outcome: outcome, error_class: error_class }.compact
  end

  # Fixed base time so nothing depends on the wall clock.
  let(:t0) { "2026-07-17T12:00:00Z" }
  def iso(base, seconds_after)
    (Time.iso8601(base) + seconds_after).utc.iso8601
  end

  describe "inert / degenerate inputs" do
    it "returns nil for nil" do
      expect(described_class.from_steps(nil)).to be_nil
    end

    it "returns nil for an empty array" do
      expect(described_class.from_steps([])).to be_nil
    end

    it "returns nil when no step has an action" do
      steps = [{ at: t0, outcome: "ok" }, { at: t0 }]
      expect(described_class.from_steps(steps)).to be_nil
    end

    it "ignores non-hash and actionless entries but keeps the rest" do
      steps = [nil, "garbage", step("project.create", at: t0)]
      result = described_class.from_steps(steps)
      expect(result[:step_count]).to eq(1)
      expect(result[:sessions].first[:entry_action]).to eq("project.create")
    end
  end

  describe "sessionization" do
    it "keeps steps within the idle gap in a single session" do
      steps = [
        step("project.create", at: iso(t0, 0)),
        step("project.mutate", at: iso(t0, 5 * 60)), # 5 min later
      ]
      result = described_class.from_steps(steps)
      expect(result[:session_count]).to eq(1)
      expect(result[:sessions].first[:step_count]).to eq(2)
    end

    it "splits into two sessions when the idle gap is exceeded" do
      steps = [
        step("project.create", at: iso(t0, 0)),
        step("bulk_download.create", at: iso(t0, 45 * 60)), # 45 min > 30 min default
      ]
      result = described_class.from_steps(steps)
      expect(result[:session_count]).to eq(2)
      expect(result[:sessions].pluck(:entry_action))
        .to eq(%w[project.create bulk_download.create])
    end

    it "honours a custom idle gap" do
      steps = [
        step("project.create", at: iso(t0, 0)),
        step("project.mutate", at: iso(t0, 2 * 60)), # 2 min
      ]
      result = described_class.from_steps(steps, idle_gap_seconds: 60)
      expect(result[:session_count]).to eq(2)
    end

    it "records dwell time between consecutive steps" do
      steps = [
        step("project.create", at: iso(t0, 0)),
        step("project.mutate", at: iso(t0, 90)),
      ]
      session = described_class.from_steps(steps)[:sessions].first
      expect(session[:steps].first[:since_previous_seconds]).to be_nil
      expect(session[:steps].last[:since_previous_seconds]).to eq(90)
    end

    it "derives entry/exit action and duration for a session" do
      steps = [
        step("sample.bulk_upload", at: iso(t0, 0)),
        step("project.mutate", at: iso(t0, 120)),
        step("bulk_download.create", at: iso(t0, 300)),
      ]
      session = described_class.from_steps(steps)[:sessions].first
      expect(session[:entry_action]).to eq("sample.bulk_upload")
      expect(session[:exit_action]).to eq("bulk_download.create")
      expect(session[:duration_seconds]).to eq(300)
    end
  end

  describe "error anchoring" do
    it "surfaces the first errored step of a session as the error_step" do
      steps = [
        step("sample.bulk_upload", at: iso(t0, 0)),
        step("bulk_download.create", at: iso(t0, 60), outcome: "error", error_class: "Aws::S3::Errors::AccessDenied"),
      ]
      session = described_class.from_steps(steps)[:sessions].first
      expect(session[:error_step]).to include(
        action: "bulk_download.create",
        error_class: "Aws::S3::Errors::AccessDenied"
      )
    end

    it "omits error_step when nothing errored" do
      steps = [step("project.create", at: iso(t0, 0))]
      session = described_class.from_steps(steps)[:sessions].first
      expect(session).not_to have_key(:error_step)
    end
  end

  describe "funnels" do
    it "reports a completed funnel when every stage is reached in order" do
      steps = [
        step("sample.bulk_upload", at: iso(t0, 0)),
        step("bulk_download.create", at: iso(t0, 600)),
      ]
      funnel = described_class.from_steps(steps)[:funnels].find { |f| f[:name] == "sample_to_download" }
      expect(funnel[:completed]).to be(true)
      expect(funnel[:furthest_stage]).to eq("bulk_download.create")
      expect(funnel).not_to have_key(:dropped_after)
    end

    it "reports where the user dropped when a later stage is never reached" do
      steps = [step("sample.bulk_upload", at: iso(t0, 0))]
      funnel = described_class.from_steps(steps)[:funnels].find { |f| f[:name] == "sample_to_download" }
      expect(funnel[:completed]).to be(false)
      expect(funnel[:dropped_after]).to eq("sample.bulk_upload")
    end

    it "flags the stage where the funnel errored" do
      steps = [
        step("sample.bulk_upload", at: iso(t0, 0), outcome: "error", error_class: "Boom"),
        step("bulk_download.create", at: iso(t0, 60)),
      ]
      funnel = described_class.from_steps(steps)[:funnels].find { |f| f[:name] == "sample_to_download" }
      expect(funnel[:errored_at]).to eq("sample.bulk_upload")
    end

    it "does not complete a funnel from out-of-order actions" do
      # download before upload: the first stage (upload) is never seen before the
      # second, so the funnel must not count the download as stage 2.
      steps = [
        step("bulk_download.create", at: iso(t0, 0)),
        step("sample.bulk_upload", at: iso(t0, 60)),
      ]
      funnel = described_class.from_steps(steps)[:funnels].find { |f| f[:name] == "sample_to_download" }
      expect(funnel[:reached]).to eq(%w[sample.bulk_upload])
      expect(funnel[:completed]).to be(false)
    end

    it "omits a funnel the user never entered" do
      steps = [step("project.create", at: iso(t0, 0))]
      names = described_class.from_steps(steps)[:funnels].pluck(:name)
      expect(names).to include("project_setup")
      expect(names).not_to include("sample_to_download")
    end
  end

  describe "timestamp robustness" do
    it "parses the CloudWatch Insights '@timestamp' form (no zone, UTC)" do
      steps = [
        step("project.create", at: "2026-07-17 12:00:00.000"),
        step("project.mutate", at: "2026-07-17 12:00:45.000"),
      ]
      session = described_class.from_steps(steps)[:sessions].first
      expect(session[:steps].last[:since_previous_seconds]).to eq(45)
    end

    it "does not crash on an unparseable timestamp and keeps the step in-session" do
      steps = [
        step("project.create", at: "not-a-time"),
        step("project.mutate", at: "also-bad"),
      ]
      result = described_class.from_steps(steps)
      expect(result[:session_count]).to eq(1)
      expect(result[:sessions].first[:steps].last[:since_previous_seconds]).to be_nil
    end
  end
end
