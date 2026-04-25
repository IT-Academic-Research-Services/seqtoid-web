#!/bin/bash
set -euo pipefail

declare image="$1"
declare env="$2"

# Ensure required environment variables are set.
if [[ -z "${image:-}" || -z "${env:-}" ]]; then
  echo "Error: Required environment variables 'image' and 'env' must be set."
  exit 1
fi

# Cleanup function to remove the czecs binary when the script exits.
cleanup() {
  rm -f /tmp/czecs
}
trap cleanup EXIT

# Determine OS.
if [[ "$(uname)" == "Darwin" ]]; then
  os="darwin"
else
  os="linux"
fi

if [[ "${env}" == "dev" ]]; then
  rails_env="development"
else
  rails_env="${env}"
fi

# Download and extract czecs.
curl -sS -L "https://github.com/chanzuckerberg/czecs/releases/download/v0.1.2/czecs_0.1.2_${os}_amd64.tar.gz" | tar xz -C /tmp czecs

# Obtain AWS account id.
aws_account_id=$(aws sts get-caller-identity --query="Account" | tr -d '"')

cluster="idseq-${env}-ecs"

echo "image: ${image}, env: ${env}, rails_env: ${rails_env} aws_account_id: ${aws_account_id}, cluster: ${cluster}"

# Pick balances file by env
balances_file="balances-${env}.json"
echo "Using balances file: $balances_file"

# Register the task. Exit if registration fails.
echo "task_definition_arn=/tmp/czecs register -f ${balances_file} --set tag=${image} --set env=${env} --set rails_env=${rails_env} --set account_id=${aws_account_id} czecs.json"
task_definition_arn=$(/tmp/czecs register -f "${balances_file}" --set tag="${image}" --set env="${env}" --set rails_env="${rails_env}" --set account_id="${aws_account_id}" czecs.json)
#task_definition_arn="arn:aws:ecs:us-west-2:${aws_account_id}:task-definition/idseq-${env}-web:8"
if [[ $? -ne 0 ]]; then
  echo "== Could not register task =="
  exit 1
fi

#
# DB Creation/deletion/migration
#

echo "running migrations"

declare -a rails_commands=(
    #"--tasks"
    #"db:drop"
    "db:create"
    #"local_user_creation:admin[test.user@test.com,test]"
    "db:migrate:with_data"
    "db:seed"
    "seed:migrate"
)

for rails_command in "${rails_commands[@]}"
do
    echo "/tmp/czecs task -f ${balances_file} --timeout 0 --set taskDefinitionArn=${task_definition_arn} --set cluster=${cluster} --set rails_command='${rails_command}' czecs-task-rails.json"
    /tmp/czecs task -f "${balances_file}" --timeout 0 --set taskDefinitionArn="${task_definition_arn}" --set cluster="${cluster}" --set rails_command="${rails_command}" czecs-task-rails.json
done

#
# Deploy Web Application
#

echo "running updates"

echo "/tmp/czecs upgrade --timeout 900 --task-definition-arn ${task_definition_arn} ${cluster} idseq-${env}-web"
/tmp/czecs upgrade --timeout 900 --task-definition-arn "${task_definition_arn}" "${cluster}" "idseq-${env}-web"

#
# Deploy Resque and Shoryuken
#

echo "running resque"

# Upgrade Resque workers.
/tmp/czecs upgrade -f ${balances_file} --set tag="${image}" --set env="${env}" --set rails_env="${rails_env}" --set name=resque --set rake_command=resque:workers --set account_id="${aws_account_id}" "${cluster}" "idseq-${env}-resque" czecs-resque.json

# Upgrade Resque scheduler.
/tmp/czecs upgrade -f ${balances_file} --set tag="${image}" --set env="${env}" --set rails_env="${rails_env}" --set name=resque-scheduler --set rake_command=resque:scheduler --set account_id="${aws_account_id}" "${cluster}" "idseq-${env}-resque-scheduler" czecs-resque.json

# Upgrade Pipeline monitor.
/tmp/czecs upgrade -f ${balances_file} --set tag="${image}" --set env="${env}" --set rails_env="${rails_env}" --set name=resque-pipeline-monitor --set rake_command=pipeline_monitor --set account_id="${aws_account_id}" "${cluster}" "idseq-${env}-resque-pipeline-monitor" czecs-resque.json

# Upgrade Result monitor.
/tmp/czecs upgrade -f ${balances_file} --set tag="${image}" --set env="${env}" --set rails_env="${rails_env}" --set name=resque-result-monitor --set rake_command=result_monitor --set account_id="${aws_account_id}" "${cluster}" "idseq-${env}-resque-result-monitor" czecs-resque.json

# Upgrade Shoryuken.
/tmp/czecs upgrade -f ${balances_file} --set tag="${image}" --set env="${env}" --set rails_env="${rails_env}" --set name=shoryuken --set entry_command='-R -C config/shoryuken.yml' --set account_id="${aws_account_id}" "${cluster}" "idseq-${env}-shoryuken" czecs-shoryuken.json

#
# Run Rake Tasks
#

echo "running rake tasks"

declare -a rake_commands=(
    #"--tasks"
    #"features:list"
    #"taxon_lineage_slice:remove_slice"
    "taxon_lineage_slice:import_data_from_s3"
    #"taxon_lineage_slice:remove_taxon_lineage_slice_es_index"
    "taxon_lineage_slice:create_taxon_lineage_slice_es_index"
    # TODO: Not sure if loading Taxon Descriptions is required or not
    "load_taxon_descriptions[s3://seqtoid-public-references/phase1/taxonomy/2018-04-01-utc-1522569777-unixtime__2018-04-04-utc-1522862260-unixtime/2.9/taxid2description.json]"
)

