class BasespaceController < ApplicationController
  include HttpHelper
  include BasespaceHelper

  def oauth
    disable_header_navigation
    @access_token = nil

    missing_env_vars = BasespaceHelper.missing_oauth_env_vars
    if missing_env_vars.any?
      # Do not fail silently. Without this, a misconfigured environment renders
      # the oauth callback with a nil access token and emits no telemetry at
      # all, which presents to the user as an unexplained "Basespace upload
      # issue" that nobody can diagnose after the fact.
      LogUtil.log_error(
        "BasespaceConfigurationError: Basespace OAuth is not configured for this environment. " \
        "Missing environment variables: #{missing_env_vars.join(', ')}. Basespace upload is unavailable.",
        missing_env_vars: missing_env_vars
      )
      return
    end

    if params[:code].blank?
      LogUtil.log_error("BasespaceOauthError: Basespace OAuth callback was reached without an authorization code.")
      return
    end

    begin
      response = HttpHelper.post_json(
        "https://api.basespace.illumina.com/v1pre3/oauthv2/token",
        "code" => params[:code],
        "redirect_uri" => ENV["CZID_BASESPACE_OAUTH_REDIRECT_URI"],
        "client_id" => ENV["CZID_BASESPACE_CLIENT_ID"],
        "client_secret" => ENV["CZID_BASESPACE_CLIENT_SECRET"],
        "grant_type" => "authorization_code"
      )
      @access_token = response["access_token"]
    rescue StandardError => e
      LogUtil.log_error("Failed to get basespace access token: #{e}", exception: e)
    end
  end

  def projects
    access_token = params[:access_token]

    if access_token.nil?
      render json: {
        error: "basespace access token required",
      }
      return
    end

    bs_projects = basespace_projects(access_token)

    if bs_projects.nil?
      render json: {
        error: "unable to fetch data from basespace",
      }
      return
    end

    render json: bs_projects
  end

  # Actually fetches basespace DATASETS, which are collections of related fastq files (such as paired-end files)
  # This roughly corresponds to "samples" in IDseq.
  def samples_for_project
    access_token = params[:access_token]
    basespace_project_id = params[:basespace_project_id]

    if access_token.nil?
      render json: {
        error: "basespace access token required",
      }
      return
    end

    if basespace_project_id.nil?
      render json: {
        error: "basespace project id required",
      }
      return
    end

    bs_samples = samples_for_basespace_project(basespace_project_id, access_token)

    if bs_samples.nil?
      render json: {
        error: "unable to fetch data from basespace",
      }
      return
    end

    render json: bs_samples
  end
end
