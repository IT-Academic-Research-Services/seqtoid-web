require 'open-uri'
require './lib/secret_redaction'

# TODO(mark): Investigate if there is a way to fetch the user's current projects with v2 API. No obvious way from the docs.
BASESPACE_CURRENT_PROJECTS_URL = "https://api.basespace.illumina.com/v1pre3/users/current/projects".freeze
BASESPACE_PROJECT_DATASETS_URL = "https://api.basespace.illumina.com/v2/projects/%s/datasets".freeze
BASESPACE_DATASET_FILES_URL = "https://api.basespace.illumina.com/v2/datasets/%s/files?filehrefcontentresolution=true".freeze
BASESPACE_DELETE_ACCESS_TOKEN_URL = "https://api.basespace.illumina.com/v2/oauthv2tokens/current".freeze
# 1024 is the maximum page size (Limit) allowed by Basespace. Listings with more
# than one page of results are retrieved by fetch_all_basespace_pages, which
# follows Basespace's Limit/Offset pagination to fetch every item rather than
# silently stopping at the first 1024 (SMP-1733).
BASESPACE_PAGE_SIZE = 1024

# Upper bound on the number of pages fetch_all_basespace_pages will request for a
# single listing. At the 1024-item page size this covers just over one million
# items -- far beyond any real Basespace account -- so reaching it means the API
# is misbehaving (for example never advancing past an Offset) and we stop rather
# than loop forever.
BASESPACE_MAX_PAGES = 1024

# Environment variables that must all be set for the BaseSpace OAuth handshake
# to be possible. If any is missing, BaseSpace upload cannot work in this
# environment and must not be offered to the user as if it were functional.
BASESPACE_OAUTH_ENV_VARS = [
  "CZID_BASESPACE_CLIENT_ID",
  "CZID_BASESPACE_CLIENT_SECRET",
  "CZID_BASESPACE_OAUTH_REDIRECT_URI",
].freeze

