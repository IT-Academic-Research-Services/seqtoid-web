require "rails_helper"

# Branch-coverage companion for app/helpers/metadata_helper.rb.
# Two clusters of untaken arms:
#   1. metadata_template_csv_helper — every arm of the `fields` / `samples`
#      selection chains and of the per-cell value chain (new samples vs no
#      project vs existing project samples, HIPAA age masking, unknown host).
#   2. validate_metadata_csv_for_samples — the row-level error/warning arms
#      (wrong value count, missing sample name, unknown sample for NEW samples,
#      sample without project, missing/invalid host organism, HIPAA age warning,
#      per-value validation errors, value-already-exists, missing required).
RSpec.describe MetadataHelper, type: :helper do
  before { allow(Rails.logger).to receive(:warn) }

  # ---------------------------------------------------------------- template --

  describe "#metadata_template_csv_helper" do
    let!(:human) { create(:host_genome, name: "Human") }
    let!(:sample_type) do
      create(:metadata_field, name: "sample_type", display_name: "Sample Type",
                              base_type: MetadataField::STRING_TYPE, is_core: 1, is_default: 1)
    end
    let!(:host_age) do
      # Deliberately NOT is_default: Project#add_default_metadata_fields would
      # otherwise attach it to every project and blur the intersection assertions.
      create(:metadata_field, name: "host_age", display_name: "Host Age",
                              base_type: MetadataField::NUMBER_TYPE, is_core: 1)
    end

    before do
      human.metadata_fields << sample_type unless human.metadata_fields.include?(sample_type)
      human.metadata_fields << host_age unless human.metadata_fields.include?(host_age)
    end

    it "builds an example row per host genome when there is no project and no new samples" do
      csv = CSV.parse(
        helper.metadata_template_csv_helper(project_id: nil, new_sample_names: nil, host_genomes: []),
        headers: true
      )

      expect(csv.headers).to include("Sample Name", "Host Organism")
      expect(csv.pluck("Host Organism")).to include("Human")
      # project.nil? -> each cell is filled with a generated default value.
      expect(csv.find { |row| row["Host Organism"] == "Human" }["Sample Type"]).to be_present
    end

    it "emits blank cells and Human defaults for new sample names" do
      csv = CSV.parse(
        helper.metadata_template_csv_helper(project_id: nil, new_sample_names: %w[s1 s2], host_genomes: ["Human"]),
        headers: true
      )

      expect(csv.pluck("Sample Name")).to eq(%w[s1 s2])
      # host_genomes runs out at index 1, so the second sample defaults to Human.
      expect(csv.pluck("Host Organism")).to eq(%w[Human Human])
      # samples_are_new -> values are left blank for the user to fill in.
      expect(csv.pluck("Sample Type").compact).to be_empty
    end

    it "falls back to the raw host organism name for a host genome with no metadata fields" do
      # A host genome with no metadata fields is dropped from host_genomes_by_name,
      # so the per-cell lookup finds no host and the raw name is echoed back.
      create(:host_genome, name: "EmptyFieldsHost")

      csv = CSV.parse(
        helper.metadata_template_csv_helper(project_id: nil, new_sample_names: ["s1"], host_genomes: ["EmptyFieldsHost"]),
        headers: true
      )

      expect(csv[0]["Host Organism"]).to eq("EmptyFieldsHost")
      expect(csv[0]["Sample Type"]).to be_nil
    end

    it "raises when new_sample_names is not enumerable" do
      expect do
        helper.metadata_template_csv_helper(project_id: nil, new_sample_names: "s1", host_genomes: [])
      end.to raise_error("new_sample_names should be an array")
    end

    it "uses Human fields intersected with the project fields for new samples in a project" do
      project = create(:project, metadata_fields: [sample_type])

      csv = CSV.parse(
        helper.metadata_template_csv_helper(project_id: project.id, new_sample_names: ["s1"], host_genomes: []),
        headers: true
      )

      expect(csv.headers).to include("Sample Type")
      expect(csv.headers).not_to include("Host Age")
    end

    context "with an existing project sample" do
      let(:project) { create(:project, metadata_fields: [sample_type, host_age]) }

      it "fills cells from existing metadata and omits the host organism column" do
        create(:sample, project: project, name: "existing_1", host_genome: human,
                        metadata_fields: { "sample_type" => "Serum" })

        csv = CSV.parse(
          helper.metadata_template_csv_helper(project_id: project.id, new_sample_names: nil, host_genomes: []),
          headers: true
        )

        # samples_are_new is false and the project exists -> no Host Organism column.
        expect(csv.headers).not_to include("Host Organism")
        expect(csv[0]["Sample Name"]).to eq("existing_1")
        expect(csv[0]["Sample Type"]).to eq("Serum")
        # A field with no stored metadatum stays blank (the &. nil arm).
        expect(csv[0]["Host Age"]).to be_nil
      end

      it "masks a human host age at or above the HIPAA maximum" do
        create(:sample, project: project, name: "existing_2", host_genome: human,
                        metadata_fields: { "host_age" => "95" })

        csv = CSV.parse(
          helper.metadata_template_csv_helper(project_id: project.id, new_sample_names: nil, host_genomes: []),
          headers: true
        )

        expect(csv[0]["Host Age"]).to eq("≥ #{MetadataField::MAX_HUMAN_AGE}")
      end

      it "leaves a human host age below the HIPAA maximum untouched" do
        create(:sample, project: project, name: "existing_3", host_genome: human,
                        metadata_fields: { "host_age" => "30" })

        csv = CSV.parse(
          helper.metadata_template_csv_helper(project_id: project.id, new_sample_names: nil, host_genomes: []),
          headers: true
        )

        expect(csv[0]["Host Age"]).to eq("30")
      end
    end
  end

  # -------------------------------------------------------------- validation --

  describe "#validate_metadata_csv_for_project_samples row-level errors" do
    let(:project) { create(:project) }
    let!(:human) { create(:host_genome, name: "Human") }

    it "records a wrong-number-of-values error and ignores the extra cells" do
      sample = create(:sample, project: project, name: "sample_1", host_genome: human)
      metadata = {
        "headers" => %w[sample_name],
        "rows" => [%w[sample_1 extra_value]],
      }

      result = helper.validate_metadata_csv_for_project_samples([sample], metadata)

      captions = result[:errors].pluck(:caption).join(" ")
      expect(captions).to match(/values/i)
    end

    it "records a missing-sample-name error for a row with a blank name cell" do
      sample = create(:sample, project: project, name: "sample_1", host_genome: human)
      metadata = {
        "headers" => %w[sample_name sample_type],
        "rows" => [["", "Serum"]],
      }

      result = helper.validate_metadata_csv_for_project_samples([sample], metadata)

      expect(result[:errors]).not_to be_empty
    end

    it "warns about a column that does not match any existing metadata field" do
      sample = create(:sample, project: project, name: "sample_1", host_genome: human)
      metadata = {
        "headers" => %w[sample_name totally_custom_column],
        "rows" => [%w[sample_1 anything]],
      }

      result = helper.validate_metadata_csv_for_project_samples([sample], metadata)

      captions = result[:warnings].pluck(:caption).join(" ")
      expect(captions).to match(/custom/i)
    end

    it "aborts on duplicate columns" do
      field = create(:metadata_field, name: "sample_type", display_name: "Sample Type",
                                      base_type: MetadataField::STRING_TYPE, is_core: 1)
      project.metadata_fields << field
      sample = create(:sample, project: project, name: "sample_1", host_genome: human)
      metadata = {
        "headers" => ["sample_name", "sample_type", "Sample Type"],
        "rows" => [%w[sample_1 Serum Plasma]],
      }

      result = helper.validate_metadata_csv_for_project_samples([sample], metadata)

      expect(result[:errors]).not_to be_empty
      expect(result[:warnings]).to eq([])
    end

    it "skips the project-fields union when the sample has no project" do
      sample = Sample.new(name: "unsaved_sample", host_genome: human)
      metadata = {
        "headers" => %w[sample_name],
        "rows" => [%w[unsaved_sample]],
      }

      result = helper.validate_metadata_csv_for_project_samples([sample], metadata)

      expect(result[:errors]).to eq([])
    end

    it "records an invalid-key error for a field that is not on the sample's host genome" do
      other_host = create(:host_genome, name: "OtherHost")
      field = create(:metadata_field, name: "other_host_only", display_name: "Other Host Only",
                                      base_type: MetadataField::STRING_TYPE, is_core: 1,
                                      host_genomes: [other_host])
      project.metadata_fields << field
      sample = create(:sample, project: project, name: "sample_1", host_genome: human)
      metadata = {
        "headers" => %w[sample_name other_host_only],
        "rows" => [%w[sample_1 something]],
      }

      result = helper.validate_metadata_csv_for_project_samples([sample], metadata)

      expect(result[:errors]).not_to be_empty
    end

    it "records a raw-value error for a value of the wrong type" do
      field = create(:metadata_field, name: "host_count", display_name: "Host Count",
                                      base_type: MetadataField::NUMBER_TYPE, is_core: 1,
                                      host_genomes: [human])
      project.metadata_fields << field
      sample = create(:sample, project: project, name: "sample_1", host_genome: human)
      metadata = {
        "headers" => %w[sample_name host_count],
        "rows" => [%w[sample_1 not_a_number]],
      }

      result = helper.validate_metadata_csv_for_project_samples([sample], metadata)

      expect(result[:errors]).not_to be_empty
    end

    it "warns when the CSV would overwrite an existing metadatum value" do
      # The sample factory attaches the field to the host genome itself, so do not
      # pre-associate it here (that would double-insert the join row).
      field = create(:metadata_field, name: "sample_type", display_name: "Sample Type",
                                      base_type: MetadataField::STRING_TYPE, is_core: 1)
      project.metadata_fields << field
      sample = create(:sample, project: project, name: "sample_1", host_genome: human,
                               metadata_fields: { "sample_type" => "Serum" })
      metadata = {
        "headers" => %w[sample_name sample_type],
        "rows" => [%w[sample_1 Plasma]],
      }

      result = helper.validate_metadata_csv_for_project_samples([sample], metadata)

      captions = result[:warnings].pluck(:caption).join(" ")
      expect(captions).to match(/overwritten/i)
    end
  end

  describe "#validate_metadata_csv_for_new_samples row-level errors" do
    let(:project) { create(:project) }
    let!(:human) { create(:host_genome, name: "Human") }

    before { allow(helper).to receive(:current_user).and_return(create(:user)) }

    it "reports an unmatched sample name using the new-sample error variant" do
      sample = create(:sample, project: project, name: "sample_1", host_genome: human)
      metadata = {
        "headers" => ["sample_name", "Host Organism"],
        "rows" => [["not_the_sample", "Human"]],
      }

      issues, = helper.validate_metadata_csv_for_new_samples([sample], metadata)

      expect(issues[:errors]).not_to be_empty
    end

    it "reports a row whose sample has no project" do
      sample = Sample.new(name: "projectless", host_genome: human)
      metadata = {
        "headers" => ["sample_name", "Host Organism"],
        "rows" => [["projectless", "Human"]],
      }

      issues, = helper.validate_metadata_csv_for_new_samples([sample], metadata)

      captions = issues[:errors].pluck(:caption).join(" ")
      expect(captions).to match(/project/i)
    end

    it "reports a row with a blank host organism cell" do
      sample = create(:sample, project: project, name: "sample_1", host_genome: human)
      metadata = {
        "headers" => ["sample_name", "Host Organism"],
        "rows" => [["sample_1", ""]],
      }

      issues, = helper.validate_metadata_csv_for_new_samples([sample], metadata)

      captions = issues[:errors].pluck(:caption).join(" ")
      expect(captions).to match(/host/i)
    end

    it "warns when a human sample's age is at or above the HIPAA maximum" do
      create(:metadata_field, name: "host_age", display_name: "Host Age",
                              base_type: MetadataField::NUMBER_TYPE, is_core: 1, host_genomes: [human])
      sample = create(:sample, project: project, name: "sample_1", host_genome: human)
      metadata = {
        "headers" => ["sample_name", "Host Organism", "Host Age"],
        "rows" => [["sample_1", "Human", "95"]],
      }

      issues, = helper.validate_metadata_csv_for_new_samples([sample], metadata)

      captions = issues[:warnings].pluck(:caption).join(" ")
      expect(captions).to match(/90/)
    end

    it "does not warn when a human sample's age is below the HIPAA maximum" do
      create(:metadata_field, name: "host_age", display_name: "Host Age",
                              base_type: MetadataField::NUMBER_TYPE, is_core: 1, host_genomes: [human])
      sample = create(:sample, project: project, name: "sample_1", host_genome: human)
      metadata = {
        "headers" => ["sample_name", "Host Organism", "Host Age"],
        "rows" => [["sample_1", "Human", "30"]],
      }

      issues, = helper.validate_metadata_csv_for_new_samples([sample], metadata)

      captions = issues[:warnings].pluck(:caption).join(" ")
      expect(captions).not_to match(/90/)
    end

    it "reports rows that are missing a required metadata field" do
      create(:metadata_field, name: "collection_date", display_name: "Collection Date",
                              base_type: MetadataField::STRING_TYPE, is_core: 1, is_default: 1,
                              is_required: 1, default_for_new_host_genome: 1)
      sample = create(:sample, project: project, name: "sample_1", host_genome: human)
      metadata = {
        "headers" => ["sample_name", "Host Organism"],
        "rows" => [["sample_1", "Human"]],
      }

      issues, = helper.validate_metadata_csv_for_new_samples([sample], metadata)

      captions = issues[:errors].pluck(:caption).join(" ")
      expect(captions).to match(/required/i)
    end
  end
end
