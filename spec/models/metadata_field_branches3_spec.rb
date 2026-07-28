# frozen_string_literal: true

require 'rails_helper'

# Branch-coverage companion #3 for app/models/metadata_field.rb.
# Companions #1/#2 cover convert_type_to_string, field_info, add_examples and
# by_samples. This file takes the arms they leave untaken:
#   - boolean?: no options, options with force_options == 0, a non-two-option
#     list, a two-option list that is not Yes/No, and the true Yes/No case
#   - metadata_field_validations: the required-but-not-default_for_new_host_genome arm
#   - update_host_genomes!: the "attach to every host genome" arm and the no-op arm
RSpec.describe MetadataField, type: :model do
  describe "#boolean?" do
    it "is false when the field has no options" do
      field = build(:metadata_field, name: "no_options", base_type: MetadataField::STRING_TYPE,
                                     options: nil, force_options: 1)

      expect(field.boolean?).to be(false)
    end

    it "is false when the options are not forced" do
      field = build(:metadata_field, name: "unforced", base_type: MetadataField::STRING_TYPE,
                                     options: %w[Yes No].to_json, force_options: 0)

      expect(field.boolean?).to be(false)
    end

    it "is false when there are more than two forced options" do
      field = build(:metadata_field, name: "three_options", base_type: MetadataField::STRING_TYPE,
                                     options: %w[Yes No Maybe].to_json, force_options: 1)

      expect(field.boolean?).to be(false)
    end

    it "is false when the two forced options are not Yes/No" do
      field = build(:metadata_field, name: "two_other_options", base_type: MetadataField::STRING_TYPE,
                                     options: %w[True False].to_json, force_options: 1)

      expect(field.boolean?).to be(false)
    end

    it "is false when the two forced options are Yes/No in the wrong order" do
      field = build(:metadata_field, name: "reversed", base_type: MetadataField::STRING_TYPE,
                                     options: %w[No Yes].to_json, force_options: 1)

      expect(field.boolean?).to be(false)
    end

    it "is true for exactly Yes then No" do
      field = build(:metadata_field, name: "yes_no", base_type: MetadataField::STRING_TYPE,
                                     options: %w[Yes No].to_json, force_options: 1)

      expect(field.boolean?).to be(true)
      expect(field.field_info[:isBoolean]).to be(true)
    end
  end

  describe "#metadata_field_validations" do
    it "rejects a required field that is not a default for new host genomes" do
      field = build(:metadata_field, name: "req_not_default_for_new", base_type: MetadataField::STRING_TYPE,
                                     is_required: 1, is_default: 1, is_core: 1, default_for_new_host_genome: 0)

      expect(field).not_to be_valid
      expect(field.errors[:name]).to include('Required field must also be default_for_new_host_genome field')
    end

    it "accepts a field that satisfies every dependency" do
      field = build(:metadata_field, name: "fully_valid_field", base_type: MetadataField::STRING_TYPE,
                                     is_required: 1, is_default: 1, is_core: 1, default_for_new_host_genome: 1)

      expect(field).to be_valid
    end
  end

  describe "#update_host_genomes!" do
    let!(:host_genome) { create(:host_genome, name: "BranchUpdateHost") }

    it "attaches a required field to every host genome that lacks it" do
      field = create(:metadata_field, name: "branch_required_attach", base_type: MetadataField::STRING_TYPE,
                                      is_required: 1, is_default: 1, is_core: 1, default_for_new_host_genome: 1)

      field.host_genomes.destroy_all
      field.update_host_genomes!

      expect(field.reload.host_genomes).to include(host_genome)
    end

    it "leaves the host genomes alone for an optional, non-default field" do
      field = create(:metadata_field, name: "branch_optional_no_attach", base_type: MetadataField::STRING_TYPE,
                                      is_required: 0, is_default: 0, is_core: 0, default_for_new_host_genome: 0)

      field.host_genomes.destroy_all
      field.update_host_genomes!

      expect(field.reload.host_genomes).to be_empty
    end
  end
end
