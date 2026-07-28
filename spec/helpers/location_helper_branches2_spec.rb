# frozen_string_literal: true

require "rails_helper"

# Second branch sweep for LocationHelper, companion to
# location_helper_branches_spec.rb. The remaining untaken arms are:
#
#   * truncate_name: the inner `if name.size > max_chars` ELSE -- a >=4-part name
#     whose "first two + last two" rewrite already fits, so the harsher
#     "first + last two" fallback is NOT applied.
#   * sample_dimensions / project_dimensions: the `loc.is_a?(Array)` ELSE arms.
#     Both grouped counts key by an Array when the metadata join returns the
#     location hierarchy, but by a bare String for a plain string_validated_value
#     row -- that scalar shape is what these examples pin.
#
# Spec-only, no app changes.
RSpec.describe LocationHelper do
  describe ".truncate_name inner-fallback else arm" do
    it "keeps first-two + last-two parts when that rewrite already fits the max" do
      # 4 parts, original > 30 chars, rewrite == original here is not the point:
      # use 5 parts so the rewrite genuinely drops a part and lands under 30.
      long = "Aa, Bb, LongMiddlePartToBeDropped, Cc, Dd"
      expect(long.size).to be > Location::DEFAULT_MAX_NAME_LENGTH

      result = described_class.truncate_name(long)

      expect(result).to eq("Aa, Bb, Cc, Dd")
      expect(result.size).to be <= Location::DEFAULT_MAX_NAME_LENGTH
    end

    it "falls back to first + last two only when the first rewrite is still too long" do
      long = "AlphaAlphaAlpha, BetaBetaBetaBeta, Middle, GammaGamma, DeltaDelta"

      result = described_class.truncate_name(long)

      # The four-part rewrite would still exceed 30 chars, so the second
      # reduction runs: parts[0] + last two.
      expect(result).to eq("AlphaAlphaAlpha, GammaGamma, DeltaDelta")
    end
  end

  describe ".sample_dimensions with scalar grouping keys" do
    it "uses the key itself as the location and no parents when the key is not an Array" do
      mock_filtered = {
        "Alaska, USA" => 2,
        "Zimbabwe" => 1,
      }
      allow(SamplesHelper).to receive_message_chain(:samples_by_metadata_field, :count).and_return(mock_filtered)

      result = described_class.sample_dimensions([1, 2, 3], "collection_location_v2", 10)

      expect(result).to eq(
        [
          { value: "Alaska, USA", text: "Alaska, USA", count: 2, parents: [] },
          { value: "Zimbabwe", text: "Zimbabwe", count: 1, parents: [] },
          { value: "not_set", text: "Unknown", count: 7 },
        ]
      )
    end

    it "omits the not_set bucket when every sample already has a location" do
      allow(SamplesHelper).to receive_message_chain(:samples_by_metadata_field, :count)
        .and_return("Zimbabwe" => 4)

      result = described_class.sample_dimensions([1, 2, 3, 4], "collection_location_v2", 4)

      expect(result.pluck(:value)).to eq(["Zimbabwe"])
    end
  end

  describe ".project_dimensions with scalar grouping keys" do
    it "uses the key itself as the location and no parents when the key is not an Array" do
      allow(SamplesHelper).to receive_message_chain(:samples_by_metadata_field, :includes, :distinct, :count)
        .and_return("Hanoi, Vietnam" => 3)

      result = described_class.project_dimensions([1, 2, 3], "collection_location_v2")

      expect(result).to eq(
        [{ value: "Hanoi, Vietnam", text: "Hanoi, Vietnam", count: 3, parents: [] }]
      )
    end
  end
end
