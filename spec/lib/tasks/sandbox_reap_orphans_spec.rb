require 'rails_helper'

# The reaper decides whether to DROP a schema holding copied user PII. Its whole decision rests on
# one question -- "is this PR closed?" -- and it used to answer that by checking whether the number
# appeared in a list of open PRs. That conflates two different facts:
#
#   closed  -> the sandbox is genuinely abandoned; reap it
#   absent  -> THIS repo never issued that PR number at all
#
# Absence happens for real: sandboxes provisioned before the IT-ARS cutover carry PR numbers minted
# by the thorvath-slower fork, which inherited upstream numbering and is in the 300s. Asked "is 332
# open?", IT-ARS says no -- because it has no PR 332, not because that PR closed. The first live
# dry-run cycle marked two sandboxes belonging to OPEN fork PRs for destruction and logged it as a
# clean run; only the dry-run flag stopped it.
#
# These specs pin the distinction at the point it is made. They are deliberately about
# github_pr_state rather than the full task: the task needs MySQL + the AWS CLI + GitHub together,
# and a test that broad would not have caught this bug -- the defect was one boolean, in the one
# function that decides life or death.
describe 'sandbox:reap_orphans PR classification' do
  # The helpers live in the :sandbox namespace, which defines them on main -- load the task file
  # once so github_pr_state is reachable, the same way the task itself reaches it.
  before(:all) { Rails.application.load_tasks unless Rake::Task.task_defined?('sandbox:reap_orphans') }

  let(:repo) { 'IT-Academic-Research-Services/seqtoid-web' }
  let(:token) { 'test-token' }

  def pr_url(number)
    "https://api.github.com/repos/#{repo}/pulls/#{number}"
  end

  # `def` inside a rake namespace block defines a private method on Object (the .rake file is
  # loaded at top level), which is exactly how the task itself calls it -- so send reaches the
  # same method the reaper runs, not a copy of it.
  def classify(number)
    send(:github_pr_state, repo, token, number)
  end

  it 'reports an open PR as :open, so a live sandbox is never a candidate' do
    stub_request(:get, pr_url(34)).to_return(
      status: 200, body: { number: 34, state: 'open' }.to_json, headers: { 'Content-Type' => 'application/json' }
    )
    expect(classify(34)).to eq(:open)
  end

  it 'reports a closed PR as :closed -- the only state that authorises a reap' do
    stub_request(:get, pr_url(39)).to_return(
      status: 200, body: { number: 39, state: 'closed' }.to_json, headers: { 'Content-Type' => 'application/json' }
    )
    expect(classify(39)).to eq(:closed)
  end

  # THE BUG. Before the fix this PR was indistinguishable from a closed one, because both simply
  # failed to appear in the open-PR list. 332 is a real example: open in the fork, absent here.
  it 'reports a PR this repo never issued as :absent, NOT :closed' do
    stub_request(:get, pr_url(332)).to_return(status: 404, body: { message: 'Not Found' }.to_json)

    expect(classify(332)).to eq(:absent)
    expect(classify(332)).not_to eq(:closed)
  end

  # An unknown answer must stop the run rather than pick a side. Defaulting a 500 to :closed would
  # reap live sandboxes during a GitHub incident; defaulting it to :absent would silently skip real
  # orphans forever. Neither is a decision this job is entitled to make on its own.
  it 'raises on a server error rather than guessing closed or absent' do
    stub_request(:get, pr_url(41)).to_return(status: 500, body: 'upstream boom')
    expect { classify(41) }.to raise_error(/GitHub API 500/)
  end

  it 'raises on a revoked or unauthorised token rather than treating every PR as absent' do
    stub_request(:get, pr_url(42)).to_return(status: 401, body: { message: 'Bad credentials' }.to_json)
    expect { classify(42) }.to raise_error(/GitHub API 401/)
  end

  it 'raises on a rate limit, which is the failure most likely to hit a job that runs hourly' do
    stub_request(:get, pr_url(43)).to_return(status: 403, body: { message: 'API rate limit exceeded' }.to_json)
    expect { classify(43) }.to raise_error(/GitHub API 403/)
  end
end
