require 'rails_helper'
require 'rake'

# SMP-1692 -- operator backstop: rake export_control:release_error_holds[<subject_ref>] releases a
# subject's active fail-closed ERROR holds, and NEVER a real screening_hit hold.
RSpec.describe 'export_control:release_error_holds', type: :task do
  before(:all) do
    Rake::Task.define_task(:environment) unless Rake::Task.task_defined?(:environment)
    unless Rake::Task.task_defined?('export_control:release_error_holds')
      Rake.application.rake_require('tasks/export_control_holds', [Rails.root.join('lib').to_s])
    end
  end

  let(:task) { Rake::Task['export_control:release_error_holds'] }
  after { task.reenable }

  it 'releases active fail-closed error holds for the subject' do
    error_hold = create(:hold, :error, subject_ref: 'User:7')
    task.invoke('User:7')
    expect(error_hold.reload).not_to be_active
    expect(error_hold.disposition).to eq(Hold::DISPOSITION_RELEASED)
  end

  it 'leaves a real screening_hit hold untouched' do
    hit_hold = create(:hold, subject_ref: 'User:7') # default reason = screening_hit
    task.invoke('User:7')
    expect(hit_hold.reload).to be_active
  end
end
