class WorkflowRunsController < ApplicationController
  include SamplesHelper
  include ParameterSanitization
  include PipelineOutputsHelper
  include WorkflowRunsFetching

  before_action :set_workflow_run, only: [:show, :results, :zip_link, :amr_report_downloads, :amr_gene_level_downloads, :cg_report_downloads, :benchmark_report_downloads]
  # rerun is owner-scoped (creator or admin), enforced inline after set_workflow_run -- not
  # admin-only. See CZID-676 Phase C.

  MAX_PAGE_SIZE = 100
  # Soft cap: at most this many owner-triggered re-runs per sample+workflow per 24h. Admins exempt.
  WORKFLOW_RERUN_DAILY_LIMIT = 3
  CLADE_FASTA_S3_KEY = "clade_exports/fastas/temp-%{path}".freeze
  CLADE_REFERENCE_TREE_S3_KEY = "clade_exports/trees/temp-%{path}".freeze
  CLADE_EXTERNAL_SITE = "clades.nextstrain.org".freeze

  def index
    permitted_params = index_params

    filters = permitted_params.slice(:search, :host, :locationV2, :tissue, :projectId, :visibility, :time, :workflow, :taxon, :sampleIds, :workflowRunIds)

    response = discovery_workflow_runs(
      domain: permitted_params[:domain],
      filters: filters,
      mode: permitted_params[:mode] || "basic",
      order_by: permitted_params[:orderBy],
      order_dir: permitted_params[:orderDir],
      offset: permitted_params[:offset] ? permitted_params[:offset].to_i : 0,
      limit: permitted_params[:limit] ? permitted_params[:limit].to_i : WorkflowRunsController::MAX_PAGE_SIZE,
      list_all_ids: ActiveModel::Type::Boolean.new.cast(permitted_params[:listAllIds])
    )

    render(
      json: response.to_json,
      status: :ok
    )
  end

  def show
    render(
      json: @workflow_run.as_json,
      status: :ok
    )
  end

  def results
    render(
      json: @workflow_run.results,
      status: :ok
    )
  rescue NameError
    render(
      json: { status: "Workflow Run action not supported" },
      status: :not_found
    )
  rescue SfnExecution::SfnDescriptionNotFoundError => e
    # The run's Step Functions execution description isn't available (e.g. the run never finalized, or
    # its SFN history/output is missing in S3). Surface a graceful "results not available" state rather
    # than raising a 500 on the report/pipeline_viz view. (#385)
    LogUtil.log_error(
      "Workflow run results unavailable: SFN execution description not found",
      exception: e,
      workflow_run_id: @workflow_run&.id
    )
    render(
      json: { status: "Results not available" },
      status: :not_found
    )
  end

  def rerun
    wr_id = params[:id]
    set_workflow_run
    return if @workflow_run.nil? # set_workflow_run already rendered a 404

    unless current_user.admin? || @workflow_run.user_id == current_user.id
      render json: { status: "error", message: "Only the original uploader can re-run this." }, status: :unauthorized
      return
    end

    unless current_user.admin? || workflow_rerun_under_daily_cap?(@workflow_run)
      render json: {
        status: "error",
        message: "This sample has reached its daily re-run limit (#{WORKFLOW_RERUN_DAILY_LIMIT}). " \
                 "Please try again later, or use Report to our team if it keeps failing.",
      }, status: :too_many_requests
      return
    end

    @workflow_run.rerun
    render json: { status: "success" }, status: :ok
  rescue StandardError => e
    LogUtil.log_error("Rerun trigger failed", exception: e, workflow_id: wr_id)
    render json: {
      status: "error",
      message: e.message,
    }, status: :ok
  end

  # POST /workflow_runs/validate_workflow_run_ids
  #
  # Validate access to workflow_run ids, and that the workflow_runs
  # have completed and succeeded processing.
  # Filters out workflow_runs that the user does not have read access to or are deprecated.
  #
  # Returns a list of valid workflow_run ids and the names of the samples that the workflow_runs the
  # user does not have access to
  #
  # This is a POST route and not a GET request because Puma does not allow
  # query strings longer than a certain amount (1024 * 10 chars), which causes
  # trouble when a large amount of workflow run ids are specified.
  def validate_workflow_run_ids
    permitted_params = params.permit(:workflow, workflowRunIds: [])

    validated_workflow_runs_info = WorkflowRunValidationService.call(query_ids: permitted_params[:workflowRunIds], current_user: current_user)
    viewable_workflow_runs = validated_workflow_runs_info[:viewable_workflow_runs]

    if validated_workflow_runs_info[:error].nil?
      valid_workflow_run_ids = viewable_workflow_runs.by_workflow(permitted_params[:workflow]).active.pluck(:id)
      invalid_workflow_runs = viewable_workflow_runs.reject { |wr| valid_workflow_run_ids.include?(wr.id) }

      invalid_sample_ids = invalid_workflow_runs.map(&:sample_id).uniq
      invalid_sample_names = current_power.samples.where(id: invalid_sample_ids).pluck(:name)

      render(
        json: {
          validIds: valid_workflow_run_ids,
          invalidSampleNames: invalid_sample_names,
          error: nil,
        },
        status: :ok
      )
    else
      render(
        json: {
          validWorkflowRunIds: [],
          invalidSampleNames: [],
          error: validated_workflow_runs_info[:error],
        },
        status: :ok
      )
    end
  end

  # POST /workflow_runs/workflow_runs_info
  # Returns sample and taxon information for the given workflow runs.
  # This method uses POST because hundreds of workflowRunIds can be passed.
  def workflow_runs_info
    permitted_params = params.permit(workflowRunIds: [])
    workflow_run_ids = permitted_params[:workflowRunIds]

    workflow_run_info = current_power.workflow_runs.joins(:sample).select(
      "samples.project_id as project_id,
      samples.name as name,
      samples.user_id as user_id,
      workflow_runs.id as id,
      workflow_runs.inputs_json"
    )
                                     .where(id: workflow_run_ids).map do |workflow_run|
      { id: workflow_run.id,
        name: workflow_run.name,
        projectId: workflow_run.project_id,
        taxonName: JSON.parse(workflow_run.inputs_json)["taxon_name"],
        creationSource: JSON.parse(workflow_run.inputs_json)["creation_source"],
        userId: workflow_run.user_id, }
    end

    render(
      json: {
        workflowRunInfo: workflow_run_info,
      },
      status: :ok
    )
  end

  # POST /workflow_runs/metadata_fields
  def metadata_fields
    permitted_params = params.permit(workflowRunIds: [])
    workflow_run_ids = permitted_params[:workflowRunIds]
    sample_ids = current_power.workflow_runs.where(id: workflow_run_ids).pluck(:sample_id).uniq

    samples = current_power.viewable_samples.where(id: sample_ids)
    results = MetadataField.by_samples(samples)

    render json: results
  end

  # POST /workflow_runs/created_by_current_user
  # Returns whether all workflow runs were created by the current user.
  # This method uses POST because hundreds of workflowRunIds can be passed.
  def created_by_current_user
    permitted_params = params.permit(workflowRunIds: [])
    workflow_runs = current_power.workflow_runs.created_by(current_user).where(id: permitted_params[:workflowRunIds])

    render(
      json: {
        created_by_current_user: permitted_params[:workflowRunIds].length == workflow_runs.length,
      },
      status: :ok
    )
  end

  # Top-level zipped pipeline results
  def zip_link
    path = @workflow_run.zip_link
    if path
      redirect_to path
    else
      render(
        json: { status: "Output not available" },
        status: :not_found
      )
    end
  end

  # POST /workflow_runs/consensus_genome_clade_export
  # Generates a link that allows the exportation of consensus genomes to Nextclade.
  # TODO: If more Consensus Genome specific controller methods are needed in the future,
  # export to a new ConsensusGenomeWorkflowRunsController.
  def consensus_genome_clade_export
    permitted_params = params.permit(:referenceTree, workflowRunIds: [])
    workflow_run_ids = permitted_params[:workflowRunIds]
    # order(:id): Postgres does not guarantee row order without ORDER BY (MySQL
    # implicitly returned PK order); keep workflow_run_ids deterministic.
    workflow_runs = current_power.workflow_runs.where(id: workflow_run_ids).consensus_genomes.active.order(:id)

    # Remove the line below if generalizing beyond SARS-CoV-2. Accept either SARS-CoV-2
    # reference accession (GenBank MN908947.3 or RefSeq NC_045512.2) -- both are the same
    # Wuhan-Hu-1 genome and align to Nextclade's sars-cov-2 dataset.
    workflow_runs = workflow_runs.select { |wr| ConsensusGenomeWorkflowRun::SARS_COV_2_ACCESSION_IDS.include?(wr.get_input("accession_id")) }
    workflow_run_ids = workflow_runs.pluck(:id)

    if workflow_run_ids.empty?
      render(
        json: { status: "No valid WorkflowRuns" },
        status: :bad_request
      ) and return
    end

    # Concatenate the fastas, upload to S3, and generate a presigned link.
    content = ConsensusGenomeConcatService.call(workflow_run_ids)
    key = format(CLADE_FASTA_S3_KEY, path: SecureRandom.alphanumeric(5))
    S3Util.upload_to_s3(SAMPLES_BUCKET_NAME, key, content)
    fasta_url = get_presigned_s3_url(bucket_name: SAMPLES_BUCKET_NAME, key: key, duration: 300)

    # Generate the external URL.
    options = { "input-fasta": fasta_url, "dataset-name": "sars-cov-2" }
    # If a reference tree file was provided, upload to s3 and generate a presigned link.
    if permitted_params[:referenceTree].present?
      tree_key = format(CLADE_REFERENCE_TREE_S3_KEY, path: SecureRandom.alphanumeric(5))
      tree_contents = permitted_params[:referenceTree]
      S3Util.upload_to_s3(SAMPLES_BUCKET_NAME, tree_key, tree_contents)
      tree_url = get_presigned_s3_url(bucket_name: SAMPLES_BUCKET_NAME, key: tree_key, duration: 300)
      options["input-tree"] = tree_url
    end
    external_url = URI::HTTPS.build(host: CLADE_EXTERNAL_SITE, query: options.to_query)

    # Ensure data export is logged and attributed.
    event_name = "WorkflowRunsController_clade_exported"
    MetricUtil.log_analytics_event(event_name, current_user, { sample_ids: workflow_runs&.pluck(:sample_id)&.uniq || [], workflow_run_ids: workflow_run_ids || [] }, request)
    Rails.logger.info("#{event_name} by user #{current_user.id} for workflow runs (#{workflow_run_ids})")

    # We call JSON.generate explicitly here so that "&input-tree=" doesn't get
    # encoded into "\u0026input-tree=" by .to_json.
    render(
      json: JSON.generate({ external_url: external_url }),
      status: :ok
    )
  rescue StandardError => e
    message = "Unexpected error in clade export generation"
    LogUtil.log_error(message, exception: e, workflow_run_ids: workflow_run_ids)
    render(
      json: { status: message },
      status: :internal_server_error
    )
  end

  # AMR pipeline outputs that are available for download directly from the AMR sample report
  def amr_report_downloads
    permitted_params = params.permit(:downloadType)
    download_type = permitted_params[:downloadType]
    sample_name = @workflow_run.sample.name

    case download_type
    when "comprehensive_amr_metrics_tsv"
      s3_path = @workflow_run.output_path(@workflow_run.workflow_by_class.class::OUTPUT_COMPREHENSIVE_AMR_METRICS_TSV)
      filename = "comprehensive_amr_metrics.tsv"
    when "non_host_reads"
      s3_path = @workflow_run.output_path(@workflow_run.workflow_by_class.class::OUTPUT_NON_HOST_READS)
      filename = "non_host_reads.fasta"
    when "non_host_contigs"
      s3_path = @workflow_run.output_path(@workflow_run.workflow_by_class.class::OUTPUT_NON_HOST_CONTIGS)
      filename = "contigs.fasta"
    when "zip_link"
      s3_path = @workflow_run.output_path(@workflow_run.workflow_by_class.class::OUTPUT_ZIP)
      filename = "outputs.zip"
    when "report_csv"
      send_data AmrReportDataService.call(@workflow_run, csv: true), filename: @workflow_run.sample.name + '_report.csv'
      return
    else
      render(
        json: { status: "Output not found" },
        status: :not_found
      )
    end

    if s3_path.present? && filename.present?
      presigned_url = get_presigned_s3_url(s3_path: s3_path, filename: "#{sample_name}_#{@workflow_run.id}_#{filename}")

      if presigned_url
        redirect_to presigned_url
      else
        render(
          json: { status: "Output not available" },
          status: :not_found
        )
      end
    end
  rescue SfnExecution::SfnDescriptionNotFoundError => e
    # Orphaned/incomplete run: its Step Functions execution description is missing from S3, so
    # no output paths exist. Treat as "no results" and return a graceful 404 instead of raising
    # a 500 to Sentry. Mirrors the WorkflowRunsController#results guard from #385 (#546).
    LogUtil.log_error(
      "AMR report download unavailable: SFN execution description not found",
      exception: e,
      workflow_run_id: @workflow_run&.id
    )
    render(json: { status: "Output not available" }, status: :not_found)
  end

  def benchmark_report_downloads
    permitted_params = params.permit(:downloadType)
    download_type = permitted_params[:downloadType]
    sample_name = @workflow_run.sample.name
    @workflow_run = @workflow_run.workflow_by_class

    case download_type
    when "report_html"
      output_name = @workflow_run.get_output_name(BenchmarkWorkflowRun::OUTPUT_BENCHMARK_HTML_TEMPLATE)
      s3_path = @workflow_run.output_path(output_name)
      filename = "benchmark.html"
    when "report_ipynb"
      output_name = @workflow_run.get_output_name(BenchmarkWorkflowRun::OUTPUT_BENCHMARK_NOTEBOOK)
      s3_path = @workflow_run.output_path(output_name)
      filename = "benchmark_notebook.ipynb"
    else
      render(
        json: { status: "Output not found" },
        status: :not_found
      )
    end

    if s3_path.present? && filename.present?
      presigned_url = get_presigned_s3_url(s3_path: s3_path, filename: "#{sample_name}_#{@workflow_run.id}_#{filename}")

      if presigned_url
        redirect_to presigned_url
      else
        render(
          json: { status: "Output not available" },
          status: :not_found
        )
      end
    end
  rescue SfnExecution::SfnDescriptionNotFoundError => e
    # Orphaned/incomplete run: its Step Functions execution description is missing from S3, so
    # no output paths exist. Treat as "no results" and return a graceful 404 instead of raising
    # a 500 to Sentry. Mirrors the WorkflowRunsController#results guard from #385 (#546).
    LogUtil.log_error(
      "Benchmark report download unavailable: SFN execution description not found",
      exception: e,
      workflow_run_id: @workflow_run&.id
    )
    render(json: { status: "Output not available" }, status: :not_found)
  end

  def amr_gene_level_downloads
    permitted_params = params.permit(:downloadType, :indexId, :geneName)
    download_type = permitted_params[:downloadType]
    # index_id is a gene id for reads and an ARO accession for contigs
    index_id = permitted_params[:indexId]
    gene_name = permitted_params[:geneName]
    case download_type
    when "download-contigs"
      file = @workflow_run.download_gene_level_contigs(index_id)
    when "download-reads"
      file = @workflow_run.download_gene_level_reads(index_id)
    else
      render(
        json: { status: "Output not found" },
        status: :not_found
      )
    end
    send_file(file, filename: "amr-#{download_type}-#{gene_name}.fasta")
  end

  def cg_report_downloads
    permitted_params = params.permit(:downloadType)
    download_type = permitted_params[:downloadType]
    sample_name = @workflow_run.sample.name

    case download_type
    when "ref_fasta"
      s3_path = @workflow_run.sample.input_files.reference_sequence[0]&.s3_path
      filename = @workflow_run.inputs&.[]("ref_fasta")
    else
      render(
        json: { status: "File not found" },
        status: :not_found
      ) and return

    end

    presigned_url = nil
    if s3_path.present? && filename.present?
      presigned_url = get_presigned_s3_url(s3_path: s3_path, filename: "#{sample_name}_#{@workflow_run.id}_#{filename}")
    end

    render(
      json: {
        url: presigned_url,
      },
      status: :ok
    )
  end

  private

  # Soft rate-limit: at most WORKFLOW_RERUN_DAILY_LIMIT workflow runs created for this
  # sample+workflow in the last 24h (each re-run creates one). Admins are exempt at the caller.
  def workflow_rerun_under_daily_cap?(workflow_run)
    workflow_run.sample.workflow_runs
                .where(workflow: workflow_run.workflow)
                .where("created_at > ?", 24.hours.ago)
                .count < WORKFLOW_RERUN_DAILY_LIMIT
  end

  def set_workflow_run
    workflow_run = current_power.workflow_runs.find(params[:id])
    workflow_class = WorkflowRun::WORKFLOW_CLASS[workflow_run.workflow]
    @workflow_run = workflow_class ? workflow_run.becomes(workflow_class) : workflow_run
  rescue ActiveRecord::RecordNotFound
    @workflow_run = nil
    render(
      json: { status: "Workflow Run not found" },
      status: :not_found
    )
  end

  def index_params
    params.permit(:domain, :mode, :offset, :limit, :orderBy, :orderDir, :listAllIds, :search, :projectId, :visibility, :workflow, host: [], time: [], locationV2: [], tissue: [], taxon: [], sampleIds: [], workflowRunIds: [])
  end
end
