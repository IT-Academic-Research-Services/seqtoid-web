require "rails_helper"

# Second-wave branch coverage for app/helpers/samples_helper.rb.
#
# The first-wave companions (samples_helper_spec / _branches / _coverage2 / _data) drive the
# summary-stat tables, the S3 listing parser, the simple filter arms and the CSV HIPAA clamp.
# What is still undriven are the arms that only appear when a record is *missing* something:
# a hidden-page status for a run that is neither kind of run, an uploader with no user, a
# pipeline run with no alignment config, a CSV row with no host organism / run info /
# uploader, a sample with two runs of the same workflow, the location-typed metadata filter,
# the taxon-threshold filter's two filter families, and the empty-level short-circuit inside
# the contig sample counter.
RSpec.describe SamplesHelper, type: :helper do
  # UserMacros#create_users is not extended for `type: :helper`, so set up users inline
  # (matching the existing spec/helpers/samples_helper_spec.rb pattern).
  before do
    @joe = create(:joe)
  end

  let(:project) { create(:project, users: [@joe]) }

  describe "#sample_status_display_for_hidden_page" do
    it "reports an uploading sample regardless of the run" do
      sample = double("Sample", status: Sample::STATUS_CREATED)

      expect(helper.sample_status_display_for_hidden_page(sample, nil)).to eq("uploading")
    end

    it "returns an empty string for a checked sample with no run at all" do
      sample = double("Sample", status: Sample::STATUS_CHECKED)

      expect(helper.sample_status_display_for_hidden_page(sample, nil)).to eq("")
    end

    it "downcases a workflow run's status" do
      sample = double("Sample", status: Sample::STATUS_CHECKED)
      run = WorkflowRun.new(status: WorkflowRun::STATUS[:succeeded])

      expect(helper.sample_status_display_for_hidden_page(sample, run)).to eq(WorkflowRun::STATUS[:succeeded].downcase)
    end

    it "returns nil for a workflow run that has no status yet" do
      sample = double("Sample", status: Sample::STATUS_CHECKED)
      run = WorkflowRun.new(status: nil)

      expect(helper.sample_status_display_for_hidden_page(sample, run)).to be_nil
    end

    it "maps every pipeline-run job status onto its display string" do
      sample = double("Sample", status: Sample::STATUS_CHECKED)

      {
        PipelineRun::STATUS_CHECKED => "complete",
        PipelineRun::STATUS_FAILED => "failed",
        PipelineRun::STATUS_RUNNING => "running",
        "SOMETHING_ELSE" => "initializing",
      }.each do |job_status, expected|
        run = PipelineRun.new(job_status: job_status)
        expect(helper.sample_status_display_for_hidden_page(sample, run)).to eq(expected)
      end
    end

    it "returns nil for a run object that is neither a workflow run nor a pipeline run" do
      sample = double("Sample", status: Sample::STATUS_CHECKED)

      expect(helper.sample_status_display_for_hidden_page(sample, Object.new)).to be_nil
    end

    it "returns nil for a sample that is neither created nor checked" do
      sample = double("Sample", status: "failed")

      expect(helper.sample_status_display_for_hidden_page(sample, PipelineRun.new(job_status: PipelineRun::STATUS_CHECKED))).to be_nil
    end
  end

  describe "#sample_uploader" do
    it "reports the uploader's name and id when the sample has a user" do
      sample = create(:sample, project: project, user: @joe)

      expect(helper.sample_uploader(sample)).to eq(name: @joe.name, id: @joe.id)
    end

    it "reports nils when the sample has no user" do
      sample = double("Sample", user: nil)

      expect(helper.sample_uploader(sample)).to eq(name: nil, id: nil)
    end
  end

  describe "#sample_derived_data" do
    it "leaves the host genome and project names nil when the sample has neither" do
      sample = double("Sample", host_genome: nil, project: nil)

      output = helper.sample_derived_data(sample, nil, {})

      expect(output).to eq(pipeline_run: nil, host_genome_name: nil, project_name: nil, summary_stats: nil)
    end

    it "reports both names when the sample has them" do
      sample = create(:sample, project: project, user: @joe, host_genome_name: "Human")

      output = helper.sample_derived_data(sample, nil, {})

      expect(output[:host_genome_name]).to eq("Human")
      expect(output[:project_name]).to eq(project.name)
    end
  end

  describe "#pipeline_run_info" do
    let(:sample) { create(:sample, project: project, user: @joe) }

    it "leaves the ncbi index version nil when the run has no alignment config" do
      pr = create(:pipeline_run, sample: sample, finalized: 1)
      allow(pr).to receive(:alignment_config).and_return(nil)

      info = helper.pipeline_run_info(pr, [], {})

      expect(info[:ncbi_index_version]).to be_nil
      expect(info[:report_ready]).to be(false)
    end

    it "falls back to the queued placeholder when there is no run at all" do
      info = helper.pipeline_run_info(nil, [], {})

      expect(info).to eq(result_status_description: 'QUEUED FOR PROCESSING', finalized: 0, report_ready: 0)
    end
  end

  describe "#generate_sample_list_csv for a sparsely populated row" do
    let(:sample) do
      create(:sample,
             project: project, user: @joe,
             host_genome_name: "Mosquito",
             sample_notes: "collected in the field",
             pipeline_runs_data: [{ finalized: 1, job_status: PipelineRun::STATUS_CHECKED, pipeline_version: "8.2" }])
    end

    # format_samples is exercised directly in its own describe below; here we hand the CSV
    # writer a row where the optional pieces are absent, which is what the writer's `? :`
    # arms exist for and what format_samples produces for an errored / partial sample.
    it "substitutes empty strings for the missing uploader, run info and host organism" do
      pipeline_run = sample.pipeline_runs.first
      row = {
        db_sample: sample,
        metadata: {},
        derived_sample_output: { pipeline_run: pipeline_run, summary_stats: nil },
        mngs_run_info: nil,
      }
      allow(helper).to receive(:format_samples).and_return([row])

      csv = helper.generate_sample_list_csv(
        Sample.where(id: sample.id),
        selected_pipeline_runs_by_sample_id: { sample.id => pipeline_run }
      )

      header, values = CSV.parse(csv)
      by_column = header.zip(values).to_h

      expect(by_column["sample_name"]).to eq(sample.name)
      expect(by_column["uploader"]).to eq("")
      expect(by_column["overall_job_status"]).to eq("")
      expect(by_column["runtime_seconds"]).to eq("")
      expect(by_column["host_organism"]).to eq("")
      expect(by_column["notes"]).to eq("collected in the field")
      # The run is on 8.2, so only the modern host-filtering columns are offered.
      expect(header).to include("reads_after_bowtie2_ercc_filtered")
      expect(header).not_to include("reads_after_trimmomatic")
    end
  end

  describe "#format_samples" do
    it "counts repeated runs of the same workflow" do
      sample = create(:sample, project: project, user: @joe)
      2.times do
        create(:workflow_run, sample: sample, user: @joe, workflow: WorkflowRun::WORKFLOW[:consensus_genome])
      end
      create(:workflow_run, sample: sample, user: @joe, workflow: WorkflowRun::WORKFLOW[:amr])

      formatted = helper.format_samples(Sample.where(id: sample.id))

      expect(formatted.first[:workflow_runs_count_by_workflow]).to eq(
        WorkflowRun::WORKFLOW[:consensus_genome] => 2,
        WorkflowRun::WORKFLOW[:amr] => 1
      )
    end
  end

  describe "#filter_by_metadata_key on a location field" do
    before { MetadataField.where(name: "collection_location_v2").update(is_required: 0) }

    it "delegates to the location name filter instead of comparing the validated column" do
      in_sf = create(:sample, project: project, user: @joe, name: "sf-sample",
                              metadata_fields: { collection_location_v2: "San Francisco, USA" })
      create(:sample, project: project, user: @joe, name: "la-sample",
                      metadata_fields: { collection_location_v2: "Los Angeles, USA" })

      results = helper.send(:filter_by_metadata_key, Sample.where(project: project), "collection_location_v2", ["San Francisco, USA"])

      expect(results.pluck(:id)).to eq([in_sf.id])
    end
  end

  describe "#filter_by_taxon_threshold" do
    let!(:low_sample) do
      create(:sample, project: project, user: @joe, name: "low",
                      initial_workflow: WorkflowRun::WORKFLOW[:short_read_mngs],
                      pipeline_runs_data: [{
                        taxon_counts_data: [{ tax_level: 1, tax_id: 573, nt: 10 }],
                        contigs_data: [{ species_taxid_nt: 573, read_count: 10 }],
                      }])
    end
    let!(:high_sample) do
      create(:sample, project: project, user: @joe, name: "high",
                      initial_workflow: WorkflowRun::WORKFLOW[:short_read_mngs],
                      pipeline_runs_data: [{
                        taxon_counts_data: [{ tax_level: 1, tax_id: 573, nt: 5000 }],
                        contigs_data: [
                          { species_taxid_nt: 573, read_count: 1000 },
                          { species_taxid_nt: 573, read_count: 1000 },
                        ],
                      }])
    end

    let(:samples) { Sample.where(id: [low_sample.id, high_sample.id]) }

    it "applies only the taxon-count filters when no contig metric is requested" do
      threshold = [{ metric: "count", count_type: "NT", operator: ">=", value: 1000 }.to_json]

      results = helper.send(:filter_by_taxon_threshold, samples, [573], ["species"], threshold)

      expect(results.pluck(:id)).to eq([high_sample.id])
    end

    it "applies only the contig filters when no taxon-count metric is requested" do
      threshold = [{ metric: "contigs", count_type: "NT", operator: ">=", value: 2 }.to_json]

      results = helper.send(:filter_by_taxon_threshold, samples, [573], ["species"], threshold)

      expect(results.pluck(:id)).to eq([high_sample.id])
    end

    it "applies both families together when both kinds of metric are requested" do
      threshold = [
        { metric: "count", count_type: "NT", operator: ">=", value: 1000 }.to_json,
        { metric: "contigs", count_type: "NT", operator: ">=", value: 2 }.to_json,
      ]

      results = helper.send(:filter_by_taxon_threshold, samples, [573], ["species"], threshold)

      expect(results.pluck(:id)).to eq([high_sample.id])
    end
  end

  describe "#filter_samples taxon arms for a non-long-read workflow" do
    let!(:hit_sample) do
      create(:sample, project: project, user: @joe, name: "hit",
                      initial_workflow: WorkflowRun::WORKFLOW[:short_read_mngs],
                      pipeline_runs_data: [{ taxon_counts_data: [{ tax_level: 1, tax_id: 573, nt: 5000 }] }])
    end
    let!(:quiet_sample) do
      create(:sample, project: project, user: @joe, name: "quiet",
                      initial_workflow: WorkflowRun::WORKFLOW[:short_read_mngs],
                      pipeline_runs_data: [{ taxon_counts_data: [{ tax_level: 1, tax_id: 573, nt: 1 }] }])
    end

    let(:samples) { Sample.where(id: [hit_sample.id, quiet_sample.id]) }

    it "routes through the threshold filter when thresholds are supplied alongside taxa" do
      filters = {
        workflow: WorkflowRun::WORKFLOW[:short_read_mngs],
        taxon: [573],
        taxaLevels: ["species"],
        taxonThresholds: [{ metric: "count", count_type: "NT", operator: ">=", value: 1000 }.to_json],
      }

      expect(helper.send(:filter_samples, samples, filters).pluck(:id)).to eq([hit_sample.id])
    end

    it "applies the annotation filter for a short-read-mngs workflow" do
      create(:annotation, pipeline_run_id: hit_sample.pipeline_runs.first.id, tax_id: 573, content: "hit")
      filters = {
        workflow: WorkflowRun::WORKFLOW[:short_read_mngs],
        annotations: ["{\"name\":\"Hit\"}"],
      }

      expect(helper.send(:filter_samples, samples, filters).pluck(:id)).to eq([hit_sample.id])
    end
  end

  describe "#add_sample_count_to_taxa_with_contigs" do
    let!(:sample) do
      create(:sample, project: project, user: @joe,
                      pipeline_runs_data: [{
                        job_status: PipelineRun::STATUS_CHECKED,
                        finalized: 1,
                        contigs_data: [{ species_taxid_nt: 573, read_count: 10 }],
                      }])
    end

    it "skips the genus queries entirely when the taxon list has only species" do
      taxon_list = [{ "taxid" => 573, "level" => "species" }]

      result = helper.add_sample_count_to_taxa_with_contigs(taxon_list, Sample.where(id: sample.id))

      expect(result.first["sample_count"]).to eq(1)
    end

    it "skips the species queries entirely when the taxon list has only genera" do
      taxon_list = [{ "taxid" => 570, "level" => "genus" }]

      result = helper.add_sample_count_to_taxa_with_contigs(taxon_list, Sample.where(id: sample.id))

      expect(result.first["sample_count"]).to eq(0)
    end
  end
end
