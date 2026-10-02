class SupportController < ApplicationController
  PUBLIC_ACTIONS = [
    :faqs,
    :impact,
    :privacy,
    :terms_changes,
    :terms,
    :security_white_paper,
    # Release Notes: the class-level auth is skipped here so the controller can
    # decide per-environment (see gate_release_notes_auth). The public production
    # feed is reachable by end users; internal (dev/staging) envs still require a
    # signed-in user, enforced below.
    :releases,
    :releases_data,
  ].freeze

  # component key -> { label, repo, public, detail, summary } mapping for the release-notes ledger.
  # public=true components appear on the external (production) feed; the infra repos (public=false)
  # are dropped from it entirely. Kept in sync with the COMPONENTS map in ReleaseNotesPage.tsx.
  #
  # External content policy: only components with detail=true (the externally approved ones: the
  # alignment engine, the analysis pipelines, and the CLI, whose releases are already public on
  # GitHub) list their individual changes on the external feed.
  # Every other public component is reduced to its one-line, high-level `summary` -- its change
  # titles never leave the server.
  RELEASE_NOTE_COMPONENTS = {
    "web" => {
      "label" => "Web app", "repo" => "seqtoid-web", "public" => true, "detail" => false,
      "summary" => "General improvements to the web application, including usability, performance, and reliability updates.",
    },
    "workflows" => { "label" => "Pipelines", "repo" => "seqtoid-workflows", "public" => true, "detail" => true },
    "swipe" => { "label" => "Alignment", "repo" => "swipe", "public" => true, "detail" => true },
    "cli" => { "label" => "CLI", "repo" => "seqtoid-cli", "public" => true, "detail" => true },
    "reference" => {
      "label" => "Reference data", "repo" => "idseq-index-generation", "public" => true, "detail" => false,
      "summary" => "Reference data maintenance updates.",
    },
    "workflow-infra" => { "label" => "Pipeline infra", "repo" => "cypherid-workflow-infra", "public" => false },
    "ssot" => { "label" => "Platform infra", "repo" => "seqtoid-ssot-infra", "public" => false },
  }.freeze

  # Public-feed record shape: only these top-level keys survive the strip; the
  # rest (source_repo, sha, reason) are internal-only.
  RELEASE_NOTE_PUBLIC_KEYS = %w[env version day n time component].freeze

  # Deployments whose release-notes feed is external (end-user facing) no matter how the auth flag is
  # set. Content filtering only ever removes detail, so inferring it from ENVIRONMENT is the safe
  # direction -- unlike auth (see release_notes_public?), which stays explicit and default-closed.
  RELEASE_NOTE_EXTERNAL_ENVS = %w[env-prod prod].freeze

  # Leading ticket key on a PR title ("SMP-1908: ...") -- internal tracker ids, dropped externally.
  RELEASE_NOTE_TICKET_PREFIX = /\A\s*\[?[A-Z][A-Z0-9]+-\d+\]?(?![\d-])\s*:?\s*/

  before_action :login_required, except: PUBLIC_ACTIONS
  skip_before_action :authenticate_user!, :verify_authenticity_token, only: PUBLIC_ACTIONS
  before_action :gate_release_notes_auth, only: [:releases, :releases_data]

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
    # REBRAND: hide the global page_header (black utility strip); the navy
    # LandingHeader rendered by the TermsChanges component is the only header here.
    @hide_header = true
  end

  def faqs
    # REBRAND: hide the global page_header (black utility strip); the navy
    # LandingHeader rendered by the FAQPage component is the only header here.
    # Rendered standalone (default support/faqs view) to match /privacy and /terms.
    @hide_header = true
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

  def releases
    # REBRAND: hide the global page_header (black utility strip); the navy
    # LandingHeader rendered by the ReleaseNotesPage component is the only header.
    @hide_header = true
    # Drives the audience default and toggle visibility in the React page, and is
    # the client-side half of the internal-vs-external gating. The server-side half
    # (filter + strip) lives in releases_data, so this flag is presentation-only.
    @release_notes_public = release_notes_external_feed?
    # The real deployment env, shown in the page's context label so it reflects where you are
    # (dev / env-staging / env-prod) instead of a hardcoded value.
    @environment = ENV["ENVIRONMENT"].presence || Rails.env.to_s
  end

  def releases_data
    # audience=public lets an internal env preview exactly what the external feed serves. It can only
    # ever remove detail, so it needs no extra gating.
    render json: release_notes_ledger(external: release_notes_external_feed? || params[:audience] == "public")
  end

  private

  # Internal (dev/staging) envs require any signed-in user; the public production
  # feed is open. This is the class-level `login_required` re-applied conditionally
  # for the release-notes actions, which are in PUBLIC_ACTIONS so the default auth
  # is skipped.
  def gate_release_notes_auth
    login_required unless release_notes_public?
  end

  # True when this deployment serves the public (end-user) release feed. DEFAULT-CLOSED and driven by an
  # EXPLICIT flag only: the release-notes page is the auth boundary, and internal envs must never open it
  # by accident. We deliberately do NOT infer from Rails.env -- staging/dev commonly run
  # RAILS_ENV=production, which would silently flip an internal env's feed to unauthenticated. Prod opts
  # in by setting RELEASE_NOTES_PUBLIC=1; everywhere else the feed stays behind login.
  def release_notes_public?
    ActiveModel::Type::Boolean.new.cast(ENV["RELEASE_NOTES_PUBLIC"])
  end

  # True when this deployment serves the external (end-user) feed: the explicit public flag, or a
  # production deployment. Governs CONTENT only; auth is release_notes_public?.
  def release_notes_external_feed?
    release_notes_public? || RELEASE_NOTE_EXTERNAL_ENVS.include?(ENV["ENVIRONMENT"].to_s)
  end

  # The ledger served to the page. On the external feed the records are filtered to
  # public components and stripped of internal fields SERVER-SIDE (defense in
  # depth) so nothing internal is shipped even if the client is tampered with.
  def release_notes_ledger(external:)
    records = fetch_release_notes_records
    external ? filter_public_release_notes(records) : records
  end

  # Fetches and parses the JSON ledger from S3. Returns [] (never raises) when the
  # env vars or object are missing or the payload is malformed, so the page renders
  # an empty state rather than 500ing.
  def fetch_release_notes_records
    stage = ENV["ENVIRONMENT"].presence || Rails.env.to_s
    # CHANGELOG_S3_URI is an optional OVERRIDE. By default the ledger location is
    # derived from the env name by convention (bucket seqtoid-<env>-release-notes,
    # written by the record-changelog collector), so the page needs no per-env
    # config to work. A missing bucket/object just yields [] (empty state), never
    # an error -- see S3Util.get_s3_file below.
    base = ENV["CHANGELOG_S3_URI"].presence ||
           (stage.present? ? "s3://seqtoid-#{stage}-release-notes/release-notes" : nil)
    return [] if base.blank?

    s3_path = "#{base.chomp('/')}/#{stage}.json"

    body = Rails.cache.fetch("release_notes_ledger/#{stage}", expires_in: 60.seconds, skip_nil: true) do
      # S3Util.get_s3_file parses s3://bucket/key and returns the body string, or
      # nil on any S3 error (missing object, access denied, etc.).
      S3Util.get_s3_file(s3_path)
    end
    return [] if body.blank?

    parsed = JSON.parse(body)
    parsed.is_a?(Array) ? parsed : []
  rescue JSON::ParserError => e
    Rails.logger.error("Malformed release-notes ledger [path=#{s3_path} error=#{e.message}]")
    []
  rescue StandardError => e
    Rails.logger.error("Failed to load release-notes ledger [error=#{e.message}]")
    []
  end

  # Keeps only public components and strips every internal field (source_repo, sha,
  # reason) and per-change PR link (pr, url). Approved (detail) components keep each
  # change as type + title, minus any leading ticket key; every other component's
  # changes collapse into its single high-level summary line.
  def filter_public_release_notes(records)
    Array(records).each_with_object([]) do |record, out|
      record = record.stringify_keys
      meta = RELEASE_NOTE_COMPONENTS[record["component"]]
      next unless meta && meta["public"]

      public_record = record.slice(*RELEASE_NOTE_PUBLIC_KEYS)
      public_record["changes"] = public_release_note_changes(meta, Array(record["changes"]))
      out << public_record
    end
  end

  def public_release_note_changes(meta, changes)
    return [] if changes.empty?
    return [{ "type" => "changed", "title" => meta["summary"] }] unless meta["detail"]

    changes.map do |change|
      change = change.stringify_keys
      { "type" => change["type"], "title" => change["title"].to_s.sub(RELEASE_NOTE_TICKET_PREFIX, "") }
    end
  end
end
