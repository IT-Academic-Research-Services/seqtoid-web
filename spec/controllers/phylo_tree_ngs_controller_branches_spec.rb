# frozen_string_literal: true

require "rails_helper"

# Coverage Wave: branch sweep for PhyloTreeNgsController. The main spec drives the
# happy paths of index/show/create/validate_name/rerun/download, which leaves the
# guard clauses, the "no eligible runs" early returns, the genus-vs-species query
# switch and the coverage-viz accession helpers untaken. This spec drives:
#
#   - the HUMAN_TAX_IDS forbidden guard on index / new_pr_ids / create and the
#     sample_details_json human/blank early returns
#   - new_pr_ids: getAdditionalSamples true/false, filter present/absent, and the
#     empty-result early return on both sides
#   - new_pr_info: both arms of the getAdditionalSamples switch
#   - choose_taxon: the BYPASS_ES_TAXON_SEARCH stub arm, with and without a query
#   - filter_phylo_tree_ngs / format_phylo_tree_ngs: each filter and each mode
#   - get_top_accession_from_coverage_viz_summary: direct taxid hit, genus
#     fallback with and without a matching species
#   - get_additional_reference_accession_ids: missing s3 path, missing s3 file,
#     and a resolved accession
#   - get_coverage_breadth_for_pipeline_runs: species vs genus, fill_zero on/off
RSpec.describe PhyloTreeNgsController, type: :controller do
  create_users

  let(:project) { create(:project, users: [@joe]) }
  let(:sample) { create(:sample, project: project, name: "Sample A") }
  let!(:pipeline_run) { create(:pipeline_run, sample: sample, job_status: "CHECKED") }

  # species-level taxon and its genus. TaxonLineage#tax_level is derived from the
  # lowest populated *_taxid column, so species_taxid must stay negative on the
  # genus row for it to report TAX_LEVEL_GENUS.
  let!(:species_lineage) do
    create(:taxon_lineage, taxid: 573, genus_taxid: 570, species_taxid: 573,
                           species_name: "Klebsiella pneumoniae", genus_name: "Klebsiella",
                           superkingdom_name: "Bacteria")
  end
  let!(:genus_lineage) do
    create(:taxon_lineage, taxid: 570, genus_taxid: 570, genus_name: "Klebsiella",
                           superkingdom_name: "Bacteria")
  end

  before { sign_in @joe }

  describe "human taxon guards" do
    let(:human_tax_id) { ApplicationHelper::HUMAN_TAX_IDS.first }

    it "forbids index for a human taxon (the guard then-arm)" do
      get :index, params: { taxId: human_tax_id }, format: :json

      expect(response).to have_http_status(:forbidden)
      expect(JSON.parse(response.body)["message"]).to eq("Human taxon ids are not allowed")
    end

    it "forbids new_pr_ids for a human taxon (the guard then-arm)" do
      get :new_pr_ids, params: { taxId: human_tax_id, projectId: project.id }, format: :json

      expect(response).to have_http_status(:forbidden)
    end

    it "forbids create for a human taxon (the guard then-arm)" do
      post :create, params: { taxId: human_tax_id, projectId: project.id, pipelineRunIds: [pipeline_run.id], name: "Tree" }, format: :json

      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "GET index" do
    it "renders the list with a resolved project and taxon name when both filters are given" do
      create(:phylo_tree_ng, user: @joe, project: project, pipeline_runs: [pipeline_run],
                             name: "Tree A", inputs_json: { pipeline_run_ids: [pipeline_run.id], tax_id: 573 })

      get :index, params: { taxId: 573, projectId: project.id }, format: :json

      expect(response).to have_http_status(:success)
      body = JSON.parse(response.body)
      expect(body["project"]["id"]).to eq(project.id)
      expect(body["taxonName"]).to eq(species_lineage.name)
      expect(body["phyloTrees"].length).to eq(1)
    end

    it "omits project and taxon name when neither filter is given (both present? else-arms)" do
      get :index, format: :json

      body = JSON.parse(response.body)
      expect(body["project"]).to be_nil
      expect(body["taxonName"]).to be_nil
    end
  end

  describe "GET new_pr_ids" do
    it "returns empty lists when the project has no completed runs with the taxon (the project early return)" do
      get :new_pr_ids, params: { getAdditionalSamples: "false", taxId: 573, projectId: project.id }, format: :json

      expect(response).to have_http_status(:success)
      body = JSON.parse(response.body)
      expect(body["pipelineRunIds"]).to eq([])
      expect(body["coverageBreadths"]).to eq({})
      expect(body["runsWithContigs"]).to eq([])
    end

    it "returns empty lists when there are no additional eligible runs (the additional-samples early return)" do
      get :new_pr_ids, params: { getAdditionalSamples: "true", taxId: 573, projectId: project.id }, format: :json

      expect(response).to have_http_status(:success)
      body = JSON.parse(response.body)
      expect(body["pipelineRunIds"]).to eq([])
      expect(body["coverageBreadths"]).to eq({})
      expect(body).not_to have_key("runsWithContigs")
    end

    context "with an out-of-project run available" do
      let!(:other_project) { create(:project, users: [@joe], name: "Other Project") }
      # The filter arm of new_pr_ids INNER JOINs samples.metadata, so the sample
      # needs at least one metadatum row to survive that join at all.
      let!(:other_sample) do
        create(:sample, project: other_project, name: "Other Sample",
                        metadata_fields: { "sample_type" => "Whole Blood" })
      end
      let!(:other_run) { create(:pipeline_run, sample: other_sample, job_status: "CHECKED") }
      let!(:other_contig) do
        create(:contig, pipeline_run: other_run, species_taxid_nt: 573, species_taxid_nr: 573)
      end

      it "returns the out-of-project runs that carry the species taxon (the species query arm)" do
        get :new_pr_ids, params: { getAdditionalSamples: "true", taxId: 573, projectId: project.id }, format: :json

        body = JSON.parse(response.body)
        expect(body["pipelineRunIds"]).to include(other_run.id)
      end

      it "applies the search filter when one is supplied (the filter present arm)" do
        get :new_pr_ids, params: { getAdditionalSamples: "true", taxId: 573, projectId: project.id, filter: "Other Project" }, format: :json

        body = JSON.parse(response.body)
        expect(body["pipelineRunIds"]).to include(other_run.id)
      end

      it "returns nothing when the search filter matches no run (the filter present arm, empty result)" do
        get :new_pr_ids, params: { getAdditionalSamples: "true", taxId: 573, projectId: project.id, filter: "zzz-no-match" }, format: :json

        body = JSON.parse(response.body)
        expect(body["pipelineRunIds"]).to eq([])
      end
    end

    context "for a genus-level taxon" do
      let!(:other_project) { create(:project, users: [@joe], name: "Genus Project") }
      let!(:other_sample) { create(:sample, project: other_project) }
      let!(:other_run) { create(:pipeline_run, sample: other_sample, job_status: "CHECKED") }
      let!(:other_contig) do
        create(:contig, pipeline_run: other_run, genus_taxid_nt: 570, genus_taxid_nr: 570)
      end

      it "queries the genus contig columns instead (the query else-arm)" do
        get :new_pr_ids, params: { getAdditionalSamples: "true", taxId: 570, projectId: project.id }, format: :json

        body = JSON.parse(response.body)
        expect(body["pipelineRunIds"]).to include(other_run.id)
      end
    end
  end

  describe "GET new_pr_info" do
    it "returns additional samples when getAdditionalSamples is true (the if-arm)" do
      expect(controller).to receive(:sample_details_json)
        .with([pipeline_run.id.to_s], 573, contigs_only: true).and_return([{ "name" => "extra" }])

      get :new_pr_info, params: { getAdditionalSamples: "true", taxId: 573, pipelineRunIds: [pipeline_run.id] }, format: :json

      expect(JSON.parse(response.body)["samples"]).to eq([{ "name" => "extra" }])
    end

    it "returns project samples when getAdditionalSamples is false (the else-arm)" do
      expect(controller).to receive(:sample_details_json)
        .with([pipeline_run.id.to_s], 573, contigs_only: false).and_return([{ "name" => "project" }])

      get :new_pr_info, params: { getAdditionalSamples: "false", taxId: 573, pipelineRunIds: [pipeline_run.id] }, format: :json

      expect(JSON.parse(response.body)["samples"]).to eq([{ "name" => "project" }])
    end
  end

  describe "GET choose_taxon with the elasticsearch bypass" do
    before do
      allow(AppConfigHelper).to receive(:get_app_config).and_call_original
      allow(AppConfigHelper).to receive(:get_app_config).with(AppConfig::BYPASS_ES_TAXON_SEARCH).and_return("1")
    end

    it "returns the canned taxa matching the query (the bypass arm with a query)" do
      expect_any_instance_of(ElasticsearchHelper).not_to receive(:taxon_search)

      get :choose_taxon, params: { query: "klebsiella pneumoniae" }

      results = JSON.parse(response.body)
      expect(results.pluck("taxid")).to eq([573])
    end

    it "returns null when there is no query (the bypass arm, query absent)" do
      get :choose_taxon

      expect(JSON.parse(response.body)).to be_nil
    end
  end

  describe "#filter_phylo_tree_ngs" do
    let(:other_project) { create(:project, users: [@joe]) }
    let!(:tree_a) do
      create(:phylo_tree_ng, user: @joe, project: project, pipeline_runs: [pipeline_run], name: "Tree A",
                             inputs_json: { pipeline_run_ids: [pipeline_run.id], tax_id: 573 })
    end
    let!(:tree_b) do
      create(:phylo_tree_ng, user: @joe, project: other_project, pipeline_runs: [pipeline_run], name: "Tree B",
                             inputs_json: { pipeline_run_ids: [pipeline_run.id], tax_id: 570 })
    end
    let(:relation) { PhyloTreeNg.where(id: [tree_a.id, tree_b.id]) }

    it "filters by project id only (the project present? then-arm)" do
      result = controller.send(:filter_phylo_tree_ngs, phylo_tree_ngs: relation, filters: { projectId: project.id })
      expect(result.pluck(:id)).to eq([tree_a.id])
    end

    it "filters by tax id only (the tax_id present? then-arm)" do
      result = controller.send(:filter_phylo_tree_ngs, phylo_tree_ngs: relation, filters: { taxId: 570 })
      expect(result.pluck(:id)).to eq([tree_b.id])
    end

    it "applies no filter when neither is present (both else-arms)" do
      result = controller.send(:filter_phylo_tree_ngs, phylo_tree_ngs: relation, filters: {})
      expect(result.pluck(:id)).to contain_exactly(tree_a.id, tree_b.id)
    end
  end

  describe "#format_phylo_tree_ngs" do
    let!(:tree) do
      create(:phylo_tree_ng, user: @joe, project: project, pipeline_runs: [pipeline_run],
                             name: "Formatted", inputs_json: { pipeline_run_ids: [pipeline_run.id], tax_id: 573 })
    end

    it "slices the basic attributes and attaches the user in basic mode (the if-arm)" do
      formatted = controller.send(:format_phylo_tree_ngs, phylo_tree_ngs: PhyloTreeNg.where(id: tree.id), mode: "basic")

      expect(formatted.first[:name]).to eq("Formatted")
      expect(formatted.first[:user]).to eq(@joe.slice(:name, :id))
      expect(formatted.first[:nextGeneration]).to be(true)
    end

    it "returns the relation untouched for any other mode (the else-arm)" do
      relation = PhyloTreeNg.where(id: tree.id)
      formatted = controller.send(:format_phylo_tree_ngs, phylo_tree_ngs: relation, mode: "detailed")

      expect(formatted).to eq(relation)
    end
  end

  describe "#get_top_accession_from_coverage_viz_summary" do
    it "reads the best accession directly when the taxid is present (the if-arm)" do
      summary = { "573" => { "best_accessions" => [{ "id" => "ACC_1" }] } }
      expect(controller.send(:get_top_accession_from_coverage_viz_summary, summary, 573)).to eq("ACC_1")
    end

    it "falls back to a species within the genus when the taxid is absent (the else-arm)" do
      summary = { "573" => { "best_accessions" => [{ "id" => "ACC_SPECIES" }] } }
      expect(controller.send(:get_top_accession_from_coverage_viz_summary, summary, 570)).to eq("ACC_SPECIES")
    end

    it "returns nil when no species in the genus is present in the summary" do
      summary = { "9999" => { "best_accessions" => [{ "id" => "ACC_X" }] } }
      expect(controller.send(:get_top_accession_from_coverage_viz_summary, summary, 570)).to be_nil
    end
  end

  describe "#get_additional_reference_accession_ids" do
    before do
      allow(controller).to receive(:current_power).and_return(Power.new(@joe))
    end

    it "skips runs with no coverage viz summary path (the outer if not taken)" do
      allow_any_instance_of(PipelineRun).to receive(:coverage_viz_summary_s3_path).and_return(nil)

      expect(controller.send(:get_additional_reference_accession_ids, [pipeline_run.id], 573)).to eq([])
    end

    it "skips runs whose coverage viz summary is missing from S3 (the inner if not taken)" do
      allow_any_instance_of(PipelineRun).to receive(:coverage_viz_summary_s3_path).and_return("s3://b/summary.json")
      allow(S3Util).to receive(:get_s3_file).with("s3://b/summary.json").and_return(nil)

      expect(controller.send(:get_additional_reference_accession_ids, [pipeline_run.id], 573)).to eq([])
    end

    it "collects the top accession when the summary resolves (all arms taken)" do
      allow_any_instance_of(PipelineRun).to receive(:coverage_viz_summary_s3_path).and_return("s3://b/summary.json")
      allow(S3Util).to receive(:get_s3_file).with("s3://b/summary.json")
                                            .and_return({ "573" => { "best_accessions" => [{ "id" => "ACC_1" }] } }.to_json)

      expect(controller.send(:get_additional_reference_accession_ids, [pipeline_run.id], 573)).to eq(["ACC_1"])
    end

    it "ignores a blank top accession (the present? guard)" do
      allow_any_instance_of(PipelineRun).to receive(:coverage_viz_summary_s3_path).and_return("s3://b/summary.json")
      allow(S3Util).to receive(:get_s3_file).with("s3://b/summary.json")
                                            .and_return({ "573" => { "best_accessions" => [{ "id" => "" }] } }.to_json)

      expect(controller.send(:get_additional_reference_accession_ids, [pipeline_run.id], 573)).to eq([])
    end
  end

  describe "#get_coverage_breadth_for_pipeline_runs" do
    let!(:species_stat) do
      create(:accession_coverage_stat, pipeline_run: pipeline_run, taxid: 573, coverage_breadth: 0.75, num_contigs: 3)
    end

    it "reads the stats directly for a species-level taxon (the if-arm)" do
      result = controller.send(:get_coverage_breadth_for_pipeline_runs, PipelineRun.where(id: pipeline_run.id), 573)

      expect(result).to eq(pipeline_run.id => 0.75)
    end

    it "picks the best species stat within the genus for a genus-level taxon (the else-arm)" do
      result = controller.send(:get_coverage_breadth_for_pipeline_runs, PipelineRun.where(id: pipeline_run.id), 570)

      expect(result).to eq(pipeline_run.id => 0.75)
    end

    it "fills missing runs with zero when fill_zero is set (the fill_zero then-arm)" do
      other_sample = create(:sample, project: project)
      other_run = create(:pipeline_run, sample: other_sample)

      result = controller.send(:get_coverage_breadth_for_pipeline_runs,
                               PipelineRun.where(id: [pipeline_run.id, other_run.id]), 573, true)

      expect(result[pipeline_run.id]).to eq(0.75)
      expect(result[other_run.id]).to eq(0.0)
    end

    it "leaves missing runs out when fill_zero is not set (the fill_zero else-arm)" do
      other_sample = create(:sample, project: project)
      other_run = create(:pipeline_run, sample: other_sample)

      result = controller.send(:get_coverage_breadth_for_pipeline_runs,
                               PipelineRun.where(id: [pipeline_run.id, other_run.id]), 573)

      expect(result).not_to have_key(other_run.id)
    end
  end

  describe "#sample_details_json" do
    before do
      allow(controller).to receive(:current_power).and_return(Power.new(@joe))
    end

    it "returns an empty list for blank pipeline run ids (the first guard)" do
      expect(controller.send(:sample_details_json, [], 573)).to eq([])
    end

    it "returns an empty list for a human taxon (the second guard)" do
      expect(controller.send(:sample_details_json, [pipeline_run.id], ApplicationHelper::HUMAN_TAX_IDS.first)).to eq([])
    end

    it "left-joins contigs and returns all requested runs when contigs_only is false (the else-arm)" do
      details = controller.send(:sample_details_json, [pipeline_run.id], 573, contigs_only: false)

      expect(details.length).to eq(1)
      expect(details.first["name"]).to eq("Sample A")
      expect(details.first["num_contigs"]).to eq(0)
    end

    it "inner-joins contigs and drops runs without them when contigs_only is true (the if-arm)" do
      details = controller.send(:sample_details_json, [pipeline_run.id], 573, contigs_only: true)

      expect(details).to eq([])
    end

    it "includes a run with a matching contig when contigs_only is true" do
      create(:contig, pipeline_run: pipeline_run, species_taxid_nt: 573)

      details = controller.send(:sample_details_json, [pipeline_run.id], 573, contigs_only: true)

      expect(details.length).to eq(1)
      expect(details.first["num_contigs"]).to eq(1)
    end

    it "uses the genus coverage-stats subquery for a genus taxon (the tax_level if-arm)" do
      create(:contig, pipeline_run: pipeline_run, genus_taxid_nt: 570)
      create(:accession_coverage_stat, pipeline_run: pipeline_run, taxid: 573, coverage_breadth: 0.5, num_contigs: 2)

      details = controller.send(:sample_details_json, [pipeline_run.id], 570, contigs_only: false)

      expect(details.first["coverage_breadth"].to_f).to be_within(0.001).of(0.5)
    end
  end
end
