require 'rails_helper'
require Rails.root.join("lib/preview_sfn_notifications").to_s

# The SQS/SNS clients are stub_responses clients backed by a small in-memory account, so the specs
# exercise real request shapes (param validation included) AND real state: a second provision
# sees what the first one created, which is the only way to prove idempotency.
describe PreviewSfnNotifications do
  let(:account) { "491013321714" }
  let(:region) { "us-west-2" }
  let(:topic_arn) { "arn:aws:sns:#{region}:#{account}:idseq-swipe-dev-sfn-notifications-topic" }
  let(:queues) { {} } # name => { attrs:, tags: }
  let(:subs) { [] }   # { arn:, endpoint:, protocol:, attrs: }
  let(:calls) { Hash.new { |h, k| h[k] = [] } }
  let(:out) { StringIO.new }

  def url_for(name)
    "https://sqs.#{region}.amazonaws.com/#{account}/#{name}"
  end

  def name_from(url)
    url.split("/").last
  end

  let(:sqs) do
    c = Aws::SQS::Client.new(stub_responses: true, region: region)
    c.stub_responses(:get_queue_url, lambda { |ctx|
      queues.key?(ctx.params[:queue_name]) ? { queue_url: url_for(ctx.params[:queue_name]) } : "QueueDoesNotExist"
    })
    c.stub_responses(:create_queue, lambda { |ctx|
      calls[:create_queue] << ctx.params[:queue_name]
      queues[ctx.params[:queue_name]] ||= { attrs: {}, tags: (ctx.params[:tags] || {}).dup }
      { queue_url: url_for(ctx.params[:queue_name]) }
    })
    c.stub_responses(:tag_queue, lambda { |ctx|
      queues.fetch(name_from(ctx.params[:queue_url]))[:tags].merge!(ctx.params[:tags])
      {}
    })
    c.stub_responses(:set_queue_attributes, lambda { |ctx|
      queues.fetch(name_from(ctx.params[:queue_url]))[:attrs].merge!(ctx.params[:attributes])
      {}
    })
    c.stub_responses(:get_queue_attributes, lambda { |ctx|
      { attributes: { "QueueArn" => "arn:aws:sqs:#{region}:#{account}:#{name_from(ctx.params[:queue_url])}" } }
    })
    c.stub_responses(:delete_queue, lambda { |ctx|
      calls[:delete_queue] << name_from(ctx.params[:queue_url])
      queues.delete(name_from(ctx.params[:queue_url])) ? {} : "QueueDoesNotExist"
    })
    c.stub_responses(:list_queues, lambda { |ctx|
      prefix = ctx.params[:queue_name_prefix].to_s
      { queue_urls: queues.keys.select { |n| n.start_with?(prefix) }.map { |n| url_for(n) }, next_token: nil }
    })
    c
  end

  let(:sns) do
    c = Aws::SNS::Client.new(stub_responses: true, region: region)
    c.stub_responses(:list_subscriptions_by_topic, lambda { |_ctx|
      { subscriptions: subs.map { |s| { subscription_arn: s[:arn], endpoint: s[:endpoint], protocol: s[:protocol], topic_arn: topic_arn } }, next_token: nil }
    })
    # What SNS itself says about a subscription. `actual_endpoint` lets a spec make the listing and
    # the authoritative read disagree, to prove the code trusts only the latter.
    c.stub_responses(:get_subscription_attributes, lambda { |ctx|
      sub = subs.find { |x| x[:arn] == ctx.params[:subscription_arn] }
      next "NotFound" unless sub

      { attributes: { "TopicArn" => sub[:topic] || topic_arn, "Protocol" => sub[:protocol], "Endpoint" => sub[:actual_endpoint] || sub[:endpoint] } }
    })
    c.stub_responses(:subscribe, lambda { |ctx|
      calls[:subscribe] << ctx.params
      arn = "#{topic_arn}:sub-#{subs.size + 1}"
      subs << { arn: arn, endpoint: ctx.params[:endpoint], protocol: ctx.params[:protocol], attrs: ctx.params[:attributes].dup }
      { subscription_arn: arn }
    })
    c.stub_responses(:set_subscription_attributes, lambda { |ctx|
      calls[:set_subscription_attributes] << ctx.params
      subs.find { |s| s[:arn] == ctx.params[:subscription_arn] }[:attrs][ctx.params[:attribute_name]] = ctx.params[:attribute_value]
      {}
    })
    c.stub_responses(:unsubscribe, lambda { |ctx|
      calls[:unsubscribe] << ctx.params[:subscription_arn]
      subs.reject! { |s| s[:arn] == ctx.params[:subscription_arn] } ? {} : "NotFound"
    })
    c
  end

  def notifier(pr: 77)
    described_class.new(pr: pr, env: "dev", topic_arn: topic_arn, sqs: sqs, sns: sns, out: out)
  end

  let(:queue_name) { "idseq-swipe-dev-pr-77-sfn-notifications-queue" }
  let(:dlq_name) { "idseq-swipe-dev-pr-77-sfn-notifications-queue-dead-letter" }
  let(:queue_arn) { "arn:aws:sqs:#{region}:#{account}:#{queue_name}" }

  describe ".filter_policy" do
    it "is EXACTLY the MessageBody filter on detail.name, with the trailing dash" do
      expect(described_class.filter_policy("idseq-pr-77")).to eq('{"detail":{"name":[{"prefix":"idseq-pr-77-"}]}}')
    end

    it "rejects a prefix Step Functions would not accept" do
      expect { described_class.filter_policy("idseq pr 77") }.to raise_error(ArgumentError, /not valid/)
      expect { described_class.filter_policy("") }.to raise_error(ArgumentError)
    end
  end

  describe "#provision!" do
    it "creates the queue and DLQ, tagged for the PR, and returns the queue ARN" do
      expect(notifier.provision!("idseq-pr-77")).to eq(queue_arn)

      expect(queues.keys).to contain_exactly(queue_name, dlq_name)
      expect(queues[queue_name][:tags]).to eq("seqtoid.io/preview-pr" => "77")
      expect(queues[dlq_name][:tags]).to eq("seqtoid.io/preview-pr" => "77")
    end

    it "encrypts both queues with SSE-SQS, not a customer-managed KMS key" do
      notifier.provision!("idseq-pr-77")

      [queue_name, dlq_name].each do |n|
        expect(queues[n][:attrs]).to include("SqsManagedSseEnabled" => "true")
        expect(queues[n][:attrs]).not_to have_key("KmsMasterKeyId")
      end
    end

    it "redrives to the DLQ after 5 receives" do
      notifier.provision!("idseq-pr-77")

      redrive = JSON.parse(queues[queue_name][:attrs]["RedrivePolicy"])
      expect(redrive).to eq("deadLetterTargetArn" => "arn:aws:sqs:#{region}:#{account}:#{dlq_name}", "maxReceiveCount" => "5")
    end

    it "lets ONLY the notification topic send to the queue" do
      notifier.provision!("idseq-pr-77")

      policy = JSON.parse(queues[queue_name][:attrs]["Policy"])
      expect(policy["Statement"]).to eq([{
                                          "Sid" => "AllowSfnNotificationsTopic",
                                          "Effect" => "Allow",
                                          "Principal" => { "Service" => "sns.amazonaws.com" },
                                          "Action" => "sqs:SendMessage",
                                          "Resource" => queue_arn,
                                          "Condition" => { "ArnEquals" => { "aws:SourceArn" => topic_arn } },
                                        }])
    end

    it "subscribes with raw delivery and the exact body-scoped filter policy" do
      notifier.provision!("idseq-pr-77")

      expect(calls[:subscribe].size).to eq(1)
      sub = calls[:subscribe].first
      expect(sub).to include(topic_arn: topic_arn, protocol: "sqs", endpoint: queue_arn, return_subscription_arn: true)
      expect(sub[:attributes]).to eq(
        "RawMessageDelivery" => "true",
        "FilterPolicyScope" => "MessageBody",
        "FilterPolicy" => '{"detail":{"name":[{"prefix":"idseq-pr-77-"}]}}'
      )
    end

    it "is idempotent: a re-provision creates nothing new and never subscribes twice" do
      notifier.provision!("idseq-pr-77")
      expect(notifier.provision!("idseq-pr-77")).to eq(queue_arn)

      expect(calls[:create_queue]).to eq([dlq_name, queue_name]) # first run only
      expect(calls[:subscribe].size).to eq(1)
      expect(subs.size).to eq(1)
    end

    it "converges a drifted existing subscription instead of adding a second one" do
      queues[queue_name] = { attrs: {}, tags: {} }
      subs << { arn: "#{topic_arn}:old", endpoint: queue_arn, protocol: "sqs", attrs: { "RawMessageDelivery" => "false" } }

      notifier.provision!("idseq-pr-77")

      expect(calls[:subscribe]).to be_empty
      expect(subs.size).to eq(1)
      expect(subs.first[:attrs]).to include(
        "RawMessageDelivery" => "true",
        "FilterPolicyScope" => "MessageBody",
        "FilterPolicy" => '{"detail":{"name":[{"prefix":"idseq-pr-77-"}]}}'
      )
      # Scope before policy: the nested policy is only valid once the scope is MessageBody.
      names = calls[:set_subscription_attributes].pluck(:attribute_name)
      expect(names.index("FilterPolicyScope")).to be < names.index("FilterPolicy")
    end

    it "does not touch another PR's subscription" do
      other = "arn:aws:sqs:#{region}:#{account}:idseq-swipe-dev-pr-7-sfn-notifications-queue"
      subs << { arn: "#{topic_arn}:pr7", endpoint: other, protocol: "sqs", attrs: {} }

      notifier.provision!("idseq-pr-77")

      expect(calls[:set_subscription_attributes]).to be_empty
      expect(subs.pluck(:endpoint)).to contain_exactly(other, queue_arn)
    end
  end

  describe "refusing to touch a subscription that is not this preview's" do
    let(:dev_queue) { "arn:aws:sqs:#{region}:#{account}:idseq-swipe-dev-web-sfn-notifications-queue" }

    # The listing says the subscription is ours, SNS says it delivers to DEV's queue. Unsubscribe
    # and SetSubscriptionAttributes cannot be scoped by endpoint in IAM, so this is the only guard.
    it "teardown raises and never unsubscribes" do
      subs << { arn: "#{topic_arn}:devsub", endpoint: queue_arn, actual_endpoint: dev_queue, protocol: "sqs", attrs: {} }

      expect { notifier.teardown! }.to raise_error(described_class::ForeignSubscriptionError, /idseq-swipe-dev-web-sfn-notifications-queue/)
      expect(calls[:unsubscribe]).to be_empty
      expect(subs.size).to eq(1)
    end

    it "provision raises and never rewrites its attributes" do
      queues[queue_name] = { attrs: {}, tags: {} }
      subs << { arn: "#{topic_arn}:devsub", endpoint: queue_arn, actual_endpoint: dev_queue, protocol: "sqs", attrs: {} }

      expect { notifier.provision!("idseq-pr-77") }.to raise_error(described_class::ForeignSubscriptionError)
      expect(calls[:set_subscription_attributes]).to be_empty
    end

    it "refuses a subscription on a different topic even if the endpoint is ours" do
      subs << { arn: "#{topic_arn}:other", endpoint: queue_arn, topic: "arn:aws:sns:#{region}:#{account}:something-else", protocol: "sqs", attrs: {} }

      expect { notifier.teardown! }.to raise_error(described_class::ForeignSubscriptionError)
      expect(calls[:unsubscribe]).to be_empty
    end

    it "refuses a similarly named queue (suffix match is not enough)" do
      subs << { arn: "#{topic_arn}:sim", endpoint: queue_arn, actual_endpoint: "arn:aws:sqs:#{region}:#{account}:x-#{queue_name}", protocol: "sqs", attrs: {} }

      expect { notifier.teardown! }.to raise_error(described_class::ForeignSubscriptionError)
    end
  end

  describe ".access_denied?" do
    it "recognises both services' denial codes and nothing else" do
      expect(described_class.access_denied?(Aws::SQS::Errors::ServiceError.new(nil, "x").tap { |e| allow(e).to receive(:code).and_return("AccessDenied") })).to be(true)
      expect(described_class.access_denied?(Aws::SNS::Errors::AuthorizationError.new(nil, "x"))).to be(true)
      expect(described_class.access_denied?(Aws::SQS::Errors::QueueDoesNotExist.new(nil, "x"))).to be(false)
    end
  end

  describe "#teardown!" do
    it "unsubscribes and deletes the queue and DLQ" do
      notifier.provision!("idseq-pr-77")
      notifier.teardown!

      expect(queues).to be_empty
      expect(subs).to be_empty
      expect(calls[:delete_queue]).to contain_exactly(queue_name, dlq_name)
    end

    it "is a clean no-op when everything is already gone" do
      expect { notifier.teardown! }.not_to raise_error
      expect(calls[:delete_queue]).to be_empty
      expect(out.string).to include("already gone")
    end

    it "removes a dangling subscription even when the queue itself is gone" do
      subs << { arn: "#{topic_arn}:dangling", endpoint: queue_arn, protocol: "sqs", attrs: {} }

      notifier.teardown!

      expect(calls[:unsubscribe]).to eq(["#{topic_arn}:dangling"])
    end

    it "only removes ITS OWN subscription (pr-7 is not a prefix match for pr-77, nor the reverse)" do
      keep = [
        { arn: "#{topic_arn}:pr7", endpoint: "arn:aws:sqs:#{region}:#{account}:idseq-swipe-dev-pr-7-sfn-notifications-queue", protocol: "sqs", attrs: {} },
        { arn: "#{topic_arn}:pr777", endpoint: "arn:aws:sqs:#{region}:#{account}:idseq-swipe-dev-pr-777-sfn-notifications-queue", protocol: "sqs", attrs: {} },
        { arn: "#{topic_arn}:dev", endpoint: "arn:aws:sqs:#{region}:#{account}:idseq-swipe-dev-web-sfn-notifications-queue", protocol: "sqs", attrs: {} },
      ]
      subs.concat(keep)
      subs << { arn: "#{topic_arn}:mine", endpoint: queue_arn, protocol: "sqs", attrs: {} }

      notifier.teardown!

      expect(calls[:unsubscribe]).to eq(["#{topic_arn}:mine"])
      expect(subs.pluck(:arn)).to match_array(keep.pluck(:arn))
    end

    it "skips a subscription still PendingConfirmation (it has no ARN to unsubscribe)" do
      subs << { arn: "PendingConfirmation", endpoint: queue_arn, protocol: "sqs", attrs: {} }

      expect { notifier.teardown! }.not_to raise_error
      expect(calls[:unsubscribe]).to be_empty
    end
  end

  describe ".preview_queue_prs" do
    it "finds every PR with a queue or DLQ, and ignores dev's own queue" do
      queues["idseq-swipe-dev-pr-12-sfn-notifications-queue"] = { attrs: {}, tags: {} }
      queues["idseq-swipe-dev-pr-12-sfn-notifications-queue-dead-letter"] = { attrs: {}, tags: {} }
      queues["idseq-swipe-dev-pr-40-sfn-notifications-queue-dead-letter"] = { attrs: {}, tags: {} } # half torn down
      queues["idseq-swipe-dev-pr-0-sfn-notifications-queue"] = { attrs: {}, tags: {} } # not a valid PR
      queues["idseq-swipe-dev-pr-9-something-else"] = { attrs: {}, tags: {} }
      queues["idseq-swipe-dev-web-sfn-notifications-queue"] = { attrs: {}, tags: {} }

      expect(described_class.preview_queue_prs(sqs, "dev")).to eq([12, 40])
    end

    it "raises on a listing failure instead of reporting no queues" do
      failing = Aws::SQS::Client.new(stub_responses: true, region: region)
      failing.stub_responses(:list_queues, "AccessDenied")
      expect { described_class.preview_queue_prs(failing, "dev") }.to raise_error(Aws::SQS::Errors::ServiceError)
    end
  end

  it "refuses a PR number that is not a positive integer" do
    expect { described_class.new(pr: "0", env: "dev", topic_arn: topic_arn, sqs: sqs, sns: sns) }.to raise_error(ArgumentError)
    expect { described_class.new(pr: "7; rm", env: "dev", topic_arn: topic_arn, sqs: sqs, sns: sns) }.to raise_error(ArgumentError)
  end

  it "refuses to run without a topic" do
    expect { described_class.new(pr: "7", env: "dev", topic_arn: " ", sqs: sqs, sns: sns) }.to raise_error(ArgumentError, /topic_arn/)
  end
end
