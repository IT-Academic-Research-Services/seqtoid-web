# frozen_string_literal: true

# Per-user weekly cap on uploaded samples, by channel and optionally in total. A week runs Sunday 00:00 to
# Saturday 23:59:59 Pacific. Channels:
#   cli        -- uploads made with the SeqToID CLI (the request carries a CLI bearer token);
#   web        -- the web uploader, from local files;
#   s3         -- the web uploader's S3 import;
#   basespace  -- the web uploader's BaseSpace import.
# A sample's channel comes from how the request authenticated (CLI token vs browser session) and from its
# input files' source_type -- never from the client-supplied `client` param.
#
# Limits are AppConfig::UPLOAD_WEEKLY_SAMPLE_LIMIT_* (unset = no limit on that channel, so this ships OFF).
# s3 / basespace samples share the cli allowance unless their own limit is set (bulk, unattended imports, like
# the CLI). A total limit, when set, applies on top of the per-channel ones. Admins are exempt; a SampleUploadLimitOverride gives one approved
# user higher limits (or none).
#
# Enforcement is a reservation: #reserve locks the user's usage rows for the week, rejects the WHOLE upload if
# any limit would be crossed, and otherwise counts it up front, so two parallel uploads cannot both slip under
# the cap. #release gives back samples the upload did not end up creating. Deleting samples later does not
# give the allowance back.
module WeeklySampleUploadLimit
  module_function

  TIME_ZONE = "America/Los_Angeles"
  CHANNELS = ["basespace", "cli", "s3", "web"].freeze
  REMOTE_CHANNELS = ["s3", "basespace"].freeze
  # Where s3 / basespace samples count when they have no limit of their own.
  REMOTE_FALLBACK = "cli"
  SCOPES = (CHANNELS + ["total"]).freeze
  LIMIT_KEYS = {
    "cli" => AppConfig::UPLOAD_WEEKLY_SAMPLE_LIMIT_CLI,
    "web" => AppConfig::UPLOAD_WEEKLY_SAMPLE_LIMIT_WEB,
    "s3" => AppConfig::UPLOAD_WEEKLY_SAMPLE_LIMIT_S3,
    "basespace" => AppConfig::UPLOAD_WEEKLY_SAMPLE_LIMIT_BASESPACE,
    "total" => AppConfig::UPLOAD_WEEKLY_SAMPLE_LIMIT_TOTAL,
  }.freeze
  LABELS = {
    "cli" => "the SeqToID CLI",
    "web" => "the web uploader",
    "s3" => "S3 import",
    "basespace" => "BaseSpace import",
    "total" => "all upload methods combined",
  }.freeze

  # allowed: whether the upload may proceed. counts: samples reserved per channel. On a rejection, scope /
  # limit / used say which limit would be crossed and how much of it was already used this week.
  # scope_channels: the channels that share the crossed limit (for the message).
  Reservation = Struct.new(:allowed, :user_id, :week_start, :counts, :scope, :scope_channels, :limit, :used, :requested,
                           keyword_init: true) do
    def allowed?
      allowed
    end
  end

  def week_start(now = Time.current)
    now.in_time_zone(TIME_ZONE).to_date.beginning_of_week(:sunday)
  end

  # When the week that starts on week_start ends: the next Sunday 00:00 Pacific (DST-correct).
  def resets_at(week_start)
    next_sunday = week_start + 7
    ActiveSupport::TimeZone[TIME_ZONE].local(next_sunday.year, next_sunday.month, next_sunday.day)
  end

  def default_limits
    LIMIT_KEYS.transform_values do |key|
      value = Integer(AppConfigHelper.get_app_config(key).to_s.strip, exception: false)
      value&.positive? ? value : nil
    end
  end

  # The limits that apply to user, per scope (nil = no limit). Admins, and users with an unlimited override,
  # have none; an active override replaces the default for each scope it sets.
  def limits_for(user)
    return SCOPES.index_with { nil } if user.admin?

    limits = default_limits
    override = SampleUploadLimitOverride.active.find_by(user_id: user.id)
    return SCOPES.index_with { nil } if override&.unlimited?

    SCOPES.index_with { |scope| override&.limit_for(scope) || limits[scope] }
  end

  # The scope a channel's samples count against: s3 / basespace share the cli allowance without a limit of
  # their own.
  def bucket_for(channel, limits)
    REMOTE_CHANNELS.include?(channel) && limits[channel].nil? ? REMOTE_FALLBACK : channel
  end

  # The channels whose samples count against scope.
  def channels_in(scope, limits)
    scope == "total" ? CHANNELS : CHANNELS.select { |c| bucket_for(c, limits) == scope }
  end

  # Samples per channel. sources: one entry per sample, the source_types of its input files. A CLI request
  # counts every sample as cli; otherwise a sample whose files are all from S3 (or all from BaseSpace) is an
  # s3 (basespace) sample and anything else -- local files, a mix, or no files -- is web.
  def counts_for(sources, cli:)
    sources.each_with_object(Hash.new(0)) do |source_types, counts|
      counts[channel_for(Array(source_types).map(&:to_s).uniq, cli: cli)] += 1
    end
  end

  def channel_for(source_types, cli:)
    return "cli" if cli
    return "s3" if source_types == [InputFile::SOURCE_TYPE_S3]
    return "basespace" if source_types == [InputFile::SOURCE_TYPE_BASESPACE]

    "web"
  end

  # Samples the user already uploaded this week, per channel.
  def usage(user, week = week_start)
    used = CHANNELS.index_with { 0 }
    WeeklySampleUploadUsage.where(user_id: user.id, week_start: week).pluck(:channel, :samples_count).each do |channel, count|
      used[channel] = count
    end
    used
  end

  # Check counts ({channel => samples}) against user's limits and, if every limit holds, count them for this
  # week. Returns a Reservation; pass it to #release once the upload has created its samples.
  def reserve(user:, counts:, now: Time.current)
    week = week_start(now)
    counts = counts.select { |_, n| n.positive? }
    limits = limits_for(user)
    return Reservation.new(allowed: true, user_id: user.id, week_start: week, counts: {}) if counts.empty? || limits.values.all?(&:nil?)

    ensure_usage_rows(user.id, week)
    WeeklySampleUploadUsage.transaction do
      rows = WeeklySampleUploadUsage.where(user_id: user.id, week_start: week).order(:channel).lock.to_a.index_by(&:channel)
      used = CHANNELS.index_with { |c| rows[c]&.samples_count.to_i }

      exceeded = first_exceeded(limits, used, counts)
      if exceeded
        scope, used_in_scope, requested = exceeded
        Reservation.new(allowed: false, user_id: user.id, week_start: week, counts: {}, scope: scope,
                        scope_channels: channels_in(scope, limits), limit: limits[scope], used: used_in_scope, requested: requested)
      else
        counts.each { |channel, n| rows.fetch(channel).update!(samples_count: rows[channel].samples_count + n) }
        Reservation.new(allowed: true, user_id: user.id, week_start: week, counts: counts)
      end
    end
  end

  # Give back what a reservation counted but the upload did not create (created: {channel => samples}).
  def release(reservation, created)
    reservation.counts.each do |channel, reserved|
      unused = reserved - created.fetch(channel, 0)
      next unless unused.positive?

      # One atomic decrement in SQL, so it cannot race a parallel upload's reservation.
      WeeklySampleUploadUsage.where(user_id: reservation.user_id, week_start: reservation.week_start, channel: channel)
                             .update_all(["samples_count = GREATEST(samples_count - ?, 0), updated_at = ?", unused, Time.current]) # rubocop:disable Rails/SkipsModelValidations
    end
  end

  # [scope, used in that scope, requested in that scope] for the first limit counts would cross, or nil.
  def first_exceeded(limits, used, counts)
    buckets = Hash.new { |h, k| h[k] = { used: 0, requested: 0 } }
    CHANNELS.each do |channel|
      bucket = buckets[bucket_for(channel, limits)]
      bucket[:used] += used[channel]
      bucket[:requested] += counts.fetch(channel, 0)
    end
    buckets.each do |scope, b|
      next if b[:requested].zero? || limits[scope].nil?
      return [scope, b[:used], b[:requested]] if b[:used] + b[:requested] > limits[scope]
    end
    if limits["total"]
      used_total = used.values.sum
      requested_total = counts.values.sum
      return ["total", used_total, requested_total] if used_total + requested_total > limits["total"]
    end
    nil
  end

  def ensure_usage_rows(user_id, week)
    existing = WeeklySampleUploadUsage.where(user_id: user_id, week_start: week).pluck(:channel)
    (CHANNELS - existing).each do |channel|
      WeeklySampleUploadUsage.create!(user_id: user_id, week_start: week, channel: channel, samples_count: 0)
    rescue ActiveRecord::RecordNotUnique
      # A parallel upload created it first; the locked read below sees it.
    end
  end

  # What a user has left this week, for the uploader UI and the CLI: per channel, the samples they can still
  # upload that way (nil = no limit), after both the channel's limit and the total.
  def summary(user, now = Time.current)
    week = week_start(now)
    limits = limits_for(user)
    used = usage(user, week)
    used_total = used.values.sum
    remaining = CHANNELS.index_with do |channel|
      bucket = bucket_for(channel, limits)
      used_in_bucket = channels_in(bucket, limits).sum { |c| used[c] }
      left = [limits[bucket] && limits[bucket] - used_in_bucket, limits["total"] && limits["total"] - used_total].compact
      left.empty? ? nil : [left.min, 0].max
    end
    {
      week_start: week.iso8601,
      resets_at: resets_at(week).iso8601,
      unlimited: limits.values.all?(&:nil?),
      limits: limits,
      used: used.merge("total" => used_total),
      remaining: remaining,
    }
  end

  def rejection_message(reservation)
    resets = resets_at(reservation.week_start).strftime("%A %B %-d at 12:00 AM Pacific")
    left = [reservation.limit - reservation.used, 0].max
    "Weekly upload limit reached: #{reservation.limit} samples per week through #{scope_label(reservation)}. " \
      "You have uploaded #{reservation.used} this week and have #{left} left, but this upload has #{reservation.requested}. " \
      "The limit resets #{resets}. Contact us if you need a higher limit."
  end

  # "the web uploader", or for a shared allowance "the SeqToID CLI, S3 import and BaseSpace import combined".
  def scope_label(reservation)
    channels = Array(reservation.scope_channels)
    return LABELS.fetch(reservation.scope) if reservation.scope == "total" || channels.size <= 1

    ordered = ([reservation.scope] + (channels - [reservation.scope])).map { |c| LABELS.fetch(c) }
    "#{ordered.to_sentence} combined"
  end
end
