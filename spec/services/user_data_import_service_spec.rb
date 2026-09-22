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
  PWV_ID = 9_910_001
  # Two source users sharing one project, for the multi-user trickle specs.
  OWNER_SRC_USER_ID = 9_000_050
  MEMBER_SRC_USER_ID = 9_000_051

  let!(:host_genome) { create(:host_genome) }
  let(:now) { "2026-01-01T00:00:00Z" }

  # Per-table payload (schema 2.0). The host_genomes reference table matches the
  # existing target host_genome by name, so the FK remaps to its id; everything
  # else uses the high synthetic IDs above.
  def bundle_tables(email: "migrated@example.com")
    {
      host_genomes: [
        { id: host_genome.id, name: host_genome.name, created_at: now, updated_at: now },
      ],
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
          name: "Migrated Project ", # trailing ws (stripped on import)
          days_to_keep_sample_private: 365,
          is_owner: true,
          project_workflow_versions: [{ id: PWV_ID, project_id: PROJECT_ID, workflow: "ncbi_index_date", version_prefix: "2024-02-06 " }],
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

  # Writes a schema-2.0 bundle into a fresh temp dir and returns its path.
  def write_bundle(tables: bundle_tables, schema_version: "2.0")
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

      it "strips latent trailing whitespace from project name and version_prefix" do
        described_class.call(input_dir: write_bundle, create_user: true)

        expect(Project.find(PROJECT_ID).name).to eq("Migrated Project")
        expect(ProjectWorkflowVersion.find_by(project_id: PROJECT_ID, workflow: "ncbi_index_date").version_prefix).to eq("2024-02-06")
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

    context "project ownership across a multi-user trickle" do
      # A member and the true owner share one project (PROJECT_ID); creator_id is
      # set ONLY by the owner (is_owner). creator_id in the row is the source owner's
      # id and is ignored by the importer. Bundles carry just user + project (the
      # member has no samples in it -- the "member with no data" case).
      def project_trickle_bundle(user_id:, email:, is_owner:)
        write_bundle(tables: {
                       user: { id: user_id, email: email, name: "U#{user_id}", role: 0,
                               sign_in_count: 1, profile_form_version: 0, created_at: now, updated_at: now, },
                       projects: [{ id: PROJECT_ID, creator_id: OWNER_SRC_USER_ID, name: "Shared Project",
                                    days_to_keep_sample_private: 365, is_owner: is_owner,
                                    created_at: now, updated_at: now, }],
                     })
      end

      it "creates the project without an owner when a member migrates first" do
        result = described_class.call(
          input_dir: project_trickle_bundle(user_id: MEMBER_SRC_USER_ID, email: "member@example.com", is_owner: false),
          create_user: true
        )

        expect(Project.find(PROJECT_ID).creator_id).to be_nil
        expect(User.find(result[:user_id]).projects.map(&:id)).to include(PROJECT_ID)
      end

      it "sets the owner when the true owner migrates and keeps the earlier member" do
        member = described_class.call(
          input_dir: project_trickle_bundle(user_id: MEMBER_SRC_USER_ID, email: "member@example.com", is_owner: false),
          create_user: true
        )
        owner = described_class.call(
          input_dir: project_trickle_bundle(user_id: OWNER_SRC_USER_ID, email: "owner@example.com", is_owner: true),
          create_user: true
        )

        expect(Project.find(PROJECT_ID).creator_id).to eq(owner[:user_id])
        # The member who migrated first is still a member (membership is not stripped).
        expect(User.find(member[:user_id]).projects.map(&:id)).to include(PROJECT_ID)
        expect(User.find(owner[:user_id]).projects.map(&:id)).to include(PROJECT_ID)
      end

      it "leaves ownership unchanged when a member migrates after the owner" do
        owner = described_class.call(
          input_dir: project_trickle_bundle(user_id: OWNER_SRC_USER_ID, email: "owner@example.com", is_owner: true),
          create_user: true
        )
        member = described_class.call(
          input_dir: project_trickle_bundle(user_id: MEMBER_SRC_USER_ID, email: "member@example.com", is_owner: false),
          create_user: true
        )

        expect(Project.find(PROJECT_ID).creator_id).to eq(owner[:user_id])
        expect(User.find(member[:user_id]).projects.map(&:id)).to include(PROJECT_ID)
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
        result = described_class.call(input_dir: write_bundle(schema_version: "1.0"))

        expect(result[:success]).to be(false)
        expect(result[:error_class]).to eq("UserDataImportService::ValidationError")
      end
    end

    context "reference-table remapping" do
      it "remaps a sample FK to an existing target row that has a different id" do
        existing_hg = create(:host_genome, name: "Homo sapiens remap")
        t = bundle_tables
        # Bundle carries the reference row under a foreign id; target already has it by name.
        t[:host_genomes] = [{ id: 9_990_001, name: "Homo sapiens remap", created_at: now, updated_at: now }]
        t[:samples][0][:host_genome_id] = 9_990_001

        result = described_class.call(input_dir: write_bundle(tables: t), create_user: true)

        expect(result[:success]).to be(true)
        expect(Sample.find(SAMPLE_ID).host_genome_id).to eq(existing_hg.id)
        expect(HostGenome.where(name: "Homo sapiens remap").count).to eq(1) # reused, not duplicated
      end

      it "raises ImportError naming a host_genome absent on the target (never creates it)" do
        t = bundle_tables
        t[:host_genomes] = [{ id: 9_990_002, name: "Martian genome", created_at: now, updated_at: now }]
        t[:samples][0][:host_genome_id] = 9_990_002

        result = nil
        expect do
          result = described_class.call(input_dir: write_bundle(tables: t), create_user: true)
        end.not_to(change { HostGenome.count })

        expect(result[:success]).to be(false)
        expect(result[:error_class]).to eq("UserDataImportService::ImportError")
        expect(result[:error]).to include("host_genomes not found on target").and(include("Martian genome"))
        expect(Sample.exists?(SAMPLE_ID)).to be(false) # transaction rolled back
      end

      it "remaps pipeline_run.alignment_config_id to an existing target row with a different id" do
        existing_ac = create(:alignment_config, name: "2099-12-31")
        t = bundle_tables
        t[:alignment_configs] = [{ id: 9_990_004, name: "2099-12-31", created_at: now, updated_at: now }]
        t[:pipeline_runs][0][:alignment_config_id] = 9_990_004

        result = described_class.call(input_dir: write_bundle(tables: t), create_user: true)

        expect(result[:success]).to be(true)
        expect(PipelineRun.find(PIPELINE_RUN_ID).alignment_config_id).to eq(existing_ac.id)
        expect(AlignmentConfig.where(name: "2099-12-31").count).to eq(1) # reused, not created
      end

      it "raises ImportError naming an alignment_config absent on the target" do
        t = bundle_tables
        t[:alignment_configs] = [{ id: 9_990_005, name: "missing-align-config", created_at: now, updated_at: now }]
        t[:pipeline_runs][0][:alignment_config_id] = 9_990_005

        result = described_class.call(input_dir: write_bundle(tables: t), create_user: true)

        expect(result[:success]).to be(false)
        expect(result[:error]).to include("alignment_configs not found on target").and(include("missing-align-config"))
      end

      it "matches locations by composite natural key, creating only when absent" do
        existing_loc = create(:location, name: "Oakland", geo_level: "city", country_name: "USA",
                                         state_name: "California", subdivision_name: "", city_name: "Oakland",
                                         osm_id: 300, locationiq_id: 400)
        t = bundle_tables
        t[:metadata_fields] = [{ id: 9_990_010, name: "collection_location_v2", is_core: 1, base_type: 0, created_at: now, updated_at: now }]
        t[:locations] = [
          { id: 9_990_020, name: "Oakland", geo_level: "city", country_name: "USA", state_name: "California",
            subdivision_name: "", city_name: "Oakland", created_at: now, updated_at: now, },
          { id: 9_990_021, name: "Reykjavik", geo_level: "city", country_name: "Iceland", state_name: "",
            subdivision_name: "", city_name: "Reykjavik", created_at: now, updated_at: now, },
        ]
        t[:metadata] = [
          { id: 9_990_030, sample_id: SAMPLE_ID, key: "collection_location_v2", metadata_field_id: 9_990_010,
            location_id: 9_990_020, created_at: now, updated_at: now, },
        ]

        result = nil
        expect do
          result = described_class.call(input_dir: write_bundle(tables: t), create_user: true)
        end.to change { Location.where(name: "Reykjavik").count }.by(1)

        expect(result[:success]).to be(true)
        expect(Metadatum.find(9_990_030).location_id).to eq(existing_loc.id) # matched, not duplicated
        expect(Location.where(name: "Oakland").count).to eq(1)
      end

      # metadata_fields: core auto-creates; custom is reused-if-present, else its metadata is dropped.
      def field_bundle(field_id:, field_name:, is_core:)
        t = bundle_tables
        t[:metadata_fields] = [{ id: field_id, name: field_name, is_core: is_core, base_type: 0, created_at: now, updated_at: now }]
        t[:metadata] = [{ id: field_id + 1, sample_id: SAMPLE_ID, key: field_name, metadata_field_id: field_id, created_at: now, updated_at: now }]
        t
      end

      it "reuses a custom metadata field already present on the target by name, keeping its metadata" do
        existing = create(:metadata_field, name: "custom_present", is_core: 0)
        t = field_bundle(field_id: 9_990_040, field_name: "custom_present", is_core: 0)

        result = described_class.call(input_dir: write_bundle(tables: t), create_user: true)

        expect(result[:success]).to be(true)
        expect(MetadataField.where(name: "custom_present").count).to eq(1) # reused, not duplicated
        expect(Metadatum.find(9_990_041).metadata_field_id).to eq(existing.id)
      end

      it "does NOT create a custom metadata field absent on the target and drops its metadata" do
        t = field_bundle(field_id: 9_990_042, field_name: "custom_absent", is_core: 0)

        result = nil
        expect do
          result = described_class.call(input_dir: write_bundle(tables: t), create_user: true)
        end.not_to(change { MetadataField.where(name: "custom_absent").count })

        expect(result[:success]).to be(true)
        expect(MetadataField.exists?(name: "custom_absent")).to be(false)
        expect(Metadatum.exists?(9_990_043)).to be(false) # metadata row dropped
        expect(result[:stats][:metadata_dropped_custom_field]).to eq(1)
      end

      it "auto-creates a missing CORE metadata field and keeps its metadata" do
        t = field_bundle(field_id: 9_990_044, field_name: "core_absent", is_core: 1)

        result = nil
        expect do
          result = described_class.call(input_dir: write_bundle(tables: t), create_user: true)
        end.to change { MetadataField.where(name: "core_absent").count }.by(1)

        expect(result[:success]).to be(true)
        new_field = MetadataField.find_by(name: "core_absent")
        expect(Metadatum.find(9_990_045).metadata_field_id).to eq(new_field.id)
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

      context "sfn-desc archive rewrite" do
        let(:arn) { "arn:aws:states:us-west-2:123:execution:wf:cg-#{WORKFLOW_RUN_ID}" }
        let(:wr_prefix) { "s3://#{dst}/samples/#{PROJECT_ID}/#{SAMPLE_ID}/#{WORKFLOW_RUN_ID}/consensus-genome-3" }
        let(:desc_uri) { "#{wr_prefix}/sfn-desc/#{arn}" }
        let(:desc_body) do
          { "output" => { "Result" => { "cg.report" => "s3://#{src}/samples/x/report.tsv" } }.to_json }.to_json
        end

        def sfn_tables
          t = rewrite_tables
          t[:workflow_runs][0][:sfn_execution_arn] = arn
          t
        end

        before do
          allow(S3Util).to receive(:get_s3_file).and_return(nil)
          allow(S3Util).to receive(:get_s3_file).with(desc_uri).and_return(desc_body)
          allow(S3Util).to receive(:upload_to_s3)
        end

        it "swaps the source bucket for the dest bucket inside the sfn-desc object" do
          described_class.call(input_dir: write_bundle(tables: sfn_tables), create_user: true,
                               source_bucket: src, dest_bucket: dst)

          expect(S3Util).to have_received(:upload_to_s3) do |bucket, key, content|
            expect(bucket).to eq(dst)
            expect(key).to end_with("/sfn-desc/#{arn}")
            expect(content).to include("s3://#{dst}/samples/x/report.tsv")
            expect(content).not_to include("s3://#{src}/")
          end
        end

        it "does not write when source and dest buckets match" do
          described_class.call(input_dir: write_bundle(tables: sfn_tables), create_user: true,
                               source_bucket: src, dest_bucket: src)

          expect(S3Util).not_to have_received(:upload_to_s3)
        end

        it "skips the object when it holds no source-bucket path (idempotent)" do
          allow(S3Util).to receive(:get_s3_file).with(desc_uri).and_return({ "output" => { "Result" => {} }.to_json }.to_json)

          described_class.call(input_dir: write_bundle(tables: sfn_tables), create_user: true,
                               source_bucket: src, dest_bucket: dst)

          expect(S3Util).not_to have_received(:upload_to_s3)
        end
      end
    end
  end
end
