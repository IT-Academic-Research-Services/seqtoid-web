class AmrGeneLevelDownloadsService
  include Callable
  include PipelineOutputsHelper

  DOWNLOAD_TYPE_READS = "reads".freeze
  DOWNLOAD_TYPE_CONTIGS = "contigs".freeze

  # index id is gene id for reads and ARO accession for contigs
  def initialize(workflow_run, download_type, index_id)
    @workflow_run = workflow_run
    @download_type = download_type
    @index_id = index_id
  end

  def call
    return generate
  end

  private

  def generate
    if @download_type == DOWNLOAD_TYPE_CONTIGS
      output_bam = AmrWorkflowRun::OUTPUT_CONTIGS_BAM
      output_bai = AmrWorkflowRun::OUTPUT_CONTIGS_BAI
    elsif @download_type == DOWNLOAD_TYPE_READS
      output_bam = AmrWorkflowRun::OUTPUT_READS_BAM
      output_bai = AmrWorkflowRun::OUTPUT_READS_BAI
    end

    s3_path_bam = @workflow_run.output_path(output_bam)
    s3_path_bai = @workflow_run.output_path(output_bai)

    # Both temp files below were previously created as `Tempfile.new().path`, which keeps only the
    # path String and drops the Tempfile object. Tempfile installs an ObjectSpace finalizer that
    # unlinks the file when that object is garbage collected, so the file could be removed while it
    # was still in use -- a timing-dependent bug that usually works and occasionally yields an empty
    # or missing download. Neither file's lifetime is left to GC now.

    # The output OUTLIVES this service: the controller passes this path to send_file, which streams
    # the file after the action returns. Tempfile.create WITHOUT a block returns a plain File with no
    # finalizer, so nothing can unlink it while Rack is still reading it. Closed immediately because
    # samtools writes to the path via shell redirection, not through this handle.
    output_file = Tempfile.create(["amr_gene_level_download", ".fasta"])
    output_file.close
    path_output = output_file.path

    # Create a signed URL; we would need "~/.aws/credentials" for this to work with S3 paths
    url_bam = get_presigned_s3_url(s3_path: s3_path_bam)

    # Download .bai index, otherwise samtools downloads/overwrites .bai from other requests
    # The .bai file is small (~50kb) since the .bam files are only 10's of megabytes
    #
    # The .bai is only needed while samtools runs, so the block form cleans it up deterministically
    # on exit -- including on exception -- rather than waiting for GC.
    Tempfile.create(["amr_gene_level_download", ".bai"]) do |bai_file|
      bai_file.close
      bucket, key = S3Util.parse_s3_path(s3_path_bai)
      AwsClient[:s3].get_object(bucket: bucket, key: key, response_target: bai_file.path)

      # Fetch reads from S3
      Syscall.pipe_with_output(
        # Fetch reads from the BAM file
        ["samtools", "view", "-h", "-X", url_bam, bai_file.path, @index_id],
        # Convert to FASTA format
        "samtools fasta > #{path_output}"
      )
    end

    path_output
  end
end
