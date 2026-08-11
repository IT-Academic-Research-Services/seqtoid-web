# frozen_string_literal: true

# SMP-1499 -- the Metadata Dictionary renders metadata_fields.description verbatim from
# the database, so the legacy "CZ ID" / "IDseq" brand references seeded into three core
# field descriptions surface on every page of the dictionary. db/seeds.rb is corrected
# for fresh databases; this migration corrects the rows already present in existing
# dev / staging / prod databases.
#
# Unlike the host-genome migrations under db/data (which CREATE rows), this UPDATES a
# column, so it is guarded on the OLD brand token still being present rather than on the
# row existing: a description already corrected -- or re-running the migration -- is a
# no-op. The replacement is a targeted substring swap, not a whole-literal reassignment,
# so a later hand-edit to a description is preserved everywhere except the brand token.

class RebrandMetadataFieldDescriptions < ActiveRecord::Migration[6.1]
  # metadata_fields.name => [legacy brand token, replacement]
  REPLACEMENTS = {
    "collection_date" => ["CZ ID", "SeqtoID"],
    "collection_location" => ["IDseq", "SeqtoID"],
    "collection_location_v2" => ["CZ ID", "SeqtoID"],
  }.freeze

  def up
    REPLACEMENTS.each do |name, (legacy_token, seqtoid_token)|
      swap_token(name, legacy_token, seqtoid_token)
    end
  end

  def down
    REPLACEMENTS.each do |name, (legacy_token, seqtoid_token)|
      swap_token(name, seqtoid_token, legacy_token)
    end
  end

  private

  def swap_token(name, from_token, to_token)
    field = MetadataField.find_by(name: name)
    return unless field&.description&.include?(from_token)

    field.update!(description: field.description.gsub(from_token, to_token))
  end
end
