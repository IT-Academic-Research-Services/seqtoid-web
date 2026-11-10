#!/usr/bin/env python3
"""pipeline_e2e + aupr legs of the RC battery, from the dev benchmark result.

The rc-gate CronJob on dev runs a known benchmark sample through dev's deployed pipeline while dev
is pinned to the RC, and writes s3://<bench bucket>/rc-gates/<rc-id>/result.json:

  {"schema": 1, "rc", "image_tag", "dataset", "srm_version", "state": running|succeeded|failed,
   "sample_id", "pipeline_run_id", "pipeline_status", "benchmark_workflow_run_id",
   "metrics": {"nt_aupr", "nr_aupr", "nt_l2_norm", "nr_l2_norm", "correlation"},
   "report_digest", "report_rows", "started_at", "updated_at", "completed_at", "error"}

Subcommands (stdlib only, except `baseline`, which parses the YAML RC records with PyYAML):

  pipeline --result F --rc ID --image-tag T
      pipeline_e2e: pass iff the result is this RC's, state succeeded and the pipeline run completed.
  baseline --records-dir DIR --exclude ID
      prints the id of the most recently RELEASED RC (newest released_at), or nothing.
  aupr --result F --rc ID --image-tag T [--baseline F --baseline-rc ID] [--floor --tolerance
       --digest-enforce true|false --verdict-out F --summary-out F]
      aupr: floor, then (when a comparable baseline exists) tolerance in either direction and
      report-digest consistency.

`pipeline` and `aupr` print `status=pass|fail` and `reason=...` for $GITHUB_OUTPUT and always exit
0 on a verdict (the caller records it); they exit 2 only on a usage error.
"""

import argparse
import glob
import json
import math
import os
import sys

METRICS = ("nt_aupr", "nr_aupr")
TERMINAL = ("succeeded", "failed")
# PipelineRun job_status for a run that finished (app/models/pipeline_run.rb STATUS_CHECKED).
COMPLETED_PIPELINE = ("CHECKED",)
NEVER_STARTED = "dev benchmark never started (is the rc-gate CronJob enabled and dev pinned to this RC?)"


def load_result(path):
    """Returns (result dict or None, problem or None). A missing file is not malformed."""
    if not path or not os.path.exists(path):
        return None, None
    try:
        with open(path) as fh:
            data = json.load(fh)
    except (OSError, ValueError) as exc:
        return None, f"result.json is not valid JSON ({exc})"
    if not isinstance(data, dict):
        return None, "result.json is not a JSON object"
    return data, None


def identity_problem(result, rc, image_tag):
    """A result written for another RC or build must never vet this one."""
    got_rc, got_tag = result.get("rc"), result.get("image_tag")
    if got_rc != rc or got_tag != image_tag:
        return (
            f"stale or foreign result: it is for {got_rc or 'no rc'} @ {got_tag or 'no image_tag'}, "
            f"not {rc} @ {image_tag}"
        )
    return None


def pipeline_verdict(result, rc, image_tag, problem=None, missing_note=None):
    if problem:
        return "fail", problem
    if result is None:
        return "fail", missing_note or NEVER_STARTED
    bad = identity_problem(result, rc, image_tag)
    if bad:
        return "fail", bad
    state = result.get("state")
    run = result.get("pipeline_run_id")
    pstatus = result.get("pipeline_status")
    where = f"sample {result.get('sample_id')} run {run} on {result.get('dataset')}"
    if state not in TERMINAL:
        return "fail", f"dev benchmark did not finish in time (state {state!r}; {where})"
    if state == "failed":
        return "fail", f"dev benchmark failed: {result.get('error') or 'no error recorded'} ({where})"
    if run is None or str(pstatus or "").upper() not in COMPLETED_PIPELINE:
        return "fail", f"state succeeded but the pipeline run did not complete (status {pstatus!r}; {where})"
    return "pass", f"{where} completed ({pstatus}) through dev's deployed pipeline on {image_tag}"


