# frozen_string_literal: true

# Pure verification logic for a candidate taxonomy/lineage artifact, extracted from the rake so it is
# unit-testable without S3 or a database. The rake (lib/tasks/taxonomy_verify.rake) fetches the real
# inputs (candidate CSV header, changelog counts, current DB baseline, known-panel rows) and hands
# them to these functions; every function is a pure transform from facts -> a check result.
#
# This is the reliability gate for the quarterly taxonomy refresh (epic #548): a candidate that fails
# any BLOCKING check cannot be loaded. The biological gate (benchmark AUPR) is wired separately; these
# are the structural + statistical-sanity + known-panel checks that run cheaply against the artifact.
module TaxonomyVerify
  module_function

  # The exact taxon_lineages columns the loader (reference_data:refresh) writes. The candidate
  # versioned-taxid-lineages CSV header must contain all of these (extra columns are allowed and
  # ignored; missing ones are a blocking structural failure -> schema drift).
  EXPECTED_COLUMNS = %w[
    taxid tax_name is_phage
    superkingdom_taxid superkingdom_name superkingdom_common_name
    kingdom_taxid kingdom_name kingdom_common_name
    phylum_taxid phylum_name phylum_common_name
    class_taxid class_name class_common_name
    order_taxid order_name order_common_name
    family_taxid family_name family_common_name
    genus_taxid genus_name genus_common_name
    species_taxid species_name species_common_name
    version_start version_end
  ].freeze

  # Curated taxid -> expected superkingdom_name. These are load-bearing organisms (host, the COVID
  # species CZID keys COVID reporting off, and a spread of common bacterial/viral/eukaryotic
  # pathogens). If any resolves to the wrong domain in the candidate, the merge mangled the tree.
  KNOWN_PANEL = {
    9606 => "Eukaryota", # Homo sapiens (host)
    2_697_049 => "Viruses", # SARS-CoV-2
    694_009 => "Viruses", # Severe acute respiratory syndrome-related coronavirus (CZID COVID species)
    11_676 => "Viruses", # HIV-1
    121_791 => "Viruses", # Nipah henipavirus
    1280 => "Bacteria", # Staphylococcus aureus
    562 => "Bacteria", # Escherichia coli
    1773 => "Bacteria",  # Mycobacterium tuberculosis
    5833 => "Eukaryota", # Plasmodium falciparum (malaria)
    5476 => "Eukaryota", # Candida albicans
  }.freeze

  # Default statistical bounds (fractions of the current baseline). Tunable via the rake's ENV.
  DEFAULT_THRESHOLDS = {
    max_shrink_frac: 0.02,  # distinct taxa may drop at most 2% (merges) before it looks like data loss
    max_growth_frac: 1.00,  # ...and grow at most 100% in one refresh (catches a duplicated/runaway pull)
    max_delete_frac: 0.05,  # deletions may be at most 5% of baseline (catches a corrupt/partial taxdump)
  }.freeze

  Result = Struct.new(:name, :status, :blocking, :detail, keyword_init: true) do
    def pass? = status == :pass
    def failed_block? = status == :fail && blocking
    def to_h = { name: name, status: status, blocking: blocking, detail: detail }
  end

  # STRUCTURAL: the candidate header must carry every expected column.
  def check_header(header_columns)
    present = Array(header_columns).map { |c| c.to_s.strip }
    missing = EXPECTED_COLUMNS - present
    if missing.empty?
      Result.new(name: "structural.header", status: :pass, blocking: true,
                 detail: "all #{EXPECTED_COLUMNS.size} expected columns present (#{present.size} total)")
    else
      Result.new(name: "structural.header", status: :fail, blocking: true,
                 detail: "missing required columns: #{missing.join(', ')}")
    end
  end

  # STRUCTURAL: every declared artifact file must be present + non-trivially sized.
  def check_artifacts(sizes_by_name, required: %w[versioned-taxid-lineages changed_lineage_taxa new_taxa deleted_taxa])
    problems = []
    required.each do |base|
      size = sizes_by_name[base] || sizes_by_name["#{base}.csv.gz"]
      problems << "#{base}: missing" if size.nil?
      problems << "#{base}: empty" if size && size <= 0
    end
    if problems.empty?
      Result.new(name: "structural.artifacts", status: :pass, blocking: true,
                 detail: "#{required.size} required artifacts present + non-empty")
    else
      Result.new(name: "structural.artifacts", status: :fail, blocking: true, detail: problems.join("; "))
    end
  end

  # SANITY: derive candidate distinct-taxa from baseline + changelog deltas (distinct_taxa =
  # baseline + new - deleted; "changed" does not alter the taxid set) and bound the movement. Cheap:
  # no full scan of the 7.5M-row versioned file needed. baseline == current DB distinct taxid count.
  def check_deltas(baseline_distinct:, new_count:, changed_count:, deleted_count:, thresholds: DEFAULT_THRESHOLDS)
    t = DEFAULT_THRESHOLDS.merge(thresholds || {})
    candidate_distinct = baseline_distinct + new_count - deleted_count
    issues = []

    if baseline_distinct.positive?
      shrink = (baseline_distinct - candidate_distinct).to_f / baseline_distinct
      growth = (candidate_distinct - baseline_distinct).to_f / baseline_distinct
      del_frac = deleted_count.to_f / baseline_distinct
      issues << format("distinct taxa shrank %.1f%% (max %.1f%%)", shrink * 100, t[:max_shrink_frac] * 100) if shrink > t[:max_shrink_frac]
      issues << format("distinct taxa grew %.1f%% (max %.1f%%)", growth * 100, t[:max_growth_frac] * 100) if growth > t[:max_growth_frac]
      issues << format("deletions are %.1f%% of baseline (max %.1f%%)", del_frac * 100, t[:max_delete_frac] * 100) if del_frac > t[:max_delete_frac]
    end
    issues << "new_count is negative (#{new_count})" if new_count.negative?
    issues << "deleted_count is negative (#{deleted_count})" if deleted_count.negative?

    detail = "baseline=#{baseline_distinct} +new=#{new_count} -deleted=#{deleted_count} changed=#{changed_count} => candidate_distinct=#{candidate_distinct}"
    if issues.empty?
      Result.new(name: "sanity.deltas", status: :pass, blocking: true, detail: detail)
    else
      Result.new(name: "sanity.deltas", status: :fail, blocking: true, detail: "#{detail}; #{issues.join('; ')}")
    end
  end

  # KNOWN-PANEL: each curated taxid must resolve to its expected superkingdom in the candidate.
  # resolved = { taxid => superkingdom_name } collected from the candidate for the panel taxids.
  def check_known_panel(resolved, panel: KNOWN_PANEL)
    missing = []
    wrong = []
    panel.each do |taxid, expected|
      got = resolved[taxid] || resolved[taxid.to_s]
      if got.nil? || got.to_s.strip.empty?
        missing << taxid
      elsif got != expected
        wrong << "#{taxid}: expected #{expected}, got #{got}"
      end
    end
    if missing.empty? && wrong.empty?
      Result.new(name: "known_panel", status: :pass, blocking: true,
                 detail: "all #{panel.size} curated taxa resolve to the expected superkingdom")
    else
      parts = []
      parts << "misclassified: #{wrong.join('; ')}" unless wrong.empty?
      parts << "unresolved taxids: #{missing.join(', ')}" unless missing.empty?
      # An unresolved panel taxid is blocking (a load-bearing organism vanished); a wrong domain is
      # blocking too.
      Result.new(name: "known_panel", status: :fail, blocking: true, detail: parts.join(" | "))
    end
  end

  # Aggregate a list of Result into a machine-readable report + overall PASS/FAIL.
  def build_report(results, version:, prefix:)
    blocking_failures = results.select(&:failed_block?)
    passed = blocking_failures.empty?
    {
      artifact: { version: version, prefix: prefix },
      overall: passed ? "PASS" : "FAIL",
      blocking_failures: blocking_failures.map(&:name),
      checks: results.map(&:to_h),
    }
  end
end
