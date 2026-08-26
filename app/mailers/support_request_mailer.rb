# frozen_string_literal: true

# Emails a fully-built support payload to the ServiceNow inbound address so it spawns a
# ticket (the customer requires ServiceNow; we have no ServiceNow API, so the app -> SES ->
# ServiceNow-inbox -> ticket chain is how a report becomes a ticket).
#
# Design goals:
#   - PLAIN TEXT, shaped for ServiceNow's inbound email parser: the Subject becomes the
#     ticket short_description, the body becomes the description. HTML is avoided because
#     ServiceNow's inbound parsing mangles it.
#   - EVIDENCE FIRST. A support agent should never have to learn our observability stack:
#     the deep-links into the Grafana Support Inbox and CloudWatch Logs (already built by
#     SupportRequestsController#build_log_links, scoped to this exact session + time window)
#     sit at the very top, plus the exact Step Functions execution for a failed run.
#   - Reply-To is the reporting user, so ServiceNow can resolve the caller and any reply from
#     support reaches the person who hit the problem. (Reply-To needs no SES verification;
#     only the From identity does -- see ApplicationMailer / MAIL_FROM_ADDRESS.)
#
# This mailer is invoked best-effort from SupportRouter (its own rescue), so a mail/SES/
# ServiceNow outage can never fail the user's submit -- the durable Grafana/Loki record
# remains the load-bearing sink.
class SupportRequestMailer < ApplicationMailer
  # Default ServiceNow inbox; overridden per-env by SUPPORT_INBOX_EMAIL in chamber.
  DEFAULT_SUPPORT_INBOX = "seqtoid-support@ucsf.edu"
  # ServiceNow truncates short_description; keep the subject tight.
  SUBJECT_MAX = 160

  def service_now_ticket(payload)
    @p = payload.to_h.deep_symbolize_keys
    @links = (@p[:log_links] || {})
    @failure = @p[:pipeline_failure]
    @evidence = evidence_links

    inbox = ENV["SUPPORT_INBOX_EMAIL"].presence || DEFAULT_SUPPORT_INBOX
    mail(
      to: inbox,
      subject: service_now_subject,
      reply_to: @p[:user_email].presence
    ) do |format|
      format.text { render "service_now_ticket" }
    end
  end

  private

  # "[SeqtoID <env>] <error or task> -- <account>" -> ServiceNow short_description.
  def service_now_subject
    env = @p[:environment].presence || Rails.env
    headline = @p[:error].presence || @p[:task].presence || "Support request"
    who = @p[:account_name].presence
    subject = "[SeqtoID #{env}] #{headline}"
    subject += " -- #{who}" if who
    subject.truncate(SUBJECT_MAX)
  end

  # An ordered list of {label:, url:} the agent can click straight through to. Grafana +
  # CloudWatch come from the pre-built log_links; the Step Functions execution is derived
  # from the failed run when the report is about one. Any missing/placeholder link is dropped
  # so the ticket never shows a dead "TODO-set-..." URL.
  def evidence_links
    links = []
    links << { label: "Grafana Support Inbox (this report)", url: @links[:otel_dashboard] }
    links << { label: "CloudWatch Logs -- session", url: @links[:cloudwatch_logs_insights] }
    links << { label: "CloudWatch Logs -- user action trail", url: @links[:otel_action_log] }

    arn = @failure.is_a?(Hash) ? @failure[:sfn_execution_arn].presence : nil
    links << { label: "Step Functions execution (failed run)", url: AwsUtil.get_sfn_execution_url(arn) } if arn

    links.select { |l| usable_url?(l[:url]) }
  end

  def usable_url?(url)
    url.is_a?(String) && url.start_with?("http") && !url.include?("TODO-set-")
  end
end
