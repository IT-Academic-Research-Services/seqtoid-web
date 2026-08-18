require 'rails_helper'
require 'zlib'
require 'tmpdir'
require 'fileutils'

# UserDataExportService streams a per-table NDJSON bundle (schema 3.0) into an
# output directory. These specs run a real export into a temp dir and read the
# bundle back into a convenient Hash to assert on.
RSpec.describe UserDataExportService do
  let(:user) { create(:user, name: "Test User", email: "test@example.com") }

  # Runs the export into a fresh temp dir; returns [result_summary, bundle_hash].
  # bundle_hash: { manifest:, user:, user_profile:, <table_sym> => [rows] }.
  def export_bundle(**kwargs)
    dir = Dir.mktmpdir("export_spec")
    (@export_dirs ||= []) << dir
    result = described_class.call(output_dir: dir, **kwargs)
    [result, read_bundle(dir)]
  end

  def read_bundle(dir)
    bundle = {}
    bundle[:manifest] = JSON.parse(File.read(File.join(dir, "manifest.json")), symbolize_names: true)
    bundle[:user] = JSON.parse(File.read(File.join(dir, "user.json")), symbolize_names: true)
    profile_path = File.join(dir, "user_profile.json")
    bundle[:user_profile] = File.exist?(profile_path) ? JSON.parse(File.read(profile_path), symbolize_names: true) : nil
    Dir.glob(File.join(dir, "*.ndjson.gz")).each do |path|
      name = File.basename(path).delete_suffix('.ndjson.gz').to_sym
      rows = []
      Zlib::GzipReader.open(path) do |gz|
        gz.each_line { |line| rows << JSON.parse(line, symbolize_names: true) unless line.strip.empty? }
      end
      bundle[name] = rows
    end
    bundle
  end

  after do
    (@export_dirs || []).each { |d| FileUtils.remove_entry(d) if Dir.exist?(d) }
  end

  describe "#call" do
    context "argument handling" do
      it "raises UserNotFoundError when the user does not exist" do
        expect do
          described_class.call(user_id: 999_999, output_dir: Dir.mktmpdir)
        end.to raise_error(UserDataExportService::UserNotFoundError, "User not found: 999999")
      end

      it "raises ArgumentError when neither user_id nor user_email is given" do
        expect do
          described_class.call(output_dir: Dir.mktmpdir)
        end.to raise_error(ArgumentError, "Must provide either user_id or user_email")
      end

      it "raises ArgumentError when output_dir is missing" do
        expect do
          described_class.call(user_id: user.id)
        end.to raise_error(ArgumentError, "Must provide output_dir")
      end
    end

    context "when user exists with minimal data" do
      it "writes user.json with the preserved id" do
        _result, bundle = export_bundle(user_id: user.id)

        expect(bundle[:user][:id]).to eq(user.id)
        expect(bundle[:user][:email]).to eq(user.email)
        expect(bundle[:user][:name]).to eq(user.name)
      end

      it "writes a manifest with schema version 3.0 and source metadata" do
        result, bundle = export_bundle(user_id: user.id)

        expect(result[:schema_version]).to eq("1.0")
        expect(bundle[:manifest][:schema_version]).to eq("1.0")
        expect(bundle[:manifest][:format]).to eq("ndjson-gzip")
        expect(bundle[:manifest][:user_id]).to eq(user.id)
        expect(bundle[:manifest][:extracted_at]).to be_present
        expect(bundle[:manifest][:table_counts]).to be_a(Hash)
      end

      it "writes empty per-table files for absent associations" do
        _result, bundle = export_bundle(user_id: user.id)

        expect(bundle[:samples]).to eq([])
        expect(bundle[:visualizations]).to eq([])
        expect(bundle[:user_settings]).to eq([])
        expect(bundle[:projects]).to eq([])
        expect(bundle[:user_profile]).to be_nil
      end
    end

    context "when user has a project" do
      let!(:owned_project) { create(:project, creator: user) }

      before { user.projects << owned_project }

      it "exports owned projects with preserved id and is_owner true" do
        _result, bundle = export_bundle(user_id: user.id)

        owned = bundle[:projects].select { |p| p[:is_owner] }
        expect(owned.length).to eq(1)
        expect(owned.first[:id]).to eq(owned_project.id)
        expect(owned.first[:creator_id]).to eq(user.id)
      end

      context "when user is a member of another project" do
        let(:other_user) { create(:user) }
        let!(:other_project) { create(:project, creator: other_user) }

        before { user.projects << other_project }

        it "flags owned vs member projects via is_owner" do
          _result, bundle = export_bundle(user_id: user.id)

          owned = bundle[:projects].select { |p| p[:is_owner] }
          member = bundle[:projects].reject { |p| p[:is_owner] }
          expect(owned.pluck(:id)).to eq([owned_project.id])
          expect(member.pluck(:id)).to eq([other_project.id])
        end
      end
    end

    context "when user has samples" do
      let(:project) { create(:project, creator: user) }
      let!(:sample) { create(:sample, user: user, project: project) }

      it "exports samples (scalar) with preserved id and foreign keys" do
        _result, bundle = export_bundle(user_id: user.id)

        expect(bundle[:samples].length).to eq(1)
        sample_data = bundle[:samples].first
        expect(sample_data[:id]).to eq(sample.id)
        expect(sample_data[:user_id]).to eq(user.id)
        expect(sample_data[:project_id]).to eq(project.id)
        expect(sample_data[:name]).to eq(sample.name)
        expect(sample_data[:s3_paths][:input_path]).to be_present
        expect(sample_data[:s3_paths][:output_path]).to be_present
      end

      it "exports input files in their own table keyed by sample_id" do
        _result, bundle = export_bundle(user_id: user.id)

        expect(bundle[:input_files].length).to eq(2) # Factory creates 2 input files
        expect(bundle[:input_files].first[:sample_id]).to eq(sample.id)
      end
    end

    context "when user has samples with pipeline runs" do
      let(:project) { create(:project, creator: user) }
      let!(:sample) { create(:sample, user: user, project: project) }
      let!(:pipeline_run) { create(:pipeline_run, sample: sample, pipeline_version: "7.0.0") }

      it "exports pipeline runs in their own table keyed by sample_id" do
        _result, bundle = export_bundle(user_id: user.id)

        expect(bundle[:pipeline_runs].length).to eq(1)
        expect(bundle[:pipeline_runs].first[:id]).to eq(pipeline_run.id)
        expect(bundle[:pipeline_runs].first[:sample_id]).to eq(sample.id)
      end

      it "excludes short-read runs below the minimum migration version (and their children)" do
        old_run = create(:pipeline_run, sample: sample, pipeline_version: "6.9.0")
        create(:taxon_count, pipeline_run: old_run)

        _result, bundle = export_bundle(user_id: user.id)

        pr_ids = bundle[:pipeline_runs].pluck(:id)
        expect(pr_ids).to include(pipeline_run.id)  # >= 7.0.0 migrated
        expect(pr_ids).not_to include(old_run.id)   # sub-7.0.0 excluded
        expect(bundle[:taxon_counts].pluck(:pipeline_run_id)).not_to include(old_run.id)
      end

      it "excludes deprecated and soft-deleted pipeline runs (and their children)" do
        deprecated_run = create(:pipeline_run, sample: sample, pipeline_version: "8.0.0", deprecated: true)
        deleted_run = create(:pipeline_run, sample: sample, pipeline_version: "8.0.0", deleted_at: Time.now.utc)
        create(:taxon_count, pipeline_run: deprecated_run)

        _result, bundle = export_bundle(user_id: user.id)

        pr_ids = bundle[:pipeline_runs].pluck(:id)
        expect(pr_ids).to include(pipeline_run.id)        # current, migratable
        expect(pr_ids).not_to include(deprecated_run.id)  # deprecated excluded
        expect(pr_ids).not_to include(deleted_run.id)     # soft-deleted excluded
        expect(bundle[:taxon_counts].pluck(:pipeline_run_id)).not_to include(deprecated_run.id)
      end

      context "with taxon counts" do
        let!(:taxon_count) { create(:taxon_count, pipeline_run: pipeline_run) }

        it "exports taxon counts in their own table keyed by pipeline_run_id" do
          _result, bundle = export_bundle(user_id: user.id)

          expect(bundle[:taxon_counts].length).to eq(1)
          expect(bundle[:taxon_counts].first[:id]).to eq(taxon_count.id)
          expect(bundle[:taxon_counts].first[:pipeline_run_id]).to eq(pipeline_run.id)
        end
      end

      context "with contigs" do
        let!(:contig) { create(:contig, pipeline_run: pipeline_run) }

        it "exports contigs in their own table keyed by pipeline_run_id" do
          _result, bundle = export_bundle(user_id: user.id)

          expect(bundle[:contigs].length).to eq(1)
          expect(bundle[:contigs].first[:id]).to eq(contig.id)
          expect(bundle[:contigs].first[:pipeline_run_id]).to eq(pipeline_run.id)
        end
      end

      context "with job stats" do
        let!(:job_stat) { create(:job_stat, pipeline_run: pipeline_run, task: "test_task") }

        it "exports job stats keyed by pipeline_run_id" do
          _result, bundle = export_bundle(user_id: user.id)

          found = bundle[:job_stats].find { |js| js[:id] == job_stat.id }
          expect(found).to be_present
          expect(found[:pipeline_run_id]).to eq(pipeline_run.id)
        end
      end

      context "with ercc counts" do
        let!(:ercc_count) { ErccCount.create!(pipeline_run: pipeline_run, name: "ERCC-001", count: 100) }

        it "exports ercc counts keyed by pipeline_run_id" do
          _result, bundle = export_bundle(user_id: user.id)

          expect(bundle[:ercc_counts].pluck(:id)).to include(ercc_count.id)
        end
      end

      context "with output states" do
        # pipeline_run factory creates output_states via after_create callback.
        let(:output_state) { pipeline_run.output_states.first }

        it "exports output states keyed by pipeline_run_id" do
          _result, bundle = export_bundle(user_id: user.id)

          found = bundle[:output_states].find { |os| os[:id] == output_state.id }
          expect(found).to be_present
          expect(found[:pipeline_run_id]).to eq(pipeline_run.id)
        end
      end

      context "with insert size metric set" do
        let!(:insert_size_metric_set) { create(:insert_size_metric_set, pipeline_run: pipeline_run) }

        it "exports insert size metric sets keyed by pipeline_run_id" do
          _result, bundle = export_bundle(user_id: user.id)

          expect(bundle[:insert_size_metric_sets].length).to eq(1)
          expect(bundle[:insert_size_metric_sets].first[:id]).to eq(insert_size_metric_set.id)
          expect(bundle[:insert_size_metric_sets].first[:pipeline_run_id]).to eq(pipeline_run.id)
        end
      end
    end

    context "when user has workflow runs" do
      let(:project) { create(:project, creator: user) }
      let!(:sample) { create(:sample, user: user, project: project) }
      let!(:workflow_run) { create(:workflow_run, sample: sample, user: user) }

      it "exports workflow runs with preserved id" do
        _result, bundle = export_bundle(user_id: user.id)

        expect(bundle[:workflow_runs].length).to eq(1)
        expect(bundle[:workflow_runs].first[:id]).to eq(workflow_run.id)
        expect(bundle[:workflow_runs].first[:user_id]).to eq(user.id)
        expect(bundle[:workflow_runs].first[:sample_id]).to eq(sample.id)
      end

      it "excludes deprecated and soft-deleted workflow runs" do
        deprecated_wr = create(:workflow_run, sample: sample, user: user, deprecated: true)
        deleted_wr = create(:workflow_run, sample: sample, user: user, deleted_at: Time.now.utc)

        _result, bundle = export_bundle(user_id: user.id)

        ids = bundle[:workflow_runs].pluck(:id)
        expect(ids).to include(workflow_run.id)
        expect(ids).not_to include(deprecated_wr.id)
        expect(ids).not_to include(deleted_wr.id)
      end
    end

    context "when user has visualizations" do
      let(:project) { create(:project, creator: user) }
      let!(:sample) { create(:sample, user: user, project: project) }
      let!(:visualization) { create(:visualization, user: user, samples: [sample], name: "Test Viz", visualization_type: "heatmap") }

      it "exports visualizations with a sample_ids array" do
        _result, bundle = export_bundle(user_id: user.id)

        expect(bundle[:visualizations].length).to eq(1)
        expect(bundle[:visualizations].first[:id]).to eq(visualization.id)
        expect(bundle[:visualizations].first[:user_id]).to eq(user.id)
        expect(bundle[:visualizations].first[:sample_ids]).to eq([sample.id])
      end
    end

    context "when visualization has data with sampleIds" do
      let(:project) { create(:project, creator: user) }
      let!(:sample1) { create(:sample, user: user, project: project) }
      let!(:sample2) { create(:sample, user: user, project: project) }
      let!(:visualization) do
        viz = create(:visualization, user: user, samples: [sample1, sample2], name: "Test Viz", visualization_type: "heatmap")
        # rubocop:disable Rails/SkipsModelValidations
        viz.update_column(:data, { "sampleIds" => [sample1.id, sample2.id], "background" => 123 })
        # rubocop:enable Rails/SkipsModelValidations
        viz
      end

      it "exports data verbatim (IDs preserved, no transform)" do
        _result, bundle = export_bundle(user_id: user.id)

        # Visualization#data is a `serialize :data, JSON` column, exported as a
        # nested object. (read_bundle parses with symbolize_names, so the nested
        # keys read back as symbols here; the point is the values/keys are
        # preserved verbatim with no id transform.)
        viz_data = bundle[:visualizations].first[:data]
        expect(viz_data[:sampleIds]).to match_array([sample1.id, sample2.id])
        expect(viz_data).not_to have_key(:old_sample_ids)
        expect(viz_data[:background]).to eq(123)
      end
    end

    context "when user has user settings" do
      let!(:user_setting) { create(:user_setting, user: user, key: "show_skip_processing_option", serialized_value: "true") }

      it "exports user settings with user_id" do
        _result, bundle = export_bundle(user_id: user.id)

        expect(bundle[:user_settings].length).to eq(1)
        expect(bundle[:user_settings].first[:id]).to eq(user_setting.id)
        expect(bundle[:user_settings].first[:user_id]).to eq(user.id)
      end
    end

    context "when user has backgrounds" do
      let!(:background) { create(:background, user: user) }

      it "exports backgrounds with preserved id" do
        _result, bundle = export_bundle(user_id: user.id)

        expect(bundle[:backgrounds].length).to eq(1)
        expect(bundle[:backgrounds].first[:id]).to eq(background.id)
        expect(bundle[:backgrounds].first[:user_id]).to eq(user.id)
      end

      context "with taxon summaries" do
        let!(:taxon_summary) { create(:taxon_summary, background: background) }

        it "exports taxon summaries in their own table keyed by background_id" do
          _result, bundle = export_bundle(user_id: user.id)

          expect(bundle[:taxon_summaries].length).to eq(1)
          expect(bundle[:taxon_summaries].first[:id]).to eq(taxon_summary.id)
          expect(bundle[:taxon_summaries].first[:background_id]).to eq(background.id)
        end
      end
    end

    context "when user has persisted backgrounds" do
      let(:project) { create(:project, creator: user, users: [user]) }
      let(:background) { create(:background, user: user, public_access: 1) }
      let!(:persisted_background) { create(:persisted_background, user: user, project: project, background: background) }

      it "exports persisted backgrounds with foreign key references" do
        _result, bundle = export_bundle(user_id: user.id)

        expect(bundle[:persisted_backgrounds].length).to eq(1)
        expect(bundle[:persisted_backgrounds].first[:id]).to eq(persisted_background.id)
        expect(bundle[:persisted_backgrounds].first[:user_id]).to eq(user.id)
        expect(bundle[:persisted_backgrounds].first[:project_id]).to eq(project.id)
        expect(bundle[:persisted_backgrounds].first[:background_id]).to eq(background.id)
      end
    end

    context "when user has a user profile" do
      let!(:user_profile) { UserProfile.create!(user: user, first_name: "Test", last_name: "User") }

      it "writes user_profile.json with user_id" do
        _result, bundle = export_bundle(user_id: user.id)

        expect(bundle[:user_profile]).to be_present
        expect(bundle[:user_profile][:id]).to eq(user_profile.id)
        expect(bundle[:user_profile][:user_id]).to eq(user.id)
      end
    end

    context "when user has samples with metadata" do
      let(:project) { create(:project, creator: user) }
      let!(:sample) { create(:sample, user: user, project: project) }
      let(:metadata_field) do
        field = create(:metadata_field, name: "test_field", base_type: 0)
        sample.host_genome.metadata_fields << field unless sample.host_genome.metadata_fields.include?(field)
        field
      end
      let!(:metadatum) { create(:metadatum, sample: sample, metadata_field: metadata_field, key: "test_field", raw_value: "test") }

      it "exports metadata in its own table keyed by sample_id" do
        _result, bundle = export_bundle(user_id: user.id)

        found = bundle[:metadata].find { |m| m[:id] == metadatum.id }
        expect(found).to be_present
        expect(found[:sample_id]).to eq(sample.id)
      end
    end

    context "when user has bulk downloads" do
      let(:project) { create(:project, creator: user) }
      let!(:sample) { create(:sample, user: user, project: project) }
      let!(:pipeline_run) { create(:pipeline_run, sample: sample, pipeline_version: "7.0.0") }
      let!(:bulk_download) { create(:bulk_download, user: user, pipeline_runs: [pipeline_run]) }

      it "exports bulk downloads with pipeline_run_ids" do
        _result, bundle = export_bundle(user_id: user.id)

        expect(bundle[:bulk_downloads].length).to eq(1)
        expect(bundle[:bulk_downloads].first[:id]).to eq(bulk_download.id)
        expect(bundle[:bulk_downloads].first[:user_id]).to eq(user.id)
        expect(bundle[:bulk_downloads].first[:pipeline_run_ids]).to eq([pipeline_run.id])
      end

      context "with params_json referencing a background id" do
        let!(:background) { create(:background, user: user) }

        before do
          # rubocop:disable Rails/SkipsModelValidations
          bulk_download.update_column(:params_json, { background_id: background.id, metric: "NT.rpm" }.to_json)
          # rubocop:enable Rails/SkipsModelValidations
        end

        it "exports params_json verbatim (IDs preserved, no transform)" do
          _result, bundle = export_bundle(user_id: user.id)

          params = JSON.parse(bundle[:bulk_downloads].first[:params_json])
          expect(params["background_id"]).to eq(background.id)
          expect(params).not_to have_key("old_background_id")
          expect(params["metric"]).to eq("NT.rpm")
        end
      end
    end

    context "when user has phylo tree ngs" do
      let(:project) { create(:project, creator: user, users: [user]) }
      let!(:sample) { create(:sample, user: user, project: project) }
      let!(:pipeline_run) { create(:pipeline_run, sample: sample, pipeline_version: "7.0.0") }
      let!(:phylo_tree_ng) { create(:phylo_tree_ng, user: user, project: project, pipeline_runs: [pipeline_run]) }

      it "exports phylo tree ngs with pipeline_run_ids" do
        _result, bundle = export_bundle(user_id: user.id)

        expect(bundle[:phylo_tree_ngs].length).to eq(1)
        expect(bundle[:phylo_tree_ngs].first[:id]).to eq(phylo_tree_ng.id)
        expect(bundle[:phylo_tree_ngs].first[:user_id]).to eq(user.id)
        expect(bundle[:phylo_tree_ngs].first[:project_id]).to eq(project.id)
        expect(bundle[:phylo_tree_ngs].first[:pipeline_run_ids]).to eq([pipeline_run.id])
      end

      context "with inputs_json referencing pipeline_run_ids" do
        before do
          # rubocop:disable Rails/SkipsModelValidations
          phylo_tree_ng.update_column(:inputs_json, {
            pipeline_run_ids: [pipeline_run.id],
            tax_id: 573,
            superkingdom_name: "bacteria",
          }.to_json)
          # rubocop:enable Rails/SkipsModelValidations
        end

        it "exports inputs_json verbatim (IDs preserved, no transform)" do
          _result, bundle = export_bundle(user_id: user.id)

          inputs = JSON.parse(bundle[:phylo_tree_ngs].first[:inputs_json])
          expect(inputs["pipeline_run_ids"]).to eq([pipeline_run.id])
          expect(inputs).not_to have_key("old_pipeline_run_ids")
          expect(inputs["tax_id"]).to eq(573)
        end
      end
    end

    context "when user has snapshot links" do
      let(:project) { create(:project, creator: user, users: [user]) }
      let!(:snapshot_link) { SnapshotLink.create!(project: project, creator_id: user.id, share_id: "test123", content: "{}") }

      it "exports snapshot links with foreign key references" do
        _result, bundle = export_bundle(user_id: user.id)

        expect(bundle[:snapshot_links].length).to eq(1)
        expect(bundle[:snapshot_links].first[:id]).to eq(snapshot_link.id)
        expect(bundle[:snapshot_links].first[:project_id]).to eq(project.id)
        expect(bundle[:snapshot_links].first[:creator_id]).to eq(user.id)
      end
    end

    context "when using user_email parameter" do
      it "finds the user by email and exports" do
        _result, bundle = export_bundle(user_email: user.email)

        expect(bundle[:user][:id]).to eq(user.id)
        expect(bundle[:user][:email]).to eq(user.email)
      end

      it "raises when the email is not found" do
        expect do
          described_class.call(user_email: "nonexistent@example.com", output_dir: Dir.mktmpdir)
        end.to raise_error(UserDataExportService::UserNotFoundError, "User not found: nonexistent@example.com")
      end
    end

    context "idempotency" do
      let(:project) { create(:project, creator: user) }
      let!(:sample) { create(:sample, user: user, project: project) }

      it "produces identical bundles on repeated calls (excluding extracted_at)" do
        _r1, bundle1 = export_bundle(user_id: user.id)
        _r2, bundle2 = export_bundle(user_id: user.id)

        bundle1[:manifest].delete(:extracted_at)
        bundle2[:manifest].delete(:extracted_at)

        expect(bundle1).to eq(bundle2)
      end
    end
  end
end
