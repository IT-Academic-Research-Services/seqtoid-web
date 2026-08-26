require "rails_helper"

# Specs for SupportRequestMailer -- the app -> SES -> ServiceNow-inbox -> ticket chain.
# Proves the subject shape (ServiceNow short_description), recipient/reply-to routing, and
# that the log deep-links (Grafana + CloudWatch) an agent needs are surfaced up top, with
# unset/placeholder links dropped. See app/mailers/support_request_mailer.rb.
RSpec.describe SupportRequestMailer, type: :mailer do
  let(:payload) do
    {
      event: "support_request",
      correlation_id: "corr-abc-123",
      user_id: 42,
      user_email: "scientist@example.edu",
      user_role: "user",
      account_name: "Doe Lab",
      error: "Upload failed",
      task: "Upload samples",
      project: "Metagenomics 2026",
      description: "It died at 80%.",
      summary: "Upload failure during resumable upload.",
      runbook: { label: "Upload failure", runbook: "https://runbooks.seqtoid.internal/upload-failure" },
      log_links: {
        cloudwatch_logs_insights: "https://us-west-2.console.aws.amazon.com/cloudwatch/home?region=us-west-2#logsV2:logs-insights$3F...corr-abc-123",
        otel_dashboard: "https://grafana.dev.seqtoid.org/d/support?correlationId=corr-abc-123",
        otel_action_log: "https://us-west-2.console.aws.amazon.com/cloudwatch/home?region=us-west-2#logsV2:logs-insights$3F...user_action",
      },
      environment: "dev",
      git_release_sha: "sha-abcd1234",
      submitted_at: "2026-08-18T12:00:00Z",
    }
  end

  around do |example|
    ClimateControl.modify(SUPPORT_INBOX_EMAIL: "seqtoid-support@ucsf.edu") { example.run }
  end

  describe "#service_now_ticket" do
    it "routes to the ServiceNow inbox with the user as reply-to" do
      mail = described_class.service_now_ticket(payload)
      expect(mail.to).to eq(["seqtoid-support@ucsf.edu"])
      expect(mail.reply_to).to eq(["scientist@example.edu"])
    end

    it "builds a ServiceNow short_description-style subject" do
      mail = described_class.service_now_ticket(payload)
      expect(mail.subject).to eq("[SeqtoID dev] Upload failed -- Doe Lab")
    end

    it "surfaces the Grafana + CloudWatch deep-links at the top" do
      body = described_class.service_now_ticket(payload).body.encoded
      expect(body).to include("JUMP STRAIGHT TO THE LOGS")
      expect(body).to include("https://grafana.dev.seqtoid.org/d/support?correlationId=corr-abc-123")
      expect(body).to include("logs-insights")
      expect(body).to include("Correlation ID: corr-abc-123")
    end

    it "renders the Step Functions execution link for a failed run" do
      payload[:pipeline_failure] = {
        failed_stage: "host_filter",
        error_message: "OOMKilled",
        sfn_execution_arn: "arn:aws:states:us-west-2:123:execution:idseq-swipe:abc",
      }
      body = described_class.service_now_ticket(payload).body.encoded
      expect(body).to include("Step Functions execution")
      expect(body).to include("states/home")
    end

    it "drops unconfigured TODO-placeholder links instead of printing dead URLs" do
      payload[:log_links] = {
        cloudwatch_logs_insights: "https://us-west-2.console.aws.amazon.com/cloudwatch/home?region=us-west-2#...source~(~'TODO-set-SUPPORT_LOG_GROUP)...",
        otel_dashboard: "TODO-set-OTEL_DASHBOARD_BASE_URL?correlationId=corr-abc-123",
        otel_action_log: "TODO-set-OTEL_DASHBOARD_BASE_URL",
      }
      body = described_class.service_now_ticket(payload).body.encoded
      expect(body).not_to include("TODO-set-")
      expect(body).to include("not configured for this environment yet")
    end
  end
end
