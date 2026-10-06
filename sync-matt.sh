#!/bin/bash

set -euxo pipefail

project_ids=(
4336
20987
21072
21202
21211
21213
21368
21398
21399
21402
21424
21425
21433
23826
24358
25566
25612
25613
25615
25616
25632
25663
25673
25674
25675
25676
25677
25856
26043
26079
26080
26767
27014
27016
27697
27748
27749
29033
29034
29038
29067
29134
29264
29454
29577
29597
29855
29919
)

for project_id in "${project_ids[@]}"; do
	#s5cmd --stat sync \
	aws --profile idseq-prod s3 sync \
		"s3://idseq-prod-czi-data-transfer-2026-08-27/samples/$project_id/*" \
		s3://seqtoid-env-prod-samples/samples/$project_id/ \
		--exclude "*sfn-desc*"
done

