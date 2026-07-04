class SupportController < ApplicationController
  PUBLIC_ACTIONS = [
    :faqs,
    :impact,
    :privacy_notice_for_user_research,
    :privacy,
    :terms_changes,
    :terms,
    :security_white_paper,
  ].freeze

  before_action :login_required, except: PUBLIC_ACTIONS
  skip_before_action :authenticate_user!, :verify_authenticity_token, only: PUBLIC_ACTIONS

  def privacy
    # REBRAND: hide the global page_header (black utility strip); the navy
    # LandingHeader rendered by the PrivacyNotice component is the only header here.
    @hide_header = true
  end

  def terms
    # REBRAND: hide the global page_header (black utility strip); the navy
    # LandingHeader rendered by the TermsOfUse component is the only header here.
    @hide_header = true
  end

  def terms_changes
  end

  def faqs
    render "home/discovery_view_router"
  end

  def privacy_notice_for_user_research
    render "home/discovery_view_router"
  end

  def impact
    # REBRAND: Impact page temporarily disabled
    redirect_to root_path
    # @hide_header = true
    # render "home/discovery_view_router"
  end

  def security_white_paper
    # Use `inline` disposition to make sure the PDF is shown inline and not downloaded
    filename = File.join(Rails.root, "app/assets/pdfs/security_white_paper.pdf")
    send_file(filename, disposition: "inline", type: "application/pdf")
  end
end
