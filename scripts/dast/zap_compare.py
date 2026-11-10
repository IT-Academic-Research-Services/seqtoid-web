#!/usr/bin/env python3
"""Compare an OWASP ZAP baseline-scan JSON report against the accepted baseline.

"Accept current, fail new" -- the same doctrine as the repo's trivy/checkov
baselines. Every finding the scan reports is reduced to a stable key:

    (alertRef, risk, normalized URL path)

alertRef is ZAP's per-alert id (pluginid, or pluginid-N when one plugin raises
several distinct alerts, e.g. 90004-1/-2/-3 for the three Cross-Origin-*
headers). The URL is reduced to its path with the query string and fragment
stripped, numeric ids / UUIDs collapsed to {id} / {uuid}, and asset
fingerprints (main-3f2a9b1c.js, app.4e5f6a7b8c.css) collapsed to {hash}, so
the key survives redeploys and does not depend on the host (dev vs pr-N).

A finding whose key is NOT in .zap/baseline.json is NEW. NEW findings at or
above --fail-on risk fail the check. Baseline entries no longer reported are
FIXED (informational: remove them from the baseline to lock in the win).
Rules set to IGNORE in .zap/rules.tsv are dropped before comparing (ZAP's -c
IGNORE only hides them from the console, they still appear in the JSON).

Baseline `path` values may be fnmatch globs (e.g. "/*") to accept a systemic
finding everywhere once it has been triaged as such.

Exit codes: 0 pass, 1 fail (NEW findings at/above threshold), 2 bad input.
Bad input fails closed: the workflow treats any non-zero exit as a fail.

Stdlib only.
"""

import argparse
import fnmatch
import json
import re
import sys
from urllib.parse import urlsplit

RISKS = ["Informational", "Low", "Medium", "High"]
RISK_ALIASES = {"info": "Informational", "informational": "Informational",
                "low": "Low", "medium": "Medium", "high": "High"}

_UUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_NUM = re.compile(r"^\d+$")
# A fingerprint is a run of >= 8 hex chars containing at least one digit, glued
# to the file name by '-' or '.', e.g. main-3f2a9b1c.js, app.4e5f6a7b8c.css,
# vendor-8c1d2e3f4a5b6c7d.chunk.js. The digit requirement keeps real words
# ("deadbeef" aside) from being collapsed.
_FINGERPRINT = re.compile(r"(?<=[-.])(?=[0-9a-fA-F]*\d)[0-9a-fA-F]{8,}(?=[-.])")
# Opaque base64url-ish tokens some bundlers use right before the extension
# (Vite: index-BxYz12Ab.js): >= 8 chars mixing letters and digits.
_OPAQUE = re.compile(r"(?<=[-.])(?=[A-Za-z0-9_]*\d)(?=[A-Za-z0-9_]*[A-Za-z])[A-Za-z0-9_]{8,}(?=\.[A-Za-z0-9]+$)")


class InputError(Exception):
    pass


def normalize_risk(value):
    if value is None:
        raise InputError("missing risk")
    s = str(value).strip()
    if s.isdigit():
        i = int(s)
        if 0 <= i < len(RISKS):
            return RISKS[i]
        raise InputError("unknown riskcode %r" % value)
    # riskdesc looks like "Medium (High)": risk then confidence.
    word = s.split(" ", 1)[0].lower()
    if word in RISK_ALIASES:
        return RISK_ALIASES[word]
    raise InputError("unknown risk %r" % value)


def normalize_path(url):
    """Reduce a URL to a stable path pattern (host-independent)."""
    parts = urlsplit(str(url))
    path = parts.path or "/"
    segs = []
    for seg in path.split("/"):
        if _UUID.match(seg):
            seg = "{uuid}"
        elif _NUM.match(seg):
            seg = "{id}"
        else:
            seg = _FINGERPRINT.sub("{hash}", seg)
            seg = _OPAQUE.sub("{hash}", seg)
        segs.append(seg)
    out = "/".join(segs)
    if not out.startswith("/"):
        out = "/" + out
    return out


