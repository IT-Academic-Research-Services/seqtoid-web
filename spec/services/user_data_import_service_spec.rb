require 'rails_helper'
require 'zlib'
require 'tmpdir'
require 'fileutils'

# These specs drive the importer with synthetic bundles whose primary keys are
# high, unused IDs. A true export->import round-trip in a single database would
# collide on the preserved IDs (export writes id X, import re-inserts id X); the
# real migration runs against two separate databases.
RSpec.describe UserDataImportService do
  # High IDs that won't collide with factory-generated (auto-increment) rows.
  OLD_USER_ID = 9_000_001
  PROJECT_ID = 9_100_001
  SAMPLE_ID = 9_200_001
  PIPELINE_RUN_ID = 9_300_001
  INPUT_FILE_ID = 9_400_001
  VIZ_ID = 9_500_001
  SETTING_ID = 9_600_001
  PHYLO_TREE_ID = 9_700_001
  WORKFLOW_RUN_ID = 9_800_001
  PHYLO_TREE_NG_ID = 9_900_001

  let!(:host_genome) { create(:host_genome) }
  let(:now) { "2026-01-01T00:00:00Z" }

  # Per-table payload (schema 1.0). Reference data (host_genome) uses a real,
  # existing ID; everything else uses the high synthetic IDs above.
  def bundle_tables(email: "migrated@example.com")
    {
      user: {
        id: OLD_USER_ID,
        email: email,
        name: "Migrated User",
        role: 0,
        sign_in_count: 3,
        profile_form_version: 0,
        created_at: now,
        updated_at: now,
      },
      user_settings: [
        { id: SETTING_ID, user_id: OLD_USER_ID, key: "show_skip_processing_option", serialized_value: "true" },
      ],
      projects: [
        {
          id: PROJECT_ID,
          creator_id: OLD_USER_ID,
          name: "Migrated Project",
          days_to_keep_sample_private: 365,
          is_owner: true,
          project_workflow_versions: [],
          created_at: now,
          updated_at: now,
        },
      ],
      samples: [
        {
          id: SAMPLE_ID,
          user_id: OLD_USER_ID,
          project_id: PROJECT_ID,
          host_genome_id: host_genome.id,
          name: "Migrated Sample",
          status: "created",
          do_not_process: false,
          use_taxon_whitelist: false,
          initial_workflow: "short-read-mngs",
          created_at: now,
          updated_at: now,
        },
      ],
      pipeline_runs: [
        {
          id: PIPELINE_RUN_ID,
          sample_id: SAMPLE_ID,
          alignment_config_id: nil,
          job_status: "CHECKED",
          finalized: 1,
          technology: "Illumina",
          use_taxon_whitelist: false,
          created_at: now,
          updated_at: now,
        },
      ],
      visualizations: [
        {
          id: VIZ_ID,
          user_id: OLD_USER_ID,
          name: "Migrated Viz",
          visualization_type: "heatmap",
          data: { "sampleIds" => [SAMPLE_ID], "background" => 123 },
          sample_ids: [SAMPLE_ID],
          created_at: now,
          updated_at: now,
        },
      ],
      phylo_trees: [
        {
          id: PHYLO_TREE_ID,
          user_id: OLD_USER_ID,
          project_id: PROJECT_ID,
          name: "Migrated Legacy Tree",
          taxid: 573,
          tax_name: "Klebsiella pneumoniae",
          tax_level: 1,
          status: 1,
          newick: "(a:0.1,b:0.2);",
          pipeline_run_ids: [PIPELINE_RUN_ID],
          created_at: now,
          updated_at: now,
        },
      ],
    }
  end

  # Writes a schema-1.0 bundle into a fresh temp dir and returns its path.
  def write_bundle(tables: bundle_tables, schema_version: "1.0")
    dir = Dir.mktmpdir("import_spec")
    (@import_dirs ||= []) << dir
    user = tables.delete(:user)
    File.write(File.join(dir, "user.json"), JSON.generate(user))
    tables.each do |name, rows|
      Zlib::GzipWriter.open(File.join(dir, "#{name}.ndjson.gz")) do |gz|
        rows.each { |row| gz.puts(JSON.generate(row)) }
      end
    end
    File.write(File.join(dir, "manifest.json"), JSON.generate({
                                                                schema_version: schema_version,
                                                                format: "ndjson-gzip",
                                                                user_id: user[:id],
                                                                extracted_at: now,
                                                                table_counts: tables.transform_values(&:size),
                                                              }))
    dir
  end

  after do
    (@import_dirs || []).each { |d| FileUtils.remove_entry(d) if Dir.exist?(d) }
  end

  describe "#call" do
    context "when creating a new user from the export" do
      it "creates the user with a new id and reports the remap" do
        result = described_class.call(input_dir: write_bundle, create_user: true)

        expect(result[:success]).to be(true)
        expect(result[:old_user_id]).to eq(OLD_USER_ID)
        expect(result[:user_id]).to be_present
        expect(result[:user_id]).not_to eq(OLD_USER_ID)
        expect(User.find(result[:user_id]).email).to eq("migrated@example.com")
      end

      it "preserves non-user primary keys" do
        described_class.call(input_dir: write_bundle, create_user: true)

        expect(Project.exists?(PROJECT_ID)).to be(true)
        expect(Sample.exists?(SAMPLE_ID)).to be(true)
        expect(PipelineRun.exists?(PIPELINE_RUN_ID)).to be(true)
        expect(Visualization.exists?(VIZ_ID)).to be(true)
        expect(PipelineRun.find(PIPELINE_RUN_ID).sample_id).to eq(SAMPLE_ID)
      end

      it "remaps user references (user_id and creator_id) to the new user id" do
        result = described_class.call(input_dir: write_bundle, create_user: true)
        new_user_id = result[:user_id]

        expect(Sample.find(SAMPLE_ID).user_id).to eq(new_user_id)
        expect(Project.find(PROJECT_ID).creator_id).to eq(new_user_id)
        expect(Visualization.find(VIZ_ID).user_id).to eq(new_user_id)
        expect(UserSetting.find(SETTING_ID).user_id).to eq(new_user_id)
      end

      it "adds the user as a member of imported projects" do
        result = described_class.call(input_dir: write_bundle, create_user: true)

        expect(User.find(result[:user_id]).projects.map(&:id)).to include(PROJECT_ID)
      end

      it "rebuilds join associations using preserved ids" do
        described_class.call(input_dir: write_bundle, create_user: true)

        expect(Visualization.find(VIZ_ID).samples.map(&:id)).to eq([SAMPLE_ID])
      end

      it "migrates legacy PhyloTree with preserved id, remapped user, and rebuilt join" do
        result = described_class.call(input_dir: write_bundle, create_user: true)

        tree = PhyloTree.find(PHYLO_TREE_ID)
        expect(tree.user_id).to eq(result[:user_id])
        expect(tree.project_id).to eq(PROJECT_ID)
        expect(tree.pipeline_runs.map(&:id)).to eq([PIPELINE_RUN_ID])
      end

      it "stores JSON/serialized fields verbatim (IDs preserved)" do
        described_class.call(input_dir: write_bundle, create_user: true)

        expect(Visualization.find(VIZ_ID).data["sampleIds"]).to eq([SAMPLE_ID])
        expect(Visualization.find(VIZ_ID).data["background"]).to eq(123)
      end
    end

    context "when importing into an existing user (target_user_id)" do
      let!(:target_user) { create(:user, email: "target@example.com") }

      it "attaches data to the target user without creating a new user" do
        result = described_class.call(input_dir: write_bundle, target_user_id: target_user.id)

        expect(result[:success]).to be(true)
        expect(result[:user_id]).to eq(target_user.id)
        expect(User.find_by(email: "migrated@example.com")).to be_nil
        expect(Sample.find(SAMPLE_ID).user_id).to eq(target_user.id)
        expect(Project.find(PROJECT_ID).creator_id).to eq(target_user.id)
      end

      it "fails when the target user does not exist" do
        result = described_class.call(input_dir: write_bundle, target_user_id: 123_456_789)

        expect(result[:success]).to be(false)
        expect(result[:error_class]).to eq("UserDataImportService::ValidationError")
      end
    end

    context "when neither target_user_id nor create_user is given" do
      it "fails validation instead of silently creating a user" do
        result = described_class.call(input_dir: write_bundle)

        expect(result[:success]).to be(false)
        expect(result[:error_class]).to eq("UserDataImportService::ValidationError")
        expect(User.find_by(email: "migrated@example.com")).to be_nil
      end
    end

    context "with skip_existing (idempotency)" do
      it "is safe to re-run without creating duplicates" do
        first = described_class.call(input_dir: write_bundle, create_user: true)
        expect(first[:success]).to be(true)

        second = described_class.call(input_dir: write_bundle, create_user: true, skip_existing: true)

        expect(second[:success]).to be(true)
        expect(second[:user_id]).to eq(first[:user_id]) # reused existing user
        expect(second[:stats][:samples_skipped]).to eq(1)
        expect(second[:stats][:projects_skipped]).to eq(1)
        expect(Sample.where(id: SAMPLE_ID).count).to eq(1)
        expect(Project.where(id: PROJECT_ID).count).to eq(1)
      end
    end

    context "when the user already exists and skip_existing is off" do
      it "returns a DuplicateUserError" do
        described_class.call(input_dir: write_bundle, create_user: true)
        result = described_class.call(input_dir: write_bundle, create_user: true)

        expect(result[:success]).to be(false)
        expect(result[:error_class]).to eq("UserDataImportService::DuplicateUserError")
      end
    end

    context "with dry_run" do
      it "rolls back all changes" do
        result = described_class.call(input_dir: write_bundle, create_user: true, dry_run: true)

        expect(result[:success]).to be(true)
        expect(result[:dry_run]).to be(true)
        expect(Sample.exists?(SAMPLE_ID)).to be(false)
        expect(Project.exists?(PROJECT_ID)).to be(false)
        expect(User.find_by(email: "migrated@example.com")).to be_nil
      end
    end

    context "when a table file declared in the manifest is missing" do
      it "fails validation instead of importing a partial bundle" do
        dir = write_bundle
        File.delete(File.join(dir, "samples.ndjson.gz"))

        result = described_class.call(input_dir: dir, create_user: true)

        expect(result[:success]).to be(false)
        expect(result[:error_class]).to eq("UserDataImportService::ValidationError")
        expect(Sample.exists?(SAMPLE_ID)).to be(false)
        expect(User.find_by(email: "migrated@example.com")).to be_nil
      end
    end

    context "when the manifest declares more rows than the bundle contains" do
      it "rolls back and fails when counts don't reconcile" do
        dir = write_bundle
        manifest_path = File.join(dir, "manifest.json")
        manifest = JSON.parse(File.read(manifest_path))
        manifest["table_counts"]["samples"] = 99 # bundle actually has 1
        File.write(manifest_path, JSON.generate(manifest))

        result = described_class.call(input_dir: dir, create_user: true)

        expect(result[:success]).to be(false)
        expect(result[:error_class]).to eq("UserDataImportService::ImportError")
        expect(Sample.exists?(SAMPLE_ID)).to be(false) # transaction rolled back
      end
    end

    context "with an unsupported schema version" do
      it "fails validation" do
        result = described_class.call(input_dir: write_bundle(schema_version: "2.0"))

        expect(result[:success]).to be(false)
        expect(result[:error_class]).to eq("UserDataImportService::ValidationError")
      end
    end

    context "with an S3 bucket rewrite (source_bucket -> dest_bucket)" do
      let(:src) { "idseq-samples-source" }
      let(:dst) { "partner-samples-dest" }

      # Adds stored-URI-bearing rows (pipeline_run/workflow_run/phylo_tree_ng
      # s3_output_prefix, input_files.source) to the standard bundle so we can
      # assert the rewrite hits every column and leaves other buckets / non-S3
      # values / presigned URLs alone.
      def rewrite_tables
        t = bundle_tables
        t[:pipeline_runs][0][:s3_output_prefix] = "s3://#{src}/samples/#{PROJECT_ID}/#{SAMPLE_ID}/#{PIPELINE_RUN_ID}"
        t[:input_files] = [
          { id: INPUT_FILE_ID, sample_id: SAMPLE_ID, name: "a.fastq.gz", source_type: "s3",
            source: "s3://#{src}/samples/#{PROJECT_ID}/#{SAMPLE_ID}/fastqs/a.fastq.gz",
            presigned_url: "https://#{src}.s3.amazonaws.com/x?sig=abc", created_at: now, updated_at: now, },
          { id: INPUT_FILE_ID + 1, sample_id: SAMPLE_ID, name: "ref.fastq.gz", source_type: "s3",
            source: "s3://some-other-bucket/ref/a.fastq.gz", created_at: now, updated_at: now, },
          { id: INPUT_FILE_ID + 2, sample_id: SAMPLE_ID, name: "bs", source_type: "basespace",
            source: "12345", created_at: now, updated_at: now, },
        ]
        t[:workflow_runs] = [
          { id: WORKFLOW_RUN_ID, sample_id: SAMPLE_ID, user_id: OLD_USER_ID, workflow: "consensus-genome",
            status: "SUCCEEDED", deprecated: false,
            s3_output_prefix: "s3://#{src}/samples/#{PROJECT_ID}/#{SAMPLE_ID}/#{WORKFLOW_RUN_ID}/consensus-genome-3",
            created_at: now, updated_at: now, },
        ]
        t[:phylo_tree_ngs] = [
          { id: PHYLO_TREE_NG_ID, user_id: OLD_USER_ID, project_id: PROJECT_ID, name: "NG Tree",
            status: "SUCCEEDED", deprecated: false,
            s3_output_prefix: "s3://#{src}/phylo_tree_ngs/#{PHYLO_TREE_NG_ID}/results",
            created_at: now, updated_at: now, },
        ]
        t
      end

      it "rewrites s3://source/... URIs to s3://dest/... across every stored-URI column" do
        described_class.call(input_dir: write_bundle(tables: rewrite_tables), create_user: true,
                             source_bucket: src, dest_bucket: dst)

        expect(PipelineRun.find(PIPELINE_RUN_ID).s3_output_prefix)
          .to eq("s3://#{dst}/samples/#{PROJECT_ID}/#{SAMPLE_ID}/#{PIPELINE_RUN_ID}")
        expect(WorkflowRun.find(WORKFLOW_RUN_ID).s3_output_prefix).to start_with("s3://#{dst}/")
        expect(PhyloTreeNg.find(PHYLO_TREE_NG_ID).s3_output_prefix).to start_with("s3://#{dst}/")
        expect(InputFile.find(INPUT_FILE_ID).source)
          .to eq("s3://#{dst}/samples/#{PROJECT_ID}/#{SAMPLE_ID}/fastqs/a.fastq.gz")
      end

      it "leaves other-bucket, non-S3, and presigned (HTTPS) values untouched" do
        described_class.call(input_dir: write_bundle(tables: rewrite_tables), create_user: true,
                             source_bucket: src, dest_bucket: dst)

        expect(InputFile.find(INPUT_FILE_ID + 1).source).to eq("s3://some-other-bucket/ref/a.fastq.gz")
        expect(InputFile.find(INPUT_FILE_ID + 2).source).to eq("12345")
        expect(InputFile.find(INPUT_FILE_ID).presigned_url).to eq("https://#{src}.s3.amazonaws.com/x?sig=abc")
      end

      it "is a no-op when source and dest buckets are identical" do
        described_class.call(input_dir: write_bundle(tables: rewrite_tables), create_user: true,
                             source_bucket: src, dest_bucket: src)

        expect(PipelineRun.find(PIPELINE_RUN_ID).s3_output_prefix)
          .to eq("s3://#{src}/samples/#{PROJECT_ID}/#{SAMPLE_ID}/#{PIPELINE_RUN_ID}")
      end

      it "leaves URIs unchanged when no buckets are provided" do
        described_class.call(input_dir: write_bundle(tables: rewrite_tables), create_user: true)

        expect(PipelineRun.find(PIPELINE_RUN_ID).s3_output_prefix).to start_with("s3://#{src}/")
        expect(InputFile.find(INPUT_FILE_ID).source).to start_with("s3://#{src}/")
      end
    end
  end
end