def select_baseline(records, exclude=None):
    """records: parsed RC records. Newest released_at among state `released`, excluding `exclude`."""
    released = [
        r
        for r in records
        if isinstance(r, dict) and r.get("state") == "released" and r.get("id") and r.get("id") != exclude
    ]
    released = [r for r in released if r.get("released_at")]
    if not released:
        return None
    return max(released, key=lambda r: str(r["released_at"]))["id"]


def load_records(records_dir):
    import yaml  # PyYAML: installed from seqtoid-gitops' requirements.txt by the workflow

    out = []
    for path in sorted(glob.glob(os.path.join(records_dir, "*.yaml"))):
        with open(path) as fh:
            out.append(yaml.safe_load(fh) or {})
    return out


def _metric(block, name):
    v = (block or {}).get(name) if isinstance(block, dict) else None
    if isinstance(v, bool) or not isinstance(v, (int, float)) or math.isnan(v):
        return None
    return float(v)


def aupr_verdict(
    result,
    rc,
    image_tag,
    baseline=None,
    baseline_rc=None,
    floor=0.98,
    tolerance=0.01,
    digest_enforce=True,
    problem=None,
    missing_note=None,
):
    v = {
        "check": "aupr",
        "rc": rc,
        "image_tag": image_tag,
        "baseline_rc": baseline_rc,
        "comparable": False,
        "floor": floor,
        "tolerance": tolerance,
        "metrics": {},
        "failures": [],
        "warnings": [],
        "notes": [],
    }

    def done():
        v["status"] = "fail" if v["failures"] else "pass"
        v["reason"] = "; ".join(v["failures"] or v["notes"]) or "ok"
        return v

    p_status, p_reason = pipeline_verdict(result, rc, image_tag, problem, missing_note)
    if p_status != "pass":
        v["failures"].append(f"no usable benchmark result: {p_reason}")
        return done()

    new = {m: _metric(result.get("metrics"), m) for m in METRICS}
    for m in METRICS:
        v["metrics"][m] = {"new": new[m]}
        if new[m] is None:
            v["failures"].append(f"{m} missing or not a number in result.json")
        elif new[m] < floor:
            v["failures"].append(f"{m} {new[m]:.4f} is below the floor {floor}")
    if v["failures"]:
        return done()

    # Comparable baseline: same dataset AND same srm_version, with numeric metrics.
    why_not = None
    if baseline is None:
        why_not = (
            f"released RC {baseline_rc} has no dev benchmark result" if baseline_rc else "no RC has been released yet"
        )
    else:
        for key in ("dataset", "srm_version"):
            if not result.get(key) or result.get(key) != baseline.get(key):
                why_not = f"{key} {result.get(key)!r} differs from baseline {baseline_rc}'s {baseline.get(key)!r}"
                break
        if not why_not and any(_metric(baseline.get("metrics"), m) is None for m in METRICS):
            why_not = f"baseline {baseline_rc}'s result has no numeric AUPR"
    if why_not:
        v["notes"].append(
            f"floor met (nt {new['nt_aupr']:.4f}, nr {new['nr_aupr']:.4f} >= {floor}); no comparable baseline "
            f"({why_not}); this RC's result becomes the baseline once released"
        )
        return done()

    v["comparable"] = True
    for m in METRICS:
        base = _metric(baseline.get("metrics"), m)
        rel = abs(new[m] - base) / base if base else (0.0 if new[m] == base else math.inf)
        v["metrics"][m].update({"base": base, "rel_change": rel})
        if rel > tolerance:
            direction = "up" if new[m] > base else "down"
            v["failures"].append(
                f"{m} moved {direction} {rel:.2%} vs baseline {baseline_rc} ({base:.4f} -> {new[m]:.4f}; "
                f"tolerance {tolerance:.2%} either way: outputs must stay consistent)"
            )

    nd, bd = result.get("report_digest"), baseline.get("report_digest")
    if not nd or not bd or nd != bd:
        if not nd:
            msg, blocks = "this RC's result has no report_digest; report consistency is unproven", True
        elif not bd:
            msg, blocks = f"baseline {baseline_rc} has no report_digest; report consistency not compared", False
        else:
            msg = (
                f"report rows changed vs baseline {baseline_rc} "
                f"({baseline.get('report_rows')} rows {bd[:19]} -> {result.get('report_rows')} rows {nd[:19]})"
            )
            blocks = True
        if blocks and digest_enforce:
            v["failures"].append(msg)
        else:
            v["warnings"].append(msg)

    if not v["failures"]:
        v["notes"].append(
            f"nt {new['nt_aupr']:.4f}, nr {new['nr_aupr']:.4f} within {tolerance:.2%} of {baseline_rc}"
            + ("" if v["warnings"] else ", report identical")
        )
    return done()