## loop through above array (quotes are important if your elements may contain spaces)
for rake_command in "${rake_commands[@]}"
do
    echo "/tmp/czecs task -f ${balances_file} --debug --timeout 0 --set taskDefinitionArn=${task_definition_arn} --set cluster=${cluster} --set name=rake-task --set rake_command='${rake_command}' czecs-task-rake.json"
    /tmp/czecs task -f "${balances_file}" --debug --timeout 0 --set taskDefinitionArn="${task_definition_arn}" --set cluster="${cluster}" --set name=rake-task --set rake_command="${rake_command}" czecs-task-rake.json
done

#
# Create OpenSearch Indexes and associated Aliases
#

echo "running opensearch tasks"

# Create pipeline_runs Index

es_endpoint=$(aws es describe-elasticsearch-domain --domain-name "czid-${env}-heatmap-es" --query "DomainStatus.Endpoints" --output text)

curl_http_method=POST
curl_content_type=application/x-ndjson
curl_url=${es_endpoint}/_index_template/pipeline_runs
curl_data=@./docker/open_distro/pipeline_runs_template.json

echo "/tmp/czecs task -f ${balances_file} --debug --timeout 0 --set taskDefinitionArn=${task_definition_arn} --set cluster=${cluster} --set curl_http_method=${curl_http_method} --set curl_content_type=${curl_content_type} --set curl_url=${curl_url} --set curl_data=${curl_data} czecs-task-curl-data.json"
/tmp/czecs task -f "${balances_file}" --debug --timeout 0 --set taskDefinitionArn="${task_definition_arn}" --set cluster="${cluster}" --set curl_http_method="${curl_http_method}"  --set curl_content_type="${curl_content_type}" --set curl_url="${curl_url}" --set curl_data="${curl_data}" czecs-task-curl-data.json

curl_http_method=PUT # DELETE to delete the index
curl_url=${es_endpoint}/pipeline_runs-v1

echo "/tmp/czecs task -f ${balances_file} --debug --timeout 0 --set taskDefinitionArn=${task_definition_arn} --set cluster=${cluster} --set curl_http_method=${curl_http_method} --set curl_url=${curl_url} czecs-task-curl.json"
/tmp/czecs task -f "${balances_file}" --debug --timeout 0 --set taskDefinitionArn="${task_definition_arn}" --set cluster="${cluster}" --set curl_http_method="${curl_http_method}" --set curl_url="${curl_url}" czecs-task-curl.json

# Create scored_taxon_counts Index

curl_http_method=POST
curl_content_type=application/x-ndjson
curl_url=${es_endpoint}/_index_template/scored_taxon_counts
curl_data=@./docker/open_distro/scored_taxon_counts_template.json

echo "/tmp/czecs task -f ${balances_file} --debug --timeout 0 --set taskDefinitionArn=${task_definition_arn} --set cluster=${cluster} --set curl_http_method=${curl_http_method} --set curl_content_type=${curl_content_type} --set curl_url=${curl_url} --set curl_data=${curl_data} czecs-task-curl-data.json"
/tmp/czecs task -f "${balances_file}" --debug --timeout 0 --set taskDefinitionArn="${task_definition_arn}" --set cluster="${cluster}" --set curl_http_method="${curl_http_method}"  --set curl_content_type="${curl_content_type}" --set curl_url="${curl_url}" --set curl_data="${curl_data}" czecs-task-curl-data.json

curl_http_method=PUT # DELETE to delete the index
curl_url=${es_endpoint}/scored_taxon_counts-v1

echo "/tmp/czecs task -f ${balances_file} --debug --timeout 0 --set taskDefinitionArn=${task_definition_arn} --set cluster=${cluster} --set curl_http_method=${curl_http_method} --set curl_url=${curl_url} czecs-task-curl.json"
/tmp/czecs task -f "${balances_file}" --debug --timeout 0 --set taskDefinitionArn="${task_definition_arn}" --set cluster="${cluster}" --set curl_http_method="${curl_http_method}" --set curl_url="${curl_url}" czecs-task-curl.json

# Create Aliases for Indexes

curl_http_method=POST
curl_content_type=application/x-ndjson
curl_url=${es_endpoint}/_aliases
curl_data=@./docker/open_distro/alias_update.json

echo "/tmp/czecs task -f ${balances_file} --debug --timeout 0 --set taskDefinitionArn=${task_definition_arn} --set cluster=${cluster} --set curl_http_method=${curl_http_method} --set curl_content_type=${curl_content_type} --set curl_url=${curl_url} --set curl_data=${curl_data} czecs-task-curl-data.json"
/tmp/czecs task -f "${balances_file}" --debug --timeout 0 --set taskDefinitionArn="${task_definition_arn}" --set cluster="${cluster}" --set curl_http_method="${curl_http_method}"  --set curl_content_type="${curl_content_type}" --set curl_url="${curl_url}" --set curl_data="${curl_data}" czecs-task-curl-data.json

#
# Release Tagging
#

echo "load release tag into param store"
# Extract the release SHA from the image string (expected format: sha-<7+ hex digits>).
if [[ "${image}" =~ ^sha-([0-9a-f]{7,})$ ]]; then
  release_sha="${BASH_REMATCH[1]}"
else
  echo "Error: image tag does not match expected pattern (sha-[0-9a-f]{7,})."
  exit 1
fi

# Put the parameter into AWS Systems Manager Parameter Store.
aws ssm put-parameter --name "/idseq-${env}-web/GIT_RELEASE_SHA" --value "${release_sha}" --type String --overwrite
