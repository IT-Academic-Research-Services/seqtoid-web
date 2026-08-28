require "rails_helper"

# SMP-1718 -- guard the db/seeds.rb snapshot so a `db:seed`-only bootstrap can never advertise a
# workflow default that has no catalog row.
#
# db/seeds.rb is a hand-maintained SeedMigration snapshot. It sets each workflow's default version as
# a `<workflow>-version` AppConfig, and separately declares the runnable catalog in WorkflowVersion
# rows. VersionRetrievalService (CZID-982) fail-closes when the configured default names a version
# with no catalog row -- so if the snapshot bumps a `*-version` app_config without adding the
# matching WorkflowVersion row, every request that resolves that project's pipeline versions 500s
# (the amr=1.4.2 Sentry regression, first seen 2026-08-08). Historically only `seed:migrate`
# (ReconcileWorkflowVersionCatalog) closed the gap; a deploy that ran db:seed without it shipped the
# break.
#
# This is a STATIC check of the checked-in snapshot -- it does not run the seed -- so it fails fast in
# CI the moment a default and the catalog disagree, which is the invariant SMP-1718 asks for.
RSpec.describe "db/seeds.rb workflow-version catalog consistency" do
  # `*-version` app_configs whose value is a workflow version. Mirrors AppConfig::WORKFLOW_VERSION_TEMPLATE.
  VERSION_APP_CONFIG = /AppConfig\.create\(\{"key"=>"([a-z0-9-]+)-version",\s*"value"=>"([^"]+)"\}/.freeze
  # The NCBI index default is selected via DEFAULT_ALIGNMENT_CONFIG_NAME, not a `*-version` key.
  NCBI_APP_CONFIG = /AppConfig\.create\(\{"key"=>"default_alignment_config_name",\s*"value"=>"([^"]+)"\}/.freeze
  WORKFLOW_VERSION_ROW = /WorkflowVersion\.create\(\{[^}]*"version"=>"([^"]+)",\s*"workflow"=>"([^"]+)"\}/.freeze

  let(:seed) { File.read(Rails.root.join("db/seeds.rb"), encoding: "UTF-8") }

  let(:configured_defaults) do
    defaults = seed.scan(VERSION_APP_CONFIG).map { |workflow, version| [workflow, version] }
    ncbi = seed[NCBI_APP_CONFIG, 1]
    defaults << [AlignmentConfig::NCBI_INDEX, ncbi] if ncbi.present?
    defaults
  end

  let(:catalogued) do
    seed.scan(WORKFLOW_VERSION_ROW).map { |version, workflow| [workflow, version] }.to_set
  end

  it "seeds at least one workflow-version default (guards against a regex that matched nothing)" do
    expect(configured_defaults).not_to be_empty
  end

  it "has a catalog row for every configured workflow default" do
    uncatalogued = configured_defaults.reject { |workflow, version| catalogued.include?([workflow, version]) }

    expect(uncatalogued).to be_empty,
      "db/seeds.rb configures workflow defaults with no matching WorkflowVersion row: " \
      "#{uncatalogued.map { |workflow, version| "#{workflow}=#{version}" }.join(', ')}. " \
      "Add the WorkflowVersion.create row(s) so db:seed alone stays consistent (SMP-1718)."
  end
end
