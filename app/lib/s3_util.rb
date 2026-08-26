module S3Util
  # select a particular part of a JSON file using Amazon S3 Select SQL syntax
  def self.s3_select_json(bucket, key, expression)
    s3_select_params = {
      bucket: bucket,
      key: key,
      expression_type: "SQL",
      expression: expression,
      input_serialization: {
        json: {
          type: "DOCUMENT",
        },
      },
      output_serialization: {
        json: {
          record_delimiter: ",",
        },
      },
    }

    entry = []
    begin
      AwsClient[:s3].select_object_content(s3_select_params) do |stream|
        stream.on_records_event do |event|
          entry.push(event.payload.read)
        end
      end
    rescue Aws::S3::Errors::ServiceError => e
      Rails.logger.error("Error retrieving entry #{expression} from #{bucket}/#{key} from s3")
      Rails.logger.error(e.message)
      return ""
    end
    return entry.join
  end

  def self.get_s3_file(s3_path)
    bucket, key = parse_s3_path(s3_path)
    begin
      resp = AwsClient[:s3].get_object(bucket: bucket, key: key)
      return resp.body.read
    rescue StandardError
      return nil
    end
  end

  def self.get_s3_range(s3_path, first_byte, last_byte)
    if first_byte.nil? || last_byte.nil?
      LogUtil.log_error("Invalid byte range for S3 file", s3_path: s3_path, first_byte: first_byte, last_byte: last_byte)
      return nil
    end

    bucket, key = parse_s3_path(s3_path)
    byterange = "bytes=#{first_byte}-#{last_byte}"
    begin
      resp = AwsClient[:s3].get_object(bucket: bucket, key: key, range: byterange)
      return resp.body.read
    rescue StandardError => e
      LogUtil.log_error(
        "Error retrieving byte range from S3 file",
        exception: e
      )
      return nil
    end
  end

  # CZID-296: Guard against a blank bucket name before handing it to the AWS SDK.
  # When the downloads bucket env var (e.g. SAMPLES_BUCKET_NAME_V1) is unset, the
  # bucket resolves to "" and the SDK raises an opaque
  # 'Parameter validation failed: Invalid bucket name ""' deep in put_object,
  # producing a cryptic "upload failed: - to s3:///downloads/..." error. Fail fast
  # here with an actionable message that names the missing configuration.
  def self.upload_to_s3(bucket, key, content)
    if bucket.blank?
      raise ArgumentError,
            "S3Util.upload_to_s3: bucket name is blank (key=#{key.inspect}). " \
            "The destination bucket env var is likely unset (e.g. SAMPLES_BUCKET_NAME_V1); " \
            "set it before uploading."
    end

    AwsClient[:s3].put_object(bucket: bucket,
                              key: key,
                              body: content)
  end

  # Uploads a local file to S3 using the resource-level uploader, which switches
  # to multipart automatically for large objects (e.g. a big contigs.ndjson.gz
  # can exceed the 5 GB single-PUT limit for very large users).
  def self.upload_file(bucket, key, path)
    Aws::S3::Resource.new(client: AwsClient[:s3]).bucket(bucket).object(key).upload_file(path)
  end

  def self.parse_s3_path(s3_path)
    uri_parts = s3_path.split("/", 4)
    bucket = uri_parts[2]
    key = uri_parts[3]
    return bucket, key
  end

  def self.get_file_size(bucket, key)
    resp = AwsClient[:s3].list_objects_v2(bucket: bucket,
                                          prefix: key,
                                          max_keys: 1)
    if !resp.contents.empty?
      return resp.contents[0].size
    else
      raise "Cannot get file size for #{s3_path}: unable to find file"
    end
  end

  def self.latest_multipart_upload(bucket, key)
    resp = AwsClient[:s3].list_multipart_uploads(
      bucket: bucket,
      prefix: key,
      max_uploads: 1
    )
    resp.uploads.map(&:upload_id).first
  end

  # Abort every incomplete (in-progress) multipart upload under a key prefix.
  # A failed or orphaned upload leaves partial data behind as an incomplete
  # multipart upload rather than a completed object, so deleting the object
  # prefix alone does not reclaim it. This walks the paginated
  # list_multipart_uploads response and aborts each upload, and returns the
  # count of uploads aborted.
  def self.abort_multipart_uploads(bucket, prefix)
    aborted = 0
    pages = AwsClient[:s3].list_multipart_uploads(
      bucket: bucket,
      prefix: prefix
    )
    pages.each do |resp|
      (resp.uploads || []).each do |upload|
        AwsClient[:s3].abort_multipart_upload(
          bucket: bucket,
          key: upload.key,
          upload_id: upload.upload_id
        )
        aborted += 1
      end
    end
    aborted
  end

  def self.delete_s3_prefix(s3_prefix)
    bucket, prefix = parse_s3_path(s3_prefix)
    pages = AwsClient[:s3].list_objects_v2({
                                             bucket: bucket,
                                             prefix: prefix,
                                           })
    pages.each do |resp|
      objects = resp[:contents].map { |object| { key: object[:key] } }
      next if objects.blank?

      AwsClient[:s3].delete_objects({ bucket: bucket, delete: { objects: objects } })
    end
  end

  # S3 CopyObject copies an object in a single operation, but that operation is
  # capped at 5 GiB by AWS. Larger objects must be copied via a multipart copy
  # (UploadPartCopy). copy_object has no fallback, so we branch on the source size:
  # objects at or under the limit take the proven single-copy path, larger ones use
  # the SDK's managed multipart copy.
  MAX_SINGLE_COPY_BYTES = 5 * 1024 * 1024 * 1024 # 5 GiB (S3 CopyObject hard limit)

  def self.copy_with_tags(source_path, dest_path, tags = {})
    source_bucket, source_key = parse_s3_path(source_path)
    dest_bucket, dest_key = parse_s3_path(dest_path)
    tagging = URI.encode_www_form(tags)
    Rails.logger.debug("Copying S3 [#{source_bucket}/#{source_key}] -> [#{dest_bucket}/#{dest_key}] tags [#{tagging}]")

    source_size = AwsClient[:s3].head_object(bucket: source_bucket, key: source_key).content_length

    if source_size > MAX_SINGLE_COPY_BYTES
      # Multipart copy for objects above the 5 GiB single-operation limit. tagging is
      # applied on the multipart upload; tagging_directive is a copy_object-only option
      # and does not apply here.
      Aws::S3::Object.new(bucket_name: dest_bucket, key: dest_key, client: AwsClient[:s3])
                     .copy_from("#{source_bucket}/#{source_key}", multipart_copy: true, tagging: tagging)
    else
      AwsClient[:s3].copy_object(
        copy_source: "#{source_bucket}/#{source_key}",
        bucket: dest_bucket,
        key: dest_key,
        tagging_directive: "REPLACE",
        tagging: tagging
      )
    end
  end

  # Apply an S3 object tag set to an object that already exists. copy_with_tags
  # tags an object as part of a server-side copy; a streaming upload
  # (`aws s3 cp -` from a non-seekable stdin) cannot tag inline, so callers that
  # stream to S3 use this to apply the same lifecycle tag set once the object is
  # written (SMP-1731). Replaces the object's entire tag set, matching the
  # REPLACE semantics of copy_with_tags.
  def self.put_object_tags(s3_path, tags = {})
    bucket, key = parse_s3_path(s3_path)
    tag_set = tags.map { |tag_key, tag_value| { key: tag_key.to_s, value: tag_value.to_s } }
    Rails.logger.debug("Tagging S3 [#{bucket}/#{key}] tags [#{URI.encode_www_form(tags)}]")
    AwsClient[:s3].put_object_tagging(
      bucket: bucket,
      key: key,
      tagging: { tag_set: tag_set }
    )
  end
end
