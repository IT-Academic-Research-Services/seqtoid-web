# frozen_string_literal: true

# Approved exceptions to the weekly sample upload limits (WeeklySampleUploadLimit). One override per user;
# granting again replaces it. Arguments come from the environment so a reason can contain commas.
#
#   UPLOAD_USER=<id or email> rake upload_limits:show
#   UPLOAD_USER=<id or email> LIMITS="cli=5000 web=500" APPROVED_BY=<who> REASON="<why>" \
#     [EXPIRES=2026-12-31] rake upload_limits:grant
#   UPLOAD_USER=<id or email> LIMITS=unlimited APPROVED_BY=<who> REASON="<why>" rake upload_limits:grant
#   UPLOAD_USER=<id or email> rake upload_limits:revoke
#
# LIMITS scopes: cli, web, s3, basespace, total. A scope left out keeps the deployment default.
namespace :upload_limits do
  def upload_limits_user
    ref = ENV["UPLOAD_USER"].to_s.strip
    abort("UPLOAD_USER (user id or email) is required") if ref.blank?
    user = ref.match?(/\A\d+\z/) ? User.find_by(id: ref) : User.find_by(email: ref)
    abort("No user #{ref}") if user.nil?
    user
  end

  def upload_limits_print(user)
    override = SampleUploadLimitOverride.find_by(user_id: user.id)
    puts "user #{user.id}#{' (admin: exempt)' if user.admin?}"
    if override
      limits = SampleUploadLimitOverride::LIMIT_COLUMNS.filter_map { |scope, col| "#{scope}=#{override[col]}" if override[col] }
      state = override.expires_at.nil? || override.expires_at.future? ? "active" : "EXPIRED"
      puts "override (#{state}): #{override.unlimited? ? 'unlimited' : limits.join(' ')}; " \
           "expires #{override.expires_at || 'never'}; approved by #{override.approved_by}: #{override.reason}"
    else
      puts "override: none"
    end
    puts "this week: #{JSON.pretty_generate(WeeklySampleUploadLimit.summary(user))}"
  end

  desc "Show a user's weekly upload limits, override and usage. UPLOAD_USER=<id or email>"
  task show: :environment do
    upload_limits_print(upload_limits_user)
  end

  desc "Grant a user higher weekly upload limits. UPLOAD_USER, LIMITS, APPROVED_BY, REASON, [EXPIRES]"
  task grant: :environment do
    user = upload_limits_user
    approved_by = ENV["APPROVED_BY"].to_s.strip
    reason = ENV["REASON"].to_s.strip
    abort("APPROVED_BY and REASON are required") if approved_by.blank? || reason.blank?

    spec = ENV["LIMITS"].to_s.strip
    attrs = SampleUploadLimitOverride::LIMIT_COLUMNS.values.index_with { nil }.merge(unlimited: false)
    if spec == "unlimited"
      attrs[:unlimited] = true
    else
      abort('LIMITS is required, e.g. LIMITS="cli=5000 web=500" or LIMITS=unlimited') if spec.blank?
      spec.split.each do |pair|
        scope, value = pair.split("=", 2)
        column = SampleUploadLimitOverride::LIMIT_COLUMNS[scope]
        number = Integer(value.to_s, exception: false)
        abort("Bad LIMITS entry #{pair.inspect}: use <scope>=<positive number>, scopes #{SampleUploadLimitOverride::LIMIT_COLUMNS.keys.join(', ')}") if column.nil? || number.nil? || number <= 0
        attrs[column] = number
      end
    end
    expires = ENV["EXPIRES"].to_s.strip
    attrs[:expires_at] = expires.present? ? Time.find_zone!(WeeklySampleUploadLimit::TIME_ZONE).parse(expires) : nil

    override = SampleUploadLimitOverride.find_or_initialize_by(user_id: user.id)
    override.update!(attrs.merge(approved_by: approved_by, reason: reason))
    Rails.logger.info("UploadLimitOverrideGranted: user=#{user.id} approved_by=#{approved_by} #{attrs.compact.inspect}")
    upload_limits_print(user)
  end

  desc "Remove a user's upload limit override (back to the defaults). UPLOAD_USER=<id or email>"
  task revoke: :environment do
    user = upload_limits_user
    removed = SampleUploadLimitOverride.where(user_id: user.id).delete_all
    Rails.logger.info("UploadLimitOverrideRevoked: user=#{user.id} removed=#{removed}")
    puts removed.positive? ? "Removed the override for user #{user.id}." : "User #{user.id} had no override."
  end
end
