#!/usr/bin/sh

set -euxo pipefail

ES_DOMAIN=seqtoid-env-prod-heatmap-es
ES_URL=$(aws es describe-elasticsearch-domain \
		--domain-name "${ES_DOMAIN}" --query \
		"DomainStatus.Endpoints" --output text)

ES_URL="https://${ES_URL}"
echo "ES_URL=$ES_URL"

run_curl() {
	http_method="$1"
	curl_path="$2"
	curl_data="$3"

	content_type="application/x-ndjson"
	accept="application/json"

	echo "http_method=$http_method"
	echo "curl_path=$curl_path"
	echo "curl_data=$curl_data"

	# curl -ivL --retry-connrefused
	if [ -n "${curl_data}" ]; then
		curl -ivL --retry-connrefused \
				-X "$http_method" \
				-H "Content-Type: ${content_type}" \
				-H "Accept: ${accept}" \
				"${ES_URL}/$curl_path" \
				-d "${curl_data}"
	else
		curl -ivL --retry-connrefused \
				-X "$http_method" \
				-H "Content-Type: ${content_type}" \
				-H "Accept: ${accept}" \
				"${ES_URL}/$curl_path"
	fi
}

METHOD="GET"
CMD="_cat/indices"
DATA=""
#CMD="_cat/indices?format=json&pretty"
run_curl "${METHOD}" "${CMD}" "${DATA}"

# Create pipeline_runs Index

METHOD="POST"
CMD="_index_template/pipeline_runs"
DATA="@./pipeline_runs_template.json"
run_curl "${METHOD}" "${CMD}" "${DATA}"

METHOD="PUT"
# DELETE to delete the index
CMD="pipeline_runs-v1"
DATA=""
run_curl "${METHOD}" "${CMD}" "${DATA}"

# Create scored_taxon_counts Index

METHOD="POST"
CMD="_index_template/scored_taxon_counts"
DATA="@./scored_taxon_counts_template.json"
run_curl "${METHOD}" "${CMD}" "${DATA}"

METHOD="PUT"
# DELETE to delete the index
CMD="scored_taxon_counts-v1"
DATA=""
run_curl "${METHOD}" "${CMD}" "${DATA}"

# Create Aliases for Indexes

METHOD="POST"
CMD="_aliases"
DATA="@./alias_update.json"
run_curl "${METHOD}" "${CMD}" "${DATA}"
