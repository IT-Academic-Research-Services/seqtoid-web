require "rails_helper"

# Branch coverage for ErrorHelper. Covers the conditional arms the existing
# error_helper_spec leaves undriven:
#   - get_field_error: the implicit fall-through when the field's base_type matches
#     none of the known type constants (returns nil).
#   - ErrorAggregator#create_raw_value_error_group_for_metadata_field: the human arm
#     of the LOCATION group and the non-human arm of the DATE group.
RSpec.describe ErrorHelper, type: :helper do
  describe "#get_field_error" do
    it "returns nil for a field whose base_type matches no known type" do
      field = MetadataField.new(base_type: 99)
      expect(helper.get_field_error(field)).to be_nil
    end
  end

  describe ErrorHelper::ErrorAggregator do
    subject(:aggregator) { described_class.new }

    def build_field(base_type, opts = {})
      MetadataField.new({ name: "collection_field", display_name: "Collection Field", base_type: base_type }.merge(opts))
    end

    it "builds a human LOCATION error group" do
      field = build_field(MetadataField::LOCATION_TYPE)
      key = aggregator.create_raw_value_error_group_for_metadata_field(field, 3, true)
      aggregator.add_error(key, [1, "s1", "bad"])
      expect(aggregator.error_groups.first[:caption]).to include(ErrorHelper::LOCATION_INVALID_ERROR_HUMAN)
    end

    it "builds a non-human DATE error group" do
      field = build_field(MetadataField::DATE_TYPE)
      key = aggregator.create_raw_value_error_group_for_metadata_field(field, 2, false)
      aggregator.add_error(key, [1, "s1", "bad"])
      expect(aggregator.error_groups.first[:caption]).to include(ErrorHelper::DATE_INVALID_ERROR)
    end
  end
end
