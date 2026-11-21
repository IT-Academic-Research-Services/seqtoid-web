#!/usr/bin/env python3
"""Which rollout gates protect dev while it runs the RC? (rc-battery rollout leg, FJ-1265)

Merges the values Argo renders dev with -- the chart's values.yaml at the RC commit, then
cypherid-web-infra's dev.yaml and dev-pin.yaml (later files win, maps merge deeply, like Helm) --
and prints, for $GITHUB_OUTPUT:

  smoke_gate=on|off        smoke.gate.enabled: the PreSync smoke job; a failing gate fails the sync,
                           so a failing image never serves
  cutover_check=on|off     rolloutStrategy pingpong AND pingpong.postCutoverCheck.enabled: after the
                           cutover the live site is probed and a failure moves traffic straight back
  cutover_window_s=<n>     how long that post-cutover probe runs (count x interval)
  pin_kind=<kind>  pin_rc=<rc id>

Usage: dev-gates.py CHART_VALUES DEV_VALUES DEV_PIN_VALUES
"""
import re
import sys

import yaml


def merge(base, over):
    if isinstance(base, dict) and isinstance(over, dict):
        out = dict(base)
        for k, v in over.items():
            out[k] = merge(base.get(k), v) if k in base else v
        return out
    return over


def seconds(value):
    m = re.fullmatch(r"\s*(\d+)\s*([smh]?)\s*", str(value))
    if not m:
        raise ValueError(f"cannot read duration {value!r}")
    return int(m.group(1)) * {"": 1, "s": 1, "m": 60, "h": 3600}[m.group(2)]


def main(paths):
    values = {}
    for path in paths:
        with open(path) as f:
            values = merge(values, yaml.safe_load(f) or {})

    smoke = bool(((values.get("smoke") or {}).get("gate") or {}).get("enabled"))
    check = ((values.get("pingpong") or {}).get("postCutoverCheck")) or {}
    cutover = values.get("rolloutStrategy") == "pingpong" and bool(check.get("enabled"))
    window = seconds(check.get("interval", 0)) * int(check.get("count", 0)) if cutover else 0
    pin = values.get("pin") or {}

    print(f"smoke_gate={'on' if smoke else 'off'}")
    print(f"cutover_check={'on' if cutover else 'off'}")
    print(f"cutover_window_s={window}")
    print(f"pin_kind={pin.get('kind') or 'none'}")
    print(f"pin_rc={pin.get('rc') or ''}")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(sys.argv[1:])
