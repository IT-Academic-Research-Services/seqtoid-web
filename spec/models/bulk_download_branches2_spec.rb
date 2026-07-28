# frozen_string_literal: true

require "rails_helper"

# Branch-coverage companion #2 for app/models/bulk_download.rb.
# bulk_download_branches_spec.rb covers the command/key builders; this file takes
# the validation and dispatch conditionals that nothing else drives:
#   - params_checks: every download_type guard plus BOTH arms of each `unless`
#     inside it (sample taxon report background, combined-results metric/zscore
#     background, reads/contigs "all" handling, consensus genome download format,
#     and the whole biom-format block including the threshold-filter loop)
#   - get_accession_id / get_accession_id_prefix: present vs absent accession
#   - download_display_name: the per-taxon suffix arms
#   - execution_type: the three VARIABLE-execution-type ternaries
#   - create_biom_file: the header-only-metrics guard and the two CLI failure arms
RSpec.describe BulkDownload, type: :model do
  create_users

  # params_checks reads params via get_param_value, which digs params[key]["value"].
  def build_download(download_type, params = {})
    bd = build(:bulk_download, user: @joe, download_type: download_type)
    bd.params = params.transform_values { |value| { "value" => value } }
    bd
  end

  def param_errors(bulk_download)
    bulk_download.valid?
    bulk_download.errors[:params]
  end

  describe "#params_checks for sample_taxon_report" do
    let(:download_type) { BulkDownloadTypesHelper::SAMPLE_TAXON_REPORT_BULK_DOWNLOAD_TYPE }

    it "accepts a nil background" do
      bd = build_download(download_type, "workflow" => WorkflowRun::WORKFLOW[:short_read_mngs], "background" => nil)
      expect(param_errors(bd)).to be_empty
    end

    it "accepts an integer background" do
      bd = build_download(download_type, "workflow" => WorkflowRun::WORKFLOW[:short_read_mngs], "background" => 12)
      expect(param_errors(bd)).to be_empty
    end

    it "rejects a non-integer background" do
      bd = build_download(download_type, "workflow" => WorkflowRun::WORKFLOW[:short_read_mngs], "background" => "twelve")
      expect(param_errors(bd)).to include("background value must be an integer")
    end

    it "skips the background check for a non-short-read workflow" do
      bd = build_download(download_type, "workflow" => WorkflowRun::WORKFLOW[:long_read_mngs], "background" => "twelve")
      expect(param_errors(bd)).to be_empty
    end
  end

  describe "#params_checks for combined_sample_taxon_results" do
    let(:download_type) { BulkDownloadTypesHelper::COMBINED_SAMPLE_TAXON_RESULTS_BULK_DOWNLOAD_TYPE }
    let(:workflow) { WorkflowRun::WORKFLOW[:short_read_mngs] }

    it "accepts a metric that exists for the workflow" do
      bd = build_download(download_type, "workflow" => workflow, "metric" => "NT.rpm")
      expect(param_errors(bd)).to be_empty
    end

    it "rejects a metric that does not exist for the workflow" do
      bd = build_download(download_type, "workflow" => workflow, "metric" => "NT.bogus")
      expect(param_errors(bd)).to include("metrics value is invalid")
    end

    it "rejects any metric when the workflow has no metric list at all" do
      bd = build_download(download_type, "workflow" => "not-a-workflow", "metric" => "NT.rpm")
      expect(param_errors(bd)).to include("metrics value is invalid")
    end

    it "requires an integer background for a zscore metric" do
      bd = build_download(download_type, "workflow" => workflow, "metric" => "NT.zscore", "background" => nil)
      expect(param_errors(bd)).to include("background value must be an integer")
    end

    it "accepts an integer background for a zscore metric" do
      bd = build_download(download_type, "workflow" => workflow, "metric" => "NR.zscore", "background" => 3)
      expect(param_errors(bd)).to be_empty
    end
  end

  describe "#params_checks for reads_non_host" do
    let(:download_type) { BulkDownloadTypesHelper::READS_NON_HOST_BULK_DOWNLOAD_TYPE }

    it "accepts an integer taxid" do
      bd = build_download(download_type, "taxa_with_reads" => 573)
      expect(param_errors(bd)).to be_empty
    end

    it "rejects a taxid that is neither an integer nor 'all'" do
      bd = build_download(download_type, "taxa_with_reads" => "some-taxon")
      expect(param_errors(bd)).to include("taxa_with_reads must be all or an integer")
    end

    it "requires a supported file format when downloading all taxa" do
      bd = build_download(download_type, "taxa_with_reads" => "all", "file_format" => ".txt")
      expect(param_errors(bd)).to include("file_format must be .fasta or .fastq")
    end

    it "accepts .fastq when downloading all taxa" do
      bd = build_download(download_type, "taxa_with_reads" => "all", "file_format" => ".fastq")
      expect(param_errors(bd)).to be_empty
    end
  end

  describe "#params_checks for contigs_non_host" do
    let(:download_type) { BulkDownloadTypesHelper::CONTIGS_NON_HOST_BULK_DOWNLOAD_TYPE }

    it "accepts 'all'" do
      bd = build_download(download_type, "taxa_with_contigs" => "all")
      expect(param_errors(bd)).to be_empty
    end

    it "rejects a non-integer, non-'all' value" do
      bd = build_download(download_type, "taxa_with_contigs" => "klebsiella")
      expect(param_errors(bd)).to include("taxa_with_contigs must be all or an integer")
    end
  end

  describe "#params_checks for consensus_genome" do
    let(:download_type) { BulkDownloadTypesHelper::CONSENSUS_GENOME_DOWNLOAD_TYPE }

    it "accepts the separate-files download format" do
      bd = build_download(download_type, "download_format" => BulkDownloadTypesHelper::SEPARATE_FILES_DOWNLOAD)
      expect(param_errors(bd)).to be_empty
    end

    it "rejects an unknown download format" do
      bd = build_download(download_type, "download_format" => "Zip")
      expect(param_errors(bd)).to include("download_format must be Separate Files or Single File (Concatenated)")
    end
  end

  describe "#params_checks for biom_format" do
    let(:download_type) { BulkDownloadTypesHelper::BIOM_FORMAT_DOWNLOAD_TYPE }

    def biom_download(overrides = {})
      build_download(download_type, {
        "metric" => "NT_rpm",
        "background_id" => 4,
        "categories" => ["Viruses"],
        "filter_by" => [],
      }.merge(overrides))
    end

    it "accepts a fully valid biom parameter set" do
      expect(param_errors(biom_download)).to be_empty
    end

    it "rejects an unknown count type" do
      expect(param_errors(biom_download("metric" => "XX_rpm"))).to include("count type is invalid")
    end

    it "rejects an unknown metric" do
      expect(param_errors(biom_download("metric" => "NT_bogus"))).to include("metric value is invalid")
    end

    it "rejects a non-integer background_id" do
      expect(param_errors(biom_download("background_id" => "four"))).to include("background value must be an integer")
    end

    it "accepts a nil background_id" do
      expect(param_errors(biom_download("background_id" => nil))).to be_empty
    end

    it "rejects an unknown category" do
      expect(param_errors(biom_download("categories" => ["Bacteria", "Fungi"]))).to include("category is invalid")
    end

    it "accepts blank categories" do
      expect(param_errors(biom_download("categories" => []))).to be_empty
    end

    it "validates each threshold filter" do
      errors = param_errors(biom_download("filter_by" => [
                                            { "metric" => "XX_bogus", "operator" => "==" },
                                          ]))

      expect(errors).to include("threshold filter contains invalid count type")
      expect(errors).to include("threshold filter contains invalid metric")
      expect(errors).to include("threshold filter contains invalid operator")
    end

    it "accepts a well-formed threshold filter" do
      errors = param_errors(biom_download("filter_by" => [
                                            { "metric" => "NR_zscore", "operator" => ">=" },
                                          ]))

      expect(errors).to be_empty
    end
  end

  describe "#get_accession_id and #get_accession_id_prefix" do
    let(:bulk_download) { build(:bulk_download, user: @joe, download_type: BulkDownloadTypesHelper::CONSENSUS_GENOME_DOWNLOAD_TYPE) }

    it "sanitizes and returns the accession id when the workflow run has one" do
      workflow_run = instance_double(WorkflowRun, inputs: { "accession_id" => "MN908947.3" })

      expect(bulk_download.get_accession_id(workflow_run)).to eq("MN908947.3")
      expect(bulk_download.get_accession_id_prefix(workflow_run)).to eq("MN908947.3_")
      expect(bulk_download.get_accession_id_prefix(workflow_run, include_ending_underscore: false)).to eq("MN908947.3")
    end

    it "returns nil when the workflow run has no accession id" do
      workflow_run = instance_double(WorkflowRun, inputs: { "other" => "value" })

      expect(bulk_download.get_accession_id(workflow_run)).to be_nil
      expect(bulk_download.get_accession_id_prefix(workflow_run)).to be_nil
    end

    it "returns nil when the workflow run has no inputs at all" do
      workflow_run = instance_double(WorkflowRun, inputs: nil)

      expect(bulk_download.get_accession_id(workflow_run)).to be_nil
    end
  end

  describe "#download_display_name" do
    it "appends the taxon display name for a single-taxon reads download" do
      bd = build(:bulk_download, user: @joe, download_type: BulkDownloadTypesHelper::READS_NON_HOST_BULK_DOWNLOAD_TYPE)
      bd.params = { "taxa_with_reads" => { "value" => 573, "displayName" => "Klebsiella" } }

      expect(bd.download_display_name).to end_with(" - Klebsiella")
    end

    it "leaves the display name alone for an all-taxa reads download" do
      bd = build(:bulk_download, user: @joe, download_type: BulkDownloadTypesHelper::READS_NON_HOST_BULK_DOWNLOAD_TYPE)
      bd.params = { "taxa_with_reads" => { "value" => "all", "displayName" => "All Taxa" } }

      expect(bd.download_display_name).not_to include(" - ")
    end

    it "appends the taxon display name for a single-taxon contigs download" do
      bd = build(:bulk_download, user: @joe, download_type: BulkDownloadTypesHelper::CONTIGS_NON_HOST_BULK_DOWNLOAD_TYPE)
      bd.params = { "taxa_with_contigs" => { "value" => 573, "displayName" => "Klebsiella" } }

      expect(bd.download_display_name).to end_with(" - Klebsiella")
    end

    it "leaves the display name alone for an all-taxa contigs download" do
      bd = build(:bulk_download, user: @joe, download_type: BulkDownloadTypesHelper::CONTIGS_NON_HOST_BULK_DOWNLOAD_TYPE)
      bd.params = { "taxa_with_contigs" => { "value" => "all", "displayName" => "All Taxa" } }

      expect(bd.download_display_name).not_to include(" - ")
    end
  end

  describe "#execution_type for variable-execution download types" do
    def execution_type_for(download_type, params)
      bd = build(:bulk_download, user: @joe, download_type: download_type)
      bd.params = params.transform_values { |value| { "value" => value } }
      bd.execution_type
    end

    it "runs reads_non_host on ECS for all taxa and on Resque for a single taxon" do
      reads = BulkDownloadTypesHelper::READS_NON_HOST_BULK_DOWNLOAD_TYPE
      expect(execution_type_for(reads, "taxa_with_reads" => "all")).to eq(BulkDownloadTypesHelper::ECS_EXECUTION_TYPE)
      expect(execution_type_for(reads, "taxa_with_reads" => 573)).to eq(BulkDownloadTypesHelper::RESQUE_EXECUTION_TYPE)
    end

    it "runs contigs_non_host on ECS for all taxa and on Resque for a single taxon" do
      contigs = BulkDownloadTypesHelper::CONTIGS_NON_HOST_BULK_DOWNLOAD_TYPE
      expect(execution_type_for(contigs, "taxa_with_contigs" => "all")).to eq(BulkDownloadTypesHelper::ECS_EXECUTION_TYPE)
      expect(execution_type_for(contigs, "taxa_with_contigs" => 573)).to eq(BulkDownloadTypesHelper::RESQUE_EXECUTION_TYPE)
    end

    it "runs consensus_genome on ECS for separate files and on Resque when concatenated" do
      cg = BulkDownloadTypesHelper::CONSENSUS_GENOME_DOWNLOAD_TYPE
      expect(execution_type_for(cg, "download_format" => BulkDownloadTypesHelper::SEPARATE_FILES_DOWNLOAD))
        .to eq(BulkDownloadTypesHelper::ECS_EXECUTION_TYPE)
      expect(execution_type_for(cg, "download_format" => BulkDownloadTypesHelper::SINGLE_FILE_CONCATENATED_DOWNLOAD))
        .to eq(BulkDownloadTypesHelper::RESQUE_EXECUTION_TYPE)
    end
  end

  describe "#create_biom_file" do
    let(:bulk_download) do
      bd = build(:bulk_download, user: @joe, download_type: BulkDownloadTypesHelper::BIOM_FORMAT_DOWNLOAD_TYPE)
      allow(bd).to receive(:id).and_return(99)
      bd
    end

    def write_tmp(name, contents)
      path = File.join(Dir.tmpdir, "branch_biom_#{name}_#{SecureRandom.hex(4)}")
      File.write(path, contents)
      path
    end

    let(:metadata_path) { write_tmp("metadata", "meta\n") }
    let(:lineage_path) { write_tmp("lineage", "lineage\n") }

    it "fails fast and marks the download errored when the metrics file is header-only" do
      metrics_path = write_tmp("metrics", "header_only\n")

      expect { bulk_download.create_biom_file(metrics_path, metadata_path, lineage_path) }
        .to raise_error(BulkDownload::BiomConversionError, /No taxa matched the selected filters/)
      expect(bulk_download.status).to eq(BulkDownload::STATUS_ERROR)
    end

    context "with a metrics file that has observations" do
      let(:metrics_path) { write_tmp("metrics", "header\nrow1\n") }

      it "returns the metadata-annotated biom path when both CLI steps succeed" do
        ok = instance_double(Process::Status, exitstatus: 0)
        allow(Open3).to receive(:capture3).and_return(["", "", ok])

        expect(bulk_download.create_biom_file(metrics_path, metadata_path, lineage_path))
          .to eq("/tmp/99_output_metadata.biom")
      end

      it "raises when the biom convert step fails" do
        allow(LogUtil).to receive(:log_error)
        failure = instance_double(Process::Status, exitstatus: 1)
        allow(Open3).to receive(:capture3).and_return(["out", "convert boom", failure])

        expect { bulk_download.create_biom_file(metrics_path, metadata_path, lineage_path) }
          .to raise_error(BulkDownload::BiomConversionError, /biom convert failed: convert boom/)
        expect(bulk_download.status).to eq(BulkDownload::STATUS_ERROR)
      end

      it "raises when the add-metadata step fails" do
        allow(LogUtil).to receive(:log_error)
        ok = instance_double(Process::Status, exitstatus: 0)
        failure = instance_double(Process::Status, exitstatus: 1)
        allow(Open3).to receive(:capture3).and_return(["", "", ok], ["out", "metadata boom", failure])

        expect { bulk_download.create_biom_file(metrics_path, metadata_path, lineage_path) }
          .to raise_error(BulkDownload::BiomConversionError, /biom add-metadata failed: metadata boom/)
        expect(bulk_download.status).to eq(BulkDownload::STATUS_ERROR)
      end
    end
  end
end
