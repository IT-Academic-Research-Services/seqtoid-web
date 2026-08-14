# Backfill the heatmap OpenSearch index for existing pipeline runs.
#
# WHY: taxa are indexed into the heatmap ES domain two ways -- eagerly when a run finalizes
# (IndexTaxons, default background only) and lazily on first heatmap view
# (ElasticsearchQueryHelper.update_es_for_missing_data). After an ES DOMAIN REBUILD every existing
# doc is gone, and the eager path only repopulates runs going FORWARD -- so every pre-rebuild run
# has no docs until someone opens its heatmap, which then pays a slow cold re-index (and can render
# "No data to render" transiently). This task repopulates the index up front so no one hits that.
#
# Usage:
#   bin/run-rake-in-eks -n <ns> --context <ctx> heatmap:reindex               # all public backgrounds
#   bin/run-rake-in-eks -n <ns> -e BACKGROUND_IDS="2,26" heatmap:reindex      # specific backgrounds
# (Runs against the pod's HEATMAP_ES_ADDRESS via the same synchronous indexing lambda the app uses.)
namespace :heatmap do
  desc "Backfill the heatmap ES index for all finalized pipeline runs across the given backgrounds (default: all public backgrounds)."
  task reindex: :environment do
    background_ids = ENV["BACKGROUND_IDS"].to_s.split(/[,\s]+/).map(&:to_i).reject(&:zero?)
    background_ids = Background.where(public_access: 1).pluck(:id) if background_ids.empty?

    if background_ids.empty?
      puts "heatmap:reindex -- no public backgrounds and no BACKGROUND_IDS given; nothing to do."
      next
    end

    puts "heatmap:reindex -- backgrounds=#{background_ids.inspect}"
    projects = 0
    batches = 0
    errors = 0

    Project.order(:id).each do |project|
      samples = Sample.where(project_id: project.id).to_a
      next if samples.empty?

      pipeline_run_ids = begin
        HeatmapHelper.get_latest_pipeline_runs_for_samples(samples).keys
      rescue StandardError => e
        warn "  project #{project.id}: could not resolve pipeline runs (#{e.class}: #{e.message}); skipping"
        []
      end
      next if pipeline_run_ids.empty?

      projects += 1
      background_ids.each do |background_id|
        # update_es_for_missing_data is idempotent: it indexes only the runs that are not already
        # complete in ES for this background, so re-running is cheap and safe.
        ElasticsearchQueryHelper.update_es_for_missing_data(background_id, pipeline_run_ids)
        batches += 1
      rescue StandardError => e
        errors += 1
        warn "  project #{project.id} bg #{background_id}: #{e.class}: #{e.message.to_s[0, 160]}"
      end
      puts "  project #{project.id} '#{project.name.to_s[0, 30]}': #{pipeline_run_ids.size} runs x #{background_ids.size} backgrounds"
    end

    puts "heatmap:reindex done -- #{projects} projects, #{batches} (project,background) batches indexed, #{errors} errors."
  end
end
