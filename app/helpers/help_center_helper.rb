module HelpCenterHelper
  # The help center host is environment-specific and injected via chamber
  # (SSM /idseq-<env>-web/HELP_CENTER_HOST). It falls back to the production host
  # so behaviour is unchanged wherever the parameter is absent (e.g. staging and
  # prod until STATIC-008/009) - no regression. Mirrors the ENV["SERVER_DOMAIN"]
  # convention used in project.rb / sample.rb / bulk_download.rb.
  #
  # React reads this via user_context (application_helper.rb) and resolves the
  # "helpcenter:" sentinel in Link.tsx. Mailers and plain .erb views, which cannot
  # reach UserContext, call this helper directly.
  HELP_CENTER_HOST_FALLBACK = "https://helpcenter.seqtoid.org".freeze

  def help_center_host
    ENV["HELP_CENTER_HOST"].presence || HELP_CENTER_HOST_FALLBACK
  end
end
