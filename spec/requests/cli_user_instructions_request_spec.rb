# frozen_string_literal: true

require "rails_helper"

# SMP-1486: /cli_user_instructions used to live-fetch the upstream chanzuckerberg/czid-cli README on
# every request (URI.open) -- a CZ ID branding leak, a request-path external-fetch liability, and now
# broken since the SeqToID CLI repo is private. It now renders the vendored, SeqToID-branded README
# committed at app/views/samples/cli_user_instructions.md. These assertions pin the fix at the source
# level (no full-layout render, so they run without built webpack assets).
RSpec.describe "CLI user instructions (vendored README)" do
  let(:view) { Rails.root.join("app/views/samples/cli_user_instructions.html.erb").read }
  let(:readme_path) { Rails.root.join("app/views/samples/cli_user_instructions.md") }

  it "renders from the vendored file, not a live external fetch" do
    expect(view).not_to include("URI.open")
    expect(view).not_to include("raw.githubusercontent.com/chanzuckerberg/czid-cli")
    expect(view).to include("cli_user_instructions.md")
  end

  it "vendors a SeqToID-branded README" do
    expect(readme_path).to exist
    expect(readme_path.read).to include("# SeqToID CLI")
  end
end
