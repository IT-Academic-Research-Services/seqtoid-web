require 'rails_helper'

# Branch coverage for SamplesController. samples_controller_spec drives the happy
# paths of the discovery/upload/blast endpoints; this file closes conditional arms it
# leaves undriven:
#   * index_v2's explicit `limit` (vs the MAX_PAGE_SIZE_V2 default)
#   * #all with and without an `ids` filter
#   * the human-taxid fail-closed guards of taxid_contigs_for_blast and
#     taxon_five_longest_reads
#   * the NR count_type column pair and the over-length contig truncation of
#     taxid_contigs_for_blast
#   * show_taxid_fasta's "no reads -> Coming soon" arm
#   * unidentified_fasta's missing-object arm
#   * raw_results_folder's pipeline_version query-string arm
#   * amr's loaded-output-state arm
#   * the admin-only extras of sample_params
#   * the private helpers clean_taxid_name / fetch_taxon_reads /
#     warn_if_large_bulk_upload, whose arms are unreachable from the driven actions.
RSpec.describe SamplesController, type: :controller do
  create_users

  before do
    stub_const('SAMPLES_BUCKET_NAME', "fake_bucket_name")
  end

  context "Joe" do
    before { sign_in @joe }

    describe "GET #index_v2" do
      it "honours an explicit limit instead of the default page size" do
        project = create(:project, users: [@joe])
        create(:sample, project: project, user: @joe, name: "Branch Sample A")
        create(:sample, project: project, user: @joe, name: "Branch Sample B")

        get :index_v2, format: :json, params: { domain: "my_data", limit: 1, basic: true }

        expect(response).to have_http_status :success
        json_response = JSON.parse(response.body)
        expect(json_response["samples"].length).to eq(1)
      end
    end

    describe "GET #all" do
      it "returns every viewable sample when no ids are given" do
        project = create(:project, users: [@joe])
        one = create(:sample, project: project, user: @joe)
        two = create(:sample, project: project, user: @joe)

        get :all

        expect(response).to have_http_status :success
        expect(assigns(:samples).map(&:id)).to include(one.id, two.id)
      end
    end

    describe "GET #taxid_contigs_for_blast" do
      before do
        create(:taxon_lineage, tax_name: "Klebsiella pneumoniae", taxid: 573, genus_taxid: 570, superkingdom_taxid: 2)
        project = create(:project, users: [@joe])
        @sample = create(:sample, project: project, user: @joe)
      end

      it "fails closed with no body for a human taxid" do
        create(:pipeline_run, sample: @sample, job_status: "CHECKED", pipeline_version: 6.7)

        get :taxid_contigs_for_blast, format: :json, params: { id: @sample.id, taxid: 9606, count_type: "NT" }

        expect(response.body).to be_blank
        expect(response).not_to have_http_status :ok
      end

      it "queries the NR taxid columns when count_type is NR" do
        create(:pipeline_run,
               sample: @sample,
               job_status: "CHECKED",
               pipeline_version: 6.7,
               contigs_data: [
                 # Only the NR columns carry 573, so an NT query would find nothing.
                 { species_taxid_nr: 573, genus_taxid_nr: 570, read_count: 7, lineage_json: "{\"NR\":[573, 570]}", sequence: "ACGTAC" },
                 { species_taxid_nt: 573, genus_taxid_nt: 570, read_count: 8, lineage_json: "{\"NT\":[573, 570]}", sequence: "TTTT" },
               ])

        get :taxid_contigs_for_blast, format: :json, params: { id: @sample.id, taxid: 573, count_type: "NR" }

        expect(response).to have_http_status :ok
        contigs = JSON.parse(response.body)["contigs"]
        expect(contigs.length).to eq(1)
        expect(contigs.first["num_reads"]).to eq(7)
      end

      it "truncates a contig longer than the blast character limit to its middle base pairs" do
        long_sequence = "A" * (Contig::BLAST_SEQUENCE_CHARACTER_LIMIT + 100)
        create(:pipeline_run,
               sample: @sample,
               job_status: "CHECKED",
               pipeline_version: 6.7,
               contigs_data: [
                 { species_taxid_nt: 573, genus_taxid_nt: 570, read_count: 9, lineage_json: "{\"NT\":[573]}", sequence: long_sequence },
               ])

        get :taxid_contigs_for_blast, format: :json, params: { id: @sample.id, taxid: 573, count_type: "NT" }

        expect(response).to have_http_status :ok
        contig = JSON.parse(response.body)["contigs"].first
        expect(contig["contig_length"]).to eq(long_sequence.length)
        # Header + exactly the limit's worth of base pairs, not the whole sequence.
        expect(contig["fasta_sequence"].split("\n").last.length).to eq(Contig::BLAST_SEQUENCE_CHARACTER_LIMIT)
      end
    end

    describe "GET #taxon_five_longest_reads" do
      it "fails closed with no body for a human taxid" do
        project = create(:project, users: [@joe])
        sample = create(:sample, project: project, user: @joe)
        create(:pipeline_run, sample: sample, job_status: "CHECKED", pipeline_version: 6.10)

        expect(S3Util).not_to receive(:get_s3_range)

        get :taxon_five_longest_reads, format: :json, params: { id: sample.id, taxid: 9606, tax_level: 1, count_type: "NT" }

        expect(response.body).to be_blank
      end
    end

    describe "GET #show_taxid_fasta" do
      it "falls back to the placeholder when the combined NT/NR fasta is empty" do
        create(:taxon_lineage, tax_name: "Klebsiella pneumoniae", taxid: 573, genus_taxid: 570, superkingdom_taxid: 2)
        project = create(:project, users: [@joe])
        sample = create(:sample, project: project, user: @joe)
        create(:pipeline_run,
               sample: sample,
               job_status: "CHECKED",
               pipeline_version: 6.7,
               taxon_counts_data: [{ taxon_name: "Klebsiella pneumoniae", nt: 5 }])

        # No taxon_byteranges exist, so both the NT and NR lookups return "".
        get :show_taxid_fasta, params: { id: sample.id, taxid: "573", tax_level: "1", hit_type: "NT_or_NR" }

        expect(response).to have_http_status :success
        expect(response.body).to eq("Coming soon")
      end
    end

    describe "GET #unidentified_fasta" do
      it "renders an error payload when the fasta object is missing from S3" do
        project = create(:project, users: [@joe])
        sample = create(:sample, project: project, user: @joe)
        create(:pipeline_run, sample: sample, job_status: "CHECKED", pipeline_version: 6.7)

        # head_bucket raising makes the real get_presigned_s3_url return nil.
        allow(PipelineOutputsHelper::Client).to receive(:head_bucket).and_raise(StandardError)

        get :unidentified_fasta, format: :json, params: { id: sample.id }

        expect(response).to have_http_status :success
        expect(JSON.parse(response.body)["error"]).to match(/unidentified fasta file does not exist/)
      end
    end

    describe "GET #raw_results_folder" do
      it "carries the pipeline_version through to the sample path" do
        project = create(:project, users: [@joe])
        sample = create(:sample, project: project, user: @joe,
                                 pipeline_runs_data: [{ finalized: 1, job_status: PipelineRun::STATUS_CHECKED, pipeline_version: "3.10" }])
        allow_any_instance_of(Sample).to receive(:results_folder_files).and_return({})

        get :raw_results_folder, params: { id: sample.id, pipeline_version: "3.10" }

        expect(response).to have_http_status :success
        expect(assigns(:sample_path)).to end_with("?pipeline_version=3.10")
      end
    end

    describe "GET #amr" do
      it "returns the amr counts once the amr_counts output state is LOADED" do
        @joe.add_allowed_feature("AMR")
        project = create(:project, users: [@joe])
        sample = create(:sample, project: project, user: @joe)
        pipeline_run = create(:pipeline_run,
                              sample: sample,
                              job_status: PipelineRun::STATUS_CHECKED,
                              finalized: 1,
                              pipeline_version: 6.7,
                              amr_counts_data: [{ gene: "branchGene" }],
                              output_states_data: [{ output: "amr_counts", state: PipelineRun::STATUS_LOADED }])

        expect(pipeline_run.output_states.find_by(output: "amr_counts").state).to eq(PipelineRun::STATUS_LOADED)

        get :amr, format: :json, params: { id: sample.id }

        expect(response).to have_http_status :success
        genes = JSON.parse(response.body).pluck("gene")
        expect(genes).to include("branchGene")
      end
    end

    describe "private helpers" do
      let(:project) { create(:project, users: [@joe]) }
      let(:sample) { create(:sample, project: project, user: @joe) }

      describe "#clean_taxid_name" do
        it "returns 'all' for the aggregate pseudo-taxid without touching the DB" do
          pipeline_run = create(:pipeline_run, sample: sample)
          expect(pipeline_run).not_to receive(:taxon_counts)

          expect(controller.send(:clean_taxid_name, pipeline_run, 'all')).to eq('all')
        end

        it "slugifies a named taxon" do
          create(:taxon_lineage, tax_name: "Klebsiella pneumoniae", taxid: 573, genus_taxid: 570, superkingdom_taxid: 2)
          pipeline_run = create(:pipeline_run, sample: sample,
                                               taxon_counts_data: [{ taxon_name: "Klebsiella pneumoniae", nt: 5 }])

          expect(controller.send(:clean_taxid_name, pipeline_run, 573)).to eq("klebsiella-pneumoniae")
        end

        it "falls back to a taxon-<id> slug when the count has no name" do
          pipeline_run = create(:pipeline_run, sample: sample)
          create(:taxon_count, pipeline_run: pipeline_run, tax_id: 12_345, name: nil)

          expect(controller.send(:clean_taxid_name, pipeline_run, 12_345)).to eq("taxon-12345")
        end
      end

      describe "#fetch_taxon_reads" do
        it "caps the byterange and drops the truncated tail when the range exceeds max_bytes" do
          truncated_tail = ">r1\nAC\n>r2\nACGT\n>r3\nACGTAC\n>partial"
          expect(S3Util).to receive(:get_s3_range).with("s3://b/k", 0, 100).and_return(truncated_tail)

          result = controller.send(:fetch_taxon_reads, "s3://b/k", 0, 1000, 100)

          # Read capped at first_byte + max_bytes; first (empty) and last (possibly
          # truncated) entries are dropped.
          expect(result).to eq(["r1\nAC\n", "r2\nACGT\n", "r3\nACGTAC\n"])
        end

        it "reads the whole range and keeps the tail when it fits under max_bytes" do
          whole = ">r1\nAC\n>r2\nACGT\n>r3\nACGTAC\n"
          expect(S3Util).to receive(:get_s3_range).with("s3://b/k", 0, 50).and_return(whole)

          result = controller.send(:fetch_taxon_reads, "s3://b/k", 0, 50, 100)

          # Nothing is dropped from the tail; entries come back longest-last.
          expect(result).to eq(["r1\nAC\n", "r2\nACGT\n", "r3\nACGTAC\n"])
        end
      end

      describe "#warn_if_large_bulk_upload" do
        before { allow(Rails.logger).to receive(:info).and_call_original }

        it "stays silent for a small upload" do
          controller.send(:warn_if_large_bulk_upload, [sample])

          expect(Rails.logger).not_to have_received(:info).with(/LargeBulkUploadEvent/)
        end

        it "logs a LargeBulkUploadEvent once the upload reaches 200 samples" do
          controller.send(:warn_if_large_bulk_upload, Array.new(200) { sample })

          expect(Rails.logger).to have_received(:info).with(/LargeBulkUploadEvent: 200 samples by non-admin user\./)
        end
      end
    end
  end

  context "Admin user" do
    before { sign_in @admin }

    describe "GET #all" do
      # The `ids` arm interpolates a bare `id in (?)` predicate, which is only
      # unambiguous when the power scope is un-joined -- i.e. for an admin, where
      # Sample.viewable falls through to `all`. A non-admin's viewable scope joins
      # projects and the same query fails as ambiguous, so this arm is admin-only.
      it "restricts to the requested ids when ids are given" do
        project = create(:project, users: [@admin])
        one = create(:sample, project: project, user: @admin)
        create(:sample, project: project, user: @admin)

        get :all, params: { ids: one.id }

        expect(response).to have_http_status :success
        expect(assigns(:samples).map(&:id)).to eq([one.id])
      end
    end

    describe "PUT #update" do
      it "permits the admin-only pipeline tuning params" do
        project = create(:project, users: [@admin])
        sample = create(:sample, project: project, user: @admin)

        put :update, format: :json, params: {
          id: sample.id,
          sample: { name: "Admin Renamed Sample", subsample: 1234, max_input_fragments: 4321 },
        }

        expect(response).to have_http_status :success
        sample.reload
        expect(sample.name).to eq("Admin Renamed Sample")
        expect(sample.subsample).to eq(1234)
        expect(sample.max_input_fragments).to eq(4321)
      end
    end
  end
end
