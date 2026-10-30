# frozen_string_literal: true

# One-time backfill of users.export_control_cleared_at for accounts that passed Visual Compliance before the
# column existed (2026-10-30). Project sharing only adds cleared accounts (or admins), so without this every
# existing screened account would be refused.
#
# Which accounts are cleared:
#   - accounts with no created_by_user_id: these were created by ProvisionScreenedAccountJob after an approved
#     screen of the website sign-up form. Their created_at is when the approval provisioned them. (A project
#     share and an admin create both set created_by_user_id.)
#   - INCLUDE_IDS: accounts a project share created whose owner later passed the sign-up screen (verified by
#     hand against screening_results); cleared as of now.
#   - EXCLUDE_IDS: accounts with no created_by_user_id that must NOT count as cleared (e.g. a test account).
# Accounts that already have a value are left alone. Dry run unless APPLY=1.
#
#   rake export_control:backfill_cleared INCLUDE_IDS=280,303 EXCLUDE_IDS=1
#   rake export_control:backfill_cleared INCLUDE_IDS=280,303 EXCLUDE_IDS=1 APPLY=1
namespace :export_control do
  desc 'Backfill users.export_control_cleared_at for accounts that passed screening (dry run unless APPLY=1)'
  task backfill_cleared: :environment do
    parse_ids = ->(value) { value.to_s.split(',').map(&:strip).reject(&:empty?).map { |id| Integer(id) } }
    include_ids = parse_ids.call(ENV['INCLUDE_IDS'])
    exclude_ids = parse_ids.call(ENV['EXCLUDE_IDS'])
    apply = ENV['APPLY'] == '1'
    abort('An id is in both INCLUDE_IDS and EXCLUDE_IDS') if (include_ids & exclude_ids).any?

    pending = User.where(export_control_cleared_at: nil)
    screened = pending.where(created_by_user_id: nil).where.not(id: exclude_ids).to_a
    included = pending.where(id: include_ids).to_a
    missing = include_ids - User.where(id: include_ids).pluck(:id)
    abort("INCLUDE_IDS not found: #{missing.join(',')}") if missing.any?

    puts "screened sign-ups to mark (cleared at created_at): #{screened.size}"
    puts "INCLUDE_IDS to mark (cleared now): #{included.map(&:id).sort.inspect}"
    puts "EXCLUDE_IDS left uncleared: #{exclude_ids.sort.inspect}"
    puts "still uncleared afterwards: #{pending.count - screened.size - included.size} " \
         "(admins among them: #{pending.where.not(id: screened.map(&:id) + included.map(&:id)).count(&:admin?)})"
    unless apply
      puts 'dry run: nothing changed (APPLY=1 to write)'
      next
    end

    now = Time.current
    User.transaction do
      # update_columns: a data backfill; no callbacks or validations on unrelated fields.
      screened.each { |u| u.update_columns(export_control_cleared_at: u.created_at) } # rubocop:disable Rails/SkipsModelValidations
      included.each { |u| u.update_columns(export_control_cleared_at: now) } # rubocop:disable Rails/SkipsModelValidations
    end
    Rails.logger.info("[export_control:backfill_cleared] marked #{screened.size} screened + #{included.size} included " \
                      "(#{included.map(&:id).sort.join(',')}); excluded #{exclude_ids.sort.join(',')}")
    puts "marked #{screened.size + included.size} accounts cleared"
  end
end
