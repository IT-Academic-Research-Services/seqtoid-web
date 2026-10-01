require "rails_helper"

# Every Resque queue declared in app/ must be worked by exactly one worker in the Helm chart.
#
# The web-role queues are split across resque / resque-deletion / resque-accounts / resque-indexing, and
# the screening queues live on screening-worker. A queue missing from all of them is silently never worked (jobs pile
# up forever); a queue on two of them defeats the split (e.g. hard_delete_objects back on the general
# pool re-creates the 2026-09-29 env-prod stall, and a screening queue on a web worker re-creates the
# 2026-09-23 misrouting). Explicit lists only -- the "*" catch-all must never come back.
RSpec.describe "deploy/charts/seqtoid-web resque worker queue coverage" do
  let(:working_workers) { ["resque", "resque-deletion", "resque-accounts", "resque-indexing", "screening-worker"] }
  let(:workers) do
    YAML.safe_load(Rails.root.join("deploy", "charts", "seqtoid-web", "values.yaml").read)["workers"]
  end

  let(:declared_queues) do
    Dir[Rails.root.join("app", "**", "*.rb")].flat_map do |path|
      File.read(path, encoding: "UTF-8").scan(/^\s*@queue\s*=\s*:(\w+)/).flatten
    end.uniq.sort
  end

  let(:queues_by_worker) do
    working_workers.index_with { |name| workers.fetch(name).fetch("queue").split(",").map(&:strip) }
  end

  it "finds the job queues it is checking" do
    expect(declared_queues).to include("hard_delete_objects", "provision_screened_account", "index_taxons")
  end

  it "works every declared queue on exactly one worker" do
    declared_queues.each do |queue|
      owners = queues_by_worker.select { |_, queues| queues.include?(queue) }.keys
      expect(owners.size).to eq(1), "queue #{queue} is worked by #{owners.inspect}; expected exactly one worker"
    end
  end

  it "never uses the Resque catch-all" do
    queues_by_worker.each do |name, queues|
      expect(queues).not_to include("*"), "#{name} lists the \"*\" catch-all"
    end
  end

  it "keeps destructive and account jobs off the general pool" do
    expect(queues_by_worker["resque-deletion"]).to include("hard_delete_objects", "enforce_data_retention")
    expect(queues_by_worker["resque-accounts"]).to eq(["provision_screened_account"])
    expect(queues_by_worker["resque"]).not_to include("hard_delete_objects", "enforce_data_retention", "provision_screened_account")
  end

  it "keeps heatmap indexing on its own capped pool" do
    expect(queues_by_worker["resque-indexing"]).to eq(["index_taxons"])
    expect(queues_by_worker["resque"]).not_to include("index_taxons")
  end

  it "runs the deletion worker as a single replica (parallel hard deletes trip S3 SlowDown)" do
    expect(workers.fetch("resque-deletion").fetch("replicaCount", 1)).to eq(1)
  end
end
