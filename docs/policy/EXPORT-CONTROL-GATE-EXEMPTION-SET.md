# Export-Control Gate Exemption Set

Status: DRAFT -- for IT risk-assessment review (gap C-130)
Ticket: SMP-1696 (document the exemption set)
Owner: Platform / export-control (CZID-285/286/330/599 gate family)
Last updated: 2026-08-07

## 1. Purpose and scope

The seqtoid-web application layer enforces export control through a stack of
`before_action` gates installed on `ApplicationController`. A common one-line
summary of that design is:

> "Export control gates the authenticated surface."

That statement is true but incomplete: a small, deliberate set of endpoints and
conditions is **exempt** from one or more of those gates. This document
enumerates the FULL exemption set so it can be read alongside the summary above.
For each exemption it records the endpoint/condition, exactly which gates are
skipped, the authentication (if any) that applies instead, and why the exemption
is correct or necessary.

This is a documentation deliverable only. It asserts no change to the code and
no claim that any gate is mis-designed; every exemption below is expected to be
defensible, and none was found to be otherwise.

### 1.1 The gate stack being exempted from

Installed on `ApplicationController`, in this order
(`app/controllers/application_controller.rb`, lines 1-23):

1. `authenticate_user!` (line 2) -- Auth0 session auth.
2. `check_for_maintenance` (line 3) -- redirects to the maintenance page when
   the site is disabled (`disabled_for_maintenance?`, line 98-100).
3. `require_export_control_attestation` (line 7) -- CZID-330 click-through
   attestation gate. Provided by
   `app/controllers/concerns/export_control_attestation_gate.rb`.
4. `require_export_control_layer3` (line 13) -- CZID-285/286 Layer 3 clearance
   (identity verification + export screening; device/location attestation when
   its own flag is on). Provided by
   `app/controllers/concerns/export_control_layer3_gate.rb`.
5. `screen_export_control_onboarding` (line 18) -- CZID-599 LIVE Descartes
   screening at the onboarding backstop. Provided by
   `app/controllers/concerns/export_control_screening_gate.rb`.
6. `check_browser` (line 20) -- supported-browser check.

The RESULT-RELEASE screening backstop, `screen_export_control_release`, is NOT
part of the `ApplicationController` stack; it is an ADDITIONAL gate wired only on
`BulkDownloadsController#create`
(`app/controllers/bulk_downloads_controller.rb`, line 23). The download path is
therefore MORE gated than the default surface, not less.

Enforcement default: gates 3-5 ship DARK. They early-return to a full
pass-through unless the operator sets the relevant `AppConfig` flag
(`ENABLE_EXPORT_CONTROL_ATTESTATION`, `ENABLE_EXPORT_CONTROL_LAYER3`, and the
per-point / Descartes toggles). Go-live is a counsel-gated flag flip, not an
engineering action. This global "off by default" is context, not an exemption,
but it bounds the blast radius of everything below: while the flags are off, the
entire authenticated surface is a pass-through, so the exemptions have no
additional effect.

## 2. Exemption 1 -- WorkflowVersionsController#create (the CI publish endpoint)

- **Endpoint:** `POST /workflow_versions` -> `WorkflowVersionsController#create`
  (`app/controllers/workflow_versions_controller.rb`, lines 18-30).
- **Gates skipped** (`skip_before_action ... only: [:create]`, lines 21-28):
  `authenticate_user!`, `verify_authenticity_token`, `check_for_maintenance`,
  `require_export_control_attestation`, `require_export_control_layer3`,
  `screen_export_control_onboarding`, `check_browser`.
- **Authentication used instead:** `authenticate_publisher!`
  (`before_action ... only: [:create]`, line 30; defined lines 230-244). This
  is a FAIL-CLOSED, constant-time shared-secret check: it reads the
  `X-Workflow-Publisher-Token` header and compares it with
  `ENV["WORKFLOW_PUBLISHER_TOKEN"]` (supplied via Chamber/SSM) using
  `ActiveSupport::SecurityUtils.secure_compare`. A blank configured secret, a
  missing header, or a mismatch all return `401`. A misconfigured environment
  therefore denies rather than silently accepting.
