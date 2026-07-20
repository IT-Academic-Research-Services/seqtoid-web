# frozen_string_literal: true

# Pure derivation of an AlignmentConfig's S3 paths from a version + index-generation prefix, extracted
# so it is unit-testable without S3 or a DB. Replaces the hand-edited lib/seed_resources/
# alignment_configs.rb entries (epic #548 refresh pipeline 3/6): index-generation writes every
# artifact to a deterministic path, so the config row can be DERIVED and validated instead of typed.
#
# Two-cadence aware:
# - FULL (annual NT/NR rebuild): derive every path from the version's index-generation-2 dir.
# - LINEAGE-ONLY (quarterly): the NT/NR *sequence* indexes did not change, so reuse their paths from a
#   base AlignmentConfig and override only the lineage-derived paths + version. This is the common case
#   and avoids re-guessing sequence filenames the lineage job never produced.
module AlignmentConfigBuilder
  module_function

  # <attribute> => <filename under index-generation-2/>
  FILE_ATTRS = {
    s3_nt_db_path:           "nt_compressed_shuffled.fa",
    s3_nt_loc_db_path:       "nt_loc.marisa",
    s3_nr_db_path:           "nr_compressed_shuffled.fa",
    s3_nr_loc_db_path:       "nr_loc.marisa",
    s3_lineage_path:         "taxid-lineages.marisa",
    s3_accession2taxid_path: "accession2taxid.marisa",
    s3_deuterostome_db_path: "deuterostome_taxids.txt",
    s3_nt_info_db_path:      "nt_info.marisa",
    s3_taxon_blacklist_path: "taxon_ignore_list.txt",
  }.freeze

  # <attribute> => <directory prefix under index-generation-2/> (trailing slash)
  DIR_ATTRS = {
    minimap2_long_db_path:  "nt_k14_w8_20/",
    minimap2_short_db_path: "nt_k14_w8_20/",
    diamond_db_path:        "diamond_index_chunksize_5500000000/",
  }.freeze

  # The lineage-derived paths -- the only ones a quarterly lineage-only refresh replaces.
  LINEAGE_ATTRS = %i[s3_lineage_path s3_accession2taxid_path].freeze

  # The NT/NR sequence paths reused from a base config on a lineage-only refresh.
  SEQUENCE_ATTRS = (FILE_ATTRS.keys + DIR_ATTRS.keys - LINEAGE_ATTRS).freeze

  # s3://<bucket>/<prefix>/<version>/index-generation-2
  def base_uri(bucket:, version:, prefix: "ncbi-indexes-prod")
    "s3://#{bucket}/#{prefix.to_s.chomp('/')}/#{version}/index-generation-2"
  end

  # Full attribute hash for an AlignmentConfig, every path derived from the convention.
  def derive_attributes(version:, bucket:, prefix: "ncbi-indexes-prod")
    base = base_uri(bucket: bucket, version: version, prefix: prefix)
    attrs = { name: version, index_dir_suffix: nil, lineage_version: version, lineage_version_old: nil }
    FILE_ATTRS.each { |k, f| attrs[k] = "#{base}/#{f}" }
    DIR_ATTRS.each  { |k, d| attrs[k] = "#{base}/#{d}" }
    attrs
  end

  # Lineage-only attributes: reuse the base config's sequence paths, override the lineage paths +
  # version. `base_attrs` is the existing AlignmentConfig's attributes (symbol keys).
  def lineage_only_attributes(version:, bucket:, base_attrs:, prefix: "ncbi-indexes-prod")
    base = base_uri(bucket: bucket, version: version, prefix: prefix)
    attrs = { name: version, index_dir_suffix: base_attrs[:index_dir_suffix],
              lineage_version: version, lineage_version_old: nil }
    SEQUENCE_ATTRS.each { |k| attrs[k] = base_attrs[k] } # unchanged NT/NR
    LINEAGE_ATTRS.each  { |k| attrs[k] = "#{base}/#{FILE_ATTRS[k]}" } # fresh lineage
    attrs
  end

  # The S3 object keys (relative to bucket) that must EXIST for a full config to be valid -- the file
  # artifacts (directories are validated by prefix-listing in the rake, not here).
  def required_object_keys(version:, prefix: "ncbi-indexes-prod")
    base = "#{prefix.to_s.chomp('/')}/#{version}/index-generation-2"
    FILE_ATTRS.values.map { |f| "#{base}/#{f}" }
  end

  # Just the lineage object keys (quarterly validation).
  def lineage_object_keys(version:, prefix: "ncbi-indexes-prod")
    base = "#{prefix.to_s.chomp('/')}/#{version}/index-generation-2"
    LINEAGE_ATTRS.map { |k| "#{base}/#{FILE_ATTRS[k]}" }
  end
end
