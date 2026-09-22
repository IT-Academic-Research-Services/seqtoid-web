require "rails_helper"

# SMP-1724 -- a deploy re-seed must NOT downgrade a `*-version` app_config an environment has already
# advanced past.
#
# db:seed / seed:migrate run in the migrate PreSync hook on every deploy, reconstitute, and fresh
# bootstrap. The version-seed migrations set the `*-version` app_configs to the values hardcoded in
# the (necessarily stale) seed snapshot. When such a migration is re-applied against an env whose
# live default was bumped forward (e.g. staging hand-set short-read-mngs to 8.3.16), the old
# `set_app_config` overwrote it back to the stale seed value (8.3.15) and dispatched the OLD WDL --
# and VersionRetrievalService did NOT catch it, because the stale value is itself catalogued. This
# exercises the actual migration `up` against a bumped env and asserts it is a no-op on the live
# default while still guaranteeing the default is catalogued.
RSpec.describe "SMP-1724 non-downgrading version re-seed" do
  # Load the real seed migration the deploy hook applies, once, then re-run its `up` the way
  # seed:migrate does. Seed migration files live outside the autoload paths (SeedMigration loads them
  # explicitly), so requiring the file here defines the class without colliding with Rails eager load.
  require Rails.root.join("db/seeds/20260106010016_update_pipeline_version_app_config.rb").to_s

  def reseed!
    UpdatePipelineVersionAppConfig.new.up
  end

  context "when the environment has been bumped PAST the seed snapshot" do
    before do
      # Live env: short-read-mngs advanced to 8.3.16 (newer than the 8.3.15 seed), catalogued.
      AppConfigHelper.set_app_config("short-read-mngs-version", "8.3.16")
      create(:workflow_version, workflow: "short-read-mngs", version: "8.3.16")
      # Other defaults sit exactly at the seed values.
      AppConfigHelper.set_app_config("consensus-genome-version", "3.5.5")
      AppConfigHelper.set_app_config("long-read-mngs-version", "0.7.12")
    end

    it "does NOT downgrade the bumped default back to the stale seed value" do
      reseed!
      expect(AppConfigHelper.get_workflow_version("short-read-mngs")).to eq("8.3.16")
    end

    it "leaves the bumped default catalogued so VersionRetrievalService cannot fail-close" do
      reseed!
      expect(WorkflowVersion.exists?(workflow: "short-read-mngs", version: "8.3.16")).to be(true)
    end

    it "does not resurrect the stale version as the default" do
      reseed!
      expect(AppConfigHelper.get_workflow_version("short-read-mngs")).not_to eq("8.3.15")
    end

    it "is idempotent across repeated deploys" do
      reseed!
      reseed!
      expect(AppConfigHelper.get_workflow_version("short-read-mngs")).to eq("8.3.16")
    end
  end

  context "on a fresh-bootstrap environment (default absent)" do
    it "seeds the snapshot version and catalogues it" do
      expect(AppConfig.find_by(key: "short-read-mngs-version")).to be_nil

      reseed!

      expect(AppConfigHelper.get_workflow_version("short-read-mngs")).to eq("8.3.15")
      expect(WorkflowVersion.exists?(workflow: "short-read-mngs", version: "8.3.15")).to be(true)
    end
  end

  context "on an environment BEHIND the seed snapshot" do
    before do
      AppConfigHelper.set_app_config("short-read-mngs-version", "8.3.11")
    end

    it "advances the default forward to the seed version" do
      reseed!
      expect(AppConfigHelper.get_workflow_version("short-read-mngs")).to eq("8.3.15")
      expect(WorkflowVersion.exists?(workflow: "short-read-mngs", version: "8.3.15")).to be(true)
    end
  end
end
