#!/usr/bin/env python3
"""
Release-notes collector (Option A).

Runs in CI after a successful promotion to an environment. It computes what
changed since that environment's previous release -- grouped by platform PIECE,
each linked to its PR -- stamps it with a day-based calendar version
(YYYY.MM.DD.n), appends it to the per-env ledger in S3, and (optionally) writes
a human-readable CHANGELOG-<env>.md alongside it.

The in-app /releases page reads the same S3 ledger at runtime (IRSA), so the
page is dynamic: a new promotion is visible without an app rebuild.

Requires `gh` (PR lookup) and `aws` (S3 read/write) on PATH -- both present on
the CI runner. No third-party Python deps.

  collect.py --env staging --new-sha d94a11b9 \
     --s3-uri s3://<bucket>/release-notes \
     --repo IT-Academic-Research-Services/seqtoid-web \
     --reason "Freeze deploy: ..."
"""
import argparse, json, os, re, subprocess, sys, tempfile
from datetime import datetime, timezone

# Canonical platform pieces (display order). The public feed (prod) shows only PUBLIC_PIECES.
PIECE_ORDER = ["Web application", "Analysis pipelines", "Reference data",
               "Command-line tool", "Alignment engine", "Accounts & access", "Platform & infrastructure"]
PUBLIC_PIECES = ["Alignment engine", "Command-line tool", "Analysis pipelines"]

# Keyword -> piece classifier for web-repo PRs (first match wins; default = Web application).
CLASSIFIERS = [
    ("Analysis pipelines", r"pipeline|workflow|consensus|genome|sars|\bamr\b|nanopore|long[- ]?read|phylotree|accession|postprocess|miniwdl|\bwdl\b"),
    ("Reference data",      r"\bindex[- ]?gen|taxon|lineage|\bncbi\b|reference (?:data|db)|dedup"),
    ("Accounts & access",   r"export[- ]?control|screening|clearance|auth0|\bauth\b|login|sign[- ]?up|account|descartes|visual compliance|\bidv\b"),
    ("Command-line tool",   r"\bcli\b|upload token|web[- ]?identity|assumerole"),
    ("Alignment engine",    r"\bswipe\b|alignment|spot[- ]?interrupt"),
    ("Platform & infrastructure", r"\bterraform\b|\beks\b|\bargo\b|karpenter|\bhelm\b|\binfra\b|gitops|workflow-infra"),
]
# Conventional-commit type / keyword -> change type for the entry tag.
def change_type(title):
    t = title.lower()
    if re.search(r"\bsecurity\b|leak|vuln|cve|harden|restrict|disable .*download", t): return "security"
    if re.search(r"^feat|add(ed|s)?\b|introduce|new ", t): return "added"
    if re.search(r"^fix|fixe?[sd]?\b|resolve|repair|correct", t): return "fixed"
    if re.search(r"remove|drop|delete|deprecat", t): return "removed"
    return "changed"

def sh(cmd, check=False):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if check and r.returncode != 0:
        sys.stderr.write(r.stderr)
        raise SystemExit(f"command failed: {' '.join(cmd)}")
    return r.stdout.strip()

def classify(title):
    t = title.lower()
    for piece, pat in CLASSIFIERS:
        if re.search(pat, t):
            return piece
    return "Web application"

def prs_between(repo, prev_sha, new_sha):
    if not prev_sha:
        return []
    raw = sh(["gh", "api", f"repos/{repo}/compare/{prev_sha}...{new_sha}", "--jq", ".commits[].commit.message"])
    nums = sorted({int(n) for n in re.findall(r"\(#(\d+)\)", raw)})
    out = []
    for n in nums:
        j = sh(["gh", "pr", "view", str(n), "--repo", repo, "--json", "number,title,url,mergedAt",
                "--jq", "{n:.number,t:.title,u:.url,m:.mergedAt}"])
        if not j:
            continue
        d = json.loads(j)
        out.append({"piece": classify(d["t"]), "type": change_type(d["t"]),
                    "title": d["t"], "pr": d["n"], "url": d["u"], "merged_at": (d["m"] or "")[:10]})
    return out

