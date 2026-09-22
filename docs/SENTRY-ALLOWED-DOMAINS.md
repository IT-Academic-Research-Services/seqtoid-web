# Restricting the frontend Sentry DSN to our own domains (SMP-1808)

## Problem

The frontend (reactjs) Sentry DSN is public. It is injected into the page by
`app/views/layouts/_sentry_monitoring.html.erb` as `window.SENTRY_DSN_FRONTEND`
and consumed by `Sentry.init(...)` in `app/assets/src/index.tsx`, so it ships
verbatim in the client bundle and cannot be obfuscated. Anyone who reads it can
POST forged events to our Sentry project and burn our ingest quota.

## Mechanism

Sentry itself is NOT managed by Terraform in this fleet. The Sentry org
(`ucsf-rm`), teams, projects and client keys (DSNs) are provisioned by hand /
via the Sentry MCP -- there is no `sentry` terraform provider or `sentry_project`
/ `sentry_key` resource anywhere in `seqtoid-ssot-infra`,
`cypherid-workflow-infra`, or `cypherid-web-infra`. Therefore the allowlist is a
Sentry-console setting an operator applies per project; it cannot be codified in
IaC today.

The fix has two layers:

1. Server-side (PRIMARY, operator action -- steps below): set each reactjs
   project client key's **Allowed Domains** so Sentry only accepts events whose
   HTTP `Origin`/`Referer` is one of our own hosts.
2. Client-side (defense-in-depth, shipped in this PR): `allowUrls` in
   `Sentry.init` refuses to send any event whose originating script did not load
   from a `seqtoid.org` origin. This drops browser-extension / injected
   third-party noise before it leaves the browser. It is safe because app JS is
   served same-origin in every deployed tier (dev, env-staging and env-prod all
   leave `CZID_CLOUDFRONT_ENDPOINT` unset, so assets come from the
   `*.seqtoid.org` host, not a CDN domain).

## Operator action: set Allowed Domains per reactjs project

Sentry org `ucsf-rm`. For each FRONTEND (reactjs) project below:
Settings -> Client Keys (DSN) -> the key in use -> "Allowed Domains" -> add the
listed entries (one per line) -> Save. Backend (rails) and lambda projects are
server-side and are intentionally left unrestricted (no browser Origin/Referer).

Sentry matches the entry against the request `Origin`/`Referer`. Use bare
hostnames; a leading `*.` wildcard covers subdomains. Include both the apex and
the `www` form where the tier serves them.

| Env         | Reactjs project id   | Allowed Domains entries                                                       |
| ----------- | -------------------- | ---------------------------------------------------------------------------- |
| dev         | `4511510184067072`   | `dev.seqtoid.org`, `*.dev.seqtoid.org`                                        |
| env-staging | `4511628897746949`   | `env-staging.seqtoid.org`                                                     |
| env-prod    | `4511971547283456`   | `env-prod.seqtoid.org`, `seqtoid.org`, `www.seqtoid.org`, `sandbox.seqtoid.org` |

Notes:

- `*.dev.seqtoid.org` deliberately covers the ephemeral preview and gauntlet
  hosts (`pr-N.dev.seqtoid.org`, `gauntlet-*.dev.seqtoid.org`) with one entry.
- env-prod carries the apex `seqtoid.org` (and `www.`) as well as
  `env-prod.seqtoid.org` because prod DNS-flips `env-prod.seqtoid.org` ->
  `seqtoid.org` at cutover; keeping both avoids a gap across the flip.
- `sandbox.seqtoid.org` is listed with env-prod for convenience; if sandbox is
  ever pointed at its own Sentry project, move that entry to it.
- Do not restrict the rails or lambda projects -- their events originate
  server-side and have no browser Origin/Referer to match.

## Verifying

After saving, a forged `POST` to the ingest endpoint carrying an `Origin`/
`Referer` outside the allowlist is rejected by Sentry (HTTP 403 at the store
endpoint) and does not count against quota, while real events from the tier's own
host continue to arrive.

## Follow-up (out of scope for SMP-1808)

If a Sentry Terraform provider is ever adopted for the fleet, this allowlist
should be moved into the `sentry_key` / project resource so it is codified rather
than hand-set. The ticket also flags reviewing Terraform / Parameter Store env
vars passed to the web app and Lambdas for other public secrets; that is a
separate hardening pass.
