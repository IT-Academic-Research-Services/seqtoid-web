# frozen_string_literal: true

require "rails_helper"
require Rails.root.join("lib/taxonomy_benchmark_gate").to_s

RSpec.describe TaxonomyBenchmarkGate do
  let(:passing) do
    [
      { sample: "atcc_even", nt_aupr: 0.995, nr_aupr: 0.991 },
      { sample: "atcc_staggered", nt_aupr: 0.982, nr_aupr: 0.980 },
    ]
  end

  describe ".regressions" do
    it "is empty when every NT/NR AUPR clears the floor" do
      expect(described_class.regressions(passing, 0.98)).to be_empty
    end

    it "flags each metric below the floor" do
      results = [{ sample: "gut", nt_aupr: 0.995, nr_aupr: 0.950 },
                 { sample: "soil", nt_aupr: 0.900, nr_aupr: 0.999 }]
      regs = described_class.regressions(results, 0.98)
      expect(regs).to include(a_hash_including(sample: "gut", metric: "nr_aupr", value: 0.950))
      expect(regs).to include(a_hash_including(sample: "soil", metric: "nt_aupr", value: 0.900))
      expect(regs.size).to eq(2)
    end

    it "treats a MISSING metric as a regression (unknown cannot certify)" do
      regs = described_class.regressions([{ sample: "x", nt_aupr: 0.99, nr_aupr: nil }], 0.98)
      expect(regs).to contain_exactly(a_hash_including(sample: "x", metric: "nr_aupr", value: nil, reason: /missing/))
    end

    it "is boundary-inclusive (>= floor passes)" do
      expect(described_class.regressions([{ sample: "b", nt_aupr: 0.98, nr_aupr: 0.98 }], 0.98)).to be_empty
      expect(described_class.regressions([{ sample: "b", nt_aupr: 0.9799, nr_aupr: 0.98 }], 0.98).size).to eq(1)
    end
  end

  describe ".report / .pass?" do
    it "PASSES a clean run" do
      report = described_class.report(passing, 0.98)
      expect(report[:overall]).to eq("PASS")
      expect(report[:samples_checked]).to eq(2)
      expect(described_class.pass?(passing, 0.98)).to be(true)
    end

    it "FAILS on any regression" do
      results = passing + [{ sample: "bad", nt_aupr: 0.5, nr_aupr: 0.99 }]
      expect(described_class.report(results, 0.98)[:overall]).to eq("FAIL")
      expect(described_class.pass?(results, 0.98)).to be(false)
    end

    it "does not vacuously pass an empty result set" do
      expect(described_class.pass?([], 0.98)).to be(false)
    end
  end
end
