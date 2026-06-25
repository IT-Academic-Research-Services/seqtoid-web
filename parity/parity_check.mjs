#!/usr/bin/env node
/**
 * CZID-307 — Parity verification harness for the CZID-285 federation collapse.
 *
 * For each ported GraphQL operation, sends the SAME query + variables to BOTH:
 *   - the federation server   (FED_GRAPHQL_URL,   default .../graphqlfed)
 *   - Rails-native GraphQL     (RAILS_GRAPHQL_URL, default .../graphql)
 * against the same Rails DB, and deep-diffs the `data`. Identical = parity.
 *
 * This is the hard parity gate before the CZID-305 Relay cutover and the
 * CZID-306 federation decommission: no teardown until every op diffs clean.
 *
 * Usage: see parity/README.md. Requires Node 18+ (global fetch).
 *   PARITY_COOKIE='<session cookie>' \
 *   PARITY_WORKFLOW_RUN_ID=123 PARITY_SAMPLE_ID=456 ... \
 *   node parity/parity_check.mjs [opName ...]
 *
 * Exit code: 0 if every op matches, 1 on any mismatch or GraphQL error.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const RAILS_URL = process.env.RAILS_GRAPHQL_URL || "http://localhost:3000/graphql";
const FED_URL = process.env.FED_GRAPHQL_URL || "http://localhost:3000/graphqlfed";
const COOKIE = process.env.PARITY_COOKIE || "";
const CSRF = "graphql-yoga-csrf-prevention";
// Post-CZID-305, Rails GraphqlController uses protect_from_forgery with :null_session, so the
// Rails /graphql side must send a real Rails CSRF token (matching _czid_session in PARITY_COOKIE)
// or current_user is nullified and the response comes back unauthenticated — which would make the
// diff compare federation-authenticated vs Rails-anonymous. The federation side ignores it.
const RAILS_CSRF = process.env.PARITY_CSRF || "";

if (!COOKIE) {
  console.error(
    "WARN: PARITY_COOKIE is empty — both endpoints will likely return auth errors.\n" +
      "      Log into the local demo and export the session cookie. See parity/README.md.",
  );
}

// Replace ${ENV_VAR} placeholders in variables with process.env values, recursively.
function resolveVars(value) {
  if (typeof value === "string") {
    const m = value.match(/^\$\{([A-Z0-9_]+)\}$/);
    if (m) {
      const v = process.env[m[1]];
      if (v === undefined) {
        throw new Error(`missing env var ${m[1]} (referenced in operations.json)`);
      }
      return v;
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(resolveVars);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveVars(v)]));
  }
  return value;
}

async function post(url, query, variables, extraHeaders = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-graphql-yoga-csrf": CSRF,
      ...(COOKIE ? { Cookie: COOKIE } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify({ query, variables }),
  });
  let json;
  try {
    json = await res.json();
  } catch (e) {
    return { errors: [{ message: `non-JSON response (HTTP ${res.status}): ${e.message}` }] };
  }
  return json;
}

// Order-sensitive deep diff. Returns an array of human-readable difference strings.
function diff(fed, rails, p = "") {
  const out = [];
  const ta = kind(fed);
  const tb = kind(rails);
  if (ta !== tb) {
    out.push(`${p || "<root>"}: type ${ta} (fed) != ${tb} (rails)`);
    return out;
  }
  if (ta === "array") {
    if (fed.length !== rails.length) {
      out.push(`${p}: length ${fed.length} (fed) != ${rails.length} (rails)`);
    }
    const n = Math.min(fed.length, rails.length);
    for (let i = 0; i < n; i++) out.push(...diff(fed[i], rails[i], `${p}[${i}]`));
    return out;
  }
  if (ta === "object") {
    const keys = new Set([...Object.keys(fed), ...Object.keys(rails)]);
    for (const k of keys) {
      if (!(k in fed)) out.push(`${p}.${k}: missing in fed`);
      else if (!(k in rails)) out.push(`${p}.${k}: missing in rails`);
      else out.push(...diff(fed[k], rails[k], `${p}.${k}`));
    }
    return out;
  }
  if (fed !== rails) out.push(`${p}: ${JSON.stringify(fed)} (fed) != ${JSON.stringify(rails)} (rails)`);
  return out;
}

function kind(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v === "object" ? "object" : typeof v;
}

const ops = JSON.parse(fs.readFileSync(path.join(HERE, "operations.json"), "utf8"));
const only = process.argv.slice(2);
const selected = only.length ? ops.filter((o) => only.includes(o.name)) : ops;

let failures = 0;
let ran = 0;
for (const op of selected) {
  let variables;
  try {
    variables = resolveVars(op.variables || {});
  } catch (e) {
    console.log(`SKIP  ${op.name}  (${e.message})`);
    continue;
  }
  ran++;
  const [fedResp, railsResp] = await Promise.all([
    post(FED_URL, op.fedQuery || op.query, variables),
    post(RAILS_URL, op.railsQuery || op.query, variables, RAILS_CSRF ? { "X-CSRF-Token": RAILS_CSRF } : {}),
  ]);

  const errSide = [];
  if (fedResp.errors) errSide.push(`fed: ${JSON.stringify(fedResp.errors)}`);
  if (railsResp.errors) errSide.push(`rails: ${JSON.stringify(railsResp.errors)}`);
  if (errSide.length) {
    failures++;
    console.log(`ERROR ${op.name}`);
    errSide.forEach((e) => console.log(`        ${e}`));
    continue;
  }

  const field = op.field;
  const fedData = field ? fedResp.data?.[field] : fedResp.data;
  const railsData = field ? railsResp.data?.[field] : railsResp.data;
  const diffs = diff(fedData, railsData);
  if (diffs.length === 0) {
    console.log(`PASS  ${op.name}`);
  } else {
    failures++;
    console.log(`FAIL  ${op.name}  (${diffs.length} diff${diffs.length === 1 ? "" : "s"})`);
    diffs.slice(0, 25).forEach((d) => console.log(`        ${d}`));
    if (diffs.length > 25) console.log(`        … and ${diffs.length - 25} more`);
  }
}

console.log(`\n${ran - failures}/${ran} operations at parity${failures ? ` — ${failures} FAILED` : ""}.`);
process.exit(failures ? 1 : 0);
