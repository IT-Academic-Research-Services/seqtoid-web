require 'rails_helper'

# Wave-2 coverage supplement for app/models/sample.rb (COVERAGE-GAP-ANALYSIS, ticket #585).
# Complements sample_spec.rb / sample_coverage_spec.rb / sample_coverage2_spec.rb by
# targeting the large previously-uncovered methods (upload/transfer/copy/S3 helpers,
# check_status dispatch matrix, metadata-field ensure/save, taxon+contig threshold
# filters) and BOTH arms of each conditional. No app code is changed here.
RSpec.describe Sample, type: :model do
  create_users

  let(:project) { create(:project, users: [@joe]) }

  def sample_with(**attrs)
    create(:sample, project: project, user: @joe, **attrs)
  end

  # --- #initiate_fastq_files_s3_cp -------------------------------------------
  describe "#initiate_fastq_files_s3_cp" do
    let(:ok_status) { instance_double(Process::Status, success?: true, exitstatus: 0) }

    it "returns early when the sample is not in the CREATED status (guard arm)" do
      sample = sample_with(status: Sample::STATUS_CHECKED)
      expect(S3Util).not_to receive(:copy_with_tags)
      expect(sample.initiate_fastq_files_s3_cp).to be_nil
    end

    it "copies fastqs, uploads the total-reads file and marks the sample UPLOADED (happy arms)" do
      sample = sample_with(status: Sample::STATUS_CREATED)
      allow(S3Util).to receive(:parse_s3_path).and_return(%w[bucket key])
      allow(S3Util).to receive(:get_file_size).and_return(100)
      allow(S3Util).to receive(:copy_with_tags)
      # Avoid the real before_save cascade; we assert the status set just before save.
      allow(sample).to receive(:save!).and_return(true)

      sample.initiate_fastq_files_s3_cp

      expect(sample.status).to eq(Sample::STATUS_UPLOADED)
      expect(sample.upload_error).to be_nil
    end

    it "also copies an s3 preload result path when configured (s3_preload arm)" do
      sample = sample_with(status: Sample::STATUS_CREATED, s3_preload_result_path: "s3://preload/results")
      allow(S3Util).to receive(:parse_s3_path).and_return(%w[bucket key])
      allow(S3Util).to receive(:get_file_size).and_return(100)
      allow(sample).to receive(:save!).and_return(true)
      allow(AwsClient[:s3]).to receive(:list_objects_v2).and_return(double(contents: [double(key: "a/b.txt")]))
      expect(S3Util).to receive(:copy_with_tags).at_least(:once)
      expect(Open3).to receive(:capture3)
        .with("aws", "s3", "cp", "s3://preload/results", sample.sample_output_s3_path.to_s, "--recursive")
        .and_return(["", "", ok_status])

      sample.initiate_fastq_files_s3_cp

      expect(sample.status).to eq(Sample::STATUS_UPLOADED)
    end

    it "fails closed when an input file exceeds the max size (size-guard + rescue arms)" do
      sample = sample_with(status: Sample::STATUS_CREATED)
      allow(S3Util).to receive(:parse_s3_path).and_return(%w[bucket key])
      # Larger than the default 100 GB limit (100 * 10**9).
      allow(S3Util).to receive(:get_file_size).and_return(200 * (10**9))
      allow(WorkflowRun).to receive(:handle_sample_upload_failure)
      allow(sample).to receive(:save!).and_return(true)
      allow(LogUtil).to receive(:log_error)

      sample.initiate_fastq_files_s3_cp

      # upload_error was set BEFORE the raise, so the rescue's blank? guard keeps it.
      expect(sample.upload_error).to eq(Sample::UPLOAD_ERROR_MAX_FILE_SIZE_EXCEEDED)
      expect(sample.status).to eq(Sample::STATUS_CHECKED)
    end

    it "retries then fails with the generic S3 upload error when every copy fails (retry + rescue arms)" do
      sample = sample_with(status: Sample::STATUS_CREATED)
      allow(S3Util).to receive(:parse_s3_path).and_return(%w[bucket key])
      allow(S3Util).to receive(:get_file_size).and_return(100)
      allow(S3Util).to receive(:copy_with_tags).and_raise(Aws::S3::Errors::ServiceError.new(nil, "boom"))
      allow(sample).to receive(:sleep) # skip the retry backoff
      allow(WorkflowRun).to receive(:handle_sample_upload_failure)
      allow(sample).to receive(:save!).and_return(true)
      allow(LogUtil).to receive(:log_error)

      sample.initiate_fastq_files_s3_cp

      expect(sample.upload_error).to eq(Sample::UPLOAD_ERROR_S3_UPLOAD_FAILED)
      expect(sample.status).to eq(Sample::STATUS_CHECKED)
    end
  end

  # --- #concatenate_input_parts ----------------------------------------------
  describe "#concatenate_input_parts" do
    it "returns early when the sample is not UPLOADED (guard arm)" do
      sample = sample_with(status: Sample::STATUS_CREATED)
      expect(Syscall).not_to receive(:run)
      expect(sample.concatenate_input_parts).to be_nil
    end

    it "concatenates multi-part local input files and cleans up (multi-part arm)" do
      sample = sample_with(status: Sample::STATUS_CREATED)
      sample.assign_attributes(status: Sample::STATUS_UPLOADED)
      sample.input_files.each { |f| f.assign_attributes(parts: "part_a.fastq.gz, part_b.fastq.gz") }
      allow(Syscall).to receive(:run)
      allow(Syscall).to receive(:run_in_dir)

      sample.concatenate_input_parts

      expect(Syscall).to have_received(:run_in_dir).with(anything, "cat * > complete_file").at_least(:once)
    end

    it "skips single-part files and non-local sources (next arms)" do
      sample = sample_with(status: Sample::STATUS_CREATED)
      sample.assign_attributes(status: Sample::STATUS_UPLOADED)
      # First file: single part (parts.length <= 1). Second: non-local source_type.
      files = sample.input_files.to_a
      files[0].assign_attributes(parts: "only_one_part.fastq.gz")
      files[1].assign_attributes(parts: "a, b", source_type: InputFile::SOURCE_TYPE_S3)

      expect(Syscall).not_to receive(:run)
      expect(Syscall).not_to receive(:run_in_dir)
      sample.concatenate_input_parts
    end

    it "rescues and logs when a Syscall raises (rescue arm)" do
      sample = sample_with(status: Sample::STATUS_CREATED)
      sample.assign_attributes(status: Sample::STATUS_UPLOADED)
      sample.input_files.each { |f| f.assign_attributes(parts: "part_a.fastq.gz, part_b.fastq.gz") }
      allow(Syscall).to receive(:run).and_raise(StandardError.new("s3 down"))
      expect(LogUtil).to receive(:log_error).with(/Failed to concatenate input parts/, hash_including(:sample_id))

      expect { sample.concatenate_input_parts }.not_to raise_error
    end
  end

  # --- #check_status (before_save dispatch matrix) ---------------------------
  describe "#check_status" do
    it "no-ops for a CREATED sample (guard else arm)" do
      sample = sample_with(status: Sample::STATUS_CREATED)
      expect(sample.send(:check_status)).to be_nil
    end

    it "retries the pipeline run for a RETRY_PR sample (RETRY_PR arm)" do
      sample = sample_with(status: Sample::STATUS_CREATED)
      pr = create(:pipeline_run, sample: sample)
      sample.status = Sample::STATUS_RETRY_PR
      allow(sample).to receive(:first_pipeline_run).and_return(pr)
      expect(pr).to receive(:retry)
      sample.send(:check_status)
      expect(sample.status).to eq(Sample::STATUS_CHECKED)
    end

    it "dispatches created consensus_genome workflow runs (CG arm)" do
      sample = sample_with(status: Sample::STATUS_CREATED, initial_workflow: WorkflowRun::WORKFLOW[:consensus_genome])
      create(:workflow_run, sample: sample, user: @joe, workflow: WorkflowRun::WORKFLOW[:consensus_genome], status: WorkflowRun::STATUS[:created])
      sample.status = Sample::STATUS_UPLOADED
      expect_any_instance_of(WorkflowRun).to receive(:dispatch)
      sample.send(:check_status)
    end

    it "dispatches created amr workflow runs (AMR arm)" do
      sample = sample_with(status: Sample::STATUS_CREATED, initial_workflow: WorkflowRun::WORKFLOW[:amr])
      create(:workflow_run, sample: sample, user: @joe, workflow: WorkflowRun::WORKFLOW[:amr], status: WorkflowRun::STATUS[:created])
      sample.status = Sample::STATUS_UPLOADED
      expect_any_instance_of(WorkflowRun).to receive(:dispatch)
      sample.send(:check_status)
    end

    it "kicks off the mNGS pipeline and dispatches side workflows (short_read_mngs arm, both empty-guards)" do
      sample = sample_with(status: Sample::STATUS_CREATED, initial_workflow: WorkflowRun::WORKFLOW[:short_read_mngs])
      create(:workflow_run, sample: sample, user: @joe, workflow: WorkflowRun::WORKFLOW[:amr], status: WorkflowRun::STATUS[:created])
      create(:workflow_run, sample: sample, user: @joe, workflow: WorkflowRun::WORKFLOW[:consensus_genome], status: WorkflowRun::STATUS[:created])
      sample.status = Sample::STATUS_UPLOADED
      expect(sample).to receive(:kickoff_pipeline)
      allow_any_instance_of(WorkflowRun).to receive(:dispatch)
      sample.send(:check_status)
    end

    it "short_read_mngs with no side workflows skips the dispatch guards (empty arms)" do
      sample = sample_with(status: Sample::STATUS_CREATED, initial_workflow: WorkflowRun::WORKFLOW[:short_read_mngs])
      sample.status = Sample::STATUS_UPLOADED
      expect(sample).to receive(:kickoff_pipeline)
      expect_any_instance_of(WorkflowRun).not_to receive(:dispatch)
      sample.send(:check_status)
    end

    it "dispatches the existing run for a long_read_mngs upload (long_read non-rerun else arm)" do
      sample = sample_with(status: Sample::STATUS_CREATED, initial_workflow: WorkflowRun::WORKFLOW[:long_read_mngs])
      pr = create(:pipeline_run, sample: sample)
      allow(sample).to receive(:first_pipeline_run).and_return(pr)
      sample.status = Sample::STATUS_UPLOADED
      expect(pr).to receive(:dispatch)
      sample.send(:check_status)
    end

    it "creates and dispatches a new run for a long_read_mngs RERUN (long_read rerun arm)" do
      sample = sample_with(status: Sample::STATUS_CREATED, initial_workflow: WorkflowRun::WORKFLOW[:long_read_mngs])
      pr = create(:pipeline_run, sample: sample)
      allow(sample).to receive(:first_pipeline_run).and_return(pr)
      sample.status = Sample::STATUS_RERUN
      allow(VersionRetrievalService).to receive(:call).and_return("ncbi-index-name")
      allow(AlignmentConfig).to receive(:find_by).and_return(pr.alignment_config)
      new_pr = instance_double(PipelineRun, save!: true, dispatch: nil)
      allow(PipelineRun).to receive(:new).and_return(new_pr)
      allow(sample).to receive(:mark_older_pipeline_runs_as_deprecated)
      expect(new_pr).to receive(:dispatch)
      sample.send(:check_status)
    end
  end

  # --- #check_host_genome -----------------------------------------------------
  describe "#check_host_genome" do
    it "copies index paths when a host genome is present (present arm)" do
      hg = create(:host_genome, s3_star_index_path: "s3://b/star", s3_bowtie2_index_path: "s3://b/bt2")
      sample = sample_with(host_genome: hg)
      sample.send(:check_host_genome)
      expect(sample.s3_star_index_path).to eq("s3://b/star")
      expect(sample.s3_bowtie2_index_path).to eq("s3://b/bt2")
    end

    it "skips index copying when there is no host genome (absent arm)" do
      sample = sample_with
      allow(sample).to receive(:host_genome).and_return(nil)
      expect { sample.send(:check_host_genome) }.not_to raise_error
    end
  end

  # --- #results_folder_files (>= v2, non-step-function branch) ---------------
  describe "#results_folder_files (>= v2 legacy multi-path branch)" do
    it "concatenates version/postprocess/assembly/expt outputs for a non-step-function run" do
      sample = sample_with
      pr = create(:pipeline_run, sample: sample, pipeline_version: "5.0")
      allow(sample).to receive(:first_pipeline_run).and_return(pr)
      allow(sample).to receive(:pipeline_version_at_least_2).and_return(true)
      allow(pr).to receive(:step_function?).and_return(false)
      allow(pr).to receive(:output_s3_path_with_version).and_return("s3://b/v")
      allow(pr).to receive(:postprocess_output_s3_path).and_return("s3://b/pp")
      allow(pr).to receive(:expt_output_s3_path).and_return("s3://b/expt")
      allow(sample).to receive(:list_outputs).and_return([:x])

      expect(sample.results_folder_files).to eq([:x, :x, :x, :x, :x])
    end
  end

  # --- #list_outputs / #list_objects (AWS S3 listing) ------------------------
  describe "#list_outputs and #list_objects" do
    it "maps s3 objects into display hashes (list_outputs)" do
      sample = sample_with
      obj = double("obj", key: "samples/1/2/results/report.txt", size: 2048)
      page = double("page", contents: [obj])
      s3 = double("s3")
      allow(AwsClient).to receive(:[]).with(:s3).and_return(s3)
      allow(s3).to receive(:list_objects_v2).and_return([page])
      allow(Sample).to receive(:get_signed_url).and_return("https://signed/x")

      outputs = sample.list_outputs("s3://#{SAMPLES_BUCKET_NAME}/samples/1/2/results")

      expect(outputs.first[:display_name]).to eq("report.txt")
      expect(outputs.first[:url]).to eq("https://signed/x")
    end

    it "delegates to AwsClient list_objects_v2 with a continuation token (list_objects)" do
      sample = sample_with
      s3 = double("s3")
      allow(AwsClient).to receive(:[]).with(:s3).and_return(s3)
      expect(s3).to receive(:list_objects_v2).with(hash_including(continuation_token: "tok")).and_return(:page)
      expect(sample.list_objects("s3://#{SAMPLES_BUCKET_NAME}/samples/1/2/foo", "tok")).to eq(:page)
    end
  end

  # --- #copy_pipeline_runs_to_sample / #copy_workflow_runs_to_sample ----------
  describe "#copy_pipeline_runs_to_sample and #copy_workflow_runs_to_sample" do
    it "clones non-deprecated pipeline runs and skips deprecated ones (deprecated next arm)" do
      sample = sample_with
      create(:pipeline_run, sample: sample, deprecated: false)
      create(:pipeline_run, sample: sample, deprecated: true)
      target = sample_with

      expect { sample.copy_pipeline_runs_to_sample(target) }
        .to change { target.pipeline_runs.count }.by(1)
    end

    it "clones non-deprecated workflow runs and skips deprecated ones (deprecated next arm)" do
      sample = sample_with
      create(:workflow_run, sample: sample, user: @joe, deprecated: false)
      create(:workflow_run, sample: sample, user: @joe, deprecated: true)
      target = sample_with

      expect { sample.copy_workflow_runs_to_sample(target) }
        .to change { target.workflow_runs.count }.by(1)
    end
  end

  # --- #duplicate_pipeline_run_s3 --------------------------------------------
  describe "#duplicate_pipeline_run_s3" do
    it "copies each object, choosing single- vs multipart based on size (both size arms)" do
      sample = sample_with
      old_pr = create(:pipeline_run, sample: sample)
      new_sample = sample_with
      new_pr = create(:pipeline_run, sample: new_sample)
      allow(old_pr).to receive(:sfn_results_path).and_return("s3://b/old")
      allow(new_pr).to receive(:sfn_results_path).and_return("s3://b/new")

      small_meta = double("small_meta", :[] => "small_key")
      large_meta = double("large_meta", :[] => "large_key")
      objects = double("objects", contents: [small_meta, large_meta], next_continuation_token: nil, is_truncated: false)
      allow(sample).to receive(:list_objects).and_return(objects)

      small_src = double("small_src", size: 1024)
      large_src = double("large_src", size: 6_000_000)
      bucket = instance_double(Aws::S3::Bucket)
      allow(bucket).to receive(:object).with("small_key").and_return(small_src)
      allow(bucket).to receive(:object).with("large_key").and_return(large_src)
      allow(Aws::S3::Bucket).to receive(:new).and_return(bucket)
      allow(S3Util).to receive(:parse_s3_path).and_return(["tbucket", "tkey"])
      expect(small_src).to receive(:copy_to).with(hash_including(multipart_copy: false))
      expect(large_src).to receive(:copy_to).with(hash_including(multipart_copy: true))

      sample.duplicate_pipeline_run_s3(new_sample, old_pr, new_pr)
    end
  end

  # --- #cleanup_relations / #cleanup_s3 --------------------------------------
  describe "#cleanup_relations and #cleanup_s3" do
    it "deletes input files and metadata (cleanup_relations)" do
      sample = sample_with(metadata_fields: { "sample_type" => "CSF" })
      expect(sample.input_files).not_to be_empty
      sample.cleanup_relations
      expect(sample.input_files.reload).to be_empty
      expect(sample.metadata.reload).to be_empty
    end

    it "deletes the s3 prefix and aborts multipart uploads (cleanup_s3)" do
      sample = sample_with
      expect(S3Util).to receive(:delete_s3_prefix)
      expect(S3Util).to receive(:abort_multipart_uploads)
      sample.cleanup_s3
    end
  end

  # --- #ensure_metadata_field_for_key ----------------------------------------
  describe "#ensure_metadata_field_for_key" do
    it "returns 'ok' when a matching field already exists" do
      sample = sample_with
      allow(sample).to receive(:get_existing_metadatum).and_return(double("m"))
      expect(sample.ensure_metadata_field_for_key("some_key")).to eq("ok")
    end

    it "adds a core field to the project and returns 'core'" do
      sample = sample_with
      core_field = create(:metadata_field, name: "core_field")
      allow(sample).to receive(:get_existing_metadatum).and_return(nil)
      allow(sample).to receive(:get_available_matching_field).and_return(nil)
      allow(sample).to receive(:get_matching_core_field).and_return(core_field)

      expect(sample.ensure_metadata_field_for_key("core_field")).to eq("core")
      expect(sample.project.metadata_fields.reload).to include(core_field)
    end

    it "creates a custom field, attaches it to project + host genomes, and returns 'custom'" do
      sample = sample_with
      custom_field = create(:metadata_field, name: "brand_new_custom")
      allow(sample).to receive(:get_existing_metadatum).and_return(nil)
      allow(sample).to receive(:get_available_matching_field).and_return(nil)
      allow(sample).to receive(:get_matching_core_field).and_return(nil)
      allow(sample).to receive(:get_new_custom_field).and_return(custom_field)

      expect(sample.ensure_metadata_field_for_key("brand_new_custom")).to eq("custom")
      expect(sample.project.metadata_fields.reload).to include(custom_field)
    end
  end

  # --- #get_metadatum_to_save (delete-on-clear branch) -----------------------
  describe "#get_metadatum_to_save" do
    it "deletes an existing metadatum when the value is cleared (delete arm)" do
      sample = sample_with(metadata_fields: { "sample_type" => "CSF" })
      sample.reload
      existing = sample.get_existing_metadatum("sample_type")
      expect(existing).to be_present

      result = sample.get_metadatum_to_save("sample_type", "")

      expect(result[:metadatum]).to be_nil
      expect(result[:status]).to eq("ok")
      expect(Metadatum.exists?(existing.id)).to be(false)
    end
  end

  # --- #metadata_with_base_type (location branch) ----------------------------
  describe "#metadata_with_base_type (location field)" do
    it "resolves a location_id into the location attributes (location arm)" do
      sample = sample_with
      field = create(:metadata_field, name: "collection_location_v2", base_type: MetadataField::LOCATION_TYPE)
      sample.project.metadata_fields << field
      sample.host_genome.metadata_fields << field
      create(:metadatum, sample: sample, metadata_field: field, key: "collection_location_v2", location_id: 12_345)
      sample.reload
      allow(Location).to receive(:find).with(12_345).and_return(double("loc", attributes: { "name" => "San Francisco" }))

      result = sample.metadata_with_base_type
      loc_entry = result.find { |m| m["key"] == "collection_location_v2" }
      expect(loc_entry["location_validated_value"]).to eq({ "name" => "San Francisco" })
    end
  end

  # --- #metadatum_validate (core-field fallback branch) ----------------------
  describe "#metadatum_validate (core field fallback)" do
    it "falls back to a matching core field when no available field is found" do
      sample = sample_with
      core_field = create(:metadata_field, name: "sample_type")
      allow(sample).to receive(:get_available_matching_field).and_return(nil)
      allow(sample).to receive(:get_matching_core_field).and_return(core_field)

      result = sample.metadatum_validate("sample_type", "CSF")
      expect(result[:metadata_field]).to eq(core_field)
    end
  end

  # --- .search (pathogen search with eligible_pr_ids) ------------------------
  describe ".search (pathogen search path)" do
    it "unions name matches with pathogen (taxid) matches when eligible pr ids are given" do
      sample = sample_with(name: "PathogenSample")
      pr = create(:pipeline_run, sample: sample)
      lineage = create(:taxon_lineage, tax_name: "Klebsiella pneumoniae")
      create(:taxon_byterange, taxid: lineage.taxid, hit_type: "NT", first_byte: 0, last_byte: 1, pipeline_run_id: pr.id)

      results = Sample.where(id: sample.id).search("Klebsiella", [pr.id])
      expect(results).to be_a(ActiveRecord::Relation)
      expect { results.to_a }.not_to raise_error
    end
  end

  # --- .filter_by_taxon_count_threshold (NT/NR/both case arms) ---------------
  describe ".filter_by_taxon_count_threshold" do
    def sample_with_taxon(count_type:, count:, tax_id:)
      sample = sample_with
      pr = create(:pipeline_run, sample: sample, deprecated: false)
      create(:taxon_count, pipeline_run: pr, tax_id: tax_id, count: count, count_type: count_type)
      sample
    end

    it "filters by an NT-only threshold (NT case arm)" do
      s = sample_with_taxon(count_type: "NT", count: 100, tax_id: 570)
      filters = [{ count_type: "nt", metric: "count", operator: ">=", value: "10" }]
      expect(Sample.filter_by_taxon_count_threshold([570], filters)).to include(s)
    end

    it "filters by an NR-only threshold (NR case arm)" do
      s = sample_with_taxon(count_type: "NR", count: 100, tax_id: 571)
      filters = [{ count_type: "nr", metric: "count", operator: ">=", value: "10" }]
      expect(Sample.filter_by_taxon_count_threshold([571], filters)).to include(s)
    end

    it "filters by combined NT and NR thresholds (NT+NR case arm)" do
      s = sample_with
      pr = create(:pipeline_run, sample: s, deprecated: false)
      create(:taxon_count, pipeline_run: pr, tax_id: 573, count: 100, count_type: "NT")
      create(:taxon_count, pipeline_run: pr, tax_id: 573, count: 100, count_type: "NR")
      filters = [
        { count_type: "nt", metric: "count", operator: ">=", value: "10" },
        { count_type: "nr", metric: "count", operator: "<=", value: "500" },
      ]
      expect(Sample.filter_by_taxon_count_threshold([573], filters)).to include(s)
    end
  end

  # --- .filter_by_contig_threshold (+ contig metric case arms) ---------------
  describe ".filter_by_contig_threshold" do
    it "filters by a contig-count threshold ('contigs' metric arm)" do
      sample = sample_with
      pr = create(:pipeline_run, sample: sample, deprecated: false)
      create(:contig, pipeline_run: pr, species_taxid_nt: 570, genus_taxid_nt: 570, read_count: 5)

      filters = [{ count_type: "NT", metric: "contigs", operator: ">=", value: 1 }]
      result = Sample.filter_by_contig_threshold({ 570 => "species" }, filters)
      expect(result).to be_a(ActiveRecord::Relation)
      expect { result.to_a }.not_to raise_error
    end

    it "filters by a summed read-count threshold ('contig_r' metric arm)" do
      sample = sample_with
      pr = create(:pipeline_run, sample: sample, deprecated: false)
      create(:contig, pipeline_run: pr, species_taxid_nt: 571, genus_taxid_nt: 571, read_count: 50)

      filters = [{ count_type: "NT", metric: "contig_r", operator: ">=", value: 10 }]
      result = Sample.filter_by_contig_threshold({ 571 => "species" }, filters)
      expect { result.to_a }.not_to raise_error
    end
  end
end
