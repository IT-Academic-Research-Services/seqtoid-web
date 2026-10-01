# This is a class of static helper methods for generating data for the heatmap
# visualization. See HeatmapElasticsearchHelperTest.
# See selectedOptions in SamplesHeatmapView for client-side defaults, and
# heatmap action in VisualizationsController.
class TopTaxonsElasticsearchService
  include Callable
  include ElasticsearchQueryHelper
  include HeatmapHelper

  # Based on the trade-off between performance and information quantity, we
  # decided on 10 as the best default number of taxons to show per sample.
  DEFAULT_MAX_NUM_TAXONS = 10
  DEFAULT_TAXON_SORT_PARAM = "highest_nt_rpm".freeze
  MINIMUM_READ_THRESHOLD = 1

  def initialize(
    params:,
    samples_for_heatmap:,
    background_for_heatmap:
  )
    @params = params
    @samples = samples_for_heatmap
    @should_remove_zscore = background_for_heatmap.nil?
    @background_id = background_for_heatmap || resolve_default_background
  end

  # The configured default background when it exists in this environment, else the first public one.
  # (SMP-1789; shared with the pipeline-finalize indexing via HeatmapIndexing.)
  def resolve_default_background
    HeatmapIndexing.default_background_id
  end

  def call
    return generate
  end

  # Samples and background are assumed here to be vieweable.
  def generate
    return {} if @samples.empty?

    filter_param = build_filter_param_hash

    pr_id_to_sample_id = HeatmapHelper.get_latest_pipeline_runs_for_samples(@samples)

    # Index only runs that can be indexed: finished successfully and Illumina. A run still loading results
    # (or failed, or ONT) would otherwise sit "missing" forever and be re-enqueued on every view.
    indexable_run_ids = HeatmapIndexing.indexable_run_ids(pr_id_to_sample_id.keys)

    # Kick off any needed (re)indexing asynchronously (async: true) so the request returns immediately
    # instead of blocking on the taxon-indexing lambda (SMP-1788). Each missing (background, run) is queued
    # at most once until its job finishes (HeatmapIndexing). The client's automatic status polls send
    # indexingPoll=true and only check, never enqueue.
    incomplete_run_ids = ElasticsearchQueryHelper.update_es_for_missing_data(
      filter_param[:background_id],
      indexable_run_ids,
      async: true,
      enqueue: !indexing_poll?
    )

    # Serve the heatmap only when every requested run is completely indexed for this background. A run that
    # is not complete is either queued or mid-index, and querying it would render missing or partial
    # abundance for its sample (SMP-1887). (SMP-1795)
    return { status: "indexing" } if incomplete_run_ids.present?

    ElasticsearchQueryHelper.update_last_read_at(
      filter_param[:background_id],
      pr_id_to_sample_id.keys
    )

    results_by_pr = fetch_top_taxons(
      filter_param,
      pr_id_to_sample_id,
      filter_param[:addedTaxonIds]
    )
    dict = ElasticsearchQueryHelper.samples_taxons_details(
      results_by_pr,
      @samples,
      @should_remove_zscore
    )

    return dict
  end

  # The heatmap client's automatic retries after a 202 send indexingPoll=true: report status, enqueue nothing.
  def indexing_poll?
    ActiveModel::Type::Boolean.new.cast(@params[:indexingPoll]) == true
  end

  def build_filter_param_hash
    # Normalize to indifferent access up front. Callers pass ActionController::Parameters
    # (string-keyed internally, indifferent []), but the include?("categories"/"subcategories"/
    # "readSpecificity") checks below use STRING keys while every [] read uses a SYMBOL. That
    # only lines up for ACP; a plain Hash with symbol keys would make include? return false and
    # silently skip those filter blocks. With indifferent access, include? and [] agree
    # regardless of the caller's key type.
    params = @params.respond_to?(:to_unsafe_h) ? @params.to_unsafe_h : @params
    params = params.with_indifferent_access

    filter_params = {}
    filter_params[:min_reads] = params[:minReads] ? params[:minReads].to_i : MINIMUM_READ_THRESHOLD
    removed_taxon_ids = (params[:removedTaxonIds] || []).map do |x|
      Integer(x)
    rescue ArgumentError, TypeError
      nil
    end
    removed_taxon_ids = removed_taxon_ids.compact
    filter_params[:addedTaxonIds] = params[:addedTaxonIds] || []
    # Coerce taxonIds the same way as removedTaxonIds. Taxids are integers, but from an HTTP
    # request they arrive as strings; both sides of the set subtraction below must share a type
    # or it silently removes nothing ("20" != 20).
    taxon_ids = (params[:taxonIds] || []).map do |x|
      Integer(x)
    rescue ArgumentError, TypeError
      nil
    end
    taxon_ids = taxon_ids.compact

    taxon_ids -= removed_taxon_ids
    filter_params[:taxon_ids] = taxon_ids
    threshold_filters = params[:thresholdFilters]

    # thresholdFilters arrives in several shapes; only STRINGS are JSON to be parsed.
    #   * String -- the frontend JSON.stringify's the array (the common case): parse it.
    #   * Array  -- either JSON strings (parse each) or already-parsed hashes (keep as-is).
    #   * Hash   -- Rails parsed a nested-object encoding (thresholdFilters[i][k]=v) into an
    #               index-keyed Hash; its values ARE the filter hashes. JSON.parse-ing a Hash
    #               raised "no implicit conversion of HashWithIndifferentAccess into String"
    #               and 500'd the heatmap (surfaced as a generic ElasticSearch error).
    # Downstream (HeatmapHelper.parse_custom_filters) iterates an array of filter hashes.
    filter_params[:threshold_filters] =
      case threshold_filters
      when String
        JSON.parse(threshold_filters.presence || "[]")
      when Array
        threshold_filters.map { |filter| filter.is_a?(String) ? JSON.parse(filter.presence || "{}") : filter }
      when Hash
        threshold_filters.values.map { |filter| filter.is_a?(String) ? JSON.parse(filter.presence || "{}") : filter }
      else
        []
      end

    filter_params[:background_id] = @background_id && @background_id > 0 ? @background_id : @samples.first.default_background_id

    if params.include?("categories")
      filter_params[:categories] = params[:categories]
    end
    if params.include?("subcategories")
      # subcategories arrives in two shapes, same String-vs-Hash ambiguity handled above for
      # thresholdFilters. A JSON.stringify'd value is a String to parse -> {"Viruses" => ["Phage"]}.
      # But the Rails nested-object query encoding (subcategories[Viruses][0]=Phage) is parsed by
      # Rails into a HashWithIndifferentAccess -> {"Viruses" => {"0" => "Phage"}}; JSON.parse-ing that
      # raised "no implicit conversion of HashWithIndifferentAccess into String" and 500'd the heatmap
      # whenever the "Phage" filter was selected (the only filter that sends subcategories). Also note
      # {"0" => "Phage"}.include?("Phage") checks KEYS and is false, so normalize the Viruses value to
      # its list of names either way.
      raw_subcategories = params[:subcategories]
      subcategories = raw_subcategories.is_a?(String) ? JSON.parse(raw_subcategories.presence || "{}") : (raw_subcategories || {})
      viruses_subcategories = subcategories["Viruses"]
      virus_subcategory_names = viruses_subcategories.is_a?(Hash) ? viruses_subcategories.values : Array(viruses_subcategories)
      filter_params[:include_phage] = virus_subcategory_names.include?("Phage")
    end
    filter_params[:taxon_level] = params[:species].to_i == TaxonCount::TAX_LEVEL_SPECIES ? TaxonCount::TAX_LEVEL_SPECIES : TaxonCount::TAX_LEVEL_GENUS
    if params.include?("readSpecificity")
      filter_params[:read_specificity] = params[:readSpecificity].to_i
    end
    filter_params[:sort_by] = params[:sortBy] || DEFAULT_TAXON_SORT_PARAM
    filter_params[:taxons_per_sample] = params[:taxonsPerSample] || DEFAULT_MAX_NUM_TAXONS
    filter_params[:taxon_tags] = params[:taxonTags] || []

    # add the mandatory counts > 5 threshold filter to the `threshold_filters` to be later parsed by `elasticsearch_query_helper#parse_custom_filters`
    metric_count_type = filter_params[:sort_by].split("_")[1].upcase # TODO: I am extracting the metric details out of sort_by when they should probably be passed directly from the frontend
    filter_params[:threshold_filters] << \
      {
        "metric" => "#{metric_count_type}_r",
        "value" => filter_params[:min_reads],
        "operator" => ">=",
      }

    return filter_params
  end

  def fetch_top_taxons(
    filter_param,
    pr_id_to_sample_id,
    added_taxon_ids
  )
    # get the top 10 taxa for each sample
    top_n_taxa_per_sample = ElasticsearchQueryHelper.top_n_taxa_per_sample(
      filter_param,
      pr_id_to_sample_id.keys()
    )
    # for each sample, get the scores for each of the above taxa
    all_metrics_per_sample_and_taxa = ElasticsearchQueryHelper.all_metrics_per_sample_and_taxa(
      pr_id_to_sample_id.keys(),
      top_n_taxa_per_sample + added_taxon_ids,
      filter_param[:background_id]
    )
    # organizing the results by pipeline_run_id
    hash = ElasticsearchQueryHelper.organize_data_by_pr(all_metrics_per_sample_and_taxa, pr_id_to_sample_id)
    return hash
  end
end
