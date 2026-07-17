require 'resque/server'
require 'resque/scheduler/server' # Enables 'Schedule' tab (/resque/schedule)

Resque.redis = Redis.new(url: REDISCLOUD_URL)

Dir[Rails.root.join('app', 'jobs', '*.rb')].sort.each { |file| require file }

RESQUE_SERVER = Resque::Server.new
# Hide verbose exception pages
RESQUE_SERVER.settings.show_exceptions = false

# #544: `Resque.schedule=` (resque-scheduler) writes the schedule into Redis, so it opens a
# Redis connection at boot. Skip it during `rails assets:precompile` (marked by the build-only
# ENV["ASSETS_PRECOMPILE"], set in the Dockerfile) where no Redis is running -- asset compilation
# never uses the schedule. The YAML is still loadable; only the boot-time Redis write is skipped.
# ENV["ASSETS_PRECOMPILE"] is never set at runtime, so deployed behavior is unchanged.
#
# SKIP_RESQUE_SCHEDULE is the same escape hatch for the same reason, at runtime. `Resque.redis=`
# above is lazy -- it opens nothing -- so this line is the ONLY thing that makes a plain Rails boot
# require a reachable Redis. That matters for a preview sandbox, whose Redis lives in its own
# namespace and is created in the Sync phase, while the migrate hook that boots Rails is a PreSync
# hook and therefore runs BEFORE it exists. Without this, migrate would die trying to write a
# schedule it has no reason to write: only the resque-scheduler process consumes it, and that
# process boots after its Redis is up.
#
# Writing the schedule is not skipped anywhere it is needed -- the scheduler sets it on its own
# boot. Unset by default, so dev/staging/prod are unchanged.
Resque.schedule = YAML.load_file('config/resque_schedule.yml') unless ENV["ASSETS_PRECOMPILE"] || ENV["SKIP_RESQUE_SCHEDULE"]
