# Biological AUPR gate for a taxonomy/index refresh (epic #548). Runs the benchmark against a
# CANDIDATE index and BLOCKS adoption if the NT/NR AUPR regresses below the floor vs the truth set --
# the check that a new lineage or a rebuilt NT/NR (incl. the core_nt swap) does not silently degrade
# classification. Hooks into the app-native BenchmarkWorkflowRun (CZID-580), which runs the benchmark
# WDL on the current dev SFN and computes AUPR via BenchmarkMetricsService.
#
# TWO WAYS TO RUN (the operator produces benchmarked pipeline runs on the candidate index first --
# a real sample run pinned to the candidate AlignmentConfig; that is the dev-validation step):
#
#   1. GATE completed benchmark runs (robust; benchmarks kicked off via the app):
#        rake 'taxonomy:benchmark_gate[101,102,103]'      # BenchmarkWorkflowRun ids
#      or  BENCHMARK_WR_IDS=101,102,103 rake taxonomy:benchmark_gate
#
#   2. CREATE + dispatch + poll + gate in one shot, from completed pipeline runs on the candidate:
#        BENCHMARK_SAMPLE_ID=42 BENCHMARK_USER_ID=1 \
#        RUN_TRUTH_PAIRS='9001=atcc_even_truth.json,9002=atcc_staggered_truth.json' \
#          rake taxonomy:benchmark_gate
#
# Options: MIN_AUPR (default 0.98) · POLL_TIMEOUT_S (default 10800 = 3h) · POLL_INTERVAL_S (default 60)
# · REPORT_ONLY=1 (print + exit 0).
require Rails.root.join("lib/taxonomy_benchmark_gate").to_s

namespace :taxonomy do
  desc "AUPR gate: benchmark a candidate index and block adoption on regression (biological gate)"
  task :benchmark_gate, [:wr_ids] => :environment do |_t, args|
    min_aupr = (ENV["MIN_AUPR"] || TaxonomyBenchmarkGate::DEFAULT_MIN_AUPR).to_f
    timeout_s = (ENV["POLL_TIMEOUT_S"] || "10800").to_i
    interval_s = (ENV["POLL_INTERVAL_S"] || "60").to_i
    terminal = [WorkflowRun::STATUS[:succeeded], WorkflowRun::STATUS[:succeeded_with_issue], WorkflowRun::STATUS[:failed]]

    # --- optionally CREATE + dispatch benchmark runs from candidate pipeline runs ---
    created_ids = []
    if ENV["RUN_TRUTH_PAIRS"].present?
      sample_id = ENV["BENCHMARK_SAMPLE_ID"].presence or abort("RUN_TRUTH_PAIRS needs BENCHMARK_SAMPLE_ID")
      user_id = ENV["BENCHMARK_USER_ID"].presence or abort("RUN_TRUTH_PAIRS needs BENCHMARK_USER_ID")
      wdl_version = AppConfigHelper.get_workflow_version(WorkflowRun::WORKFLOW[:benchmark])
      abort("no benchmark WDL version configured (AppConfig)") if wdl_version.blank?

      ENV["RUN_TRUTH_PAIRS"].split(",").each do |pair|
        run_id, truth = pair.split("=", 2)
        abort("bad RUN_TRUTH_PAIRS entry '#{pair}' (want run_id=truth_file)") if run_id.blank? || truth.blank?
        wr = BenchmarkWorkflowRun.create!(
          sample_id: sample_id.to_i, user_id: user_id.to_i,
          workflow: WorkflowRun::WORKFLOW[:benchmark], wdl_version: wdl_version,
          inputs_json: { run_ids: [run_id.to_i], workflow_benchmarked: WorkflowRun::WORKFLOW[:short_read_mngs],
                         ground_truth_file: truth }.to_json
        )
        wr.dispatch
        created_ids << wr.id
        puts "[benchmark_gate] dispatched BenchmarkWorkflowRun #{wr.id} for pipeline_run #{run_id} (truth #{truth})"
      end
    end

    wr_ids = (args[:wr_ids] || ENV["BENCHMARK_WR_IDS"]).to_s.split(/[,\s]+/).map(&:to_i).reject(&:zero?)
    wr_ids = (wr_ids + created_ids).uniq
    abort("taxonomy:benchmark_gate: no BenchmarkWorkflowRun ids (pass ids, BENCHMARK_WR_IDS, or RUN_TRUTH_PAIRS)") if wr_ids.empty?

    results = wr_ids.map do |id|
      wr = BenchmarkWorkflowRun.find(id)

      # Poll to terminal (actively refresh from SFN so we do not depend on the monitor cadence).
      waited = 0
      until terminal.include?(wr.status)
        abort("[benchmark_gate] BenchmarkWorkflowRun #{id} still #{wr.status} after #{timeout_s}s") if waited >= timeout_s
        sleep(interval_s)
        waited += interval_s
        begin
          wr.update_status
        rescue StandardError => e
          warn "  [WARN] update_status(#{id}) failed: #{e.message}"
        end
        wr.reload
      end

      metrics = (wr.status == WorkflowRun::STATUS[:failed]) ? {} : (BenchmarkMetricsService.call(wr) || {})
      sample_label = "wr#{id}:#{wr.get_input('ground_truth_file')}"
      { sample: sample_label, status: wr.status, nt_aupr: metrics[:nt_aupr], nr_aupr: metrics[:nr_aupr] }
    end

    report = TaxonomyBenchmarkGate.report(results, min_aupr)

    puts "\n=== taxonomy:benchmark_gate report (floor #{min_aupr}) ==="
    results.each do |r|
      puts format("  %-40s status=%-10s nt_aupr=%-8s nr_aupr=%-8s", r[:sample], r[:status],
                  r[:nt_aupr].nil? ? "MISSING" : r[:nt_aupr], r[:nr_aupr].nil? ? "MISSING" : r[:nr_aupr])
    end
    unless report[:regressions].empty?
      puts "  --- regressions ---"
      report[:regressions].each { |x| puts "  #{x[:sample]} #{x[:metric]} = #{x[:value].inspect} (#{x[:reason]})" }
    end
    puts "  OVERALL: #{report[:overall]}"

    if report[:overall] == "FAIL" && ENV["REPORT_ONLY"] != "1"
      abort("[taxonomy:benchmark_gate] FAIL -- candidate index regresses AUPR; not adoptable")
    end
  end
end
