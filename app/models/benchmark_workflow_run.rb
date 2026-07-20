class BenchmarkWorkflowRun < WorkflowRun
  # Ground-truth truth-file location for benchmark runs (CZID-580). Historically hardcoded to the
  # CZI-owned public idseq-bench bucket. Mirror the S3_DATABASE_BUCKET pattern: allow an ENV override
  # so operators can repoint to a UCSF-owned bucket without a code change. The default is kept for
  # back-compatibility; when S3_TRUTH_FILES_BUCKET is set, the ENV value wins.
  AWS_S3_TRUTH_FILES_BUCKET = ENV.fetch("S3_TRUTH_FILES_BUCKET", "s3://idseq-bench/datasets/truth_files/").freeze

  OUTPUT_BENCHMARK_HTML_TEMPLATE = "benchmark.%<workflow_name>s_benchmark.benchmark_html".freeze
  OUTPUT_BENCHMARK_TRUTH_NT_TEMPLATE = "benchmark.%<workflow_name>s_benchmark.truth_nt".freeze
  OUTPUT_BENCHMARK_TRUTH_NR_TEMPLATE = "benchmark.%<workflow_name>s_benchmark.truth_nr".freeze
  OUTPUT_BENCHMARK_CORRELATION_TEMPLATE = "benchmark.%<workflow_name>s_benchmark.correlation".freeze

  def results(cacheable_only: false)
    results = {
      "benchmark_metrics" => parsed_cached_results&.[]("benchmark_metrics") || benchmark_metrics,
      "benchmark_info" => parsed_cached_results&.[]("benchmark_info") || benchmark_info,
      # Store additional info about the runs used in the benchmark.
      # In the case that a run gets deleted, we can still refer to this info for benchmark results.
      "additional_info" => parsed_cached_results&.[]("additional_info") || additional_info,
    }

    unless cacheable_only
      results["benchmark_html_report"] = benchmark_html_report
    end

    results
  end

  def get_output_name(output_template)
    format(output_template, workflow_name: inputs&.[]("workflow_benchmarked")&.underscore)
  end

  private

  def benchmark_metrics
    BenchmarkMetricsService.call(self)
  rescue StandardError => exception
    LogUtil.log_error(
      "Error loading benchmark metrics",
      exception: exception,
      workflow_run_id: id
    )
    return nil
  end

  def benchmark_html_report
    output_name = get_output_name(OUTPUT_BENCHMARK_HTML_TEMPLATE)
    output(output_name)
  end

  def benchmark_info
    return {
      workflow: inputs&.[]("workflow_benchmarked"),
      ground_truth_file: inputs&.[]("ground_truth_file"),
    }
  end

  def additional_info
    if WorkflowRun::MNGS_WORKFLOWS.include?(inputs&.[]("workflow_benchmarked"))
      additional_mngs_info
    else
      {}
    end
  end

  def additional_mngs_info
    run_ids = inputs&.[]("run_ids")
    # A benchmark can be persisted with partial/malformed inputs (inputs nil, or no
    # "run_ids" key). Degrade to an empty hash rather than NoMethodError on nil.each_with_object.
    return {} if run_ids.blank?

    info = run_ids.each_with_object({}) do |run_id, result|
      pr = PipelineRun.find(run_id)
      sample_id = pr&.sample&.id

      result[sample_id] = {
        sample_name: pr&.sample&.name,
        run_id: run_id,
        # Since only two samples can be used for benchmarking, we can just check if the current run is the first or second.
        # The second run_id will be the REF for benchmarking
        is_ref: run_id == run_ids.second,
        pipeline_version: pr&.pipeline_version,
        ncbi_index_version: pr&.alignment_config&.name,
      }
    end
    info
  end
end
