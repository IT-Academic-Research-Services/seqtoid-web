require "rails_helper"

# Branch coverage for app/helpers/samples_helper.rb. The existing companions
# (samples_helper_spec / _coverage2 / _data) cover the small pure helpers; what is left
# undriven are the multi-armed paths that need real records or a stubbed S3 listing:
# get_summary_stats' per-technology step tables, parsed_samples_for_s3_path's filename
# matching and error handling, the individual filter_samples arms, format_samples'
# snapshot / upload-error arms, the HIPAA age clamp in the CSV writer, and
# bulk_create_and_dispatch_workflow_runs' guard clauses.
RSpec.describe SamplesHelper, type: :helper do
  # UserMacros#create_users is not extended for `type: :helper`, so set up users inline
  # (matching the existing spec/helpers/samples_helper_spec.rb pattern).
  before do
    @joe = create(:joe)
  end

  describe "#get_summary_stats" do
    let(:project) { create(:project, users: [@joe]) }
    let(:sample) { create(:sample, project: project, user: @joe) }

    it "uses the modern host-filtering step table for a recent Illumina run" do
      pr = create(:pipeline_run, sample: sample, technology: PipelineRun::TECHNOLOGY_INPUT[:illumina], pipeline_version: "8.2")
      job_stats = {
        "bowtie2_ercc_filtered_out" => { "reads_after" => 900 },
        "fastp_out" => { "reads_after" => 800 },
        "czid_dedup_out" => { "reads_after" => 700 },
      }

      result = helper.get_summary_stats(job_stats, pr)

      expect(result[:reads_after_bowtie2_ercc_filtered]).to eq(900)
      expect(result[:reads_after_fastp]).to eq(800)
      expect(result[:reads_after_czid_dedup]).to eq(700)
      expect(result).not_to have_key(:reads_after_star)
    end

    it "uses the legacy step table and the czid_dedup step when that stat exists" do
      pr = create(:pipeline_run, sample: sample, technology: PipelineRun::TECHNOLOGY_INPUT[:illumina], pipeline_version: "3.0")
      job_stats = { "star_out" => { "reads_after" => 500 }, "czid_dedup_out" => { "reads_after" => 100 } }

      result = helper.get_summary_stats(job_stats, pr)

      expect(result[:reads_after_star]).to eq(500)
      expect(result[:reads_after_czid_dedup]).to eq(100)
      expect(result).not_to have_key(:reads_after_idseq_dedup)
    end

    it "falls back to the idseq_dedup step name for older runs" do
      pr = create(:pipeline_run, sample: sample, technology: PipelineRun::TECHNOLOGY_INPUT[:illumina], pipeline_version: "3.0")
      job_stats = { "idseq_dedup_out" => { "reads_after" => 42 } }

      result = helper.get_summary_stats(job_stats, pr)

      expect(result[:reads_after_idseq_dedup]).to eq(42)
      expect(result[:reads_after_trimmomatic]).to be_nil
    end

    it "reports bases (not reads) for a nanopore run" do
      pr = create(:pipeline_run, sample: sample, technology: PipelineRun::TECHNOLOGY_INPUT[:nanopore], pipeline_version: "0.7")
      job_stats = {
        "original_bases" => { "bases_after" => 1000 },
        "quality_filtered_bases" => { "bases_after" => 900 },
      }

      result = helper.get_summary_stats(job_stats, pr)

      expect(result[:bases_after_original_bases]).to eq(1000)
      expect(result[:bases_after_quality_filtered_bases]).to eq(900)
      expect(result[:bases_after_human_filtered_bases]).to be_nil
    end
  end

  describe "#parsed_samples_for_s3_path" do
    let(:project) { create(:project, users: [@joe]) }
    let(:host_genome) { create(:host_genome) }

    def stub_bucket_listing(keys)
      objects = double("ObjectCollection")
      allow(objects).to receive(:limit).with(SamplesHelper::S3_OBJECT_LIMIT)
                                       .and_return(keys.map { |k| double("Object", key: k) })
      bucket = double("Bucket", objects: objects)
      allow(Aws::S3::Resource).to receive(:new).and_return(double("Resource", bucket: bucket))
      objects
    end

    it "returns nil for a non-s3 URI scheme" do
      expect(helper.parsed_samples_for_s3_path("https://example.com/x", project.id, host_genome.id)).to be_nil
    end

    it "returns nil when the URI carries no bucket" do
      expect(helper.parsed_samples_for_s3_path("s3:/no-bucket/path", project.id, host_genome.id)).to be_nil
    end

    it "pairs R1/R2 files, keeps single-end files and skips unmatched names" do
      stub_bucket_listing([
                            "dir/SampleA_R1_001.fastq.gz",
                            "dir/SampleA_R2_001.fastq.gz",
                            "dir/Undetermined_S0_R1_001.fastq.gz",
                            "dir/notes.txt",
                          ])

      samples = helper.parsed_samples_for_s3_path("s3://bucket/dir", project.id, host_genome.id)

      expect(samples.size).to eq(1)
      sample = samples.first
      expect(sample[:name]).to eq("SampleA")
      expect(sample[:project_id]).to eq(project.id)
      expect(sample[:host_genome_id]).to eq(host_genome.id)
      expect(sample[:input_files_attributes].pluck(:name))
        .to eq(["SampleA_R1_001.fastq.gz", "SampleA_R2_001.fastq.gz"])
      expect(sample[:input_files_attributes].first[:source]).to eq("s3://bucket/dir/SampleA_R1_001.fastq.gz")
    end

    it "logs when the listing hits the object limit" do
      keys = Array.new(SamplesHelper::S3_OBJECT_LIMIT) { |i| "dir/S#{i}_R1_001.fastq.gz" }
      stub_bucket_listing(keys)
      allow(Rails.logger).to receive(:info)

      helper.parsed_samples_for_s3_path("s3://bucket/dir", project.id, host_genome.id)

      expect(Rails.logger).to have_received(:info).with(/tried to list more than #{SamplesHelper::S3_OBJECT_LIMIT} objects/)
    end

    it "logs and RE-RAISES when S3 denies the listing (so the controller can surface it)" do
      objects = stub_bucket_listing([])
      allow(objects).to receive(:limit).and_raise(Aws::S3::Errors::AccessDenied.new(nil, "denied"))
      allow(Rails.logger).to receive(:info)

      expect { helper.parsed_samples_for_s3_path("s3://bucket/dir", project.id, host_genome.id) }
        .to raise_error(Aws::S3::Errors::AccessDenied)
      expect(Rails.logger).to have_received(:info).with(/Aws::S3::Errors::ServiceError/)
    end
  end

  describe "#filter_samples" do
    let(:project) { create(:project, users: [@joe], public_access: 0) }
    let(:other_project) { create(:project, users: [@joe]) }
    let(:host_genome) { create(:host_genome, name: "Mosquito") }
    let!(:target) do
      create(:sample,
             project: project, user: @joe, name: "Target Sample",
             host_genome: host_genome,
             metadata_fields: { "sample_type" => "Serum" },
             workflow_runs_data: [{ workflow: WorkflowRun::WORKFLOW[:consensus_genome] }])
    end
    let!(:decoy) { create(:sample, project: other_project, user: @joe, name: "Decoy") }

    it "returns the scope untouched when there are no filters" do
      expect(helper.filter_samples(Sample.where(id: [target.id, decoy.id]), {}).pluck(:id))
        .to match_array([target.id, decoy.id])
    end

    it "applies every simple filter arm together" do
      filters = {
        projectId: project.id,
        host: [host_genome.id],
        tissue: ["Serum"],
        time: [1.day.ago.to_date.to_s, 1.day.from_now.to_date.to_s],
        visibility: ["private"],
        search: "Target",
        sampleIds: [target.id, decoy.id],
        workflow: WorkflowRun::WORKFLOW[:consensus_genome],
      }

      expect(helper.filter_samples(Sample.where(id: [target.id, decoy.id]), filters).pluck(:id)).to eq([target.id])
    end

    it "accepts sample ids passed as a JSON string" do
      filters = { sampleIds: [target.id].to_json }

      expect(helper.filter_samples(Sample.where(id: [target.id, decoy.id]), filters).pluck(:id)).to eq([target.id])
    end
  end

  describe "#filter_by_metadata_key" do
    let(:project) { create(:project, users: [@joe]) }
    let!(:with_value) { create(:sample, project: project, user: @joe, metadata_fields: { "sample_type" => "Serum" }) }
    let!(:without_value) { create(:sample, project: project, user: @joe, metadata_fields: { "sample_type" => "Plasma" }) }

    it "matches samples carrying the requested value" do
      scope = Sample.where(id: [with_value.id, without_value.id])

      result = helper.send(:filter_by_metadata_key, scope, "sample_type", ["Serum"])

      expect(result.pluck(:id)).to eq([with_value.id])
    end

    it "picks up samples missing the field entirely when 'not_set' is requested" do
      no_metadata = create(:sample, project: project, user: @joe)
      scope = Sample.where(id: [with_value.id, without_value.id, no_metadata.id])

      result = helper.send(:filter_by_metadata_key, scope, "sample_type", ["Serum", "not_set"])

      # The helper combines the two id sets with `[filtered_ids].concat(not_set_ids)`,
      # i.e. a nested array, so only the flat not_set ids survive the final
      # `where(id: ...)`. Pin the behaviour as it actually is: samples that have no
      # metadatum for the field are returned, samples with a non-matching value are not.
      expect(result.pluck(:id)).to include(no_metadata.id)
      expect(result.pluck(:id)).not_to include(without_value.id)
    end
  end

  describe "#format_samples" do
    let(:project) { create(:project, users: [@joe]) }

    it "builds the run info and workflow-run counts for a healthy sample" do
      sample = create(:sample,
                      project: project, user: @joe,
                      pipeline_runs_data: [{ finalized: 1, job_status: PipelineRun::STATUS_CHECKED }],
                      workflow_runs_data: [{ workflow: WorkflowRun::WORKFLOW[:consensus_genome] },
                                           { workflow: WorkflowRun::WORKFLOW[:consensus_genome] },
                                           { workflow: WorkflowRun::WORKFLOW[:amr] },])

      formatted = helper.format_samples(Sample.where(id: sample.id)).first

      expect(formatted[:db_sample].id).to eq(sample.id)
      expect(formatted[:uploader][:id]).to eq(@joe.id)
      expect(formatted[:mngs_run_info]).to be_present
      expect(formatted[:workflow_runs_count_by_workflow]).to eq(
        WorkflowRun::WORKFLOW[:consensus_genome] => 2, WorkflowRun::WORKFLOW[:amr] => 1
      )
      expect(formatted).not_to have_key(:upload_error)
    end

    it "reports the upload error and skips run info for a failed upload" do
      sample = create(:sample, project: project, user: @joe, upload_error: Sample::DO_NOT_PROCESS)

      formatted = helper.format_samples(Sample.where(id: sample.id)).first

      expect(formatted[:upload_error]).to eq(result_status_description: "SKIPPED")
      expect(formatted).not_to have_key(:mngs_run_info)
    end

    it "strips the project/input-file/sample payload in snapshot mode" do
      sample = create(:sample,
                      project: project, user: @joe,
                      pipeline_runs_data: [{ finalized: 1, job_status: PipelineRun::STATUS_CHECKED }])

      formatted = helper.format_samples(Sample.where(id: sample.id), is_snapshot: true).first

      expect(formatted).not_to have_key(:db_sample)
      expect(formatted[:derived_sample_output]).not_to have_key(:pipeline_run)
      expect(formatted[:mngs_run_info]).to be_present
    end

    it "returns an empty list without querying when there are no samples" do
      expect(helper.format_samples(Sample.where(id: -1))).to eq([])
    end
  end

  describe "#generate_sample_list_csv" do
    let(:project) { create(:project, users: [@joe]) }

    it "clamps a human host's age to the HIPAA maximum" do
      sample = create(:sample,
                      project: project, user: @joe,
                      host_genome_name: "Human",
                      pipeline_runs_data: [{ finalized: 1, job_status: PipelineRun::STATUS_CHECKED }],
                      metadata_fields: { "host_age" => (MetadataField::MAX_HUMAN_AGE + 5).to_s })

      csv = helper.generate_sample_list_csv(Sample.where(id: sample.id), include_all_metadata: true)

      expect(csv).to include("≥ #{MetadataField::MAX_HUMAN_AGE}")
      expect(csv).not_to include((MetadataField::MAX_HUMAN_AGE + 5).to_s)
    end

    it "leaves a non-human host's age alone" do
      sample = create(:sample,
                      project: project, user: @joe,
                      host_genome_name: "Mosquito",
                      pipeline_runs_data: [{ finalized: 1, job_status: PipelineRun::STATUS_CHECKED }],
                      metadata_fields: { "host_age" => (MetadataField::MAX_HUMAN_AGE + 5).to_s })

      csv = helper.generate_sample_list_csv(Sample.where(id: sample.id), include_all_metadata: true)

      expect(csv).to include((MetadataField::MAX_HUMAN_AGE + 5).to_s)
    end
  end

  describe "#pipeline_run_info" do
    let(:project) { create(:project, users: [@joe]) }
    let(:sample) { create(:sample, project: project, user: @joe) }

    it "flags assembly runs and reports the ncbi index version" do
      pr = create(:pipeline_run, sample: sample, pipeline_version: "3.1", finalized: 1)

      info = helper.pipeline_run_info(pr, [pr.id], {})

      expect(info[:with_assembly]).to eq(pr.assembly? ? 1 : 0)
      expect(info[:report_ready]).to be(true)
      expect(info[:ncbi_index_version]).to eq(pr.alignment_config.name)
    end
  end

  describe "#bulk_create_and_dispatch_workflow_runs" do
    let(:project) { create(:project, users: [@joe]) }
    let(:sample) { create(:sample, project: project, user: @joe) }

    it "raises for a workflow name that is not in the enum" do
      expect { helper.bulk_create_and_dispatch_workflow_runs([sample.id], "not-a-workflow", @joe) }
        .to raise_error(SamplesHelper::WorkflowNotFoundError)
    end

    it "returns an empty list when every candidate sample already has a run in progress" do
      create(:workflow_run,
             sample: sample, user: @joe,
             workflow: WorkflowRun::WORKFLOW[:amr],
             status: WorkflowRun::STATUS[:running],
             deprecated: false)

      expect(helper.bulk_create_and_dispatch_workflow_runs([sample.id], WorkflowRun::WORKFLOW[:amr], @joe)).to eq([])
    end

    it "returns an empty list when the user cannot update any of the requested samples" do
      stranger = create(:user)

      expect(helper.bulk_create_and_dispatch_workflow_runs([sample.id], WorkflowRun::WORKFLOW[:amr], stranger)).to eq([])
    end

    # SMP-1768 -- soft-deleted samples (e.g. purged by data retention) must be skipped so a
    # bulk AMR fork never creates a dangling run against a sample whose inputs are gone.
    it "skips soft-deleted samples and inserts no run for them" do
      deleted_sample = create(:sample, project: project, user: @joe, deleted_at: Time.now.utc)
      allow_any_instance_of(WorkflowRun).to receive(:dispatch).and_return(true)

      expect do
        result = helper.bulk_create_and_dispatch_workflow_runs([deleted_sample.id], WorkflowRun::WORKFLOW[:amr], @joe)
        expect(result).to eq([])
      end.not_to change(WorkflowRun, :count)
    end

    it "deprecates the old runs, inserts new ones and dispatches them" do
      old_run = create(:workflow_run,
                       sample: sample, user: @joe,
                       workflow: WorkflowRun::WORKFLOW[:amr],
                       status: WorkflowRun::STATUS[:succeeded],
                       deprecated: false)
      allow_any_instance_of(WorkflowRun).to receive(:dispatch).and_return(true)

      new_ids = helper.bulk_create_and_dispatch_workflow_runs([sample.id], WorkflowRun::WORKFLOW[:amr], @joe)

      expect(new_ids.size).to eq(1)
      expect(new_ids).not_to include(old_run.id)
      expect(old_run.reload.deprecated).to be(true)
    end

    it "logs and returns an empty list when the bulk insert blows up" do
      allow(WorkflowRun).to receive(:insert_all!).and_raise(ActiveRecord::StatementInvalid, "boom")
      allow(LogUtil).to receive(:log_error)

      expect(helper.bulk_create_and_dispatch_workflow_runs([sample.id], WorkflowRun::WORKFLOW[:amr], @joe)).to eq([])
      expect(LogUtil).to have_received(:log_error).with("Unexpected error in inserting new workflow runs.", any_args)
    end
  end

  describe "#upload_metadata_for_samples" do
    let(:project) { create(:project, users: [@joe]) }
    let!(:sample) { create(:sample, project: project, user: @joe, name: "S1") }

    it "reports an error for a sample name that does not exist" do
      errors = helper.upload_metadata_for_samples([sample], "Nope" => { "sample_type" => "Serum" })

      expect(errors).to be_present
      expect(errors.first.to_s).to include("Nope")
    end

    it "skips reserved metadata keys entirely" do
      reserved = MetadataField::RESERVED_NAMES.first

      errors = helper.upload_metadata_for_samples([sample], "S1" => { reserved => "anything" })

      expect(errors).to be_empty
    end

    it "reports a save error when the value fails validation" do
      allow(sample).to receive(:ensure_metadata_field_for_key).and_return("core")
      allow(sample).to receive(:get_metadatum_to_save).and_return(status: "error")

      errors = helper.upload_metadata_for_samples([sample], "S1" => { "host_age" => "not-a-number" })

      expect(errors).to be_present
    end

    it "reloads the host genomes when a custom field is created" do
      host_genome = sample.host_genome
      allow(sample).to receive(:host_genome).and_return(host_genome)
      allow(sample).to receive(:ensure_metadata_field_for_key).and_return("custom")
      allow(sample).to receive(:get_metadatum_to_save).and_return(status: "ok", metadatum: nil)
      expect(host_genome).to receive(:reload).at_least(:once)

      expect(helper.upload_metadata_for_samples([sample], "S1" => { "my_custom" => "x" })).to be_empty
    end
  end

  describe ".samples_by_metadata_field" do
    let(:project) { create(:project, users: [@joe]) }

    # The method hands back a grouped relation; every caller consumes it with .count
    # (loading whole rows would violate MySQL's only_full_group_by).
    it "groups on the validated field for a non-location metadata field" do
      sample = create(:sample, project: project, user: @joe, metadata_fields: { "sample_type" => "Serum" })

      result = SamplesHelper.samples_by_metadata_field([sample.id], "sample_type").count

      expect(result).to eq("Serum" => 1)
    end

    it "groups on the location columns for a location metadata field" do
      MetadataField.find_by(name: "collection_location_v2") ||
        create(:metadata_field, name: "collection_location_v2", base_type: MetadataField::LOCATION_TYPE)
      sample = create(:sample, project: project, user: @joe,
                               metadata_fields: { "collection_location_v2" => "California" })

      result = SamplesHelper.samples_by_metadata_field([sample.id], "collection_location_v2").count

      # Grouped on [string_validated_value, locations.name, *geo level names], so the
      # keys come back as arrays; the plain-text value lands in the first slot.
      expect(result.keys.flatten).to include("California")
      expect(result.values.sum).to eq(1)
    end
  end

  describe "#host_genomes_list" do
    it "returns only the host genomes offered as upload options" do
      shown = create(:host_genome, name: "ShownGenome", user: nil)
      hidden = create(:host_genome, name: "HiddenGenome", user: @joe)

      names = helper.host_genomes_list.pluck("name")

      expect(names).to include(shown.name)
      expect(names).not_to include(hidden.name)
    end
  end

  describe "#add_sample_count_to_taxa_with_reads" do
    let(:project) { create(:project, users: [@joe]) }

    it "counts the samples that have reads for each taxon and zeroes out the rest" do
      sample = create(:sample,
                      project: project, user: @joe,
                      pipeline_runs_data: [{
                        finalized: 1,
                        job_status: PipelineRun::STATUS_CHECKED,
                        taxon_counts_data: [{ tax_id: 570, tax_level: 1, count: 10, count_type: "NT" }],
                      }])
      taxid = 570

      taxa = [{ "taxid" => taxid }, { "taxid" => -999 }]
      result = helper.add_sample_count_to_taxa_with_reads(taxa, Sample.where(id: sample.id))

      expect(result.first["sample_count"]).to eq(1)
      expect(result.last["sample_count"]).to eq(0)
    end
  end
end