def summary_markdown(v):
    lines = [f"#### aupr: {v['status']}", "", v["reason"], ""]
    if v["metrics"]:
        lines += ["| metric | this RC | baseline | rel. change |", "| --- | --- | --- | --- |"]
        for m, row in v["metrics"].items():
            new, base, rel = row.get("new"), row.get("base"), row.get("rel_change")
            cells = [
                m,
                "-" if new is None else f"{new:.4f}",
                "-" if base is None else f"{base:.4f}",
                "-" if rel is None else f"{rel:.2%}",
            ]
            lines.append("| " + " | ".join(cells) + " |")
        lines.append("")
    lines.append(
        f"baseline: {v['baseline_rc'] or 'none'} ({'comparable' if v['comparable'] else 'not comparable'}); "
        f"floor {v['floor']}, tolerance {v['tolerance']:.2%}"
    )
    lines += [f"- warning: {w}" for w in v["warnings"]]
    return "\n".join(lines) + "\n"


def _one_line(s):
    return " ".join(str(s).split())


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("pipeline", "aupr"):
        p = sub.add_parser(name)
        p.add_argument("--result", required=True)
        p.add_argument("--rc", required=True)
        p.add_argument("--image-tag", required=True)
        p.add_argument("--missing-note", help="why result.json is absent when it is not just unwritten (S3 error)")
    a = sub.choices["aupr"]
    a.add_argument("--baseline")
    a.add_argument("--baseline-rc")
    a.add_argument("--floor", type=float, default=0.98)
    a.add_argument("--tolerance", type=float, default=0.01)
    a.add_argument("--digest-enforce", choices=("true", "false"), default="true")
    a.add_argument("--verdict-out")
    a.add_argument("--summary-out")
    b = sub.add_parser("baseline")
    b.add_argument("--records-dir", required=True)
    b.add_argument("--exclude")
    args = ap.parse_args(argv)

    if args.cmd == "baseline":
        print(select_baseline(load_records(args.records_dir), args.exclude) or "")
        return 0

    result, problem = load_result(args.result)
    if args.cmd == "pipeline":
        status, reason = pipeline_verdict(result, args.rc, args.image_tag, problem, args.missing_note)
    else:
        baseline = None
        if args.baseline_rc and args.baseline:
            baseline, bproblem = load_result(args.baseline)
            if bproblem:
                print(f"baseline {args.baseline_rc}: {bproblem}; treating as absent", file=sys.stderr)
        v = aupr_verdict(
            result,
            args.rc,
            args.image_tag,
            baseline=baseline,
            baseline_rc=args.baseline_rc,
            floor=args.floor,
            tolerance=args.tolerance,
            digest_enforce=args.digest_enforce == "true",
            problem=problem,
            missing_note=args.missing_note,
        )
        if args.verdict_out:
            with open(args.verdict_out, "w") as fh:
                json.dump(v, fh, indent=2)
        if args.summary_out:
            with open(args.summary_out, "w") as fh:
                fh.write(summary_markdown(v))
        status, reason = v["status"], v["reason"]
    print(f"status={status}")
    print(f"reason={_one_line(reason)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
