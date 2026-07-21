# frozen_string_literal: true

# Pure decision logic for the taxonomy benchmark gate, extracted so it is unit-testable without the
# SFN/DB. The rake (lib/tasks/taxonomy_benchmark_gate.rake) runs/reads the benchmarks and hands the
# per-sample AUPR here.
#
# This is the BIOLOGICAL gate for the quarterly taxonomy refresh (epic #548): a candidate index
# (new lineage or a rebuilt NT/NR, incl. the core_nt swap) is only adoptable if the benchmark's
# NT/NR AUPR against the truth set stays at/above the floor. A regression on ANY sample or metric
# blocks -- including a missing metric (a benchmark that failed to produce AUPR cannot certify the
# candidate, so "unknown" is treated as failing, not passing).
module TaxonomyBenchmarkGate
  module_function

  DEFAULT_MIN_AUPR = 0.98

  # results: array of hashes { sample:, nt_aupr:, nr_aupr: } (either aupr may be nil = the benchmark
  # did not produce it). Returns the list of regressions, each { sample:, metric:, value:, reason: }.
  def regressions(results, min_aupr = DEFAULT_MIN_AUPR)
    regs = []
    Array(results).each do |r|
      { "nt_aupr" => r[:nt_aupr], "nr_aupr" => r[:nr_aupr] }.each do |metric, value|
        if value.nil?
          regs << { sample: r[:sample], metric: metric, value: nil, reason: "missing (benchmark produced no AUPR)" }
        elsif value < min_aupr
          regs << { sample: r[:sample], metric: metric, value: value, reason: "below floor #{min_aupr}" }
        end
      end
    end
    regs
  end

  # PASS iff no sample/metric regressed. Missing metrics fail.
  def report(results, min_aupr = DEFAULT_MIN_AUPR)
    regs = regressions(results, min_aupr)
    {
      overall: regs.empty? ? "PASS" : "FAIL",
      min_aupr: min_aupr,
      samples_checked: Array(results).size,
      regressions: regs,
      results: results,
    }
  end

  def pass?(results, min_aupr = DEFAULT_MIN_AUPR)
    regressions(results, min_aupr).empty? && Array(results).any?
  end
end