- **Why the exemption is correct/necessary:** this is a machine-to-machine
  endpoint called by `seqtoid-workflows` CI after it publishes a version's two
  immutable artifacts (ECR image + WDL bundle in S3). The header comment
  (lines 1-17) records that the existing admin route could not be reused for two
  reasons: (1) it is session-based (`admin_required` needs a `current_user`;
  CI has no session and the app has no service-identity token path), and (2) it
  also PROMOTES the version to the environment default. The human-facing gates
  are meaningless for a non-browser CI caller: there is no user to attest, no
  session to screen, no browser to check, and no maintenance page to render to a
  script. The endpoint is REGISTER-ONLY -- it creates a `workflow_versions`
  catalog row and never touches `app_config`, user data, sample data, results,
  or downloads. Promotion remains a separate, deliberate admin action.

### 2.1 Intersection note for the assessor

This is the one exemption that removes ALL of the export-control gates from a
writable endpoint, so it is the one to read most carefully against "export
control gates the authenticated surface." It is defensible because:

- it is outside the human/authenticated surface entirely (no user identity is
  involved; export control screens *people*, and there is no person here);
- it is authenticated fail-closed by a shared secret, not left open;
- its effect is limited to catalog registration -- it cannot release, download,
  or expose sequence data, which is what export control is meant to protect.

Two standing dependencies worth restating: the secret must be provisioned in
every environment (absent secret = all calls denied, which is safe but breaks
publishing), and this endpoint deliberately has no CSRF protection because it is
a token-authenticated API, not a browser form.

`WorkflowVersionsController#index` (`GET /workflow_versions`, lines 44+) is NOT
exempt -- it inherits the full `ApplicationController` gate stack and uses
ordinary signed-in session auth.

## 3. Exemption 2 -- attestation gate exempt controllers (CZID-330)

- **Gate skipped:** `require_export_control_attestation`.
- **Exempt controllers** (`ATTESTATION_EXEMPT_CONTROLLERS`,
  `app/controllers/concerns/export_control_attestation_gate.rb`, lines 34-37;
  matched by `controller_name` in `attestation_exempt_request?`, lines 65-69):
  - `export_control_attestations`
  - `auth0`
- **Authentication used instead:** none is removed -- these controllers still
  run `authenticate_user!` and every other gate; only the attestation
  `before_action` is skipped for them.
- **Why the exemption is correct/necessary:** an un-attested user must be able
  to reach the attestation controller itself (to see the click-through form and
  record a decision) and the `auth0` controller (to log in / log out). Without
  these two exemptions the attestation redirect would loop and the user could
  never attest. Matching on `controller_name` (rather than route) means a route
  rename cannot silently open a hole.
- **Ordering note:** this list is intentionally SHORTER than the Layer 3 /
  screening lists (Section 4). The attestation gate runs BEFORE Layer 3, so at
  attestation time the clearance and device-attestation controllers are not yet
  reachable and are correctly NOT exempt here -- a user must attest first, then
  clear.

## 4. Exemption 3 -- Layer 3 and screening gate exempt controllers (CZID-285/286/599)

Both the Layer 3 clearance gate and the Descartes screening gate carry the same
exempt-controller list.

- **Gates skipped:** `require_export_control_layer3`,
  `screen_export_control_onboarding`, and `screen_export_control_release`.
- **Exempt controllers:**
  - `LAYER3_EXEMPT_CONTROLLERS`
    (`app/controllers/concerns/export_control_layer3_gate.rb`, lines 53-58;
    matched in `layer3_exempt_request?`, lines 97-100), and
  - `SCREENING_GATE_EXEMPT_CONTROLLERS`
    (`app/controllers/concerns/export_control_screening_gate.rb`, lines 34-39;
    matched in `screening_gate_exempt_request?`, lines 104-107).

  Both lists are identical:
  - `export_control_clearances`
  - `device_location_attestations`
  - `export_control_attestations`
  - `auth0`
- **Authentication used instead:** none is removed -- `authenticate_user!` and
  the upstream gates still apply; only the Layer 3 / screening `before_action`
  is skipped for these controllers.
- **Why the exemption is correct/necessary:** a not-yet-cleared (or
  not-yet-screened) user must be able to reach exactly the flow that would clear
  them -- the clearance controller (start/callback/denied), the
  device/location-attestation controller (submit/verify the token, deny page),
  the CZID-330 attestation controller (must stay reachable), and `auth0`
  (authenticate / sign out). Gating any of these would create a redirect loop
  with no exit. As with the attestation list, matching is by `controller_name`
  so a route change cannot silently un-exempt or open a hole.

