require 'rails_helper'
require 'rake'

# features:cleanup_user_columns strips launched features that the old add path copied into
# users.allowed_features. Dry run by default; MODE=superset only touches columns holding EVERY launched
# feature; MODE=all touches every column.
RSpec.describe 'features:cleanup_user_columns', type: :task do
  before(:all) do
    Rake::Task.define_task(:environment) unless Rake::Task.task_defined?(:environment)
    unless Rake::Task.task_defined?('features:cleanup_user_columns')
      Rake.application.rake_require('tasks/features', [Rails.root.join('lib').to_s])
    end
  end

  let(:task) { Rake::Task['features:cleanup_user_columns'] }
  let!(:polluted) { create(:user, allowed_features: JSON.dump(["launched_a", "launched_b", "own_grant"])) }
  let!(:partial) { create(:user, allowed_features: JSON.dump(["launched_a"])) }
  let!(:clean) { create(:user, allowed_features: JSON.dump(["own_grant"])) }

  before { AppConfigHelper.set_json_app_config(AppConfig::LAUNCHED_FEATURES, ["launched_a", "launched_b"]) }

  after do
    task.reenable
    %w[APPLY MODE].each { |k| ENV.delete(k) }
  end

  def run(apply: false, mode: nil)
    ENV['APPLY'] = apply ? '1' : nil
    ENV['MODE'] = mode
    output = StringIO.new
    $stdout = output
    task.invoke
    output.string
  ensure
    $stdout = STDOUT
  end

  def column(user)
    JSON.parse(user.reload.allowed_features)
  end

  it 'changes nothing without APPLY=1 but reports what it would do' do
    out = run

    expect(out).to include("would clean user_id=#{polluted.id}")
    expect(out).to include("ambiguous user_id=#{partial.id}")
    expect(column(polluted)).to eq(["launched_a", "launched_b", "own_grant"])
  end

  it 'in superset mode cleans only columns holding every launched feature' do
    run(apply: true)

    expect(column(polluted)).to eq(["own_grant"])
    expect(column(partial)).to eq(["launched_a"])
    expect(column(clean)).to eq(["own_grant"])
  end

  it 'in all mode strips every launched feature from every column' do
    run(apply: true, mode: 'all')

    expect(column(polluted)).to eq(["own_grant"])
    expect(column(partial)).to eq([])
    expect(column(clean)).to eq(["own_grant"])
  end

  it 'never changes the effective feature set at run time' do
    before_sets = [polluted, partial, clean].map { |u| u.reload.allowed_feature_list.sort }
    run(apply: true, mode: 'all')
    after_sets = [polluted, partial, clean].map { |u| u.reload.allowed_feature_list.sort }

    expect(after_sets).to eq(before_sets)
  end
end
