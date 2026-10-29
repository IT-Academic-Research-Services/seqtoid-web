# Shared discovery-view workflow-run fetch/sort/paginate/serialize pipeline.
#
# Extracted from WorkflowRunsController#index (CZID-285) so the Rails REST endpoint
# (/workflow_runs.json) and the Rails-native GraphQL resolvers that are replacing the
# federation's fed* discovery ops run the SAME code and return byte-identical data.
# Behavior is unchanged for the controller — the methods keep their names and logic.
#
# Hosts that include this concern must provide `current_user`, `current_power`,
# `sanitize_order_dir` (ParameterSanitization), and the SamplesHelper methods
# `fetch_samples` / `sample_uploader` / `get_visibility_by_sample_id` /
# `get_result_status_description_for_errored_sample`.
module WorkflowRunsFetching
  extend ActiveSupport::Concern

  # The full discovery-view pipeline, exactly as WorkflowRunsController#index ran it:
  # fetch the domain/filter-scoped runs, apply the sorting_v0-gated ordering, paginate,
  # and serialize via format_workflow_runs. Returns { workflow_runs: [...] } plus
  # all_workflow_run_ids when requested — the same shape the REST endpoint renders.
  def discovery_workflow_runs(domain:, filters:, mode:, order_by:, order_dir:, offset:, limit:, list_all_ids: false)
    workflow_runs = fetch_workflow_runs(domain: domain, filters: filters)

    sorting_v0_allowed = current_user.allowed_feature?("sorting_v0_admin") ||
                         (current_user.allowed_feature?("sorting_v0") && domain == "my_data")

    effective_order_by = if sorting_v0_allowed
                           order_by || "createdAt"
                         else
                           :id
                         end
    effective_order_dir = sanitize_order_dir(order_dir, :desc)

    workflow_runs = if sorting_v0_allowed
                      WorkflowRun.sort_workflow_runs(workflow_runs, effective_order_by, effective_order_dir)
                    else
                      workflow_runs.order(Hash[effective_order_by => effective_order_dir])
                    end

    paginated_workflow_runs = paginate_workflow_runs(
      workflow_runs: workflow_runs,
      offset: offset,
      limit: limit
    )

    formatted_workflow_runs = format_workflow_runs(workflow_runs: paginated_workflow_runs, mode: mode)

    {}.tap do |resp|
      resp[:workflow_runs] = formatted_workflow_runs
      resp[:all_workflow_run_ids] = workflow_runs.pluck(:id) if list_all_ids
    end
  end

  def fetch_workflow_runs(domain:, filters: {})
    sample_filters = filters.slice(:search, :host, :locationV2, :tissue, :projectId, :visibility, :sampleIds)
    workflow_run_filters = filters.slice(:workflow, :time, :taxon, :workflowRunIds)

    samples = fetch_samples(domain: domain, filters: sample_filters)
    samples_workflow_runs = current_power.samples_workflow_runs(samples).non_deprecated.non_deleted

    filter_workflow_runs(workflow_runs: samples_workflow_runs, filters: workflow_run_filters)
  end

  def format_workflow_runs(workflow_runs:, mode: "basic")
    return [] if workflow_runs.empty?

    should_include_sample_info = mode == "with_sample_info"
    if should_include_sample_info
      sample_ids = workflow_runs.pluck(:sample_id).uniq
      sample_attributes = [:id, :created_at, :host_genome_name, :name, :private_until, :project_id, :sample_notes]
      metadata_by_sample_id = Metadatum.by_sample_ids(sample_ids)
      samples_visibility_by_sample_id = get_visibility_by_sample_id(sample_ids)
      workflow_runs = workflow_runs.includes(:user, sample: [:host_genome, :project, :user])
    else
      workflow_runs = workflow_runs.includes(:user)
    end

    formatted_workflow_runs = workflow_runs.reduce([]) do |formatted_wrs, wr|
      formatted_wrs << {}.tap do |formatted_wr|
        formatted_wr[:id] = wr.id
        formatted_wr[:workflow] = wr.workflow
        formatted_wr[:runner] = {
          name: wr&.user&.name,
          id: wr&.user_id,
        }
        formatted_wr[:wdl_version] = wr.wdl_version
        formatted_wr[:created_at] = wr.created_at
        formatted_wr[:status] = wr.display_status
        formatted_wr[:cached_results] = wr.parsed_cached_results

        formatted_wr[:inputs] = {}.tap do |wr_info|
          if wr.workflow == WorkflowRun::WORKFLOW[:consensus_genome]
            wr_inputs = ["accession_id", "accession_name", "medaka_model", "taxon_name", "technology", "wetlab_protocol", "ref_fasta", "primer_bed", "creation_source"].index_with { |i| wr.get_input(i) }
            wr_inputs["taxon_name"] = TaxonLineage.where(taxid: wr.get_input("taxon_id")).order(:version_start).last&.tax_name
            wr_info.merge!(wr_inputs)
            wr_info[:technology] = ConsensusGenomeWorkflowRun::TECHNOLOGY_NAME[wr_inputs["technology"]]&.capitalize
          end
        end

        formatted_wr[:sample] = {}.tap do |formatted_sample|
          if should_include_sample_info
            wr_sample = wr.sample
            formatted_sample[:info] = wr_sample.slice(sample_attributes)
            formatted_sample[:info][:public] = samples_visibility_by_sample_id[wr_sample.id]
            result_status_description = get_result_status_description_for_errored_sample(wr_sample) if wr_sample.upload_error.present?
            formatted_sample[:info].merge!(result_status_description) if result_status_description.present?
            formatted_sample[:metadata] = metadata_by_sample_id[wr_sample.id]
            formatted_sample[:project_name] = wr_sample.project.name
            formatted_sample[:uploader] = sample_uploader(wr_sample)
          else
            formatted_sample[:info] = { id: wr.sample_id }
          end
        end
      end
    end

    formatted_workflow_runs
  end

  def filter_workflow_runs(workflow_runs:, filters: {})
    if filters.present?
      time = filters[:time]
      workflow = filters[:workflow]
      taxon_id = filters[:taxon]
      workflow_run_ids = filters[:workflowRunIds]

      workflow_runs = workflow_runs.where(id: workflow_run_ids) if workflow_run_ids.present?
      workflow_runs = workflow_runs.by_time(start_date: Date.parse(time[0]), end_date: Date.parse(time[1])) if time.present?
      workflow_runs = workflow_runs.by_workflow(workflow) if workflow.present?
      # At the moment, filtering workflows by taxon is only supported for consensus genome
      workflow_runs = workflow_runs.by_taxon(taxon_id) if taxon_id.present? && workflow == WorkflowRun::WORKFLOW[:consensus_genome]
    end

    workflow_runs
  end

  def paginate_workflow_runs(workflow_runs:, offset: 0, limit: WorkflowRunsController::MAX_PAGE_SIZE)
    workflow_runs.offset(offset).limit(limit)
  end
end
