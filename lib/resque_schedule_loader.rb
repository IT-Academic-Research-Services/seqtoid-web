# frozen_string_literal: true

require "yaml"

# Loads config/resque_schedule.yml, minus any entries an environment opts out of.
#
# RESQUE_SCHEDULE_EXCLUDE is a comma-separated list of schedule NAMES (the top-level keys of the
# YAML, e.g. "ResolveScreeningHolds"). Unset or empty => the full schedule, so every env that does not
# set it is unchanged.
#
# Why: some scheduled jobs belong only where their queue is worked. env-staging has no Descartes
# license, so it runs no screening-worker; ResolveScreeningHolds was still enqueued every 15 min onto
# a queue nothing consumes (690 jobs by 2026-09-30). Excluding it at load time stops the enqueue.
#
# This is enough to remove an entry: resque-scheduler (4.x) keeps YAML-loaded schedules in process
# memory (non-persistent), not in Redis, so the scheduler stops firing it on its next boot.
module ResqueScheduleLoader
  ENV_KEY = "RESQUE_SCHEDULE_EXCLUDE"

  def self.load(path, env = ENV)
    schedule = YAML.load_file(path)
    excluded = excluded_names(env)
    return schedule if excluded.empty?

    unknown = excluded - schedule.keys
    # A typo would silently exclude nothing; say so loudly instead.
    warn("[ResqueScheduleLoader] #{ENV_KEY} names unknown schedule(s): #{unknown.join(', ')}") if unknown.any?

    schedule.except(*excluded)
  end

  def self.excluded_names(env = ENV)
    env.fetch(ENV_KEY, "").split(",").map(&:strip).reject(&:empty?)
  end
end