def load_ignored(rules_path):
    """Plugin ids set to IGNORE in a ZAP rules.tsv (id<TAB>ACTION<TAB>(name))."""
    ignored = set()
    if not rules_path:
        return ignored
    try:
        with open(rules_path, encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("#") or not line.strip():
                    continue
                cols = line.rstrip("\n").split("\t")
                if len(cols) < 2:
                    raise InputError("rules line not tab-separated: %r" % line.strip())
                if cols[1].strip().upper() == "IGNORE":
                    ignored.add(cols[0].strip())
    except OSError as exc:
        raise InputError("cannot read rules %s: %s" % (rules_path, exc))
    return ignored


def extract_findings(report, ignored=frozenset()):
    """Return {key: finding} from a parsed ZAP JSON report."""
    if not isinstance(report, dict) or "site" not in report:
        raise InputError("not a ZAP JSON report (no 'site')")
    sites = report["site"]
    if isinstance(sites, dict):
        sites = [sites]
    if not isinstance(sites, list):
        raise InputError("'site' is not a list")
    findings = {}
    for site in sites:
        if not isinstance(site, dict):
            raise InputError("site entry is not an object")
        for alert in site.get("alerts") or []:
            if not isinstance(alert, dict) or "pluginid" not in alert:
                raise InputError("alert without pluginid")
            pluginid = str(alert["pluginid"])
            if pluginid in ignored:
                continue
            ref = str(alert.get("alertRef") or pluginid)
            risk = normalize_risk(alert.get("riskcode", alert.get("riskdesc")))
            name = alert.get("alert") or alert.get("name") or ""
            instances = alert.get("instances") or [{"uri": site.get("@name", "/")}]
            for inst in instances:
                if not isinstance(inst, dict):
                    raise InputError("instance is not an object")
                path = normalize_path(inst.get("uri", "/"))
                key = (ref, risk, path)
                findings.setdefault(key, {"pluginid": pluginid, "alertRef": ref,
                                          "alert": name, "risk": risk, "path": path})
    return findings


def load_baseline(baseline):
    if not isinstance(baseline, dict) or not isinstance(baseline.get("findings"), list):
        raise InputError("baseline must be an object with a 'findings' list")
    entries = []
    for e in baseline["findings"]:
        if not isinstance(e, dict):
            raise InputError("baseline entry is not an object")
        ref = e.get("alertRef") or e.get("pluginid")
        if not ref or "path" not in e:
            raise InputError("baseline entry needs alertRef/pluginid and path: %r" % e)
        entries.append({"alertRef": str(ref), "risk": normalize_risk(e.get("risk")),
                        "path": str(e["path"]), "alert": e.get("alert", ""),
                        "reason": e.get("reason", "")})
    return entries


def _matches(entry, key):
    ref, risk, path = key
    return (entry["alertRef"] == ref and entry["risk"] == risk
            and fnmatch.fnmatchcase(path, entry["path"]))


def compare(findings, baseline_entries, fail_on="Medium"):
    """Return dict(result, new, new_blocking, fixed, accepted)."""
    threshold = RISKS.index(normalize_risk(fail_on))
    new, accepted = [], []
    used = set()
    for key in sorted(findings):
        hit = None
        for i, entry in enumerate(baseline_entries):
            if _matches(entry, key):
                hit = i
                break
        if hit is None:
            new.append(findings[key])
        else:
            used.add(hit)
            accepted.append(findings[key])
    fixed = [e for i, e in enumerate(baseline_entries) if i not in used]
    blocking = [f for f in new if RISKS.index(f["risk"]) >= threshold]
    return {"result": "fail" if blocking else "pass", "new": new,
            "new_blocking": blocking, "fixed": fixed, "accepted": accepted}


def summary_line(res, fail_on):
    return ("ZAP baseline %s: %d new (%d at/above %s), %d accepted, %d fixed"
            % (res["result"].upper(), len(res["new"]), len(res["new_blocking"]),
               fail_on, len(res["accepted"]), len(res["fixed"])))


def markdown(res, fail_on):
    lines = ["## DAST (OWASP ZAP baseline)", "", summary_line(res, fail_on), ""]

    def table(title, rows):
        lines.append("### %s (%d)" % (title, len(rows)))
        if not rows:
            lines.extend(["", "none", ""])
            return
        lines.extend(["", "| Risk | Alert | Ref | Path |", "| --- | --- | --- | --- |"])
        for r in sorted(rows, key=lambda r: (-RISKS.index(r["risk"]), r["alertRef"], r["path"])):
            lines.append("| %s | %s | %s | `%s` |" % (r["risk"], r.get("alert", ""),
                                                      r["alertRef"], r["path"]))
        lines.append("")

    table("NEW at/above %s (blocking)" % fail_on, res["new_blocking"])
    table("NEW below threshold", [f for f in res["new"] if f not in res["new_blocking"]])
    table("FIXED (in baseline, no longer reported)", res["fixed"])
    table("Accepted (in baseline)", res["accepted"])
    return "\n".join(lines) + "\n"


def run(report_path, baseline_path, fail_on="Medium", rules_path=None, out=None):
    out = out or sys.stdout
    ignored = load_ignored(rules_path)
    try:
        with open(report_path, encoding="utf-8") as fh:
            report = json.load(fh)
        with open(baseline_path, encoding="utf-8") as fh:
            baseline = json.load(fh)
    except (OSError, ValueError) as exc:
        raise InputError(str(exc))
    res = compare(extract_findings(report, ignored), load_baseline(baseline), fail_on)
    print(summary_line(res, fail_on), file=out)
    for f in res["new"]:
        tag = "NEW-FAIL" if f in res["new_blocking"] else "NEW-WARN"
        print("%s: [%s] %s %s %s" % (tag, f["risk"], f["alertRef"], f["alert"], f["path"]), file=out)
    for f in res["fixed"]:
        print("FIXED: [%s] %s %s %s" % (f["risk"], f["alertRef"], f["alert"], f["path"]), file=out)
    return res


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    ap.add_argument("--report", required=True, help="ZAP JSON report (zap-baseline.py -J)")
    ap.add_argument("--baseline", required=True, help=".zap/baseline.json")
    ap.add_argument("--rules", help=".zap/rules.tsv (IGNORE entries are dropped)")
    ap.add_argument("--fail-on", default="Medium", help="Informational|Low|Medium|High")
    ap.add_argument("--github-output", help="append result=/summary= here ($GITHUB_OUTPUT)")
    ap.add_argument("--summary-md", help="append a markdown table here ($GITHUB_STEP_SUMMARY)")
    args = ap.parse_args(argv)
    try:
        fail_on = normalize_risk(args.fail_on)
        res = run(args.report, args.baseline, fail_on, args.rules)
        line = summary_line(res, fail_on)
        md = markdown(res, fail_on)
        code = 0 if res["result"] == "pass" else 1
    except InputError as exc:
        print("ERROR: %s" % exc, file=sys.stderr)
        res, code = {"result": "fail"}, 2
        line = "ZAP baseline FAIL: bad input (%s)" % str(exc).replace("\n", " ")[:200]
        md = "## DAST (OWASP ZAP baseline)\n\n%s\n" % line
    if args.github_output:
        with open(args.github_output, "a", encoding="utf-8") as fh:
            fh.write("result=%s\nsummary=%s\n" % (res["result"], line))
    if args.summary_md:
        with open(args.summary_md, "a", encoding="utf-8") as fh:
            fh.write(md)
    return code


if __name__ == "__main__":
    sys.exit(main())
