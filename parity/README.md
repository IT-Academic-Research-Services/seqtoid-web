# Parity verification harness (CZID-307)

Differential tester for the **CZID-285 federation collapse**. For every ported GraphQL
operation it sends the **same query + variables** to both endpoints against the **same Rails
DB** and deep-diffs the `data`:

- **federation** — `FED_GRAPHQL_URL` (default `http://localhost:3000/graphqlfed`)
- **Rails-native** — `RAILS_GRAPHQL_URL` (default `http://localhost:3000/graphql`)

Identical responses = parity. This is the **hard parity gate**: every op in
[`operations.json`](operations.json) must diff clean before the CZID-305 Relay cutover, and
the federation is not decommissioned (CZID-306) until it does. The ported ops keep the
federation's `graphql_name`s, so one query text is valid against both schemas.

## Run it

1. **Bring up the local stack from `czid-285a`** (so Rails `/graphql` has the ported ops *and*
   the gql-fed `/graphqlfed` is up), per memory `seqtoid-web-local-build-recipe`:
   bring up `db redis opensearch web web-proxy` + run the gql-fed (`czid-graphql`) on `czidnet`.
   Access the app at `http://localhost:3000` (NOT `:3001`).

2. **Log in** (seeded admin `czid-e2e@chanzuckerberg.com`) and copy the **session cookie** from
   the browser devtools (Network → any request → `Cookie:` header — it includes
   `_czid_session` + the services token). This authenticates both endpoints.

3. **Pick real ids** from the local DB for the ops you're checking, and export them:

   ```bash
   export PARITY_COOKIE='_czid_session=...; czid_services_token=...'
   export PARITY_SAMPLE_ID=123            # a viewable sample id
   export PARITY_WORKFLOW_RUN_ID=456      # a consensus-genome workflow run id
   export PARITY_WORKFLOW='consensus-genome'
   export PARITY_CG_DOWNLOAD_TYPE='consensus_genome_intermediate_output_files'
   ```

4. **Run** (all ops, or name specific ones):

   ```bash
   node parity/parity_check.mjs
   node parity/parity_check.mjs ZipLink MetadataFields
   ```

   `PASS` = byte-identical `data`. `FAIL` prints the differing paths (`fed` vs `rails`).
   `ERROR` = one side returned GraphQL errors. `SKIP` = a referenced `${ENV}` var is unset.
   Exit code is non-zero on any FAIL/ERROR.

## Adding ops

As CZID-303/304 port more operations, append to `operations.json`:
`{ name, field, query, variables }`. Use the **same query both sides** (possible because the
ported `graphql_name`s match the federation); if a NEW object had to be renamed to avoid a
collision (see the naming principle on CZID-303), give that op a `fedQuery` + `railsQuery`
pair instead of a single `query`. Reference real ids via `${ENV_VAR}` placeholders in
`variables`. All listed ops are read-only (safe to run repeatedly).

> No AWS / no live infra — this runs entirely against the local demo stack.