def s3_read_json(uri):
    with tempfile.NamedTemporaryFile(suffix=".json") as tf:
        r = subprocess.run(["aws", "s3", "cp", uri, tf.name], capture_output=True, text=True)
        if r.returncode != 0:
            return []  # first run: object does not exist yet
        try:
            return json.load(open(tf.name))
        except Exception:
            return []

def s3_write_json(uri, data, content_type="application/json"):
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as tf:
        json.dump(data, tf, indent=2)
        path = tf.name
    sh(["aws", "s3", "cp", path, uri, "--content-type", content_type,
        "--cache-control", "max-age=60"], check=True)
    os.unlink(path)

def s3_write_text(uri, text, content_type="text/markdown"):
    with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as tf:
        tf.write(text); path = tf.name
    sh(["aws", "s3", "cp", path, uri, "--content-type", content_type], check=True)
    os.unlink(path)

def day_version(day, ledger):
    n = sum(1 for r in ledger if r.get("day") == day) + 1
    return f"{day.replace('-', '.')}.{n}", n

def render_markdown(env, ledger):
    lines = [f"# Release notes -- {env}", ""]
    for rec in sorted(ledger, key=lambda r: (r["day"], r.get("n", 0)), reverse=True):
        lines.append(f"## {rec['version']} -- {rec['day']}")
        if rec.get("reason"):
            lines.append(f"_{rec.get('sha','')}  {rec['reason']}_")
        lines.append("")
        by = {}
        for c in rec["changes"]:
            by.setdefault(c["piece"], []).append(c)
        for piece in PIECE_ORDER:
            if piece not in by:
                continue
            lines.append(f"### {piece}")
            for c in by[piece]:
                pr = f" ([#{c['pr']}]({c['url']}))" if c.get("pr") else ""
                lines.append(f"- {c['title']}{pr}")
            lines.append("")
    return "\n".join(lines).rstrip() + "\n"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--env", required=True)
    ap.add_argument("--new-sha", required=True)
    ap.add_argument("--s3-uri", required=True, help="s3://bucket/prefix (no trailing slash)")
    ap.add_argument("--repo", default="IT-Academic-Research-Services/seqtoid-web")
    ap.add_argument("--reason", default="")
    ap.add_argument("--prev-sha", default="")
    ap.add_argument("--date", default="")
    ap.add_argument("--md", action="store_true", help="also write CHANGELOG-<env>.md to S3")
    a = ap.parse_args()

    base = a.s3_uri.rstrip("/")
    ledger_uri = f"{base}/{a.env}.json"
    ledger = s3_read_json(ledger_uri)

    # idempotent: if this exact sha is already the latest recorded release for the env, do nothing.
    if ledger and ledger[-1].get("sha") == f"sha-{a.new_sha}":
        print(f"already recorded sha-{a.new_sha} for {a.env}; no-op")
        return

    prev = a.prev_sha or (ledger[-1]["sha"].replace("sha-", "") if ledger else "")
    day = a.date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    version, n = day_version(day, ledger)
    changes = prs_between(a.repo, prev, a.new_sha)

    rec = {"env": a.env, "version": version, "day": day, "n": n,
           "sha": f"sha-{a.new_sha}", "previous_sha": f"sha-{prev}" if prev else None,
           "recorded_at": (a.date + "T00:00:00Z") if a.date else datetime.now(timezone.utc).isoformat(),
           "reason": a.reason, "changes": changes}
    ledger.append(rec)
    s3_write_json(ledger_uri, ledger)
    if a.md:
        s3_write_text(f"{base}/CHANGELOG-{a.env}.md", render_markdown(a.env, ledger))
    print(f"recorded {a.env} {version}: {len(changes)} changes (prev={prev or 'none'}) -> {ledger_uri}")

if __name__ == "__main__":
    main()
