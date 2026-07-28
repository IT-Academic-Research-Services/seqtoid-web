# frozen_string_literal: true

require "rails_helper"

# Branch sweep #2 for BulkDownloadsHelper. The existing helper specs only reach the
# module's pure `self.` methods; the INSTANCE methods -- the ones the controller and
# the GraphQL mutations mix in -- are what still carry untaken arms:
#
#   get_valid_pipeline_run_ids_for_samples - each arm of the error translation rescue.
#   format_bulk_download                   - all four workflow-selection arms, the
#                                            admin block, the user&.name nil arm, the
#                                            params-nil guard and the detailed block.
#   validate_num_objects                   - unset app config, over/under the limit,
#                                            and the admin bypass.
#   validate_bulk_download_create_params   - sample vs workflow-run input, both
#                                            permission errors, unknown download type,
#                                            and the admin_only / collaborator_only /
#                                            uploader_only gates on both arms.
#   validate_sample_metadata_params        - the array guard and the permission guard.
#
# The helper is exercised through a bare host object that mixes it in the same way a
# controller does (plus AppConfigHelper for get_app_config and a current_user), so no
# application code is touched.
RSpec.describe BulkDownloadsHelper, type: :helper do
  let(:host_class) do
    Class.new do
      include AppConfigHelper
      include BulkDownloadsHelper
      attr_accessor :current_user
    end
  end

  let(:joe) { create(:joe) }
  let(:admin) { create(:admin) }
  let(:host) do
    h = host_class.new
    h.current_user = joe
    h
  end

  # A download type table with the three permission flags the real table does not
  # currently populate, so both arms of each gate are reachable.
  let(:download_types) do
    base = BulkDownloadTypesHelper::BULK_DOWNLOAD_TYPE_NAME_TO_DATA
    base.merge(
      "spec_admin_only" => { type: "spec_admin_only", admin_only: true },
      "spec_collaborator_only" => { type: "spec_collaborator_only", collaborator_only: true },
      "spec_uploader_only" => { type: "spec_uploader_only", uploader_only: true },
      "spec_open" => { type: "spec_open" }
    )
  end

  before do
    stub_const("BulkDownloadTypesHelper::BULK_DOWNLOAD_TYPE_NAME_TO_DATA", download_types)
    AppConfigHelper.set_app_config(AppConfig::MAX_OBJECTS_BULK_DOWNLOAD, "100")
  end

  describe "#get_valid_pipeline_run_ids_for_samples" do
    let(:samples) { [create(:sample, project: create(:project, users: [joe]), user: joe)] }

    it "returns the pipeline run ids when every run succeeded" do
      runs = [instance_double("PipelineRun", id: 5), instance_double("PipelineRun", id: 9)]
      allow(host).to receive(:get_succeeded_pipeline_runs_for_samples).and_return(runs)

      expect(host.get_valid_pipeline_run_ids_for_samples(samples)).to eq([5, 9])
    end

    it "translates the still-running error into the human-readable sample message" do
      allow(host).to receive(:get_succeeded_pipeline_runs_for_samples)
        .and_raise(PipelineRunsHelper::PIPELINE_RUN_STILL_RUNNING_ERROR)

      expect { host.get_valid_pipeline_run_ids_for_samples(samples) }
        .to raise_error(BulkDownloadsHelper::SAMPLE_STILL_RUNNING_ERROR)
    end

    it "translates the failed-run error into the human-readable sample message" do
      allow(host).to receive(:get_succeeded_pipeline_runs_for_samples)
        .and_raise(PipelineRunsHelper::PIPELINE_RUN_FAILED_ERROR)

      expect { host.get_valid_pipeline_run_ids_for_samples(samples) }
        .to raise_error(BulkDownloadsHelper::SAMPLE_FAILED_ERROR)
    end

    it "logs and re-raises anything else (the else arm)" do
      allow(host).to receive(:get_succeeded_pipeline_runs_for_samples).and_raise(ArgumentError, "weird")
      expect(LogUtil).to receive(:log_error).with(/Unexpected issue getting valid pipeline runs/, anything)

      expect { host.get_valid_pipeline_run_ids_for_samples(samples) }.to raise_error(ArgumentError, "weird")
    end
  end

  describe "#validate_num_objects" do
    it "raises when the max-objects app config is not set" do
      AppConfigHelper.remove_app_config(AppConfig::MAX_OBJECTS_BULK_DOWNLOAD)

      expect { host.validate_num_objects(1, AppConfig::MAX_OBJECTS_BULK_DOWNLOAD) }
        .to raise_error(BulkDownloadsHelper::APP_CONFIG_MAX_OBJECTS_NOT_SET)
    end

    it "passes when the count is within the limit" do
      expect { host.validate_num_objects(100, AppConfig::MAX_OBJECTS_BULK_DOWNLOAD) }.not_to raise_error
    end

    it "raises for a non-admin over the limit" do
      AppConfigHelper.set_app_config(AppConfig::MAX_OBJECTS_BULK_DOWNLOAD, "2")

      expect { host.validate_num_objects(3, AppConfig::MAX_OBJECTS_BULK_DOWNLOAD) }
        .to raise_error(BulkDownloadsHelper::MAX_OBJECTS_EXCEEDED_ERROR_TEMPLATE % "2")
    end

    it "lets an admin exceed the limit (the && short-circuit)" do
      AppConfigHelper.set_app_config(AppConfig::MAX_OBJECTS_BULK_DOWNLOAD, "2")
      host.current_user = admin

      expect { host.validate_num_objects(3, AppConfig::MAX_OBJECTS_BULK_DOWNLOAD) }.not_to raise_error
    end
  end

  describe "#validate_bulk_download_create_params" do
    let(:project) { create(:project, users: [joe]) }
    let(:sample) { create(:sample, project: project, user: joe) }
    let(:workflow_run) do
      create(:workflow_run, sample: sample, user: joe,
                            workflow: WorkflowRun::WORKFLOW[:consensus_genome], deprecated: false)
    end

    it "returns the viewable samples for a sample-id download" do
      result = host.validate_bulk_download_create_params(
        { sample_ids: [sample.id], download_type: "spec_open" }, joe
      )

      expect(result.pluck(:id)).to eq([sample.id])
    end

    it "returns the viewable workflow runs for a workflow-run download (the elsif arm)" do
      result = host.validate_bulk_download_create_params(
        { workflow_run_ids: [workflow_run.id], download_type: "spec_open" }, joe
      )

      expect(result.pluck(:id)).to eq([workflow_run.id])
    end

    it "raises the sample permission error when a sample is not viewable" do
      other_sample = create(:sample, project: create(:project), user: create(:user))

      expect do
        host.validate_bulk_download_create_params(
          { sample_ids: [sample.id, other_sample.id], download_type: "spec_open" }, joe
        )
      end.to raise_error(BulkDownloadsHelper::SAMPLE_NO_PERMISSION_ERROR)
    end

    it "raises the workflow-run permission error when a run is not viewable" do
      other_run = create(:workflow_run,
                         sample: create(:sample, project: create(:project), user: create(:user)),
                         user: create(:user),
                         workflow: WorkflowRun::WORKFLOW[:consensus_genome], deprecated: false)

      expect do
        host.validate_bulk_download_create_params(
          { workflow_run_ids: [workflow_run.id, other_run.id], download_type: "spec_open" }, joe
        )
      end.to raise_error(BulkDownloadsHelper::WORKFLOW_RUN_NO_PERMISSION_ERROR)
    end

    it "raises for an unrecognized download type" do
      expect do
        host.validate_bulk_download_create_params(
          { sample_ids: [sample.id], download_type: "not_a_real_type" }, joe
        )
      end.to raise_error(BulkDownloadsHelper::UNKNOWN_DOWNLOAD_TYPE)
    end

    it "blocks a non-admin from an admin-only download type" do
      expect do
        host.validate_bulk_download_create_params(
          { sample_ids: [sample.id], download_type: "spec_admin_only" }, joe
        )
      end.to raise_error(BulkDownloadsHelper::ADMIN_ONLY_DOWNLOAD_TYPE)
    end

    it "allows an admin through an admin-only download type" do
      host.current_user = admin
      admin_project = create(:project, users: [admin])
      admin_sample = create(:sample, project: admin_project, user: admin)

      result = host.validate_bulk_download_create_params(
        { sample_ids: [admin_sample.id], download_type: "spec_admin_only" }, admin
      )

      expect(result.pluck(:id)).to eq([admin_sample.id])
    end

    it "blocks a non-collaborator from a collaborator-only download type" do
      # Public project Joe can view but is not a member of.
      foreign_sample = create(:sample, project: create(:public_project), user: create(:user))
      allow_any_instance_of(Power).to receive(:viewable_samples).and_return(Sample.where(id: foreign_sample.id))

      expect do
        host.validate_bulk_download_create_params(
          { sample_ids: [foreign_sample.id], download_type: "spec_collaborator_only" }, joe
        )
      end.to raise_error(BulkDownloadsHelper::COLLABORATOR_ONLY_DOWNLOAD_TYPE)
    end

    it "allows a project collaborator through a collaborator-only download type" do
      result = host.validate_bulk_download_create_params(
        { sample_ids: [sample.id], download_type: "spec_collaborator_only" }, joe
      )

      expect(result.pluck(:id)).to eq([sample.id])
    end

    it "blocks a non-uploader from an uploader-only sample download" do
      someone_else = create(:user)
      not_mine = create(:sample, project: project, user: someone_else)

      expect do
        host.validate_bulk_download_create_params(
          { sample_ids: [not_mine.id], download_type: "spec_uploader_only" }, joe
        )
      end.to raise_error(BulkDownloadsHelper::UPLOADER_ONLY_DOWNLOAD_TYPE)
    end

    it "allows the uploader through an uploader-only sample download" do
      result = host.validate_bulk_download_create_params(
        { sample_ids: [sample.id], download_type: "spec_uploader_only" }, joe
      )

      expect(result.pluck(:id)).to eq([sample.id])
    end

    it "checks uploader ownership via created_by for a workflow-run download (the ternary else)" do
      result = host.validate_bulk_download_create_params(
        { workflow_run_ids: [workflow_run.id], download_type: "spec_uploader_only" }, joe
      )

      expect(result.pluck(:id)).to eq([workflow_run.id])
    end

    it "blows up on the count check when neither id list is supplied (the elsif's else arm)" do
      # Neither branch assigns num_objects, so validate_num_objects compares nil to
      # the configured maximum. Pinning the NoMethodError documents that the
      # no-ids case is not actually guarded.
      expect do
        host.validate_bulk_download_create_params({ download_type: "spec_open" }, joe)
      end.to raise_error(NoMethodError)
    end

    it "skips the uploader check entirely for an admin" do
      host.current_user = admin
      admin_project = create(:project, users: [admin])
      not_admins = create(:sample, project: admin_project, user: create(:user))

      result = host.validate_bulk_download_create_params(
        { sample_ids: [not_admins.id], download_type: "spec_uploader_only" }, admin
      )

      expect(result.pluck(:id)).to eq([not_admins.id])
    end
  end

  describe "#validate_sample_metadata_params" do
    let(:project) { create(:project, users: [joe]) }
    let(:sample) { create(:sample, project: project, user: joe) }

    it "raises when sample_ids is not an array" do
      expect { host.validate_sample_metadata_params({ sample_ids: sample.id }, joe) }
        .to raise_error(BulkDownloadsHelper::MISSING_SAMPLE_IDS_ERROR)
    end

    it "de-duplicates the ids and returns them with the viewable samples" do
      sample_ids, viewable = host.validate_sample_metadata_params(
        { sample_ids: [sample.id, sample.id] }, joe
      )

      expect(sample_ids).to eq([sample.id])
      expect(viewable.pluck(:id)).to eq([sample.id])
    end

    it "raises the permission error when an id is not viewable" do
      hidden = create(:sample, project: create(:project), user: create(:user))

      expect { host.validate_sample_metadata_params({ sample_ids: [sample.id, hidden.id] }, joe) }
        .to raise_error(BulkDownloadsHelper::SAMPLE_NO_PERMISSION_ERROR)
    end
  end

  describe "#format_bulk_download" do
    let(:project) { create(:project, users: [joe]) }
    let(:sample) { create(:sample, project: project, user: joe) }

    def bulk_download_with(pipeline_runs: [], workflow_runs: [], **attrs)
      bd = create(:bulk_download, user: joe, **attrs)
      bd.pipeline_runs = pipeline_runs
      bd.workflow_runs = workflow_runs
      bd
    end

    it "reports the short-read-mngs workflow when pipeline runs are attached" do
      pipeline_run = create(:pipeline_run, sample: sample)
      bd = bulk_download_with(pipeline_runs: [pipeline_run])

      formatted = host.format_bulk_download(bd)

      expect(formatted[:analysis_type]).to eq(WorkflowRun::WORKFLOW[:short_read_mngs])
      expect(formatted[:analysis_count]).to eq(1)
      expect(formatted[:num_samples]).to eq(1)
      expect(formatted[:download_name]).to be_present
      # access_token is excluded; admin-only and detail keys are absent by default.
      expect(formatted).not_to have_key("access_token")
      expect(formatted).not_to have_key(:user_name)
      expect(formatted).not_to have_key(:pipeline_runs)
      expect(formatted).not_to have_key(:params)
    end

    it "reports the consensus-genome workflow when only CG runs are attached (the first elsif)" do
      cg = create(:workflow_run, sample: sample, user: joe,
                                 workflow: WorkflowRun::WORKFLOW[:consensus_genome], deprecated: false)
      bd = bulk_download_with(workflow_runs: [cg])

      formatted = host.format_bulk_download(bd)

      expect(formatted[:analysis_type]).to eq(WorkflowRun::WORKFLOW[:consensus_genome])
      expect(formatted[:analysis_count]).to eq(1)
    end

    it "reports the AMR workflow when only AMR runs are attached (the second elsif)" do
      amr = create(:workflow_run, sample: sample, user: joe,
                                  workflow: WorkflowRun::WORKFLOW[:amr], deprecated: false)
      bd = bulk_download_with(workflow_runs: [amr])

      formatted = host.format_bulk_download(bd)

      expect(formatted[:analysis_type]).to eq(WorkflowRun::WORKFLOW[:amr])
      expect(formatted[:analysis_count]).to eq(1)
    end

    it "degrades to mNGS/0 and logs when nothing is attached (the else arm)" do
      bd = bulk_download_with
      expect(LogUtil).to receive(:log_message).with(/has no associated workflow runs or pipeline runs/)

      formatted = host.format_bulk_download(bd)

      expect(formatted[:analysis_type]).to eq(WorkflowRun::WORKFLOW[:short_read_mngs])
      expect(formatted[:analysis_count]).to eq(0)
      expect(formatted[:num_samples]).to eq(0)
    end

    it "adds the admin-only fields when admin is true" do
      pipeline_run = create(:pipeline_run, sample: sample)
      bd = bulk_download_with(pipeline_runs: [pipeline_run])

      formatted = host.format_bulk_download(bd, admin: true)

      expect(formatted[:user_name]).to eq(joe.name)
      expect(formatted[:execution_type]).to eq(bd.execution_type)
      expect(formatted).to have_key(:log_url)
    end

    it "leaves user_name nil when the uploader is gone (the &. nil arm)" do
      pipeline_run = create(:pipeline_run, sample: sample)
      bd = bulk_download_with(pipeline_runs: [pipeline_run])
      allow(bd).to receive(:user).and_return(nil)

      formatted = host.format_bulk_download(bd, admin: true)

      expect(formatted[:user_name]).to be_nil
    end

    it "includes params when the download carries them" do
      pipeline_run = create(:pipeline_run, sample: sample)
      bd = create(:bulk_download, user: joe, params: { "background" => { "value" => 17 } })
      bd.pipeline_runs = [pipeline_run]

      formatted = host.format_bulk_download(bd)

      expect(formatted[:params]).to eq("background" => { "value" => 17 })
    end

    it "expands the runs and the presigned url when detailed is true" do
      pipeline_run = create(:pipeline_run, sample: sample)
      cg = create(:workflow_run, sample: sample, user: joe,
                                 workflow: WorkflowRun::WORKFLOW[:consensus_genome], deprecated: false)
      bd = bulk_download_with(pipeline_runs: [pipeline_run], workflow_runs: [cg])

      formatted = host.format_bulk_download(bd, detailed: true)

      expect(formatted[:pipeline_runs]).to eq([{ "id": pipeline_run.id, "sample_name": sample.name }])
      expect(formatted[:workflow_runs]).to eq([{ "id": cg.id, "sample_name": sample.name }])
      # Not a succeeded download, so the presigned url short-circuits to nil.
      expect(formatted).to have_key(:presigned_output_url)
      expect(formatted[:presigned_output_url]).to be_nil
    end
  end

  describe ".pivot_biom_metrics row streaming" do
    let(:bulk_download_id) { "branchspec#{SecureRandom.hex(4)}" }
    let(:sample_names) { ["sample-a:1", "sample-b:2"] }
    let(:pr_id_to_sample_id) { { 10 => 1, 20 => 2 } }

    def taxonomy_columns(name)
      BulkDownloadsHelper::TAXONOMY_LIST.index_with { |level| "#{name}-#{level}" }
    end

    def row(tax_id:, pipeline_run_id:, rpm:, z_score:)
      taxonomy_columns("tax#{tax_id}").merge(
        "tax_id" => tax_id, "pipeline_run_id" => pipeline_run_id,
        "rpm" => rpm, "z_score" => z_score
      )
    end

    # A stand-in for the lazy TaxonCountsDataService relation. Only the three calls
    # pivot_biom_metrics makes are stubbed, which keeps the taxon/lineage join out of
    # the picture while the real streaming/pivot logic runs.
    def relation_for(rows)
      ordered = double("ordered_taxon_metrics")
      allow(ordered).to receive(:where).and_return(ordered)
      allow(ordered).to receive(:pluck_to_hash).and_return(rows)

      relation = double("taxon_metrics")
      allow(relation).to receive(:pluck).with(:id).and_return((1..rows.length).to_a)
      allow(relation).to receive(:order).with(:tax_id, :pipeline_run_id).and_return(ordered)
      relation
    end

    after do
      ["/tmp/#{bulk_download_id}_output.tsv", "/tmp/#{bulk_download_id}_taxonomy.tsv"].each do |path|
        File.delete(path) if File.exist?(path)
      end
    end

    it "emits one row per taxon, zero-fills a nil metric, and drops zscore-filtered rows" do
      rows = [
        row(tax_id: 100, pipeline_run_id: 10, rpm: 5.0, z_score: 3.0),
        row(tax_id: 100, pipeline_run_id: 20, rpm: nil, z_score: 3.0),   # nil metric -> 0
        row(tax_id: 200, pipeline_run_id: 10, rpm: 99.0, z_score: 0.1),  # filtered out by zscore
        row(tax_id: 300, pipeline_run_id: 20, rpm: 7.0, z_score: 4.0),
      ]
      zscore_filters = [{ operator: ">=", value: "1" }]

      data_file, taxonomy_file = BulkDownloadsHelper.pivot_biom_metrics(
        relation_for(rows), zscore_filters, "rpm", sample_names, pr_id_to_sample_id,
        %w[tax_id pipeline_run_id rpm z_score], bulk_download_id
      )

      data = CSV.read(data_file, col_sep: "\t")
      expect(data.first).to eq(["Taxon Name"] + sample_names)
      body = data.drop(1)
      # tax 100 (both runs, second zero-filled) then tax 300; tax 200 never made it
      # past the zscore filter.
      expect(body.length).to eq(2)
      expect(body[0][1..]).to eq(["5.0", "0"])
      expect(body[1][1..]).to eq(["0", "7.0"])

      taxonomy = CSV.read(taxonomy_file, col_sep: "\t")
      expect(taxonomy.first.first).to eq("#TaxID")
      expect(taxonomy.length).to eq(3)
    end

    it "writes only the trailing row when a single taxon is present (the prev-nil arm)" do
      rows = [row(tax_id: 100, pipeline_run_id: 10, rpm: 2.0, z_score: 9.0)]

      data_file, = BulkDownloadsHelper.pivot_biom_metrics(
        relation_for(rows), [], "rpm", sample_names, pr_id_to_sample_id,
        %w[tax_id pipeline_run_id rpm z_score], bulk_download_id
      )

      body = CSV.read(data_file, col_sep: "\t").drop(1)
      expect(body.length).to eq(1)
      expect(body[0][1..]).to eq(["2.0", "0"])
    end

    it "writes nothing but the header when every row is filtered out" do
      rows = [row(tax_id: 100, pipeline_run_id: 10, rpm: 2.0, z_score: 0.0)]

      data_file, = BulkDownloadsHelper.pivot_biom_metrics(
        relation_for(rows), [{ operator: ">=", value: "1" }], "rpm", sample_names,
        pr_id_to_sample_id, %w[tax_id pipeline_run_id rpm z_score], bulk_download_id
      )

      # prev_taxon_count stayed nil, so the final output_tsv_row call no-ops.
      expect(CSV.read(data_file, col_sep: "\t").length).to eq(1)
    end
  end

  describe ".filter_by_threshold count-type grouping" do
    let(:relation) { TaxonCount.where(tax_level: TaxonCount::TAX_LEVEL_SPECIES) }

    it "returns the relation untouched when every filter is a zscore filter" do
      # zscore is computed after the pluck, so it never becomes a SQL predicate;
      # filters_by_count_type ends up empty and the method early-returns.
      filters = [{ "metric" => "NT_zscore", "value" => "1", "operator" => ">=" }]

      returned, zscore_filters = BulkDownloadsHelper.filter_by_threshold(filters, relation)

      expect(returned).to equal(relation)
      expect(zscore_filters.pluck(:metric)).to eq(["z_score"])
    end

    it "ORs the predicates together when filters span two count types (the non-nil accumulator arm)" do
      filters = [
        { "metric" => "NT_rpm", "value" => "1", "operator" => ">=" },
        { "metric" => "NR_rpm", "value" => "2", "operator" => "<=" },
      ]

      returned, zscore_filters = BulkDownloadsHelper.filter_by_threshold(filters, relation)

      expect(zscore_filters).to be_empty
      sql = returned.to_sql
      expect(sql).to include("OR")
      expect(sql).to include("'NT'")
      expect(sql).to include("'NR'")
    end
  end

  describe ".generate_cg_overview_csv / data with missing workflow inputs" do
    let(:project) { create(:project, users: [joe]) }
    let(:sample) { create(:sample, project: project, user: joe, name: "no-inputs-sample") }

    before do
      allow(BulkDownloadsHelper).to receive(:generate_sample_metadata_csv_info)
        .and_return([["host_age"], [:host_age], {}])
      allow(BulkDownloadsHelper).to receive(:cg_overview_metadata_headers_and_info)
        .and_return([["Wetlab Protocol", "Executed At", "Host Age"], [:host_age], {}])
    end

    # inputs_json is nil, so wr.inputs is nil and every `wr.inputs&.[]` short-circuits.
    let!(:workflow_run) do
      create(:workflow_run, sample: sample, user: joe,
                            workflow: WorkflowRun::WORKFLOW[:consensus_genome], deprecated: false)
    end

    it "emits blank accession columns in the CSV when the run has no inputs" do
      csv = BulkDownloadsHelper.generate_cg_overview_csv(
        workflow_runs: WorkflowRun.where(id: workflow_run.id), include_metadata: true
      )

      row = CSV.parse(csv).last
      expect(row[0]).to eq("no-inputs-sample")
      # accession_name / accession_id came back nil from the safe navigation...
      expect(row[1]).to be_nil
      expect(row[2]).to be_nil
      # ...and the wetlab protocol fell back to the empty string via `|| ''`.
      expect(row).to include("")
    end

    it "emits nil accession values in the array form when the run has no inputs" do
      rows = BulkDownloadsHelper.generate_cg_overview_data(
        workflow_runs: WorkflowRun.where(id: workflow_run.id), include_metadata: true
      )

      data_row = rows.last
      expect(data_row[0]).to eq("no-inputs-sample")
      expect(data_row[1]).to be_nil
      expect(data_row[2]).to be_nil
      expect(data_row).to include("")
    end
  end

  describe ".generate_sample_metadata_csv_info HIPAA age clamp" do
    let(:project) { create(:project, users: [joe]) }
    let(:human_genome) { create(:host_genome, name: "Human") }
    let(:mosquito_genome) { create(:host_genome, name: "Mosquito") }

    before do
      # The metadata-field plumbing is not what this exercises; stub it out so the
      # HIPAA loop is the only thing under test.
      allow(MetadataHelper).to receive(:get_unique_metadata_fields_for_samples).and_return([])
      allow(MetadataHelper).to receive(:order_metadata_fields_for_csv).and_return([])
      allow(MetadataHelper).to receive(:get_csv_headers_for_metadata_fields).and_return(["Host Age"])
    end

    def metadata_for(sample, metadata)
      allow(Metadatum).to receive(:by_sample_ids).and_return(sample.id => metadata)
      _headers, _keys, by_sample_id = BulkDownloadsHelper.generate_sample_metadata_csv_info(samples: Sample.where(id: sample.id))
      by_sample_id[sample.id]
    end

    it "clamps an over-max age for a human host" do
      sample = create(:sample, project: project, user: joe, host_genome: human_genome)

      result = metadata_for(sample, host_age: MetadataField::MAX_HUMAN_AGE + 5)

      # The app writes a U+2265 (greater-than-or-equal) prefix; built by code point
      # so this source file stays pure ASCII.
      ge_sign = [0x2265].pack("U")
      expect(result[:host_age]).to eq("#{ge_sign} #{MetadataField::MAX_HUMAN_AGE}")
    end

    it "leaves an under-max age alone for a human host (the age guard's false arm)" do
      sample = create(:sample, project: project, user: joe, host_genome: human_genome)

      result = metadata_for(sample, host_age: 30)

      expect(result[:host_age]).to eq(30)
    end

    it "leaves an over-max age alone for a non-human host (the host guard's false arm)" do
      sample = create(:sample, project: project, user: joe, host_genome: mosquito_genome)

      result = metadata_for(sample, host_age: MetadataField::MAX_HUMAN_AGE + 5)

      expect(result[:host_age]).to eq(MetadataField::MAX_HUMAN_AGE + 5)
    end

    it "handles a human sample with no host_age at all (the key? false arm)" do
      sample = create(:sample, project: project, user: joe, host_genome: human_genome)

      result = metadata_for(sample, sample_type: "Serum")

      expect(result).to eq(sample_type: "Serum")
    end
  end
end
