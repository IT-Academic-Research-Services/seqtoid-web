# frozen_string_literal: true

# Set AUTO_INCREMENT for user-based tables to support user migration from CZI
class SetAutoIncrement < ActiveRecord::Migration[7.2]
  def change
    # List the tables and their target auto_increment starting values
    tables_to_modify = {
      accession_coverage_stats: 1_000_000_000,
      amr_counts: 10_000_000,
      annotations: 100_000,
      backgrounds: 10_000,
      bulk_downloads: 100_000,
      contigs: 10_000_000_000,
      ercc_counts: 100_000_000,
      input_files: 10_000_000,
      insert_size_metric_sets: 1_000_000,
      job_stats: 1_000_000_000,
      metadata: 10_000_000,
      output_states: 10_000_000,
      persisted_backgrounds: 100_000,
      phylo_tree_ngs: 1_000,
      phylo_trees: 1_000,
      pipeline_runs: 10_000_000,
      pipeline_run_stages: 10_000_000,
      projects: 100_000,
      project_workflow_versions: 1_000_000,
      samples: 10_000_000,
      snapshot_links: 100,
      taxon_byteranges: 10_000_000_000,
      taxon_counts: 10_000_000_000,
      taxon_summaries: 100_000_000_000,
      user_settings: 100,
      visualizations: 10_000,
      workflow_runs: 1_000_000,
    }

    # Wrap the operations in safety_assured to bypass strong_migrations checks
    safety_assured do
      tables_to_modify.each do |table_name, target_id|
        execute "ALTER TABLE #{table_name} AUTO_INCREMENT = #{target_id};"
      end
    end
  end
end
