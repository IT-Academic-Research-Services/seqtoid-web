S3_CLIENT = AwsClient[:s3]
S3_PRESIGNER = Aws::S3::Presigner.new(client: S3_CLIENT) # auth from the env
SAMPLES_BUCKET_NAME = ENV['SAMPLES_BUCKET_NAME'] # Should be ENV.fetch('SAMPLES_BUCKET_NAME') as it is required
SAMPLE_DOWNLOAD_EXPIRATION = 3600 # seconds
S3_GLOBAL_ENDPOINT = "https://s3.amazonaws.com".freeze
S3_DATABASE_BUCKET = ENV["S3_DATABASE_BUCKET"] # Should be ENV.fetch('S3_DATABASE_BUCKET') as it is required
S3_WORKFLOWS_BUCKET = ENV["S3_WORKFLOWS_BUCKET"] # Should be ENV.fetch('S3_WORKFLOWS_BUCKET') as it is required
S3_AEGEA_ECS_EXECUTE_BUCKET = ENV["S3_AEGEA_ECS_EXECUTE_BUCKET"] || "aegea-ecs-execute-#{Rails.env}"
# Buckets users may S3-import from (samples_controller#bulk_import). The web role can only read these, so
# keep it in step with its IAM allowlist (seqtoid-ssot-infra state-foundation/app var.import_source_bucket_names,
# default seqtoid-sandbox in every env). Override per env with a comma-separated S3_IMPORT_SOURCE_BUCKETS.
S3_IMPORT_SOURCE_BUCKETS = ENV.fetch("S3_IMPORT_SOURCE_BUCKETS", "seqtoid-sandbox").split(",").map(&:strip).reject(&:empty?).freeze
