require 'rails_helper'

# Supplementary coverage for Sample model (Coverage Wave 4b). Kept in a separate
# file from sample_spec.rb to avoid collision with the parallel pipeline_run
# coverage work in the same model area. Targets the many small helper / path /
# scope / query methods that were previously uncovered.
describe Sample, type: :model do
  create_users

  let(:project) { create(:public_project) }

  describe "s3 path helpers" do
    let(:sample) { create(:sample, project: project) }

    it "#sample_path is samples/<project_id>/<sample_id>" do
      expect(sample.sample_path).to eq("samples/#{project.id}/#{sample.id}")
    end

    it "#sample_input_s3_path points at the fastqs prefix" do
      expect(sample.sample_input_s3_path).to eq("s3://#{SAMPLES_BUCKET_NAME}/#{sample.sample_path}/fastqs")
    end

    it "#sample_output_s3_path points at the results prefix" do
      expect(sample.sample_output_s3_path).to eq("s3://#{SAMPLES_BUCKET_NAME}/#{sample.sample_path}/results")
    end

    it "#sample_postprocess_s3_path points at the postprocess prefix" do
      expect(sample.sample_postprocess_s3_path).to eq("s3://#{SAMPLES_BUCKET_NAME}/#{sample.sample_path}/postprocess")
    end

    it "#sample_expt_s3_path points at the expt prefix" do
      expect(sample.sample_expt_s3_path).to eq("s3://#{SAMPLES_BUCKET_NAME}/#{sample.sample_path}/expt")
    end
  end

  describe "#end_path" do
    let(:sample) { create(:sample, project: project) }

    it "returns the last path segment by default" do
      expect(sample.end_path("a/b/c/d.txt")).to eq("d.txt")
    end

    it "returns the last n segments joined by /" do
      expect(sample.end_path("a/b/c/d.txt", 2)).to eq("c/d.txt")
    end
  end

  describe "#uploaded_from_basespace?" do
    it "is true when the flag is 1" do
      sample = create(:sample, project: project, input_files: [], uploaded_from_basespace: 1)
      expect(sample.uploaded_from_basespace?).to eq(true)
    end

    it "is false when the flag is 0" do
      sample = create(:sample, project: project, uploaded_from_basespace: 0)
      expect(sample.uploaded_from_basespace?).to eq(false)
    end
  end

  describe "#fasta_input?" do
    it "is true when the first input file has a fasta extension" do
      sample = create(:sample, project: project)
      allow(sample.input_files[0]).to receive(:file_extension).and_return("fasta")
      expect(sample.fasta_input?).to eq(true)
    end

    it "is false for fastq input" do
      sample = create(:sample, project: project)
      allow(sample.input_files[0]).to receive(:file_extension).and_return("fastq.gz")
      expect(sample.fasta_input?).to eq(false)
    end
  end

  describe "#skip_deutero_filter_flag" do
    it "is 1 when the host genome skips the deutero filter" do
      hg = create(:host_genome, name: "SkipDeutero", skip_deutero_filter: 1)
      sample = create(:sample, project: project, host_genome: hg)
      expect(sample.skip_deutero_filter_flag).to eq(1)
    end

    it "is 0 when the host genome does not skip the deutero filter" do
      hg = create(:host_genome, name: "KeepDeutero", skip_deutero_filter: 0)
      sample = create(:sample, project: project, host_genome: hg)
      expect(sample.skip_deutero_filter_flag).to eq(0)
    end
  end

  describe "#host_genome_name" do
    it "returns the host genome name" do
      hg = create(:host_genome, name: "Anopheles")
      sample = create(:sample, project: project, host_genome: hg)
      expect(sample.host_genome_name).to eq("Anopheles")
    end
  end

  describe "#default_background_id" do
    it "returns the host genome default background when present" do
      background = create(:background)
      hg = create(:host_genome, name: "HasBackground", default_background_id: background.id)
      sample = create(:sample, project: project, host_genome: hg)
      expect(sample.default_background_id).to eq(background.id)
    end

    it "falls back to Human's default background when the host genome has none" do
      human_background = create(:background)
      create(:host_genome, name: "Human", default_background_id: human_background.id)
      hg = create(:host_genome, name: "NoBackground", default_background_id: nil)
      sample = create(:sample, project: project, host_genome: hg)
      expect(sample.default_background_id).to eq(human_background.id)
    end
  end

  describe "#private_until" do
    it "is created_at offset by the project's private retention window" do
      project = create(:project, days_to_keep_sample_private: 30)
      sample = create(:sample, project: project, created_at: Time.zone.parse("2022-01-01"))
      expect(sample.private_until).to eq(sample.created_at + 30.days)
    end
  end

  describe "#status_url" do
    it "returns the absolute pipeline runs url" do
      sample = create(:sample, project: project)
      expect(sample.status_url).to eq("#{UrlUtil.absolute_base_url}/samples/#{sample.id}/pipeline_runs")
    end
  end

  describe "#input_file_s3_paths" do
    it "returns s3 paths for all input files with no type filter" do
      sample = create(:sample, project: project)
      expect(sample.input_file_s3_paths).to match_array(sample.input_files.map(&:s3_path))
    end

    it "restricts to input files of the requested type" do
      sample = create(:sample, project: project)
      paths = sample.input_file_s3_paths(InputFile::FILE_TYPE_FASTQ)
      expect(paths).to match_array(sample.input_files.by_type(InputFile::FILE_TYPE_FASTQ).map(&:s3_path))
    end
  end

  describe "validations" do
    it "rejects an invalid status" do
      sample = build(:sample, project: project, status: "bogus_status")
      expect(sample).not_to be_valid
      expect(sample.errors[:status]).to be_present
    end

    it "requires uploaded_from_basespace to be 0 or 1" do
      sample = build(:sample, project: project, uploaded_from_basespace: 5)
      expect(sample).not_to be_valid
      expect(sample.errors[:uploaded_from_basespace]).to be_present
    end

    it "rejects an unknown initial_workflow" do
      sample = build(:sample, project: project, initial_workflow: "not-a-workflow")
      expect(sample).not_to be_valid
      expect(sample.errors[:initial_workflow]).to be_present
    end

    it "enforces name uniqueness within a project (case-insensitive)" do
      create(:sample, project: project, name: "Dup Sample")
      dup = build(:sample, project: project, name: "dup sample")
      expect(dup).not_to be_valid
      expect(dup.errors[:name]).to be_present
    end
  end

  describe "#input_files_checks" do
    it "flags identical read1/read2 sources on a paired upload" do
      sample = build(
        :sample,
        project: project,
        input_files: [
          build(:local_web_input_file, name: "r1.fastq.gz", source: "s3://bucket/same.fastq.gz"),
          build(:local_web_input_file, name: "r2.fastq.gz", source: "s3://bucket/same.fastq.gz"),
        ]
      )
      expect(sample).not_to be_valid
      expect(sample.errors[:input_fastqs].join).to include("identical read 1 source and read 2 source")
    end

    it "flags an invalid number of input fastqs" do
      sample = build(:sample, project: project, input_files: [])
      expect(sample).not_to be_valid
      expect(sample.errors[:input_fastqs].join).to include("invalid number")
    end
  end

  describe "required / missing metadata fields" do
    # A required metadata field must also be core + default + default_for_new_host_genome
    # (see MetadataField#metadata_field_validations), so set all the dependent flags.
    let!(:required_field) do
      create(:metadata_field, name: "req_field", is_required: 1, is_default: 1, is_core: 1, default_for_new_host_genome: 1)
    end
    # host_genome created after the field so add_default_metadata_fields! auto-associates it.
    let(:host_genome) { create(:host_genome, name: "MetaHost") }
    let(:sample) do
      project.metadata_fields << required_field unless project.metadata_fields.include?(required_field)
      host_genome.metadata_fields << required_field unless host_genome.metadata_fields.include?(required_field)
      create(:sample, project: project, host_genome: host_genome)
    end

    it "#required_metadata_fields returns the intersection of required project+host fields" do
      expect(sample.required_metadata_fields).to include(required_field)
    end

    it "#missing_required_metadata_fields returns required fields with no metadatum" do
      expect(sample.missing_required_metadata_fields).to include(required_field)
    end
  end

  describe ".owned_by_user" do
    it "returns only samples owned by the given user" do
      mine = create(:sample, project: project, user: @joe)
      create(:sample, project: project, user: @admin)
      expect(Sample.owned_by_user(@joe)).to contain_exactly(mine)
    end
  end

  describe ".by_time" do
    it "returns samples created within the inclusive day range" do
      in_range = create(:sample, project: project, created_at: Date.parse("2022-06-21").noon)
      out_of_range = create(:sample, project: project, created_at: Date.parse("2022-06-30").noon)
      results = Sample.by_time(start_date: Date.parse("2022-06-20"), end_date: Date.parse("2022-06-24"))
      expect(results).to include(in_range)
      expect(results).not_to include(out_of_range)
    end
  end

  describe ".non_deleted" do
    it "excludes soft-deleted samples" do
      kept = create(:sample, project: project)
      deleted = create(:sample, project: project, deleted_at: Time.now.utc)
      expect(Sample.non_deleted).to include(kept)
      expect(Sample.non_deleted).not_to include(deleted)
    end
  end

  describe ".viewable" do
    it "returns none for a nil user" do
      expect(Sample.viewable(nil)).to eq(Sample.none)
    end

    it "returns all samples for an admin" do
      sample = create(:sample, project: project)
      expect(Sample.viewable(@admin)).to include(sample)
      expect(Sample.viewable(@admin).count).to eq(Sample.count)
    end

    it "returns public-project samples for a non-admin" do
      public_project = create(:public_project, days_to_keep_sample_private: 365)
      public_sample = create(:sample, project: public_project, created_at: 366.days.ago)
      expect(Sample.viewable(@joe)).to include(public_sample)
    end
  end

  describe ".editable / .my_data" do
    it "returns nil editable for a nil user" do
      expect(Sample.editable(nil)).to be_nil
    end

    it "returns all for an admin" do
      sample = create(:sample, project: project)
      expect(Sample.editable(@admin)).to include(sample)
      expect(Sample.editable(@admin).count).to eq(Sample.count)
    end

    it "returns only samples in the user's projects for a non-admin" do
      joe_project = create(:project, users: [@joe])
      mine = create(:sample, project: joe_project)
      create(:sample, project: project)
      expect(Sample.editable(@joe)).to contain_exactly(mine)
      expect(Sample.my_data(@joe)).to contain_exactly(mine)
    end
  end

  describe ".public_samples / .private_samples" do
    it "partitions samples by public access + retention window" do
      public_project = create(:public_project, days_to_keep_sample_private: 365)
      public_sample = create(:sample, project: public_project, created_at: 366.days.ago)

      private_project = create(:project, public_access: 0, days_to_keep_sample_private: 365)
      private_sample = create(:sample, project: private_project, created_at: 1.day.ago)

      expect(Sample.public_samples).to include(public_sample)
      expect(Sample.public_samples).not_to include(private_sample)
      expect(Sample.private_samples).to include(private_sample)
      expect(Sample.private_samples).not_to include(public_sample)
    end
  end

  describe ".current_stalled_local_uploads / .orphaned_created_uploads" do
    it "finds created local uploads older than the delay" do
      stalled = create(
        :sample,
        project: project,
        status: Sample::STATUS_CREATED,
        created_at: 4.hours.ago
      )
      create(
        :sample,
        project: project,
        status: Sample::STATUS_CREATED,
        created_at: 1.minute.ago
      )
      expect(Sample.current_stalled_local_uploads).to include(stalled)
      expect(Sample.orphaned_created_uploads).to include(stalled)
    end
  end

  describe ".get_signed_url" do
    it "returns nil when the key is blank" do
      expect(Sample.get_signed_url(nil)).to be_nil
      expect(Sample.get_signed_url("")).to be_nil
    end

    it "presigns a GET url when the key is present" do
      expect(S3_PRESIGNER).to receive(:presigned_url)
        .with(:get_object, hash_including(key: "some/key", bucket: SAMPLES_BUCKET_NAME))
        .and_return("https://signed.example/some/key")
      expect(Sample.get_signed_url("some/key")).to eq("https://signed.example/some/key")
    end

    it "logs and returns nil on presign failure" do
      allow(S3_PRESIGNER).to receive(:presigned_url).and_raise(StandardError.new("boom"))
      expect(LogUtil).to receive(:log_error)
      expect(Sample.get_signed_url("some/key")).to be_nil
    end
  end

  describe ".search" do
    it "returns scoped when the search term is falsey" do
      sample = create(:sample, project: project)
      expect(Sample.search(nil)).to include(sample)
      expect(Sample.search(nil).count).to eq(Sample.count)
    end

    it "matches on sample name" do
      match = create(:sample, project: project, name: "Findable Alpha")
      create(:sample, project: project, name: "Other Beta")
      expect(Sample.search("Findable")).to include(match)
    end
  end

  describe "#pipeline_versions and #pipeline_run_by_version" do
    let(:sample) { create(:sample, project: project) }

    it "returns distinct pipeline versions for runs with taxon counts" do
      pr = create(:pipeline_run, sample: sample, pipeline_version: "7.1")
      create(:taxon_count, pipeline_run: pr)
      expect(sample.pipeline_versions).to include("7.1")
    end

    it "#pipeline_run_by_version prefers a run that has taxon counts" do
      pr_with_counts = create(:pipeline_run, sample: sample, pipeline_version: "7.1")
      create(:taxon_count, pipeline_run: pr_with_counts)
      expect(sample.pipeline_run_by_version("7.1")).to eq(pr_with_counts)
    end
  end

  describe "#first_pipeline_run" do
    it "returns the most recently created pipeline run" do
      sample = create(:sample, project: project)
      create(:pipeline_run, sample: sample, created_at: 2.days.ago)
      newest = create(:pipeline_run, sample: sample, created_at: 1.hour.ago)
      expect(sample.first_pipeline_run).to eq(newest)
    end
  end

  describe "#metadatum_validate" do
    # For an unknown key no metadata field is found, so metadatum_validate builds an
    # empty Metadatum (no field/key/sample set) whose #valid? is false -- the method
    # returns that Metadatum's errors and a nil metadata_field.
    it "returns the (invalid) metadatum errors and nil field for an unknown key" do
      sample = create(:sample, project: project)
      result = sample.metadatum_validate("totally_unknown_field", "value")
      expect(result[:metadata_field]).to be_nil
      expect(result[:errors]).to be_present
    end

    it "validates against a matching field when one exists on the project" do
      field = create(:metadata_field, name: "known_field")
      sample = create(:sample, project: project)
      # get_available_matching_field looks at sample.project.metadata_fields.
      sample.project.metadata_fields << field
      result = sample.metadatum_validate("known_field", "value")
      expect(result[:metadata_field]).to eq(field)
    end
  end

  describe "#move_to_project" do
    it "moves s3 objects and updates the project id" do
      sample = create(:sample, project: project)
      target_project = create(:project)
      expect(Syscall).to receive(:s3_mv_recursive)
      sample.move_to_project(target_project.id)
      expect(sample.reload.project_id).to eq(target_project.id)
    end
  end

  describe "#create_and_dispatch_workflow_run" do
    it "creates a workflow run and dispatches it" do
      sample = create(:sample, project: project)
      allow_any_instance_of(WorkflowRun).to receive(:dispatch).and_return(true)
      wr = sample.create_and_dispatch_workflow_run(WorkflowRun::WORKFLOW[:consensus_genome], @joe.id)
      expect(wr).to be_persisted
      expect(wr.workflow).to eq(WorkflowRun::WORKFLOW[:consensus_genome])
    end

    # SMP-1768 -- a forked run started against a soft-deleted sample can never succeed and
    # would leave a dangling workflow_run row, so it must be refused before creating one.
    it "raises SampleDeletedError and creates no run for a soft-deleted sample" do
      sample = create(:sample, project: project, deleted_at: Time.now.utc)
      allow_any_instance_of(WorkflowRun).to receive(:dispatch).and_return(true)

      expect do
        expect do
          sample.create_and_dispatch_workflow_run(WorkflowRun::WORKFLOW[:consensus_genome], @joe.id)
        end.to raise_error(Sample::SampleDeletedError)
      end.not_to change(WorkflowRun, :count)
    end
  end

  describe "#copy_to_project" do
    it "raises when copying into the same project" do
      sample = create(:sample, project: project)
      expect { sample.copy_to_project(project) }.to raise_error("Projects can't be the same")
    end
  end
end
