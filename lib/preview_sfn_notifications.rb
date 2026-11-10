# frozen_string_literal: true

require "json"

# A preview sandbox's OWN Step Functions notification queue.
#
# WHY: every preview dispatches to DEV's state machines, and their status-change events all reach
# one SNS topic (EventBridge -> idseq-swipe-<env>-sfn-notifications-topic). Dev's queue on that
# topic is consumed by HandleSfnNotifications, which only deletes a message whose execution ARN
# matches a run in ITS OWN database; anything else is redelivered until it dead-letters. So a
# preview running Shoryuken against dev's queue is a competing consumer that burns dev's receive
# counts, and that is why previews used to poll instead.
#
# This gives each preview its own queue on the same topic, filtered on the execution NAME. A
# preview names its executions "<prefix>-..." (SFN_EXECUTION_NAME_PREFIX, e.g. "idseq-pr-<N>"), and
# the subscription only lets through events whose detail.name starts with "<prefix>-". The trailing
# dash is what keeps pr-1 from receiving pr-12's events.
#
# Every operation is idempotent: Argo re-runs the provision hook on every sync, and teardown /
# the orphan reaper can run against a sandbox that is already partly gone.
#
# Names are built ONLY from a validated PR number, so this can never address dev's own queue.
class PreviewSfnNotifications
  # Raised instead of touching a subscription that is not this preview's own. The provisioner's
  # IAM can scope Subscribe by endpoint but NOT Unsubscribe / SetSubscriptionAttributes, so the
  # role could alter dev's own subscription on the shared topic; this check is the boundary.
  class ForeignSubscriptionError < StandardError; end

  PR_TAG = "seqtoid.io/preview-pr"
  # SSE-SQS (SQS-owned keys), deliberately not a customer-managed KMS key: SNS can deliver into it
  # with no key-policy grant, and there is no key to leak or orphan when the preview goes away.
  SSE_ATTRIBUTES = { "SqsManagedSseEnabled" => "true" }.freeze
  # Only this preview consumes its queue now, so a message that fails 5 times is genuinely bad.
  MAX_RECEIVE_COUNT = 5
  # 14 days, the SQS maximum: a dead-lettered status event is evidence worth keeping around.
  DLQ_RETENTION_SECONDS = 1_209_600
  # Same rule SfnExecutionName enforces at dispatch; checked here too so a bad prefix fails the
  # provision instead of creating a filter that silently never matches.
  VALID_PREFIX = /\A[0-9A-Za-z_-]{1,40}\z/

  attr_reader :pr, :env, :topic_arn

  def self.queue_name(env, pr)
    "idseq-swipe-#{env}-pr-#{pr}-sfn-notifications-queue"
  end

  def self.dlq_name(env, pr)
    "#{queue_name(env, pr)}-dead-letter"
  end

  # Exact JSON the subscription filters on (FilterPolicyScope=MessageBody). With raw message
  # delivery the SQS body IS the EventBridge event, so detail.name is the execution name.
  def self.filter_policy(execution_name_prefix)
    unless execution_name_prefix.to_s.match?(VALID_PREFIX)
      raise ArgumentError, "execution name prefix #{execution_name_prefix.inspect} is not valid " \
                           "(allowed: 1-40 of [0-9A-Za-z_-])"
    end

    JSON.generate({ "detail" => { "name" => [{ "prefix" => "#{execution_name_prefix}-" }] } })
  end

  # PR numbers that have a preview queue (or DLQ) in this account, from the queue names alone.
  # Used by the orphan reaper; raises on any API failure rather than reporting "none".
  def self.preview_queue_prs(sqs, env)
    pattern = /\Aidseq-swipe-#{Regexp.escape(env)}-pr-([1-9][0-9]*)-sfn-notifications-queue(?:-dead-letter)?\z/
    prs = []
    token = nil
    loop do
      resp = sqs.list_queues(queue_name_prefix: "idseq-swipe-#{env}-pr-", max_results: 1000, next_token: token)
      resp.queue_urls.each do |url|
        name = url.split("/").last
        prs << Regexp.last_match(1).to_i if name =~ pattern
      end
      token = resp.next_token
      break if token.to_s.empty?
    end
    prs.uniq.sort
  end

  # An IAM denial, in either service's spelling (SQS: AccessDenied; SNS: AuthorizationError).
  def self.access_denied?(err)
    err.code.to_s.match?(/AccessDenied|AuthorizationError/)
  end

  def initialize(pr:, env:, topic_arn:, sqs: nil, sns: nil, out: $stdout)
    raise ArgumentError, "pr must be a positive integer (got #{pr.inspect})" unless pr.to_s.match?(/\A[1-9][0-9]*\z/)
    raise ArgumentError, "topic_arn is required" if topic_arn.to_s.strip.empty?

    @pr = pr.to_s
    @env = env.to_s
    @topic_arn = topic_arn.to_s.strip
    @sqs = sqs || Aws::SQS::Client.new
    @sns = sns || Aws::SNS::Client.new
    @out = out
  end

  def queue_name
    self.class.queue_name(env, pr)
  end

  def dlq_name
    self.class.dlq_name(env, pr)
  end

  # Create (or converge) the DLQ, the queue, its policy + redrive, and the filtered subscription.
  # Returns the queue ARN, which provision writes over SFN_NOTIFICATIONS_QUEUE_ARN.
  def provision!(execution_name_prefix)
    filter = self.class.filter_policy(execution_name_prefix)

    dlq_url = ensure_queue(dlq_name)
    @sqs.set_queue_attributes(queue_url: dlq_url, attributes: SSE_ATTRIBUTES.merge("MessageRetentionPeriod" => DLQ_RETENTION_SECONDS.to_s))
    dlq_arn = queue_arn(dlq_url)

    url = ensure_queue(queue_name)
    arn = queue_arn(url)
    # Set on every run, so a re-provision converges a queue that drifted or was half-created.
    @sqs.set_queue_attributes(queue_url: url, attributes: SSE_ATTRIBUTES.merge(
      "Policy" => queue_policy(arn),
      "RedrivePolicy" => JSON.generate({ "deadLetterTargetArn" => dlq_arn, "maxReceiveCount" => MAX_RECEIVE_COUNT.to_s })
    ))

    ensure_subscription(arn, filter)
    log("queue #{queue_name} ready (dlq #{dlq_name}), filter #{filter}")
    arn
  end

  # Unsubscribe and delete the queue + DLQ. Tolerates any piece already being gone.
  def teardown!
    # A PendingConfirmation entry has no ARN to unsubscribe; it expires on its own.
    subs = subscriptions_for_queue_name(queue_name).select { |s| s.subscription_arn.to_s.start_with?("arn:") }
    subs.each do |sub|
      next unless verify_own_subscription!(sub.subscription_arn)

      @sns.unsubscribe(subscription_arn: sub.subscription_arn)
    rescue Aws::SNS::Errors::ServiceError => e
      raise unless e.code.to_s.include?("NotFound")
    end
    log("unsubscribed #{subs.size} subscription(s) for #{queue_name}")

    [queue_name, dlq_name].each do |name|
      url = existing_queue_url(name)
      if url.nil?
        log("queue #{name} already gone")
        next
      end
      begin
        @sqs.delete_queue(queue_url: url)
        log("deleted queue #{name}")
      rescue Aws::SQS::Errors::ServiceError => e
        raise unless missing_queue_error?(e)

        log("queue #{name} already gone")
      end
    end
  end

  # The access policy that lets ONLY this topic deliver into the queue.
  def queue_policy(queue_arn)
    JSON.generate({
                    "Version" => "2012-10-17",
                    "Statement" => [{
                      "Sid" => "AllowSfnNotificationsTopic",
                      "Effect" => "Allow",
                      "Principal" => { "Service" => "sns.amazonaws.com" },
                      "Action" => "sqs:SendMessage",
                      "Resource" => queue_arn,
                      "Condition" => { "ArnEquals" => { "aws:SourceArn" => topic_arn } },
                    }],
                  })
  end

  private

  def log(msg)
    @out.puts("[preview-sfn-notifications] pr=#{pr} #{msg}")
  end

  # get_queue_url first, create only when absent: CreateQueue on an existing queue errors when the
  # attributes passed differ from the live ones, so "always create" is not safely idempotent.
  def ensure_queue(name)
    url = existing_queue_url(name)
    url ||= create_queue(name)
    @sqs.tag_queue(queue_url: url, tags: { PR_TAG => pr })
    url
  end

  def create_queue(name)
    attempts = 0
    begin
      attempts += 1
      @sqs.create_queue(queue_name: name, attributes: SSE_ATTRIBUTES, tags: { PR_TAG => pr }).queue_url
    rescue Aws::SQS::Errors::ServiceError => e
      # SQS refuses to recreate a name for 60s after deleting it -- a PR closed and reopened
      # quickly. Wait it out once instead of failing the provision.
      raise unless e.code.to_s.include?("QueueDeletedRecently") && attempts < 2

      log("#{name} was deleted recently; waiting 65s before recreating it")
      sleep(65)
      retry
    end
  end

  def existing_queue_url(name)
    @sqs.get_queue_url(queue_name: name).queue_url
  rescue Aws::SQS::Errors::ServiceError => e
    raise unless missing_queue_error?(e)

    nil
  end

  # The JSON-protocol SQS API reports a missing queue as QueueDoesNotExist; the legacy query
  # protocol as AWS.SimpleQueueService.NonExistentQueue. Accept either, nothing else.
  def missing_queue_error?(err)
    "#{err.code} #{err.class.name}".match?(/NonExistentQueue|QueueDoesNotExist/)
  end

  def queue_arn(url)
    @sqs.get_queue_attributes(queue_url: url, attribute_names: ["QueueArn"]).attributes.fetch("QueueArn")
  end

  def topic_subscriptions
    subs = []
    token = nil
    loop do
      resp = @sns.list_subscriptions_by_topic(topic_arn: topic_arn, next_token: token)
      subs.concat(resp.subscriptions)
      token = resp.next_token
      break if token.to_s.empty?
    end
    subs
  end

  # True only for an SQS ARN whose queue name is EXACTLY this preview's queue (any region/account
  # field shape is irrelevant; the name is built from the validated PR number).
  def own_endpoint?(endpoint)
    parts = endpoint.to_s.split(":")
    parts.size == 6 && parts[0, 3] == %w[arn aws sqs] && parts[5] == queue_name
  end

  # Re-read the subscription from SNS itself (not the listing) and refuse unless it is on OUR topic,
  # protocol sqs, and delivers to OUR queue. Returns false if it vanished meanwhile.
  def verify_own_subscription!(subscription_arn)
    attrs = @sns.get_subscription_attributes(subscription_arn: subscription_arn).attributes
    return true if attrs["TopicArn"] == topic_arn && attrs["Protocol"] == "sqs" && own_endpoint?(attrs["Endpoint"])

    raise ForeignSubscriptionError, "refusing to modify subscription #{subscription_arn}: it delivers to " \
                                    "#{attrs['Endpoint'].inspect} (#{attrs['Protocol'].inspect}) on #{attrs['TopicArn'].inspect}, " \
                                    "not this preview's queue #{queue_name} on #{topic_arn}"
  rescue Aws::SNS::Errors::ServiceError => e
    raise unless e.code.to_s.include?("NotFound")

    false
  end

  # Match on ":<queue name>" so pr-1 never matches pr-12's queue. Works even when the queue itself
  # is already gone, so a dangling subscription is still cleaned up.
  def subscriptions_for_queue_name(name)
    topic_subscriptions.select { |s| s.protocol == "sqs" && s.endpoint.to_s.end_with?(":#{name}") }
  end

  # Look for an existing subscription for this endpoint before subscribing, so a re-provision
  # never adds a second one; then converge its attributes. FilterPolicyScope goes first: the
  # nested policy is only valid in MessageBody scope.
  def ensure_subscription(queue_arn, filter)
    attrs = { "RawMessageDelivery" => "true", "FilterPolicyScope" => "MessageBody", "FilterPolicy" => filter }
    existing = topic_subscriptions.select { |s| s.protocol == "sqs" && s.endpoint == queue_arn }

    if existing.empty?
      resp = @sns.subscribe(topic_arn: topic_arn, protocol: "sqs", endpoint: queue_arn, attributes: attrs, return_subscription_arn: true)
      log("subscribed #{queue_arn} -> #{resp.subscription_arn}")
      return
    end

    existing.each do |sub|
      verify_own_subscription!(sub.subscription_arn)
      attrs.each do |name, value|
        @sns.set_subscription_attributes(subscription_arn: sub.subscription_arn, attribute_name: name, attribute_value: value)
      end
      log("subscription #{sub.subscription_arn} already present; attributes converged")
    end
  end
end
