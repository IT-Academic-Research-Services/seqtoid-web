# frozen_string_literal: true

require "rails_helper"

# Branch-coverage companion #3 for app/models/bulk_download.rb.
#
# bulk_download_branches_spec.rb covers the command/key builders and
# bulk_download_branches2_spec.rb covers params_checks / execution_type /
# create_biom_file. This file takes the arms nothing else drives:
#   - params / convert_params_to_json memoization arms
#   - viewable: admin vs non-admin
#   - output_file_presigned_url: non-success guard, the three filename arms and
#     the rescue arm
#   - log_stream_name / log_url: arn present vs nil, ECS vs non-ECS execution
#   - success_url / error_url / progress_url: blank vs present server host
#   - aegea_ecs_submit_command: the Rails.env.development? redirect
#   - bulk_download_ecs_task_command: every download_type arm plus the
#     "nothing to download" fall-through
#   - write_output_files_to_s3_tar_writer: the includes-dispatch chain, the
#     per-type body arms, the failure rescue and the failed-sample logging
#   - generate_download_file: the CG / biom / tar arms and the tar sub-arms
#   - get_technology, verify_and_mark_success, kickoff
RSpec.describe BulkDownload, type: :model do
  create_users

  let(:project) { create(:project, users: [@joe], name: "Branch Project") }
  let(:sample_one) { create(:sample, project: project, user: @joe, name: "Branch Sample One") }
  let(:sample_two) { create(:sample, project: project, user: @joe, name: "Branch Sample Two") }

  # params_checks runs on save, so build download types whose params are already valid.
  def make_download(download_type, params = {}, status: BulkDownload::STATUS_WAITING)
    bd = build(:bulk_download, user: @joe, download_type: download_type, status: status)
    bd.params = params.transform_values { |value| { "value" => value } }
    bd.save!
    bd
  end

  describe "#params" do
    it "parses params_json lazily when nothing has been assigned yet" do
      bd = build(:bulk_download, user: @joe, download_type: "sample_overview")
      bd.params_json = { "include_metadata" => { "value" => true } }.to_json

      expect(bd.params).to eq("include_metadata" => { "value" => true })
    end

    it "returns nil when neither params nor params_json are set" do
      bd = build(:bulk_download, user: @joe, download_type: "sample_overview")
      expect(bd.params).to be_nil
    end

    it "keeps an explicitly assigned params hash instead of re-parsing params_json" do
      bd = build(:bulk_download, user: @joe, download_type: "sample_overview")
      bd.params_json = { "from_json" => 1 }.to_json
      bd.params = { "assigned" => 2 }

      expect(bd.params).to eq("assigned" => 2)
    end
  end

  describe "#convert_params_to_json" do
    it "serializes assigned params on save" do
      bd = make_download("sample_overview", { "include_metadata" => true })
      expect(JSON.parse(bd.params_json)).to eq("include_metadata" => { "value" => true })
    end

    it "leaves params_json untouched when there are no params" do
      bd = build(:bulk_download, user: @joe, download_type: "sample_overview")
      bd.save!
      expect(bd.params_json).to be_nil
    end
  end

  describe ".viewable" do
    it "returns every non-deleted download for an admin" do
      mine = create(:bulk_download, user: @joe, download_type: "sample_overview")
      theirs = create(:bulk_download, user: @admin, download_type: "sample_overview")

      expect(described_class.viewable(@admin)).to include(mine, theirs)
    end

    it "returns only the user's own downloads for a non-admin" do
      mine = create(:bulk_download, user: @joe, download_type: "sample_overview")
      theirs = create(:bulk_download, user: @admin, download_type: "sample_overview")

      viewable = described_class.viewable(@joe)
      expect(viewable).to include(mine)
      expect(viewable).not_to include(theirs)
    end
  end

  describe "#validate_access_token" do
    it "is true when the token matches" do
      bd = create(:bulk_download, user: @joe, download_type: "sample_overview")
      expect(bd.validate_access_token(bd.access_token)).to be(true)
    end

    it "is false when the token does not match" do
      bd = create(:bulk_download, user: @joe, download_type: "sample_overview")
      expect(bd.validate_access_token("nope")).to be(false)
    end
  end

  describe "#output_file_presigned_url" do
    it "returns nil without presigning when the download has not succeeded" do
      bd = create(:bulk_download, user: @joe, download_type: "sample_overview", status: BulkDownload::STATUS_RUNNING)
      expect(S3_PRESIGNER).not_to receive(:presigned_url)

      expect(bd.output_file_presigned_url).to be_nil
    end

    it "presigns a .tar.gz attachment for a regular download" do
      bd = create(:bulk_download, user: @joe, download_type: "sample_overview", status: BulkDownload::STATUS_SUCCESS)
      allow(S3_PRESIGNER).to receive(:presigned_url) do |_op, opts|
        expect(opts[:response_content_disposition]).to end_with(".tar.gz\"")
        "https://example.com/signed"
      end

      expect(bd.output_file_presigned_url).to eq("https://example.com/signed")
    end

    it "presigns a .fa attachment for a concatenated consensus genome download" do
      bd = make_download(
        BulkDownloadTypesHelper::CONSENSUS_GENOME_DOWNLOAD_TYPE,
        { "download_format" => BulkDownloadTypesHelper::SINGLE_FILE_CONCATENATED_DOWNLOAD },
        status: BulkDownload::STATUS_SUCCESS
      )
      disposition = nil
      allow(S3_PRESIGNER).to receive(:presigned_url) do |_op, opts|
        disposition = opts[:response_content_disposition]
        "https://example.com/cg"
      end

      expect(bd.output_file_presigned_url).to eq("https://example.com/cg")
      expect(disposition).to end_with(".fa\"")
    end

    it "presigns a .biom attachment for a biom download" do
      bd = make_download(
        BulkDownloadTypesHelper::BIOM_FORMAT_DOWNLOAD_TYPE,
        {
          "metric" => "NT.rpm",
          "background_id" => nil,
          "categories" => [],
        },
        status: BulkDownload::STATUS_SUCCESS
      )
      disposition = nil
      allow(S3_PRESIGNER).to receive(:presigned_url) do |_op, opts|
        disposition = opts[:response_content_disposition]
        "https://example.com/biom"
      end

      expect(bd.output_file_presigned_url).to eq("https://example.com/biom")
      expect(disposition).to end_with(".biom\"")
    end

    it "logs and returns nil when presigning raises" do
      bd = create(:bulk_download, user: @joe, download_type: "sample_overview", status: BulkDownload::STATUS_SUCCESS)
      allow(S3_PRESIGNER).to receive(:presigned_url).and_raise(StandardError, "presign boom")
      expect(LogUtil).to receive(:log_error).with(/BulkDownloadPresignError/, anything)

      expect(bd.output_file_presigned_url).to be_nil
    end
  end

  describe "#log_stream_name and #log_url" do
    let(:bd) { create(:bulk_download, user: @joe, download_type: "sample_overview") }

    it "returns nil for both when there is no ecs task arn" do
      expect(bd.log_stream_name).to be_nil
      expect(bd.log_url).to be_nil
    end

    it "derives the stream name from the last arn segment" do
      bd.update!(ecs_task_arn: "arn:aws:ecs:us-west-2:123:task/cluster/abc123")
      expect(bd.log_stream_name).to eq("bulk_downloads/bulk_downloads/abc123")
    end

    it "builds a cloudwatch url for an ECS download with an arn" do
      bd.update!(ecs_task_arn: "arn:aws:ecs:us-west-2:123:task/cluster/abc123")
      allow(bd).to receive(:execution_type).and_return(BulkDownloadTypesHelper::ECS_EXECUTION_TYPE)
      allow(AwsUtil).to receive(:get_cloudwatch_url).and_return("https://console/logs")

      expect(bd.log_url).to eq("https://console/logs")
    end

    it "returns nil for a resque download even when an arn is present" do
      bd.update!(ecs_task_arn: "arn:aws:ecs:us-west-2:123:task/cluster/abc123")
      allow(bd).to receive(:execution_type).and_return(BulkDownloadTypesHelper::RESQUE_EXECUTION_TYPE)

      expect(bd.log_url).to be_nil
    end
  end

  describe "callback urls" do
    let(:bd) { create(:bulk_download, user: @joe, download_type: "sample_overview") }

    it "returns nil for all three urls when the server host is blank" do
      allow(bd).to receive(:server_host).and_return("")

      expect(bd.success_url).to be_nil
      expect(bd.error_url).to be_nil
      expect(bd.progress_url).to be_nil
    end

    it "builds all three urls from the server host when it is present" do
      allow(bd).to receive(:server_host).and_return("https://czid.test")

      expect(bd.success_url).to start_with("https://czid.test")
      expect(bd.success_url).to include(bd.access_token)
      expect(bd.error_url).to start_with("https://czid.test")
      expect(bd.progress_url).to start_with("https://czid.test")
    end
  end

  describe "#aegea_ecs_submit_command in development" do
    let(:bd) { create(:bulk_download, user: @joe, download_type: "sample_overview") }

    it "redirects the cluster and staging bucket to the deployment stage" do
      allow(bd).to receive(:get_app_config).and_return(nil)
      allow(Rails.env).to receive(:development?).and_return(true)
      allow(bd).to receive(:aegea_deployment_stage).and_return("staging")

      command = bd.aegea_ecs_submit_command(executable_file_path: "/tmp/exec.sh")

      expect(command).to include("idseq-fargate-tasks-staging")
      expect(command).to include("aegea-ecs-execute-staging")
    end
  end

  describe "#aegea_deployment_stage" do
    let(:bd) { create(:bulk_download, user: @joe, download_type: "sample_overview") }

    it "uses ENV['ENVIRONMENT'] when it is set" do
      allow(ENV).to receive(:[]).and_call_original
      allow(ENV).to receive(:[]).with("ENVIRONMENT").and_return("prod")
      expect(bd.aegea_deployment_stage).to eq("prod")
    end

    it "falls back to the default stage when ENV['ENVIRONMENT'] is blank" do
      allow(ENV).to receive(:[]).and_call_original
      allow(ENV).to receive(:[]).with("ENVIRONMENT").and_return("")
      expect(bd.aegea_deployment_stage).to eq(BulkDownload::AEGEA_DEV_FALLBACK_STAGE)
    end
  end

  describe "#bulk_download_ecs_task_command" do
    # The command builder needs a success url, which is derived from the server host.
    def command_for(bulk_download)
      allow(bulk_download).to receive(:server_host).and_return("https://czid.test")
      bulk_download.bulk_download_ecs_task_command
    end

    before do
      # WorkflowRun#output_path resolves the real SFN description from S3; the
      # command builder only cares that it returns a path.
      allow_any_instance_of(WorkflowRun).to receive(:output_path) { |run, output| "s3://bucket/#{run.id}/#{output}" }
    end

    it "returns nil when the download type produces no src urls" do
      bd = make_download("sample_overview")
      bd.pipeline_runs << create(:pipeline_run, sample: sample_one)

      expect(command_for(bd)).to be_nil
    end

    it "builds unmapped.fasta names from the pipeline runs" do
      bd = make_download(BulkDownloadTypesHelper::UNMAPPED_READS_BULK_DOWNLOAD_TYPE)
      bd.pipeline_runs << create(:pipeline_run, sample: sample_one)

      command = command_for(bd)
      expect(command.join(" ")).to include("unmapped.fasta")
      expect(command.first).to eq("python")
    end

    it "builds reads_nh.fasta names for a .fasta reads_non_host download" do
      bd = make_download(
        BulkDownloadTypesHelper::READS_NON_HOST_BULK_DOWNLOAD_TYPE, { "taxa_with_reads" => "all", "file_format" => ".fasta" }
      )
      bd.pipeline_runs << create(:pipeline_run, sample: sample_one)

      expect(command_for(bd).join(" ")).to include("reads_nh.fasta")
    end

    it "builds per-read-pair names for a .fastq short-read reads_non_host download" do
      bd = make_download(
        BulkDownloadTypesHelper::READS_NON_HOST_BULK_DOWNLOAD_TYPE, { "taxa_with_reads" => "all", "file_format" => ".fastq" }
      )
      pipeline_run = create(:pipeline_run, sample: sample_one, technology: PipelineRun::TECHNOLOGY_INPUT[:illumina])
      bd.pipeline_runs << pipeline_run

      joined = command_for(bd).join(" ")
      expect(joined).to include("reads_nh_R1.fastq")
    end

    it "builds a single name for a long-read .fastq reads_non_host download" do
      long_read_sample = create(:sample, project: project, user: @joe, name: "Long Read Sample",
                                         initial_workflow: WorkflowRun::WORKFLOW[:long_read_mngs])
      bd = make_download(
        BulkDownloadTypesHelper::READS_NON_HOST_BULK_DOWNLOAD_TYPE, { "taxa_with_reads" => "all", "file_format" => ".fastq" }
      )
      bd.pipeline_runs << create(:pipeline_run, sample: long_read_sample,
                                                technology: PipelineRun::TECHNOLOGY_INPUT[:nanopore])

      joined = command_for(bd).join(" ")
      expect(joined).to include("reads_nh.fastq")
      expect(joined).not_to include("reads_nh_R1")
    end

    it "builds contigs_nh.fasta names for a contigs_non_host download" do
      bd = make_download(BulkDownloadTypesHelper::CONTIGS_NON_HOST_BULK_DOWNLOAD_TYPE, { "taxa_with_contigs" => "all" })
      # nanopore -> supports_assembly? -> contigs_fasta_s3_path is a real path, so the (post-hardening)
      # src-url completeness guard in s3_tar_writer_command doesn't reject a nil src url.
      bd.pipeline_runs << create(:pipeline_run, sample: sample_one, technology: PipelineRun::TECHNOLOGY_INPUT[:nanopore])

      expect(command_for(bd).join(" ")).to include("contigs_nh.fasta")
    end

    it "uses the legacy star tab name for an old-pipeline host_gene_counts download" do
      bd = make_download(BulkDownloadTypesHelper::HOST_GENE_COUNTS_BULK_DOWNLOAD_TYPE)
      bd.pipeline_runs << create(:pipeline_run, sample: sample_one, pipeline_version: "6.0")

      expect(command_for(bd).join(" ")).to include("reads_per_gene.star.tab")
    end

    it "uses the kallisto name for a new-host-filtering host_gene_counts download" do
      bd = make_download(BulkDownloadTypesHelper::HOST_GENE_COUNTS_BULK_DOWNLOAD_TYPE)
      bd.pipeline_runs << create(:pipeline_run, sample: sample_one, pipeline_version: "8.0")

      expect(command_for(bd).join(" ")).to include("reads_per_transcript.kallisto.tsv")
    end

    it "builds consensus.fa names from the workflow runs" do
      bd = make_download(
        BulkDownloadTypesHelper::CONSENSUS_GENOME_DOWNLOAD_TYPE, { "download_format" => BulkDownloadTypesHelper::SEPARATE_FILES_DOWNLOAD }
      )
      bd.workflow_runs << create(:workflow_run, sample: sample_one, user: @joe,
                                                workflow: WorkflowRun::WORKFLOW[:consensus_genome])

      expect(command_for(bd).join(" ")).to include("consensus.fa")
    end

    it "builds directory names for a consensus genome intermediate files download" do
      bd = make_download(BulkDownloadTypesHelper::CONSENSUS_GENOME_INTERMEDIATE_OUTPUT_FILES_BULK_DOWNLOAD_TYPE)
      bd.workflow_runs << create(:workflow_run, sample: sample_one, user: @joe,
                                                workflow: WorkflowRun::WORKFLOW[:consensus_genome])

      command = command_for(bd)
      tar_name = command[command.index("--tar-names") + 1]
      # Intermediate outputs are unpacked into a per-run directory, so the name
      # ends in a slash rather than a file extension.
      expect(tar_name).to include("Branch Sample One_#{sample_one.id}")
      expect(tar_name).to end_with("/")
    end

    it "builds bare prefixes for an amr results download" do
      bd = make_download(BulkDownloadTypesHelper::AMR_RESULTS_BULK_DOWNLOAD)
      bd.workflow_runs << create(:workflow_run, sample: sample_one, user: @joe,
                                                workflow: WorkflowRun::WORKFLOW[:amr])

      command = command_for(bd)
      tar_name = command[command.index("--tar-names") + 1]
      expect(tar_name).to end_with("Branch Sample One_#{sample_one.id}_")
    end

    it "builds contigs.fa names for an amr contigs download" do
      bd = make_download(BulkDownloadTypesHelper::AMR_CONTIGS_BULK_DOWNLOAD)
      bd.workflow_runs << create(:workflow_run, sample: sample_one, user: @joe,
                                                workflow: WorkflowRun::WORKFLOW[:amr])

      expect(command_for(bd).join(" ")).to include("contigs.fa")
    end
  end

  describe "#get_output_file_prefix" do
    it "truncates a very long sample name but keeps the sample id suffix" do
      bd = make_download("sample_overview")
      long_name_sample = create(:sample, project: project, user: @joe, name: "S" * 200)
      prefix = bd.get_output_file_prefix(long_name_sample, project.id => "cleaned_name")

      expect(prefix).to start_with("cleaned_name_#{project.id}/")
      expect(prefix).to end_with("_#{long_name_sample.id}_")
      expect(prefix.length).to be < 200
    end
  end

  describe "#get_technology" do
    it "returns the shared technology when every pipeline run agrees" do
      bd = make_download("sample_overview")
      create(:pipeline_run, sample: sample_one, technology: PipelineRun::TECHNOLOGY_INPUT[:illumina])
      runs = PipelineRun.where(sample_id: sample_one.id)

      expect(bd.get_technology(runs)).to eq(PipelineRun::TECHNOLOGY_INPUT[:illumina])
    end

    it "raises when the pipeline runs mix technologies" do
      bd = make_download("sample_overview")
      create(:pipeline_run, sample: sample_one, technology: PipelineRun::TECHNOLOGY_INPUT[:illumina])
      create(:pipeline_run, sample: sample_two, technology: PipelineRun::TECHNOLOGY_INPUT[:nanopore])
      runs = PipelineRun.where(sample_id: [sample_one.id, sample_two.id])

      expect { bd.get_technology(runs) }.to raise_error(/mix of short-read-mngs and long-read-mngs/)
    end
  end

  describe "#verify_and_mark_success" do
    it "records the output file size when the object exists" do
      bd = create(:bulk_download, user: @joe, download_type: "sample_overview")
      allow(bd).to receive(:fetch_output_file_size).and_return(4096)

      bd.verify_and_mark_success

      expect(bd.reload.status).to eq(BulkDownload::STATUS_SUCCESS)
      expect(bd.output_file_size).to eq(4096)
    end

    it "leaves the size unset when the lookup yields nothing" do
      bd = create(:bulk_download, user: @joe, download_type: "sample_overview")
      allow(bd).to receive(:fetch_output_file_size).and_return(nil)

      bd.verify_and_mark_success

      expect(bd.reload.status).to eq(BulkDownload::STATUS_SUCCESS)
      expect(bd.output_file_size).to be_nil
    end
  end

  describe "#fetch_output_file_size" do
    it "logs and returns nil when the head request fails" do
      bd = create(:bulk_download, user: @joe, download_type: "sample_overview")
      allow(S3_CLIENT).to receive(:head_object).and_raise(StandardError, "no such key")
      expect(LogUtil).to receive(:log_error).with(/BulkDownloadsFileSizeError/, anything)

      expect(bd.fetch_output_file_size).to be_nil
    end
  end

  describe "#kickoff" do
    it "kicks off a K8s job (ECS execution type) when there is a command to run" do
      bd = create(:bulk_download, user: @joe, download_type: "sample_overview")
      allow(bd).to receive(:execution_type).and_return(BulkDownloadTypesHelper::ECS_EXECUTION_TYPE)
      allow(bd).to receive(:bulk_download_ecs_task_command).and_return(["python", "s3_tar_writer.py"])
      # Migrated off aegea/ECS -> a K8s Job on the warm bulk-download node (#846/SMP-1477).
      expect(bd).to receive(:kickoff_k8s_job).with(["python", "s3_tar_writer.py"])

      bd.kickoff
    end

    it "does not kick off an ECS task when there is no command" do
      bd = create(:bulk_download, user: @joe, download_type: "sample_overview")
      allow(bd).to receive(:execution_type).and_return(BulkDownloadTypesHelper::ECS_EXECUTION_TYPE)
      allow(bd).to receive(:bulk_download_ecs_task_command).and_return(nil)
      expect(bd).not_to receive(:kickoff_ecs_task)

      bd.kickoff
    end

    it "enqueues a resque job for a resque download" do
      bd = create(:bulk_download, user: @joe, download_type: "sample_overview")
      allow(bd).to receive(:execution_type).and_return(BulkDownloadTypesHelper::RESQUE_EXECUTION_TYPE)
      expect(bd).not_to receive(:kickoff_ecs_task)
      expect(Resque).to receive(:enqueue).with(GenerateBulkDownload, bd.id)

      bd.kickoff
    end

    it "does nothing for a manual-upload download" do
      bd = create(:bulk_download, user: @joe, download_type: "sample_overview")
      allow(bd).to receive(:execution_type).and_return(BulkDownloadTypesHelper::MANUAL_UPLOAD_TYPE)
      expect(bd).not_to receive(:kickoff_ecs_task)
      expect(Resque).not_to receive(:enqueue)

      bd.kickoff
    end
  end

  describe "#write_output_files_to_s3_tar_writer" do
    let(:s3_tar_writer) { instance_double(S3TarWriter, add_file_with_data: nil) }

    it "writes a taxon report csv per pipeline run for a sample_taxon_report download" do
      bd = make_download(
        BulkDownloadTypesHelper::SAMPLE_TAXON_REPORT_BULK_DOWNLOAD_TYPE, { "workflow" => WorkflowRun::WORKFLOW[:short_read_mngs], "background" => nil }
      )
      bd.pipeline_runs << create(:pipeline_run, sample: sample_one)
      allow(PipelineReportService).to receive(:call).and_return("taxon,csv\n")

      expect(s3_tar_writer).to receive(:add_file_with_data).with(/taxon_report\.csv\z/, "taxon,csv\n")

      bd.write_output_files_to_s3_tar_writer(s3_tar_writer)
      expect(bd.reload.error_message).to be_nil
    end

    it "writes a contig summary csv for a contig_summary_report download" do
      bd = make_download(BulkDownloadTypesHelper::CONTIG_SUMMARY_REPORT_BULK_DOWNLOAD_TYPE)
      pipeline_run = create(:pipeline_run, sample: sample_one)
      bd.pipeline_runs << pipeline_run
      allow_any_instance_of(PipelineRun).to receive(:generate_contig_mapping_table_csv).and_return("contig,csv\n")

      expect(s3_tar_writer).to receive(:add_file_with_data).with(/contig_summary_report\.csv\z/, "contig,csv\n")

      bd.write_output_files_to_s3_tar_writer(s3_tar_writer)
    end

    it "writes an empty fasta when a reads_non_host pipeline run has no reads" do
      bd = make_download(
        BulkDownloadTypesHelper::READS_NON_HOST_BULK_DOWNLOAD_TYPE, { "taxa_with_reads" => 573, "file_format" => ".fasta" }
      )
      bd.pipeline_runs << create(:pipeline_run, sample: sample_one)
      allow(bd).to receive(:get_param_display_name).with('taxa_with_reads').and_return("Klebsiella")
      allow(AlignmentConfig).to receive(:max_lineage_version).and_return(1)
      allow(TaxonLineage).to receive(:versioned_lineages).and_return([instance_double(TaxonLineage, tax_level: 1)])
      allow(bd).to receive(:get_taxon_fasta_from_pipeline_run_combined_nt_nr).and_return(nil)

      expect(s3_tar_writer).to receive(:add_file_with_data).with(/reads_nh_Klebsiella\.fasta\z/, "")

      bd.write_output_files_to_s3_tar_writer(s3_tar_writer)
    end

    it "writes the fetched fasta when a reads_non_host pipeline run has reads" do
      bd = make_download(
        BulkDownloadTypesHelper::READS_NON_HOST_BULK_DOWNLOAD_TYPE, { "taxa_with_reads" => 573, "file_format" => ".fasta" }
      )
      bd.pipeline_runs << create(:pipeline_run, sample: sample_one)
      allow(bd).to receive(:get_param_display_name).with('taxa_with_reads').and_return("Klebsiella")
      allow(AlignmentConfig).to receive(:max_lineage_version).and_return(1)
      allow(TaxonLineage).to receive(:versioned_lineages).and_return([instance_double(TaxonLineage, tax_level: 1)])
      allow(bd).to receive(:get_taxon_fasta_from_pipeline_run_combined_nt_nr).and_return(">read\nACGT\n")

      expect(s3_tar_writer).to receive(:add_file_with_data).with(/reads_nh_Klebsiella\.fasta\z/, ">read\nACGT\n")

      bd.write_output_files_to_s3_tar_writer(s3_tar_writer)
    end

    it "raises when a reads_non_host download has no matching taxon lineage" do
      bd = make_download(
        BulkDownloadTypesHelper::READS_NON_HOST_BULK_DOWNLOAD_TYPE, { "taxa_with_reads" => 573, "file_format" => ".fasta" }
      )
      bd.pipeline_runs << create(:pipeline_run, sample: sample_one)
      allow(AlignmentConfig).to receive(:max_lineage_version).and_return(1)
      allow(TaxonLineage).to receive(:versioned_lineages).and_return([])

      expect { bd.write_output_files_to_s3_tar_writer(s3_tar_writer) }
        .to raise_error(/#{Regexp.escape(BulkDownloadsHelper::READS_NON_HOST_TAXON_LINEAGE_EXPECTED_TEMPLATE % 573)}/)
    end

    it "concatenates contigs for a contigs_non_host download" do
      bd = make_download(BulkDownloadTypesHelper::CONTIGS_NON_HOST_BULK_DOWNLOAD_TYPE, { "taxa_with_contigs" => 573 })
      bd.pipeline_runs << create(:pipeline_run, sample: sample_one)
      allow(bd).to receive(:get_param_display_name).with('taxa_with_contigs').and_return("Klebsiella")
      contig = instance_double(Contig, to_fa: ">contig\nACGT\n")
      allow_any_instance_of(PipelineRun).to receive(:get_contigs_for_taxid).and_return([contig])

      expect(s3_tar_writer).to receive(:add_file_with_data).with(/contigs_nh_Klebsiel\.fasta\z/, ">contig\nACGT\n")

      bd.write_output_files_to_s3_tar_writer(s3_tar_writer)
    end

    it "records failed samples when a pipeline run raises" do
      bd = make_download(
        BulkDownloadTypesHelper::SAMPLE_TAXON_REPORT_BULK_DOWNLOAD_TYPE, { "workflow" => WorkflowRun::WORKFLOW[:short_read_mngs], "background" => nil }
      )
      bd.pipeline_runs << create(:pipeline_run, sample: sample_one)
      allow(PipelineReportService).to receive(:call).and_raise(StandardError, "report boom")
      allow(LogUtil).to receive(:log_error)

      bd.write_output_files_to_s3_tar_writer(s3_tar_writer)

      expect(bd.reload.error_message).to eq(BulkDownloadsHelper::FAILED_SAMPLES_ERROR_TEMPLATE % 1)
    end

    it "updates progress when more than the update delay has elapsed" do
      bd = make_download(
        BulkDownloadTypesHelper::SAMPLE_TAXON_REPORT_BULK_DOWNLOAD_TYPE, { "workflow" => WorkflowRun::WORKFLOW[:short_read_mngs], "background" => nil }
      )
      bd.pipeline_runs << create(:pipeline_run, sample: sample_one)
      allow(PipelineReportService).to receive(:call).and_return("taxon,csv\n")
      allow(bd).to receive(:progress_update_delay).and_return(-1)

      bd.write_output_files_to_s3_tar_writer(s3_tar_writer)

      expect(bd.reload.progress).to eq(1.0)
    end

    it "leaves progress untouched when the update delay has not elapsed" do
      bd = make_download(
        BulkDownloadTypesHelper::SAMPLE_TAXON_REPORT_BULK_DOWNLOAD_TYPE, { "workflow" => WorkflowRun::WORKFLOW[:short_read_mngs], "background" => nil }
      )
      bd.pipeline_runs << create(:pipeline_run, sample: sample_one)
      allow(PipelineReportService).to receive(:call).and_return("taxon,csv\n")

      bd.write_output_files_to_s3_tar_writer(s3_tar_writer)

      expect(bd.reload.progress).to be_nil
    end
  end

  describe "#generate_download_file" do
    it "concatenates and uploads for a consensus genome download" do
      bd = make_download(
        BulkDownloadTypesHelper::CONSENSUS_GENOME_DOWNLOAD_TYPE, { "download_format" => BulkDownloadTypesHelper::SINGLE_FILE_CONCATENATED_DOWNLOAD }
      )
      bd.workflow_runs << create(:workflow_run, sample: sample_one, user: @joe,
                                                workflow: WorkflowRun::WORKFLOW[:consensus_genome])
      allow(ConsensusGenomeConcatService).to receive(:call).and_return(">seq\nACGT\n")
      allow(bd).to receive(:verify_and_mark_success)
      expect(S3Util).to receive(:upload_to_s3).with(bd.download_bucket_name, bd.download_output_key, ">seq\nACGT\n")

      bd.generate_download_file
    end

    it "builds and uploads the biom file for a biom download" do
      bd = make_download(
        BulkDownloadTypesHelper::BIOM_FORMAT_DOWNLOAD_TYPE, { "metric" => "NT.rpm", "background_id" => nil, "categories" => [] }
      )
      bd.pipeline_runs << create(:pipeline_run, sample: sample_one)
      allow(BulkDownloadsHelper).to receive(:generate_biom_format_file).and_return(["/tmp/m", "/tmp/md", "/tmp/tl"])
      allow(bd).to receive(:create_biom_file).and_return("/tmp/out.biom")
      allow(File).to receive(:read).and_call_original
      allow(File).to receive(:read).with("/tmp/out.biom").and_return("biom-bytes")
      allow(bd).to receive(:verify_and_mark_success)
      expect(S3Util).to receive(:upload_to_s3).with(bd.download_bucket_name, bd.download_output_key, "biom-bytes")

      bd.generate_download_file
    end

    context "with the tar-writer path" do
      let(:s3_tar_writer) do
        instance_double(
          S3TarWriter,
          start_streaming: nil,
          add_file_with_data: nil,
          close: nil,
          total_size_processed: 1024,
          process_status: instance_double(Process::Status, success?: true)
        )
      end

      before do
        allow(S3TarWriter).to receive(:new).and_return(s3_tar_writer)
      end

      it "writes a sample overview csv" do
        bd = make_download(BulkDownloadTypesHelper::SAMPLE_OVERVIEW_BULK_DOWNLOAD_TYPE, { "include_metadata" => false })
        bd.pipeline_runs << create(:pipeline_run, sample: sample_one,
                                                  technology: PipelineRun::TECHNOLOGY_INPUT[:illumina])
        allow(bd).to receive(:generate_sample_list_csv).and_return("sample,csv\n")
        allow(bd).to receive(:verify_and_mark_success)

        expect(s3_tar_writer).to receive(:add_file_with_data).with("sample_overviews.csv", "sample,csv\n")

        bd.generate_download_file
      end

      it "writes a consensus genome overview csv" do
        bd = make_download(BulkDownloadTypesHelper::CONSENSUS_GENOME_OVERVIEW_BULK_DOWNLOAD_TYPE, { "include_metadata" => true })
        bd.workflow_runs << create(:workflow_run, sample: sample_one, user: @joe,
                                                  workflow: WorkflowRun::WORKFLOW[:consensus_genome])
        allow(BulkDownloadsHelper).to receive(:generate_cg_overview_csv).and_return("cg,csv\n")
        allow(bd).to receive(:verify_and_mark_success)

        expect(s3_tar_writer).to receive(:add_file_with_data).with("consensus_genome_overviews.csv", "cg,csv\n")

        bd.generate_download_file
      end

      it "writes a combined amr results csv" do
        bd = make_download(BulkDownloadTypesHelper::AMR_COMBINED_RESULTS_BULK_DOWNLOAD)
        bd.workflow_runs << create(:workflow_run, sample: sample_one, user: @joe,
                                                  workflow: WorkflowRun::WORKFLOW[:amr])
        allow(AmrResultsConcatService).to receive(:call).and_return("amr,csv\n")
        allow(bd).to receive(:verify_and_mark_success)

        expect(s3_tar_writer).to receive(:add_file_with_data).with("combined_amr_results.csv", "amr,csv\n")

        bd.generate_download_file
      end

      it "writes a combined sample taxon results csv and logs failed samples" do
        bd = make_download(
          BulkDownloadTypesHelper::COMBINED_SAMPLE_TAXON_RESULTS_BULK_DOWNLOAD_TYPE, { "workflow" => WorkflowRun::WORKFLOW[:short_read_mngs], "metric" => "NT.rpm", "background" => 7 }
        )
        bd.pipeline_runs << create(:pipeline_run, sample: sample_one)
        allow(BulkDownloadsHelper).to receive(:generate_combined_sample_taxon_results_csv)
          .and_return(csv_str: "combined,csv\n", failed_sample_ids: [sample_two.id])
        allow(LogUtil).to receive(:log_error)
        allow(bd).to receive(:verify_and_mark_success)

        expect(s3_tar_writer).to receive(:add_file_with_data)
          .with("combined_sample_taxon_results_NT.rpm.csv", "combined,csv\n")

        bd.generate_download_file

        expect(bd.reload.error_message)
          .to eq(BulkDownloadsHelper::COMBINED_SAMPLE_TAXON_RESULTS_ERROR_TEMPLATE % 1)
      end

      it "leaves the error message unset when no samples failed the combined results download" do
        bd = make_download(
          BulkDownloadTypesHelper::COMBINED_SAMPLE_TAXON_RESULTS_BULK_DOWNLOAD_TYPE, { "workflow" => WorkflowRun::WORKFLOW[:long_read_mngs], "metric" => "NT.bpm" }
        )
        bd.pipeline_runs << create(:pipeline_run, sample: sample_one)
        captured_background = :unset
        allow(BulkDownloadsHelper).to receive(:generate_combined_sample_taxon_results_csv) do |_samples, background, _metric|
          captured_background = background
          { csv_str: "combined,csv\n", failed_sample_ids: [] }
        end
        allow(bd).to receive(:verify_and_mark_success)

        bd.generate_download_file

        # Long-read downloads do not support backgrounds, so the id stays nil.
        expect(captured_background).to be_nil
        expect(bd.reload.error_message).to be_nil
      end

      it "writes a sample metadata csv" do
        bd = make_download(BulkDownloadTypesHelper::SAMPLE_METADATA_BULK_DOWNLOAD_TYPE)
        bd.pipeline_runs << create(:pipeline_run, sample: sample_one)
        allow(BulkDownloadsHelper).to receive(:generate_metadata_csv).and_return("metadata,csv\n")
        allow(bd).to receive(:verify_and_mark_success)

        expect(s3_tar_writer).to receive(:add_file_with_data).with("sample_metadata.csv", "metadata,csv\n")

        bd.generate_download_file
      end

      it "falls through to write_output_files_to_s3_tar_writer for other download types" do
        bd = make_download(BulkDownloadTypesHelper::CONTIG_SUMMARY_REPORT_BULK_DOWNLOAD_TYPE)
        bd.pipeline_runs << create(:pipeline_run, sample: sample_one)
        allow(bd).to receive(:verify_and_mark_success)

        expect(bd).to receive(:write_output_files_to_s3_tar_writer).with(s3_tar_writer)

        bd.generate_download_file
      end

      it "marks the download errored and re-raises when the tar stream fails" do
        bd = make_download(BulkDownloadTypesHelper::SAMPLE_METADATA_BULK_DOWNLOAD_TYPE)
        bd.pipeline_runs << create(:pipeline_run, sample: sample_one)
        allow(BulkDownloadsHelper).to receive(:generate_metadata_csv).and_return("metadata,csv\n")
        allow(s3_tar_writer).to receive(:process_status)
          .and_return(instance_double(Process::Status, success?: false))

        expect { bd.generate_download_file }
          .to raise_error(BulkDownloadsHelper::BULK_DOWNLOAD_GENERATION_FAILED)
        expect(bd.reload.status).to eq(BulkDownload::STATUS_ERROR)
      end
    end
  end
end
