require 'rails_helper'

# Branch sweep for ParameterSanitization, complementing parameter_sanitization_spec.rb. That
# spec covers sanitize_metadata_field_name / sanitize_accession_id / sanitize_annotation_filters;
# this one drives the branches those tests leave uncovered:
#   - sanitize_order_dir       : valid (:asc/:desc) return vs the default fall-through, incl. nil input
#   - sanitize_title_name      : the strip-after-substitution path
#   - get_annotation_name      : the NON-String (object with #name) branch, the sibling of the
#                                already-exercised String/JSON branch
# Spec-only, pure inputs -- no DB required.
RSpec.describe ParameterSanitization do
  let(:subject) { Class.new { extend ParameterSanitization } }

  describe "#sanitize_order_dir" do
    it "returns the symbol for a valid ascending direction" do
      expect(subject.sanitize_order_dir("asc")).to eq(:asc)
    end

    it "downcases before matching a valid direction" do
      expect(subject.sanitize_order_dir("DESC")).to eq(:desc)
    end

    it "returns the default for an unrecognized direction" do
      expect(subject.sanitize_order_dir("sideways", :asc)).to eq(:asc)
    end

    it "treats nil input as empty and returns the default" do
      expect(subject.sanitize_order_dir(nil, :desc)).to eq(:desc)
    end

    it "defaults to nil when no default is supplied and the value is invalid" do
      expect(subject.sanitize_order_dir("bogus")).to be_nil
    end
  end

  describe "#sanitize_title_name" do
    it "replaces disallowed characters with spaces and strips the result" do
      expect(subject.sanitize_title_name("  hi!  ")).to eq("hi")
    end

    it "preserves letters, numbers, underscores, dashes, and internal spaces" do
      expect(subject.sanitize_title_name("My_Study-1 A")).to eq("My_Study-1 A")
    end
  end

  describe "#get_annotation_name" do
    it "parameterizes the #name of a non-String annotation filter object" do
      annotation_filter = double(name: "Not a hit")
      expect(subject.get_annotation_name(annotation_filter)).to eq("not_a_hit")
    end

    it "parameterizes the parsed name of a String (JSON) annotation filter" do
      expect(subject.get_annotation_name("{\"name\":\"Not a hit\"}")).to eq("not_a_hit")
    end
  end
end
