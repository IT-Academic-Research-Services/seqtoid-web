require "rails_helper"

# GET /samples/:id/fasta/:tax_level/:taxid/:hit_type streams the taxon's reads from S3 instead
# of building the file in memory (a long-read taxon range can be close to 1 GB and buffering it
# OOM-killed the web pods). The S3 stub refuses a non-streaming read, so a regression back to
# resp.body.read fails here.
RSpec.describe "Samples taxid fasta streaming", type: :request do
  create_users

  let(:project) { create(:project, users: [@joe]) }
  let(:sample) { create(:sample, project: project, user: @joe, name: "s1") }
  let(:pipeline_run) { create(:pipeline_run, sample: sample) }
  let(:level) { TaxonCount::TAX_LEVEL_SPECIES }
  let(:nt) { ">read_a\nACGT\n>shared\nTTAA\n" }
  let(:nr) { ">shared\nTTAA\n>read_c\nCCCC\n" }

  before do
    sign_in @joe
    allow_any_instance_of(SamplesController).to receive(:clean_taxid_name).and_return("kleb")
    # Test runs have no real results path, so give NT and NR distinct S3 keys.
    allow_any_instance_of(PipelineRun).to receive(:s3_paths_for_taxon_byteranges).and_return(
      level => { "NT" => "s3://bucket/run/sorted_nt.fasta", "NR" => "s3://bucket/run/sorted_nr.fasta" }
    )
    files = { "run/sorted_nt.fasta" => nt, "run/sorted_nr.fasta" => nr }
    allow(PipelineOutputsHelper::Client).to receive(:get_object) do |**args, &blk|
      raise "taxon fasta must be streamed, not read whole" unless blk

      files.fetch(args[:key]).b.chars.each_slice(5) { |piece| blk.call(piece.join) }
    end
  end

  def byterange(hit_type, body)
    create(:taxon_byterange, pipeline_run_id: pipeline_run.id, taxid: 573, hit_type: hit_type,
                             first_byte: 0, last_byte: body.bytesize - 1)
  end

  it "streams the deduplicated NT_or_NR reads as an attachment" do
    byterange("NT", nt)
    byterange("NR", nr)

    get "/samples/#{sample.id}/fasta/#{level}/573/NT_or_NR"

    expect(response).to have_http_status(:ok)
    expect(response.body).to eq(">read_a\nACGT\n>shared\nTTAA\n>read_c\nCCCC\n")
    expect(response.headers["Content-Disposition"]).to start_with("attachment")
    expect(response.headers["Content-Disposition"]).to include("s1_kleb-hits.fasta")
    expect(response.headers["Content-Type"]).to eq("application/octet-stream")
    expect(response.headers["ETag"]).to be_nil
    # One S3 read per hit type. Two each would mean Rack::ETag walked the stream to digest it
    # before sending, pulling the whole range up front.
    expect(PipelineOutputsHelper::Client).to have_received(:get_object).twice
  end

  it "streams a single hit type's range unchanged" do
    byterange("NT", nt)

    get "/samples/#{sample.id}/fasta/#{level}/573/NT"

    expect(response).to have_http_status(:ok)
    expect(response.body).to eq(nt)
  end

  it "says no reads are available when the taxon has none" do
    pipeline_run

    get "/samples/#{sample.id}/fasta/#{level}/573/NT_or_NR"

    expect(response).to have_http_status(:ok)
    expect(response.body).to eq(SamplesController::NO_TAXON_READS_MESSAGE)
  end
end
