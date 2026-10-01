require "rails_helper"

RSpec.describe HeatmapIndexing do
  # In-memory stand-in for the SET NX EX / DEL calls HeatmapIndexing makes on Resque.redis.
  let(:fake_redis) do
    Class.new do
      attr_reader :store

      def initialize
        @store = {}
      end

      def set(key, value, nx: false, ex: nil)
        return false if nx && @store.key?(key)

        @store[key] = { value: value, ex: ex }
        true
      end

      def del(key)
        @store.delete(key) ? 1 : 0
      end
    end.new
  end

  before do
    allow(Resque).to receive(:redis).and_return(fake_redis)
    allow(Resque).to receive(:enqueue)
  end

  describe ".enqueue" do
    it "enqueues a pair once until its job releases it" do
      expect(described_class.enqueue(10_000, 7)).to be(true)
      expect(described_class.enqueue(10_000, 7)).to be(false)
      expect(Resque).to have_received(:enqueue).with(IndexTaxons, 10_000, 7, false).once

      described_class.release(10_000, 7)
      expect(described_class.enqueue(10_000, 7)).to be(true)
      expect(Resque).to have_received(:enqueue).with(IndexTaxons, 10_000, 7, false).twice
    end

    it "keys the marker per background and run" do
      described_class.enqueue(10_000, 7)
      described_class.enqueue(10_001, 7)
      described_class.enqueue(10_000, 8)
      expect(Resque).to have_received(:enqueue).exactly(3).times
    end

    it "sets the marker with the pending TTL" do
      described_class.enqueue(10_000, 7)
      expect(fake_redis.store[described_class.pending_key(10_000, 7)][:ex]).to eq(described_class::PENDING_TTL_SECONDS)
    end

    it "always enqueues when forced, even if the pair is pending" do
      described_class.enqueue(10_000, 7)
      expect(described_class.enqueue(10_000, 7, force: true)).to be(true)
      expect(Resque).to have_received(:enqueue).with(IndexTaxons, 10_000, 7, true).once
    end

    it "enqueues anyway when the marker cannot be written (fail open)" do
      allow(fake_redis).to receive(:set).and_raise(Redis::CannotConnectError)
      expect(described_class.enqueue(10_000, 7)).to be(true)
      expect(Resque).to have_received(:enqueue).with(IndexTaxons, 10_000, 7, false)
    end

    it "does nothing without a background or run" do
      expect(described_class.enqueue(nil, 7)).to be(false)
      expect(described_class.enqueue(10_000, nil)).to be(false)
      expect(Resque).not_to have_received(:enqueue)
    end
  end

  describe ".release" do
    it "swallows Redis errors (the marker expires on its own)" do
      allow(fake_redis).to receive(:del).and_raise(Redis::CannotConnectError)
      expect { described_class.release(10_000, 7) }.not_to raise_error
    end
  end

  describe ".default_background_id" do
    around do |example|
      original = Rails.configuration.x.constants.default_background
      example.run
    ensure
      Rails.configuration.x.constants.default_background = original
    end

    it "uses the configured background when it exists" do
      background = create(:background)
      Rails.configuration.x.constants.default_background = background.id
      expect(described_class.default_background_id).to eq(background.id)
    end

    it "falls back to the first public background when the configured id does not exist" do
      Rails.configuration.x.constants.default_background = -1
      first_public = Background.where(public_access: 1).order(:id).limit(1).pick(:id)
      expect(described_class.default_background_id).to eq(first_public)
    end
  end

  describe ".indexable_run_ids" do
    it "keeps only finished Illumina runs" do
      done = create(:pipeline_run, technology: PipelineRun::TECHNOLOGY_INPUT[:illumina])
      done.update_column(:results_finalized, PipelineRun::FINALIZED_SUCCESS) # rubocop:disable Rails/SkipsModelValidations
      running = create(:pipeline_run, technology: PipelineRun::TECHNOLOGY_INPUT[:illumina])
      running.update_column(:results_finalized, PipelineRun::IN_PROGRESS) # rubocop:disable Rails/SkipsModelValidations
      ont = create(:pipeline_run, technology: PipelineRun::TECHNOLOGY_INPUT[:nanopore])
      ont.update_column(:results_finalized, PipelineRun::FINALIZED_SUCCESS) # rubocop:disable Rails/SkipsModelValidations

      expect(described_class.indexable_run_ids([done.id, running.id, ont.id])).to eq([done.id])
    end

    it "returns [] for no runs" do
      expect(described_class.indexable_run_ids([])).to eq([])
    end
  end
end
