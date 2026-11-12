require "rails_helper"

# Streaming per-taxon reads FASTA. The download used to read the whole taxon byterange into
# one String (twice over for NT_or_NR); on long-read runs a single range is close to 1 GB and
# that OOM-killed the web pods. These specs pin the streaming helpers to the old output
# byte for byte, at every chunk boundary S3 could hand us.
RSpec.describe PipelineOutputsHelper, type: :helper do
  let(:project) { create(:project) }
  let(:sample) { create(:sample, project: project) }
  let(:pipeline_run) { create(:pipeline_run, sample: sample) }
  let(:level) { TaxonCount::TAX_LEVEL_SPECIES }
  let(:paths) do
    { level => { "NT" => "s3://bucket/run/taxid_annot_sorted_nt.fasta", "NR" => "s3://bucket/run/taxid_annot_sorted_nr.fasta" } }
  end
  let(:nt_key) { "run/taxid_annot_sorted_nt.fasta" }

  # Test runs have no real results path, so give NT and NR distinct S3 keys.
  before { allow(pipeline_run).to receive(:s3_paths_for_taxon_byteranges).and_return(paths) }

  def byterange(hit_type, first_byte, last_byte)
    create(:taxon_byterange, pipeline_run_id: pipeline_run.id, taxid: 573, hit_type: hit_type,
                             first_byte: first_byte, last_byte: last_byte)
  end

  # Serves `files` (key => body) from a stubbed S3 client. With a block, yields the body in
  # `chunk_size` pieces like the SDK's streaming get_object; without one, returns it whole.
  def stub_s3(files, chunk_size: 4)
    allow(PipelineOutputsHelper::Client).to receive(:get_object) do |**args, &blk|
      data = files.fetch(args[:key]).b
      if blk
        data.chars.each_slice(chunk_size) { |piece| blk.call(piece.join) }
      else
        instance_double(Aws::S3::Types::GetObjectOutput, body: StringIO.new(data))
      end
    end
  end

  def keys
    { nt: "run/taxid_annot_sorted_nt.fasta", nr: "run/taxid_annot_sorted_nr.fasta" }
  end

  def sources
    ["NT", "NR"].map { |hit_type| helper.taxon_fasta_source(pipeline_run, 573, level, hit_type) }
  end

  def streamed
    out = +""
    any = helper.each_combined_taxon_fasta_record(sources) { |record| out << record }
    [out, any]
  end

  describe "#taxon_fasta_source" do
    it "is nil without a pipeline run or without a byterange for the taxon" do
      expect(helper.taxon_fasta_source(nil, 573, level, "NT")).to be_nil
      expect(helper.taxon_fasta_source(pipeline_run, 573, level, "NT")).to be_nil
    end

    it "points at the hit type's sorted FASTA and the taxon's byterange" do
      byterange("NT", 10, 42)

      source = helper.taxon_fasta_source(pipeline_run, 573, level, "NT")
      expect(source.bucket).to eq("bucket")
      expect(source.key).to eq(nt_key)
      expect(source.range).to eq("bytes=10-42")
    end
  end

  describe "#each_taxon_fasta_chunk" do
    it "yields the range in chunks and never reads a whole body" do
      byterange("NT", 0, 20)
      stub_s3({ keys[:nt] => ">r1\nACGT\n>r2\nTTTT\n" }, chunk_size: 3)

      chunks = []
      helper.each_taxon_fasta_chunk(helper.taxon_fasta_source(pipeline_run, 573, level, "NT")) { |c| chunks << c }

      expect(chunks.size).to be > 1
      expect(chunks.join).to eq(">r1\nACGT\n>r2\nTTTT\n")
    end

    it "logs and yields nothing when the object or range is missing" do
      byterange("NT", 0, 20)
      [Aws::S3::Errors::NoSuchKey.new(nil, "gone"), Aws::S3::Errors::InvalidRange.new(nil, "bad")].each do |error|
        allow(PipelineOutputsHelper::Client).to receive(:get_object).and_raise(error)
        expect(LogUtil).to receive(:log_error).once

        chunks = []
        helper.each_taxon_fasta_chunk(helper.taxon_fasta_source(pipeline_run, 573, level, "NT")) { |c| chunks << c }
        expect(chunks).to be_empty
      end
    end
  end

  describe "#each_combined_taxon_fasta_record" do
    # NT repeats a read, shares one with NR, and has an empty record (">>"); NR has its own read.
    let(:nt) { ">read_a\nACGT\n>read_b\nGGCC\n>>read_a\nACGT\n>shared\nTTAA\n" }
    let(:nr) { ">shared\nTTAA\n>read_c\nCCCC\nAAAA\n" }

    it "matches the buffered NT_or_NR output byte for byte at every chunk size" do
      byterange("NT", 0, nt.bytesize - 1)
      byterange("NR", 0, nr.bytesize - 1)

      stub_s3({ keys[:nt] => nt, keys[:nr] => nr })
      expected = helper.get_taxon_fasta_from_pipeline_run_combined_nt_nr(pipeline_run, 573, level)
      expect(expected).to eq(">read_a\nACGT\n>read_b\nGGCC\n>shared\nTTAA\n>read_c\nCCCC\nAAAA\n")

      (1..[nt.bytesize, nr.bytesize].max + 1).each do |chunk_size|
        stub_s3({ keys[:nt] => nt, keys[:nr] => nr }, chunk_size: chunk_size)
        out, any = streamed
        expect(out).to eq(expected), "chunk_size #{chunk_size}"
        expect(any).to be(true)
      end
    end

    it "yields one record at a time rather than the whole file" do
      byterange("NT", 0, nt.bytesize - 1)
      byterange("NR", 0, nr.bytesize - 1)
      stub_s3({ keys[:nt] => nt, keys[:nr] => nr })

      records = []
      helper.each_combined_taxon_fasta_record(sources) { |record| records << record }
      expect(records).to eq([">read_a\nACGT\n", ">read_b\nGGCC\n", ">shared\nTTAA\n", ">read_c\nCCCC\nAAAA\n"])
    end

    it "returns false and yields nothing when the taxon has no reads (the Coming soon case)" do
      out, any = streamed
      expect(out).to eq("")
      expect(any).to be(false)
      expect(helper.get_taxon_fasta_from_pipeline_run_combined_nt_nr(pipeline_run, 573, level)).to be_nil
    end

    it "streams NR alone when NT has no byterange" do
      byterange("NR", 0, nr.bytesize - 1)
      stub_s3({ keys[:nr] => nr })

      out, any = streamed
      expect(out).to eq(nr)
      expect(any).to be(true)
    end
  end
end