module BasespaceHelper
  # A BaseSpace access token is the USER'S credential for their own Illumina
  # account, held by us only for the duration of an upload, so it must never be
  # written to a log or to Sentry (SMP-1729). Where a log line genuinely needs to
  # say WHICH token -- several samples share one token, so "did this one get
  # revoked" is a real question -- log SecretRedaction.fingerprint instead: a
  # truncated SHA256 that correlates lines without being replayable against
  # Illumina. The same applies to BaseSpace HrefContent download paths, which are
  # presigned URLs and therefore bearer credentials for their validity window.

  # Names of the required OAuth environment variables that are unset or blank.
  # Blank is treated as unset because an empty string is truthy in Ruby, which
  # would otherwise let a misconfigured environment pass a bare presence check.
  def self.missing_oauth_env_vars
    BASESPACE_OAUTH_ENV_VARS.reject { |var| ENV[var].present? }
  end

  def self.oauth_configured?
    missing_oauth_env_vars.empty?
  end

  def revoke_access_token(access_token)
    HttpHelper.delete(
      BASESPACE_DELETE_ACCESS_TOKEN_URL,
      "x-access-token" => access_token
    )
  end

  def verify_access_token_revoked(access_token, sample_id)
    # Verify that the token was revoked by using it to call an API endpoint.

    fetch_from_basespace(BASESPACE_CURRENT_PROJECTS_URL, access_token, {}, true)

    # If we reach this step, the access token must not have been revoked.
    LogUtil.log_error(
      "BasespaceAccessTokenError: Failed to revoke access token for sample id #{sample_id}",
      basespace_token_fingerprint: SecretRedaction.fingerprint(access_token),
      sample_id: sample_id
    )
  rescue HttpHelper::HttpError => e
    # We expect the API endpoint to return a 401.
    if e.status_code == 401
      Rails.logger.info("Revoke access token check succeeded")
    else
      raise e
    end
  end

  # In one instance, we send a request expecting it to fail. So we provide a silence_errors option.
  def fetch_from_basespace(url, access_token, params = {}, silence_errors = false)
    HttpHelper.get_json(
      url,
      params.merge(limit: BASESPACE_PAGE_SIZE),
      { "Authorization" => "Bearer #{access_token}" },
      silence_errors
    )
  end

  # Follow Basespace's Limit/Offset pagination to retrieve EVERY item from a list
  # endpoint instead of only the first page. Basespace caps a single response at
  # BASESPACE_PAGE_SIZE (1024) items, so an account or project with more than that
  # would otherwise be silently truncated with no signal to the user or the logs
  # (SMP-1733).
  #
  # We request full pages at an increasing Offset and concatenate their items. The
  # block is handed each page and must return that page's Items array; this keeps
  # the helper agnostic to response shape, because the v1pre3 "projects" endpoint
  # nests items under "Response" while the v2 endpoints return them at the top
  # level. If the block returns nil the page is an error or an unexpected shape:
  # we stop and return [nil, that_page] so the caller's existing error handling
  # can inspect and log it. On success we return [all_items, nil].
  #
  # Pages are requested until a short page (fewer than a full page of items)
  # arrives -- Basespace only returns a short page for the final page -- or until
  # BASESPACE_MAX_PAGES is reached, which guards against looping forever on an API
  # that never advances past an Offset.
  def fetch_all_basespace_pages(url, access_token, params = {})
    all_items = []
    offset = 0

    BASESPACE_MAX_PAGES.times do
      page = fetch_from_basespace(url, access_token, params.merge(offset: offset))
      items = yield(page)

      # Error or unexpected shape: hand the page back so the caller can log it.
      return [nil, page] if items.nil?

      all_items.concat(items)

      # A full page means more may remain; a short page is the last page.
      return [all_items, nil] if items.length < BASESPACE_PAGE_SIZE

      offset += BASESPACE_PAGE_SIZE
    end

    # Hit the page cap without ever seeing a short page. Rather than loop
    # forever, log it (fingerprint only -- never the token) and return what we
    # have so the user still sees a large-but-partial list.
    LogUtil.log_error(
      "Basespace listing exceeded #{BASESPACE_MAX_PAGES} pages; returning a partial list",
      basespace_token_fingerprint: SecretRedaction.fingerprint(access_token),
      url: url,
      items_fetched: all_items.length
    )
    [all_items, nil]
  end

  module_function :revoke_access_token, :verify_access_token_revoked, :fetch_from_basespace, :fetch_all_basespace_pages

  def basespace_projects(access_token)
    begin
      # The v1pre3 projects endpoint nests its list under "Response".
      items, error_response = fetch_all_basespace_pages(BASESPACE_CURRENT_PROJECTS_URL, access_token) do |page|
        page.dig("Response", "Items")
      end

      if items.nil?
        if error_response.dig("ResponseStatus", "Message").present?
          LogUtil.log_error(
            "Fetch Basespace projects failed with error: #{error_response['ResponseStatus']['Message']}",
            basespace_token_fingerprint: SecretRedaction.fingerprint(access_token),
            response: SecretRedaction.scrub(error_response)
          )
        else
          LogUtil.log_error(
            "Failed to fetch Basespace projects",
            basespace_token_fingerprint: SecretRedaction.fingerprint(access_token),
            response: SecretRedaction.scrub(error_response)
          )
        end
        return nil
      end
    rescue StandardError
      LogUtil.log_error(
        "Failed to fetch Basespace projects",
        basespace_token_fingerprint: SecretRedaction.fingerprint(access_token)
      )
      return nil
    end

    # Just return selected fields.
    items.map do |dataset|
      {
        id: dataset["Id"],
        name: dataset["Name"],
      }
    end
  end

  def samples_for_basespace_project(project_id, access_token)
    begin
      # The v2 datasets endpoint returns its list at the top level.
      items, error_response = fetch_all_basespace_pages(BASESPACE_PROJECT_DATASETS_URL % project_id, access_token) do |page|
        page["Items"]
      end

      if items.nil?
        if error_response["ErrorMessage"].present?
          LogUtil.log_error(
            "Fetch samples for Basespace project failed with error: #{error_response['ErrorMessage']}",
            project_id: project_id,
            basespace_token_fingerprint: SecretRedaction.fingerprint(access_token),
            response: SecretRedaction.scrub(error_response)
          )
        else
          LogUtil.log_error(
            "Failed to fetch samples for Basespace project",
            project_id: project_id,
            basespace_token_fingerprint: SecretRedaction.fingerprint(access_token),
            response: SecretRedaction.scrub(error_response)
          )
        end
        return nil
      end
    rescue StandardError
      LogUtil.log_error(
        "Failed to fetch samples for Basespace project",
        project_id: project_id,
        basespace_token_fingerprint: SecretRedaction.fingerprint(access_token)
      )
      return nil
    end

    # Just return selected fields.
    formatted_samples = items.map do |dataset|
      {
        basespace_dataset_id: dataset["Id"],
        name: dataset["Name"],
        file_size: dataset["TotalSize"],
        file_type: get_dataset_file_type(dataset),
        basespace_project_id: project_id,
        basespace_project_name: dataset["Project"]["Name"],
      }
    end

    # Remove all non-FASTQ files.
    # We will add other file types as we encounter them.
    formatted_samples.select { |dataset| dataset[:file_type].present? }
  end

  def files_for_basespace_dataset(dataset_id, access_token)
    begin
      response = fetch_from_basespace(BASESPACE_DATASET_FILES_URL % dataset_id, access_token, filehrefcontentresolution: "true")

      if response["Items"].nil?
        if response["ErrorMessage"].present?
          LogUtil.log_error(
            "Fetch files for Basespace dataset failed with error: #{response['ErrorMessage']}",
            dataset_id: dataset_id,
            basespace_token_fingerprint: SecretRedaction.fingerprint(access_token),
            response: SecretRedaction.scrub(response)
          )
        else
          LogUtil.log_error(
            "Failed to fetch files for basespace dataset",
            dataset_id: dataset_id,
            basespace_token_fingerprint: SecretRedaction.fingerprint(access_token),
            response: SecretRedaction.scrub(response)
          )
        end
        return nil
      end
    rescue StandardError
      LogUtil.log_error(
        "Failed to fetch files for basespace dataset",
        dataset_id: dataset_id,
        basespace_token_fingerprint: SecretRedaction.fingerprint(access_token)
      )
      return nil
    end

    return response["Items"].map do |file|
      {
        name: file["Name"],
        # Path to download the file. Includes all auth information to download the file.
        download_path: file["HrefContent"],
        # Store the file id for debugging purposes.
        # Without a valid access token, the file cannot be accessed using the file id.
        source_path: file["Href"],
        # Size in bytes as reported by the BaseSpace v2 files API. Threaded through
        # to the streaming upload as --expected-size so the AWS CLI can size the
        # multipart plan for a non-seekable stdin (SMP-1730). May be nil if the
        # API omits it, in which case the upload falls back to no --expected-size.
        size: file["Size"],
      }
    end
  end

  def upload_from_basespace_to_s3(basespace_paths, s3_path, file_name, expected_size = nil, tags = nil)
    # Make sure lanes are concatenated in ascending order (Lane 1 -> 8)
    basespace_paths.sort! if basespace_paths.is_a?(Array)

    # The upload streams curl's stdout into `aws s3 cp -`, so the CLI reads from a
    # NON-SEEKABLE stdin and cannot discover the object size up front. Without
    # --expected-size the CLI plans the multipart upload with the default 8 MiB
    # part size; at the 10,000-part hard limit that caps a single object at
    # ~78 GB, below the ~100 GB configured limit (SMP-1730). Passing the known
    # BaseSpace file size lets the CLI choose a part size large enough for the
    # full range. If the size is unknown here we omit the flag and keep the prior
    # behavior rather than sending a wrong size.
    aws_cp_command = ["aws", "s3", "cp", "-", "#{s3_path}/#{file_name}"]
    aws_cp_command += ["--expected-size", expected_size.to_s] if expected_size.to_i.positive?

    # Run the piped commands and save stderr
    success, stderr = Syscall.pipe(
      # Don't show the cURL progress bar, but do show any errors.
      # Fail if the HTTP status code is an error.
      ["curl", "--fail", "-s", "--show-error", *basespace_paths],
      aws_cp_command
    )

    if success
      # SMP-1731: the streaming `aws s3 cp -` upload writes the object with NO
      # tags, so BaseSpace was the only ingress path whose objects were invisible
      # to tag-driven S3 retention/lifecycle rules. The stream cannot tag inline,
      # so apply the same lifecycle tag set every other ingress path uses (see the
      # S3Util.copy_with_tags call sites) once the object exists. A tagging
      # failure must surface rather than be silently swallowed: it is deliberately
      # not rescued here, so it propagates to the caller and fails the transfer.
      S3Util.put_object_tags("#{s3_path}/#{file_name}", tags) if tags.present?
    else
      # basespace_paths are HrefContent download URLs -- presigned, so the query
      # string IS the credential. Log the origin and object path (which is what
      # identifies the file) with the signature stripped. curl's stderr is passed
      # through the same redaction because it can echo the URL it was given.
      LogUtil.log_error(
        "Failed to transfer file from basespace to #{s3_path} for #{file_name}: #{SecretRedaction.redact_text(stderr)}",
        basespace_paths: SecretRedaction.redact_urls(basespace_paths),
        s3_path: s3_path,
        file_name: file_name
      )
    end

    return success
  end

  private

  def get_dataset_file_type(dataset)
    if dataset.present? && dataset["DatasetType"].present? && dataset["DatasetType"]["Name"].downcase.include?("fastq")
      if dataset.dig("Attributes", "common_fastq", "IsPairedEnd") == true
        return "Paired-end FASTQ"
      else
        return "Single-end FASTQ"
      end
    end

    return nil
  end
end
