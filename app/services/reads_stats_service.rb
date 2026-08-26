class ReadsStatsService
  include PipelineRunsHelper
  include Callable

  INITIAL_READS_STAT = "fastqs".freeze
  # the unidentified_fasta stats are not part of host filtering
  # the "subsampled" stat is actually a bool indicating whether or not subsampling happened
  BLOCKLIST = ["run_generate_unidentified_fasta", "unidentified_fasta", "subsampled"].freeze

  RUN_STAR = "star_out".freeze
  RUN_FASTP_OUT = "fastp_out".freeze
  ERCC = "ERCC".freeze
  FASTP_TOO_SHORT_READS = "fastp_too_short_reads".freeze
  FASTP_LOW_QUALITY_READS = "fastp_low_quality_reads".freeze
  FASTP_LOW_COMPLEXITY_READS = "fastp_low_complexity_reads".freeze

  MODERN_HOST_FILTER_STEP_NAME_TO_JOB_STAT_TASK_NAME = {
    "ercc_bowtie2_filter" => "bowtie2_ercc_filtered_out",
    "fastp_qc" => "fastp_out",
    "bowtie2_filter" => "bowtie2_host_filtered_out",
    "hisat2_filter" => "hisat2_host_filtered_out",
    "bowtie2_human_filter" => "bowtie2_human_filtered_out",
    "hisat2_human_filter" => "hisat2_human_filtered_out",
  }.freeze

  # The fallback path (empty representative step_statuses) labels and orders bands from each
  # sample's own JobStats. The non-fallback path humanizes the SFN step key, not the raw
  # JobStat task, so to match its labels the fallback translates tasks back to step keys via
  # the inverse of the map above before humanizing, and orders by a canonical sequence
  # derived from it -- keeping one ordered source of truth for both paths.
  JOB_STAT_TASK_NAME_TO_MODERN_HOST_FILTER_STEP_NAME = MODERN_HOST_FILTER_STEP_NAME_TO_JOB_STAT_TASK_NAME.invert.freeze

  FASTP_SUB_READS = [FASTP_LOW_QUALITY_READS, FASTP_TOO_SHORT_READS, FASTP_LOW_COMPLEXITY_READS].freeze

  # Canonical fallback order, derived from the modern-host-filter map's key order (which is
  # the pipeline step sequence). fastp_qc's slot holds the three sub-bands (what the
  # non-fallback substitutes) followed by the aggregate, so an older sample that only has the
  # aggregate still lands in fastp's position. validate_input / czid_dedup / subsampled
  # bracket the host-filter steps.
  FALLBACK_CANONICAL_STEP_ORDER = begin
    steps = MODERN_HOST_FILTER_STEP_NAME_TO_JOB_STAT_TASK_NAME.keys.dup
    steps[steps.index("fastp_qc"), 1] = FASTP_SUB_READS + ["fastp_qc"]
    ["validate_input_out", *steps, "czid_dedup_out", "subsampled_out"]
  end.freeze

  def initialize(samples)
    if samples.nil?
      Rails.logger.warn("ReadsStatsService call with samples = nil")
      samples = []
    end
    select_params = [:sample_id, :wdl_version, :pipeline_version, :pipeline_execution_strategy, :sfn_execution_arn, :technology]
    @viewable_pipeline_runs = get_succeeded_pipeline_runs_for_samples(samples, false, select_params)
    @viewable_pipeline_run_ids = @viewable_pipeline_runs.map(&:id)
    @sample_names = {}
    samples.each { |sample| @sample_names[sample.id] = sample.name }
  end

  def call
    reads_stats = get_job_stats(@viewable_pipeline_run_ids)
    step_orders = get_step_orders(@viewable_pipeline_runs)
    results = order_stats(@viewable_pipeline_runs, reads_stats, step_orders)
    results.each { |sample_id, stats| stats[:name] = @sample_names[sample_id] }
    return results
  end

  private

  # transform job stats query into hashmap
  def get_job_stats(pipeline_run_ids)
    reads_stats = {}
    job_stats = JobStat.where(pipeline_run_id: pipeline_run_ids).select(:task, :reads_after, :pipeline_run_id)
    job_stats.each do |stat|
      unless reads_stats.key?(stat.pipeline_run_id)
        reads_stats[stat.pipeline_run_id] = { steps: [], initialReads: nil }
      end
      if stat.task == INITIAL_READS_STAT
        reads_stats[stat.pipeline_run_id][:initialReads] = stat.reads_after
      # TODO(omar): Cleanup references of old host filtering stage after modern host filtering launches.
      elsif stat.task == RUN_STAR
        # If there are ERCC reads, separate them from host filtering reads.
        pr = PipelineRun.find(stat.pipeline_run_id)
        ercc_counts = pr.total_ercc_reads
        if ercc_counts.present?
          reads_stats[stat.pipeline_run_id][:steps].push(name: ERCC, reads_after: pr.total_reads - ercc_counts)
        end
        reads_stats[stat.pipeline_run_id][:steps].push(name: stat.task, reads_after: stat.reads_after)
      elsif stat.task == RUN_FASTP_OUT
        pr = PipelineRun.find(stat.pipeline_run_id)
        ercc_counts = pr.total_ercc_reads
        if ercc_counts.present?
          reads_after_fastp_complexity = pr.job_stats.find_by(task: FASTP_LOW_COMPLEXITY_READS)&.reads_after
          if reads_after_fastp_complexity
            reads_stats[stat.pipeline_run_id][:steps].push(name: ERCC, reads_after: reads_after_fastp_complexity - pr.total_ercc_reads)
          end
        end
        reads_stats[stat.pipeline_run_id][:steps].push(name: stat.task, reads_after: stat.reads_after)
      elsif !BLOCKLIST.include?(stat.task)
        reads_stats[stat.pipeline_run_id][:steps].push(name: stat.task, reads_after: stat.reads_after)
      end
    end
    return reads_stats
  end

  # get all possible step orders
  def get_step_orders(pipeline_runs)
    step_orders = {}
    unique_versions = Set.new(pipeline_runs.map { |pr| [pr.wdl_version, pr.pipeline_version] })
    unique_versions.each do |uniq|
      representative_run = pipeline_runs.find { |pr| uniq == [pr.wdl_version, pr.pipeline_version] }
      ordered_tasks = representative_run.host_filtering_stage&.step_statuses&.keys || []

      # Make sure to include ERCC as a step.
      if ordered_tasks.present?
        star_index = ordered_tasks.find_index(RUN_STAR)
        ordered_tasks.insert(star_index, ERCC) if star_index

        if pipeline_version_uses_new_host_filtering_stage(representative_run.pipeline_version)
          fastp_index = ordered_tasks.find_index("fastp_qc")

          if fastp_index
            ordered_tasks.delete_at(fastp_index)
            # v8.1 samples need to have ERCCs manually inserted into the step order becuase theyre calculated after quality filtering as part of the bowtie2 host filtering step.
            # v8.2 samples have ERCCs automatically inserted into the step order because the ERCCs are calculated before quality filtering in it's own pipeline step.
            !pipeline_version_calculates_erccs_before_quality_filtering(representative_run.pipeline_version) && ordered_tasks.insert(fastp_index, ERCC)
            ordered_tasks.insert(fastp_index, FASTP_LOW_COMPLEXITY_READS)
            ordered_tasks.insert(fastp_index, FASTP_TOO_SHORT_READS)
            ordered_tasks.insert(fastp_index, FASTP_LOW_QUALITY_READS)
          end
        end
      end

      # save in step_orders hash according to [wdl_version][pipeline_version]
      # uses 'to_s' because some values may be nil
      wdl_version = representative_run.wdl_version.to_s
      pipeline_version = representative_run.pipeline_version.to_s
      unless step_orders.key?(wdl_version)
        step_orders[wdl_version] = {}
      end
      step_orders[wdl_version][pipeline_version] = ordered_tasks
    end
    return step_orders
  end

  # order stats for each sample
  def order_stats(pipeline_runs, reads_stats, step_orders)
    results = {}
    pipeline_runs.each do |pr|
      stats_hash = reads_stats[pr.id]
      stats_hash[:sampleId] = pr.sample_id

      wdl_version = pr.wdl_version.to_s
      stats_hash[:wdlVersion] = wdl_version
      pipeline_version = pr.pipeline_version.to_s
      stats_hash[:pipelineVersion] = pipeline_version

      step_order = step_orders[wdl_version][pipeline_version]
      stats_hash[:steps] =
        if step_order.count.zero?
          canonical_fallback_steps(stats_hash[:steps])
        else
          step_order.map do |step|
            step_stats = stats_hash[:steps].find do |step_hash|
              step_name_to_step_hash_name = MODERN_HOST_FILTER_STEP_NAME_TO_JOB_STAT_TASK_NAME[step] || step
              step_hash[:name] == step_name_to_step_hash_name
            end

            unless step_stats.nil?
              { name: StringUtil.humanize_step_name(step), readsAfter: step_stats[:reads_after] }
            end
          end.compact
        end
      results[pr.sample_id] = stats_hash
    end
    return results
  end

  # Build the fallback band list from a sample's own JobStats when no representative step
  # order is available. Mirrors the non-fallback output: canonical labels, a single ERCC
  # band, no stray aggregate fastp band, and pipeline order.
  def canonical_fallback_steps(steps)
    # Drop the aggregate fastp_out band when the three sub-bands are present. Older samples
    # only have the aggregate, so keep it when the sub-bands are absent.
    if FASTP_SUB_READS.all? { |task| steps.any? { |s| s[:name] == task } }
      steps = steps.reject { |s| s[:name] == RUN_FASTP_OUT }
    end

    # Keep a single ERCC band. bowtie2_ercc_filtered_out and the synthetic ERCC constant both
    # resolve to the "ERCC" label; the non-fallback keeps the bowtie2_ercc_filtered_out band
    # for pipeline >= 8.2, so drop the synthetic one when it is present.
    #
    # NOTE: get_job_stats pushes the synthetic ERCC band whenever total_ercc_reads.present?,
    # and in Ruby `0.present?` is TRUE -- so a run with zero ERCC reads still carries this
    # band. That is intentional and not a bug to "fix" on the push side; dropping it here is
    # exactly what makes the fallback match the non-fallback path for >= 8.2.
    if steps.any? { |s| s[:name] == "bowtie2_ercc_filtered_out" }
      steps = steps.reject { |s| s[:name] == ERCC }
    end

    # Label each band via its step key (as the non-fallback path humanizes it) and order by
    # canonical pipeline position. Unrecognized tasks (legacy STAR/gsnap, nanopore
    # *_reads/_bases) are appended in reads_after DESC order so they still render.
    keyed = steps.map do |s|
      { key: JOB_STAT_TASK_NAME_TO_MODERN_HOST_FILTER_STEP_NAME[s[:name]] || s[:name], reads_after: s[:reads_after] }
    end
    known, unknown = keyed.partition { |s| FALLBACK_CANONICAL_STEP_ORDER.include?(s[:key]) }
    ordered = known.sort_by { |s| FALLBACK_CANONICAL_STEP_ORDER.index(s[:key]) } +
              unknown.sort_by { |s| -(s[:reads_after] || 0) }
    ordered.map { |s| { name: StringUtil.humanize_step_name(s[:key]), readsAfter: s[:reads_after] } }
  end
end
