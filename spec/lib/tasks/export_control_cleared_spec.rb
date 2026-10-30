require 'rails_helper'
require 'rake'

# One-time backfill of users.export_control_cleared_at: screened sign-ups (no created_by_user_id) are cleared
# at their created_at, INCLUDE_IDS now; project-share accounts and EXCLUDE_IDS stay uncleared; dry run by default.
RSpec.describe 'export_control:backfill_cleared', type: :task do
  before(:all) do
    Rake::Task.define_task(:environment) unless Rake::Task.task_defined?(:environment)
    unless Rake::Task.task_defined?('export_control:backfill_cleared')
      Rake.application.rake_require('tasks/export_control_cleared', [Rails.root.join('lib').to_s])
    end
  end

  let(:task) { Rake::Task['export_control:backfill_cleared'] }
  let(:inviter) { create(:user, export_control_cleared_at: 2.days.ago) }
  let!(:screened) { create(:user, created_by_user_id: nil, created_at: Time.zone.parse('2026-10-08 19:55:47')) }
  let!(:invited) { create(:user, created_by_user_id: inviter.id) }
  let!(:invited_then_screened) { create(:user, created_by_user_id: inviter.id) }
  let!(:test_account) { create(:user, created_by_user_id: nil) }

  after do
    task.reenable
    %w[INCLUDE_IDS EXCLUDE_IDS APPLY].each { |k| ENV.delete(k) }
  end

  def run(include_ids: nil, exclude_ids: nil, apply: false)
    ENV['INCLUDE_IDS'] = include_ids
    ENV['EXCLUDE_IDS'] = exclude_ids
    ENV['APPLY'] = apply ? '1' : nil
    expect { task.invoke }.to output.to_stdout
  end

  it 'changes nothing without APPLY=1' do
    run(include_ids: invited_then_screened.id.to_s)

    expect(screened.reload.export_control_cleared_at).to be_nil
    expect(invited_then_screened.reload.export_control_cleared_at).to be_nil
  end

  it 'clears screened sign-ups at created_at and INCLUDE_IDS now, and leaves invitees and EXCLUDE_IDS uncleared' do
    run(include_ids: invited_then_screened.id.to_s, exclude_ids: test_account.id.to_s, apply: true)

    expect(screened.reload.export_control_cleared_at).to eq(screened.created_at)
    expect(invited_then_screened.reload.export_control_cleared_at).to be_within(1.minute).of(Time.current)
    expect(invited.reload.export_control_cleared_at).to be_nil
    expect(test_account.reload.export_control_cleared_at).to be_nil
    expect(inviter.reload.export_control_cleared_at).to be_within(1.minute).of(2.days.ago)
  end
end
