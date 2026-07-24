#!/usr/bin/env python3
"""Fail if the chart renders a resource kind the Argo CD AppProject does not permit.

WHY THIS EXISTS
---------------
An Argo AppProject carries an allow-list of resource kinds (namespaceResourceWhitelist).
If a chart renders a kind that is NOT on it, Argo rejects that resource -- and because a
not-permitted resource invalidates the ENTIRE sync, the namespace is never created and the
app never serves. What the developer sees is a preview sandbox that simply times out, with
no statement of the real cause anywhere near the surface; the reason is buried in
Application.status.operationState.

That is exactly how preview sandboxes broke: the chart gained a PodDisruptionBudget, the
seqtoid-preview project did not permit policy/PodDisruptionBudget, and every preview
sandbox failed with "still not serving" while the image built perfectly. It cost real
contributor time to diagnose something that is mechanically checkable.

This check renders the chart with the same values the environment uses, extracts every
(group, kind) it produces, and diffs that against the project's allow-list. It runs at PR
time, on the repo where templates are ADDED, so the gap is caught by the person adding the
template rather than by whoever next opens a sandbox.

Usage:
    check-chart-appproject-kinds.py --chart PATH --values PATH --appproject PATH [--values PATH ...]

Exit codes: 0 = every rendered kind is permitted; 1 = at least one gap; 2 = usage/tooling error.
"""
import argparse
import subprocess
import sys

try:
    import yaml
except ImportError:  # pragma: no cover
    print("error: pyyaml is required", file=sys.stderr)
    sys.exit(2)


def render(chart, values):
    """helm template the chart with the given values files, return the manifest text."""
    cmd = ["helm", "template", "preview-kinds-check", chart]
    for v in values:
        cmd += ["-f", v]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        print("error: helm template failed:\n" + proc.stderr.strip(), file=sys.stderr)
        sys.exit(2)
    return proc.stdout


def rendered_kinds(manifest):
    """Every (group, kind) the chart actually produces. Group is '' for core/v1."""
    out = set()
    for doc in yaml.safe_load_all(manifest):
        if not doc or not doc.get("kind"):
            continue
        api = doc.get("apiVersion", "v1")
        group = api.split("/")[0] if "/" in api else ""
        out.add((group, doc["kind"]))
    return out


def permitted_kinds(appproject_path):
    """Kinds the AppProject allows, namespaced + cluster-scoped."""
    with open(appproject_path) as fh:
        proj = yaml.safe_load(fh)
    spec = (proj or {}).get("spec", {})
    allowed = set()
    for key in ("namespaceResourceWhitelist", "clusterResourceWhitelist"):
        for item in spec.get(key) or []:
            allowed.add((item.get("group", ""), item["kind"]))
    return allowed


def fmt(pair):
    group, kind = pair
    return f"{group}/{kind}" if group else f"core/{kind}"


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--chart", required=True)
    ap.add_argument("--values", action="append", default=[], required=True)
    ap.add_argument("--appproject", required=True)
    args = ap.parse_args()

    produced = rendered_kinds(render(args.chart, args.values))
    allowed = permitted_kinds(args.appproject)
    gaps = sorted(produced - allowed)

    print(f"chart renders {len(produced)} kind(s); project permits {len(allowed)}")
    for pair in sorted(produced):
        print(f"  {'OK  ' if pair in allowed else 'GAP '} {fmt(pair)}")

    if not gaps:
        print("\nAll rendered kinds are permitted by the AppProject.")
        return 0

    print(f"\nFAIL: {len(gaps)} kind(s) rendered but NOT permitted by {args.appproject}:", file=sys.stderr)
    for pair in gaps:
        print(f"  - {fmt(pair)}", file=sys.stderr)
    print(
        "\nArgo rejects a not-permitted resource and INVALIDATES THE WHOLE SYNC, so the\n"
        "namespace is never created and the app never serves -- it just times out with no\n"
        "stated cause. Fix by adding the kind(s) to spec.namespaceResourceWhitelist in the\n"
        "AppProject, or by not rendering them for this environment. Prefer permitting the\n"
        "kind: an environment that quietly drops resources stops being a faithful preview.",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
