# AWS Batch client for bulk downloads (migration off aegea -> EKS/Batch; Forgejo #846 / SMP-1477).
# Mirrors config/initializers/s3.rb; the factory (config/initializers/aws.rb) stubs responses in test.
BATCH_CLIENT = AwsClient[:batch]