## 5. Exemption 4 -- maintenance mode (all three export-control gates)

- **Condition:** `disabled_for_maintenance?` is true -- i.e.
  `ENV["DISABLE_SITE_FOR_MAINTENANCE"] == "1"` or the
  `AppConfig::DISABLE_SITE_FOR_MAINTENANCE` flag is `"1"`
  (`app/controllers/application_controller.rb`, lines 98-100).
- **Gates skipped:** all three export-control gates early-return when this is
  true. The check is part of each gate's exempt-request predicate:
  - attestation: `attestation_exempt_request?`
    (`export_control_attestation_gate.rb`, lines 65-69),
  - Layer 3: `layer3_exempt_request?`
    (`export_control_layer3_gate.rb`, lines 97-100),
  - screening: `screening_gate_exempt_request?`
    (`export_control_screening_gate.rb`, lines 104-107),
  each of which OR-s in
  `(respond_to?(:disabled_for_maintenance?, true) && disabled_for_maintenance?)`.
- **Authentication used instead:** not applicable -- during maintenance the
  request is already being redirected to the maintenance page by
  `check_for_maintenance`, which runs earlier in the stack (line 3).
- **Why the exemption is correct/necessary:** when the site is in maintenance
  mode, `check_for_maintenance` redirects every request to `maintenance_path`
  before the export-control gates would run. Having the export-control gates
  also try to redirect (to attestation/clearance) would fight the maintenance
  redirect. This exemption keeps the maintenance page reachable and the maintenance
  behavior deterministic. It does not widen access: the site is disabled, so no
  data-bearing action is served regardless.

## 6. Non-exemption: anonymous requests

Each export-control gate contains `return if current_user.nil?`
(attestation line 42, Layer 3 line 65, screening line 83). This is NOT an
export-control exemption -- anonymous requests are handled fail-closed upstream
by `authenticate_user!`, which runs first. The early return only avoids the
export-control gate acting on a request that authentication already owns.
Documented here so it is not mistaken for a gap.

## 7. Summary table

| # | Exemption | Gates skipped | Auth / handling instead | Why |
|---|-----------|---------------|-------------------------|-----|
| 1 | `WorkflowVersionsController#create` (CI publish) | authenticate_user!, verify_authenticity_token, check_for_maintenance, attestation, layer3, onboarding-screening, check_browser | `authenticate_publisher!` -- fail-closed constant-time shared secret (`X-Workflow-Publisher-Token` vs `WORKFLOW_PUBLISHER_TOKEN`) | M2M CI endpoint, no user/session/browser; register-only catalog write, never touches results or downloads |
| 2 | Attestation exempt controllers: `export_control_attestations`, `auth0` | attestation | still fully authenticated; only attestation gate skipped | un-attested user must reach the attestation form and login/logout, or the redirect loops |
| 3 | Layer3/screening exempt controllers: `export_control_clearances`, `device_location_attestations`, `export_control_attestations`, `auth0` | layer3, onboarding-screening, release-screening | still fully authenticated; only layer3/screening gates skipped | un-cleared user must reach the flow that clears them; otherwise redirect loops |
| 4 | Maintenance mode (`disabled_for_maintenance?`) | attestation, layer3, screening | request already redirected to maintenance page by `check_for_maintenance` | avoids fighting the maintenance redirect; site is disabled so nothing is served |

Not an exemption (listed for completeness): anonymous requests
(`current_user.nil?`) are handled by `authenticate_user!` upstream; the global
DARK default makes gates 3-5 a pass-through until counsel flips the flags.

## 8. Files cited

- `app/controllers/application_controller.rb` -- gate stack + `disabled_for_maintenance?`
- `app/controllers/workflow_versions_controller.rb` -- Exemption 1 + `authenticate_publisher!`
- `app/controllers/bulk_downloads_controller.rb` -- release-screening backstop (added gate)
- `app/controllers/concerns/export_control_attestation_gate.rb` -- Exemption 2 + maintenance
- `app/controllers/concerns/export_control_layer3_gate.rb` -- Exemption 3 + maintenance
- `app/controllers/concerns/export_control_screening_gate.rb` -- Exemption 3 + maintenance
