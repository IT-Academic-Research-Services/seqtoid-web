# frozen_string_literal: true

require "rails_helper"
require Rails.root.join("lib/sentry_event_filter").to_s

RSpec.describe SentryEventFilter do
  # Build `outer` raised with `inner` as its cause, the way Ruby links a rescue
  # that re-raises -- so exception.cause reflects a real cause chain.
  def raise_with_cause(outer, inner)
    begin
      raise inner
    rescue Exception # rubocop:disable Lint/RescueException
      begin
        raise outer
      rescue => e
        return e
      end
    end
  end

  describe ".shutdown_connect_race?" do
    it "is TRUE for a connect-in-progress error caused by a shutdown Interrupt (the scheduler race)" do
      ex = raise_with_cause(Errno::EALREADY, Interrupt.new)
      expect(described_class.shutdown_connect_race?(ex)).to be(true)
    end

    it "is TRUE for EINPROGRESS caused by a SignalException" do
      ex = raise_with_cause(IO::EINPROGRESSWaitWritable.new, SignalException.new("SIGTERM"))
      expect(described_class.shutdown_connect_race?(ex)).to be(true)
    end

    it "is FALSE for a connect-in-progress error with NO shutdown signal in the cause chain (a real connect issue)" do
      ex = raise_with_cause(Errno::EALREADY, RuntimeError.new("boom"))
      expect(described_class.shutdown_connect_race?(ex)).to be(false)
    end

    it "is FALSE for a real Redis outage during shutdown (ECONNREFUSED is not connect-in-progress)" do
      ex = raise_with_cause(Errno::ECONNREFUSED, Interrupt.new)
      expect(described_class.shutdown_connect_race?(ex)).to be(false)
    end

    it "is FALSE for a bare shutdown Interrupt with no connect error" do
      expect(described_class.shutdown_connect_race?(Interrupt.new)).to be(false)
    end

    it "is FALSE for nil" do
      expect(described_class.shutdown_connect_race?(nil)).to be(false)
    end
  end

  describe ".cause_chain" do
    it "walks the cause chain and is bounded against cycles" do
      ex = raise_with_cause(Errno::EALREADY, Interrupt.new)
      chain = described_class.cause_chain(ex)
      expect(chain.first).to be_a(Errno::EALREADY)
      expect(chain.any? { |e| e.is_a?(Interrupt) }).to be(true)
      expect(chain.size).to be <= SentryEventFilter::MAX_CAUSE_DEPTH
    end
  end

  # NUL-separated exec argv, the way /proc/self/cmdline presents it.
  def cmdline(*tokens)
    tokens.join("\0")
  end

  def tty
    double("stdin", tty?: true)
  end

  def not_tty
    double("stdin", tty?: false)
  end

  describe ".runner_invocation?" do
    it "matches `bin/rails runner`" do
      expect(described_class.runner_invocation?(cmdline("bin/rails", "runner", "User.count"))).to be(true)
    end

    it "matches the `rails r` short alias and `bundle exec rails runner`" do
      expect(described_class.runner_invocation?(cmdline("/app/bin/rails", "r", "x"))).to be(true)
      expect(described_class.runner_invocation?(cmdline("bundle", "exec", "rails", "runner", "x"))).to be(true)
    end

    it "does NOT match rails server, rake, resque, or a bare rails console token" do
      expect(described_class.runner_invocation?(cmdline("bin/rails", "server"))).to be(false)
      expect(described_class.runner_invocation?(cmdline("bin/rake", "reference_data:integrity_check"))).to be(false)
      expect(described_class.runner_invocation?(cmdline("resque:work"))).to be(false)
      expect(described_class.runner_invocation?(cmdline("bin/rails", "console"))).to be(false)
    end

    it "is FALSE when the argv is unreadable (nil cmdline)" do
      expect(described_class.runner_invocation?(nil)).to be(false)
    end
  end

  describe ".interactive_cli_session?" do
    it "is TRUE for a rails console session (regardless of runner argv)" do
      expect(described_class.interactive_cli_session?(console: true, cmdline: nil, stdin: not_tty)).to be(true)
    end

    it "is TRUE for a hand-typed `rails runner` one-liner (runner argv + a TTY)" do
      expect(
        described_class.interactive_cli_session?(
          console: false, cmdline: cmdline("bin/rails", "runner", "User.where(bogus: 1)"), stdin: tty
        )
      ).to be(true)
    end

    it "is FALSE for an AUTOMATED `rails runner` (runner argv but NO TTY) -- CI / cron / Argo still report" do
      expect(
        described_class.interactive_cli_session?(
          console: false, cmdline: cmdline("bundle", "exec", "rails", "runner", "TaxonLineage..."), stdin: not_tty
        )
      ).to be(false)
    end

    it "is FALSE for a web / rake / Resque process even on a TTY (not a runner or console)" do
      expect(
        described_class.interactive_cli_session?(
          console: false, cmdline: cmdline("bin/rails", "server"), stdin: tty
        )
      ).to be(false)
      expect(
        described_class.interactive_cli_session?(
          console: false, cmdline: cmdline("bin/rake", "some:task"), stdin: tty
        )
      ).to be(false)
    end

    it "is FALSE when the argv cannot be read and it is not a console (fail OPEN -- genuine errors report)" do
      expect(described_class.interactive_cli_session?(console: false, cmdline: nil, stdin: tty)).to be(false)
    end
  end

  # SMP-1729: credential material must not reach Sentry. Enforced at the sink so
  # it holds for call sites that do not exist yet.
  describe ".scrub_secrets" do
    # Obvious fakes -- nothing here is or resembles a real credential.
    let(:fake_token) { "fake-basespace-token-not-a-real-credential" }
    let(:fake_signed_url) do
      "https://basespace.example.invalid/files/s1.fastq.gz?X-Amz-Signature=fakesignaturevalue"
    end

    # A real Sentry::Event, built through a throwaway client with a dummy
    # transport so nothing leaves the process.
    def build_event
      Sentry.init do |config|
        config.dsn = "http://public@example.com/1"
        config.enabled_environments = %w[test]
        config.environment = "test"
        config.transport.transport_class = Sentry::DummyTransport
        config.traces_sample_rate = 0.0
      end
      Sentry.get_current_client.event_from_message("basespace transfer failed")
    end

    after do
      Sentry.instance_variable_set(:@main_hub, nil) if Sentry.instance_variable_defined?(:@main_hub)
    end

    it "scrubs a token-shaped extra off a real Sentry event" do
      event = build_event
      event.extra = {
        message: "Error transferring basespace files for sample 7",
        sample_id: 7,
        basespace_access_token: fake_token,
      }

      scrubbed = described_class.scrub_secrets(event)

      expect(scrubbed.extra[:basespace_access_token]).to eq(SecretRedaction::REDACTED)
      expect(scrubbed.extra.to_s).not_to include(fake_token)
      # Same debuggability: message and correlating ids survive untouched.
      expect(scrubbed.extra[:sample_id]).to eq(7)
      expect(scrubbed.extra[:message]).to eq("Error transferring basespace files for sample 7")
    end

    it "strips the signature from a presigned URL in extras but keeps the object path" do
      event = build_event
      event.extra = { basespace_paths: [fake_signed_url] }

      scrubbed = described_class.scrub_secrets(event)

      expect(scrubbed.extra[:basespace_paths].first).not_to include("fakesignaturevalue")
      expect(scrubbed.extra[:basespace_paths].first).to include("/files/s1.fastq.gz")
    end

    it "keeps a non-reversible fingerprint, which is not itself a credential" do
      digest = SecretRedaction.fingerprint(fake_token)
      event = build_event
      event.extra = { basespace_token_fingerprint: digest }

      expect(described_class.scrub_secrets(event).extra[:basespace_token_fingerprint]).to eq(digest)
    end

    it "scrubs breadcrumb data and messages" do
      event = build_event
      event.breadcrumbs = Sentry::BreadcrumbBuffer.new
      event.breadcrumbs.record(
        Sentry::Breadcrumb.new(
          category: "basespace",
          message: "GET #{fake_signed_url}",
          data: { "access_token" => fake_token, "dataset_id" => "d1" }
        )
      )

      crumb = described_class.scrub_secrets(event).breadcrumbs.to_a.first

      expect(crumb.data["access_token"]).to eq(SecretRedaction::REDACTED)
      expect(crumb.data["dataset_id"]).to eq("d1")
      expect(crumb.message).not_to include("fakesignaturevalue")
    end

    it "returns nil unchanged (a dropped event stays dropped)" do
      expect(described_class.scrub_secrets(nil)).to be_nil
    end

    it "drops the extras payload rather than shipping it unscrubbed if redaction fails" do
      event = build_event
      event.extra = { basespace_access_token: fake_token }
      allow(SecretRedaction).to receive(:scrub).and_raise(StandardError.new("boom"))

      scrubbed = described_class.scrub_secrets(event)

      expect(scrubbed.extra).to eq(described_class::SCRUB_FAILED)
      expect(scrubbed.extra.to_s).not_to include(fake_token)
    end
  end
end
