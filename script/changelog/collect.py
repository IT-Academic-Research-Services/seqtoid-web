#!/usr/bin/env python3
"""Release-notes collector (Option A) -- per-deploy, grouped by day.

Each deploy pipeline (in ANY repo) reports its OWN component when it ships:
seqtoid-web promote, swipe tf-apply, cypherid-workflow-infra apply, ssot-infra
apply, seqtoid-cli release. Every call records ONE dated release entry --
version YYYY.MM.DD.n where n counts all deploys that day across every component
-- diffing that component against ITS OWN last recorded version in the env
ledger. So a component's changes land in the changelog when THAT component
deploys, independent of whether anything else (e.g. the web app) deployed.

The record is appended to a per-env S3 ledger the in-app /releases page reads
at runtime, so a deploy is visible without an app rebuild.

Requires ``gh`` (PR lookup) and ``aws`` (S3 read/write) -- both on the CI runner.

  collect.py --env staging --component web --repo IT-Academic-Research-Services/seqtoid-web \
     --new-sha d94a11b9 --s3-uri s3://<bucket>/release-notes --reason "..."
  collect.py --env staging --component swipe --repo IT-Academic-Research-Services/swipe \
     --new-sha <sha> --default-piece "Alignment engine" --s3-uri s3://<bucket>/release-notes
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

# Canonical platform pieces (display order). The public feed (prod) shows only PUBLIC_PIECES.
PIECE_ORDER = [
    "Web application", "Analysis pipelines", "Reference data", "Command-line tool",
    "Alignment engine", "Accounts & access", "Platform & infrastructure",
]
PUBLIC_PIECES = ["Alignment engine", "Command-line tool", "Analysis pipelines"]

# Keyword -> piece classifier, used when a component spans pieces (the web repo). Single-purpose
# components (swipe, cli, workflow-infra, ...) pass --default-piece and skip this.
CLASSIFIERS = [
    ("Analysis pipelines",
     r"pipeline|workflow|consensus|genome|sars|\bamr\b|nanopore|long[- ]?read|phylotree|"
     r"accession|postprocess|miniwdl|\bwdl\b"),
    ("Reference data",
     r"\bindex[- ]?gen|taxon|lineage|\bncbi\b|reference (?:data|db)|dedup"),
    ("Accounts & access",
     r"export[- ]?control|screening|clearance|auth0|\bauth\b|login|sign[- ]?up|account|"
     r"descartes|visual compliance|\bidv\b"),
    ("Command-line tool", r"\bcli\b|upload token|web[- ]?identity|assumerole"),
    ("Alignment engine", r"\bswipe\b|alignment|spot[- ]?interrupt"),
    ("Platform & infrastructure",
     r"\bterraform\b|\beks\b|\bargo\b|karpenter|\bhelm\b|\binfra\b|gitops|workflow-infra"),
]


def change_type(title):
    t = title.lower()
    if re.search(r"\bsecurity\b|leak|vuln|cve|harden|restrict|disable .*download", t):
        return "security"
    if re.search(r"^feat|add(ed|s)?\b|introduce|new |selectable|enable", t):
        return "added"
    if re.search(r"^fix|fixe?[sd]?\b|resolve|repair|correct|stabiliz", t):
        return "fixed"
    if re.search(r"remove|drop|delete|deprecat", t):
        return "removed"
    return "changed"


def sh(cmd, check=False):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if check and r.returncode != 0:
        sys.stderr.write(r.stderr)
        raise SystemExit("command failed: " + " ".join(cmd))
    return r.stdout.strip()


def classify(title, default_piece):
    if default_piece:
        return default_piece
    t = title.lower()
    for piece, pat in CLASSIFIERS:
        if re.search(pat, t):
            return piece
    return "Web application"


def _noise_pr(title):
    # PRs that are plumbing, not user-facing changes: gitops sync / promote / rollup merges.
    t = title.lower()
    return bool(re.search(
        r"^(merge|promote|sync|roll)\b|integration ->|bring integration up to main|"
        r"^gitops|promote\(|^sync:", t))


def _change(repo, num, title, default_piece):
    return {
        "piece": classify(title, default_piece),
        "type": change_type(title),
        "title": title, "pr": num,
        "url": "https://github.com/{}/pull/{}".format(repo, num),
        "merged_at": "",
    }


def _prs_from_subjects(repo, prev_sha, new_sha, default_piece):
    # Fallback: parse "title (#NNN)" out of squash-merge subjects. Needs only contents:read, so it
    # never regresses below the prior behavior, but it MISSES a PR that reached main via a non-squash
    # promote (feature commits arrive without a "(#NNN)" subject) -- the exact case the association
    # path below fixes. Used only when the association API is unavailable.
    raw = sh(["gh", "api", "repos/{}/compare/{}...{}".format(repo, prev_sha, new_sha),
              "--jq", ".commits[].commit.message | split(\"\\n\")[0]"])
    out, seen = [], set()
    for subject in raw.splitlines():
        m = re.search(r"^(.*?)\s*\(#(\d+)\)\s*$", subject.strip())
        if not m:
            continue
        title, num = m.group(1).strip(), int(m.group(2))
        if not title or num in seen or _noise_pr(title):
            continue
        seen.add(num)
        out.append(_change(repo, num, title, default_piece))
    return sorted(out, key=lambda c: c["pr"])


def prs_between(repo, prev_sha, new_sha, default_piece):
    if not prev_sha:
        return []
    # Resolve each commit in the range to its PR via the commit->PR association API
    # (/commits/{sha}/pulls). Robust to ANY merge style -- squash, merge-commit, and the
    # integration->main promote, which brings feature commits in WITHOUT a "(#NNN)" subject and
    # otherwise silently records "0 changes". Needs pull_requests:read on the token; if that scope
    # is absent every call returns empty and we fall back to the subject parse (never worse).
    shas = sh(["gh", "api", "repos/{}/compare/{}...{}".format(repo, prev_sha, new_sha),
               "--jq", ".commits[].sha"]).splitlines()
    out, seen, resolved_any = [], set(), False
    for sha in shas:
        sha = sha.strip()
        if not sha:
            continue
        assoc = sh(["gh", "api", "repos/{}/commits/{}/pulls".format(repo, sha),
                    "--jq", r'.[] | "\(.number)\t\(.title)"'])
        if not assoc:
            continue
        resolved_any = True
        for line in assoc.splitlines():
            num_s, _, title = line.partition("\t")
            try:
                num = int(num_s)
            except ValueError:
                continue
            title = title.strip()
            if not title or num in seen or _noise_pr(title):
                continue
            seen.add(num)
            out.append(_change(repo, num, title, default_piece))
    if resolved_any:
        return sorted(out, key=lambda c: c["pr"])
    # Nothing resolved (empty range, or no pull_requests:read) -> subject-parse fallback.
    return _prs_from_subjects(repo, prev_sha, new_sha, default_piece)


def s3_read_json(uri):
    with tempfile.NamedTemporaryFile(suffix=".json") as tf:
        r = subprocess.run(["aws", "s3", "cp", uri, tf.name], capture_output=True, text=True)
        if r.returncode != 0:
            return []
        try:
            return json.load(open(tf.name))
        except Exception:
            return []


def s3_write(uri, text, content_type):
    with tempfile.NamedTemporaryFile("w", suffix=".tmp", delete=False) as tf:
        tf.write(text)
        path = tf.name
    sh(["aws", "s3", "cp", path, uri, "--content-type", content_type,
        "--cache-control", "max-age=60"], check=True)
    os.unlink(path)


def day_version(day, ledger):
    # n counts ALL releases that day, across every component (matches "multiple deploys per day").
    n = sum(1 for r in ledger if r.get("day") == day) + 1
    return "{}.{}".format(day.replace("-", "."), n), n


def last_for_component(ledger, env, component):
    for r in reversed(ledger):
        if r.get("env") == env and r.get("component") == component:
            return r
    return None


def render_markdown(env, ledger):
    lines = ["# Release notes -- {}".format(env), ""]
    for rec in sorted(ledger, key=lambda r: (r["day"], r.get("n", 0)), reverse=True):
        lines.append("## {} -- {}  ({})".format(rec["version"], rec["day"], rec.get("component", "")))
        if rec.get("reason"):
            lines.append("_{}  {}_".format(rec.get("sha", ""), rec["reason"]))
        lines.append("")
        by = {}
        for c in rec["changes"]:
            by.setdefault(c["piece"], []).append(c)
        for piece in PIECE_ORDER:
            if piece not in by:
                continue
            lines.append("### {}".format(piece))
            for c in by[piece]:
                pr = " ([#{}]({}))".format(c["pr"], c["url"]) if c.get("pr") else ""
                lines.append("- {}{}".format(c["title"], pr))
            lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--env", required=True)
    ap.add_argument("--component", required=True,
                    help="deploy source: web | swipe | pipelines | reference | cli | ssot | workflow-infra")
    ap.add_argument("--repo", required=True, help="OWNER/REPO to diff for PRs")
    ap.add_argument("--new-sha", required=True)
    ap.add_argument("--s3-uri", required=True, help="s3://bucket/prefix (no trailing slash)")
    ap.add_argument("--default-piece", default="",
                    help="force all this deploy's changes to one piece (single-purpose repos)")
    ap.add_argument("--reason", default="")
    ap.add_argument("--prev-sha", default="")
    ap.add_argument("--date", default="")
    ap.add_argument("--md", action="store_true")
    a = ap.parse_args()

    # Accept either a bare commit sha or a "sha-<commit>" tag (promote-to-env passes sha_tag).
    a.new_sha = re.sub(r"^sha-", "", a.new_sha)
    a.prev_sha = re.sub(r"^sha-", "", a.prev_sha)

    base = a.s3_uri.rstrip("/")
    ledger_uri = "{}/{}.json".format(base, a.env)
    ledger = s3_read_json(ledger_uri)

    prev_rec = last_for_component(ledger, a.env, a.component)
    if prev_rec and prev_rec.get("sha") == "sha-" + a.new_sha:
        print("already recorded {} sha-{} for {}; no-op".format(a.component, a.new_sha, a.env))
        return

    prev = a.prev_sha or (prev_rec["sha"].replace("sha-", "") if prev_rec else "")
    day = a.date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    version, n = day_version(day, ledger)
    changes = prs_between(a.repo, prev, a.new_sha, a.default_piece)

    rec = {
        "env": a.env, "version": version, "day": day, "n": n,
        "component": a.component, "source_repo": a.repo,
        "sha": "sha-" + a.new_sha,
        "previous_sha": ("sha-" + prev) if prev else None,
        "recorded_at": (a.date + "T00:00:00Z") if a.date else datetime.now(timezone.utc).isoformat(),
        "reason": a.reason, "changes": changes,
    }
    ledger.append(rec)
    s3_write(ledger_uri, json.dumps(ledger, indent=2), "application/json")
    if a.md:
        s3_write("{}/CHANGELOG-{}.md".format(base, a.env), render_markdown(a.env, ledger), "text/markdown")
    print("recorded {} {} [{}]: {} changes (prev={})".format(
        a.env, version, a.component, len(changes), prev or "none"))


if __name__ == "__main__":
    main()
