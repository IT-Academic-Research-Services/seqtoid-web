#!/usr/bin/env python3
"""Tests for the RC battery's pipeline_e2e + aupr gate (scripts/rc-battery/aupr_gate.py)."""

import contextlib
import copy
import importlib.util
import io
import json
import os
import tempfile
import unittest

_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "scripts", "rc-battery", "aupr_gate.py")
_spec = importlib.util.spec_from_file_location("aupr_gate", _PATH)
gate = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gate)

try:
    import yaml  # noqa: F401

    HAVE_YAML = True
except ImportError:
    HAVE_YAML = False

RC, TAG = "rc-2026.11.10", "sha-abc12345"


def result(**over):
    r = {
        "schema": 1,
        "rc": RC,
        "image_tag": TAG,
        "dataset": "idseq_bench_5",
        "srm_version": "8.3.15",
        "state": "succeeded",
        "sample_id": 1,
        "pipeline_run_id": 2,
        "pipeline_status": "CHECKED",
        "metrics": {"nt_aupr": 0.99, "nr_aupr": 0.985, "nt_l2_norm": 0.1, "nr_l2_norm": 0.1, "correlation": 0.99},
        "report_digest": "sha256:" + "a" * 64,
        "report_rows": 123,
        "error": None,
    }
    for k, v in over.items():
        if k in ("nt_aupr", "nr_aupr"):
            r["metrics"][k] = v
        else:
            r[k] = v
    return r


def baseline(**over):
    b = result(rc="rc-2026.11.03", image_tag="sha-0000beef")
    for k, v in over.items():
        if k in ("nt_aupr", "nr_aupr"):
            b["metrics"][k] = v
        else:
            b[k] = v
    return b


def verdict(res, base=None, **kw):
    kw.setdefault("baseline_rc", "rc-2026.11.03" if base is not None else None)
    return gate.aupr_verdict(res, RC, TAG, baseline=base, **kw)


class PipelineTest(unittest.TestCase):
    def test_pass(self):
        s, r = gate.pipeline_verdict(result(), RC, TAG)
        self.assertEqual(s, "pass", r)

    def test_missing_file_never_started(self):
        s, r = gate.pipeline_verdict(None, RC, TAG)
        self.assertEqual(s, "fail")
        self.assertIn("never started", r)

    def test_foreign_rc_and_stale_tag(self):
        for res in (result(rc="rc-2026.11.03"), result(image_tag="sha-deadbeef")):
            s, r = gate.pipeline_verdict(res, RC, TAG)
            self.assertEqual(s, "fail")
            self.assertIn("stale or foreign", r)

    def test_still_running_and_failed(self):
        s, r = gate.pipeline_verdict(result(state="running"), RC, TAG)
        self.assertEqual(s, "fail")
        self.assertIn("did not finish", r)
        s, r = gate.pipeline_verdict(result(state="failed", error="batch job died"), RC, TAG)
        self.assertEqual(s, "fail")
        self.assertIn("batch job died", r)

    def test_succeeded_but_run_incomplete(self):
        for res in (result(pipeline_status="FAILED|READY"), result(pipeline_run_id=None), result(pipeline_status=None)):
            s, _ = gate.pipeline_verdict(res, RC, TAG)
            self.assertEqual(s, "fail")


class AuprTest(unittest.TestCase):
    def test_floor_fail(self):
        v = verdict(result(nr_aupr=0.97), baseline())
        self.assertEqual(v["status"], "fail")
        self.assertIn("nr_aupr 0.9700 is below the floor", v["reason"])

    def test_floor_is_configurable(self):
        self.assertEqual(verdict(result(nr_aupr=0.97), floor=0.95)["status"], "pass")

    def test_within_tolerance_pass(self):
        v = verdict(result(nt_aupr=0.99), baseline(nt_aupr=0.992))
        self.assertEqual(v["status"], "pass", v["reason"])
        self.assertTrue(v["comparable"])

    def test_tolerance_fail_down(self):
        v = verdict(result(nt_aupr=0.981), baseline(nt_aupr=0.999), tolerance=0.01)
        self.assertEqual(v["status"], "fail")
        self.assertIn("nt_aupr moved down", v["reason"])

    def test_tolerance_fail_up(self):
        # An unexplained improvement is still a change: prod outputs must stay consistent.
        v = verdict(result(nr_aupr=0.999), baseline(nr_aupr=0.981), tolerance=0.01)
        self.assertEqual(v["status"], "fail")
        self.assertIn("nr_aupr moved up", v["reason"])

    def test_digest_mismatch_enforced(self):
        v = verdict(result(report_digest="sha256:" + "b" * 64), baseline())
        self.assertEqual(v["status"], "fail")
        self.assertIn("report rows changed vs baseline rc-2026.11.03", v["reason"])

    def test_digest_mismatch_warn_only(self):
        v = verdict(result(report_digest="sha256:" + "b" * 64), baseline(), digest_enforce=False)
        self.assertEqual(v["status"], "pass", v["reason"])
        self.assertTrue(any("report rows changed" in w for w in v["warnings"]))

    def test_digest_missing_on_new_enforced(self):
        self.assertEqual(verdict(result(report_digest=None), baseline())["status"], "fail")

    def test_digest_missing_on_baseline_warns(self):
        v = verdict(result(), baseline(report_digest=None))
        self.assertEqual(v["status"], "pass", v["reason"])
        self.assertTrue(v["warnings"])

    def test_bootstrap_no_baseline(self):
        v = verdict(result())
        self.assertEqual(v["status"], "pass")
        self.assertFalse(v["comparable"])
        self.assertIn("no comparable baseline", v["reason"])
        self.assertIn("becomes the baseline once released", v["reason"])

    def test_bootstrap_still_enforces_floor(self):
        self.assertEqual(verdict(result(nt_aupr=0.5))["status"], "fail")

    def test_srm_mismatch_takes_bootstrap_path(self):
        # A big AUPR swing is not compared across pipeline versions; only the floor applies.
        v = verdict(result(nt_aupr=0.999), baseline(srm_version="8.3.14", nt_aupr=0.981))
        self.assertEqual(v["status"], "pass", v["reason"])
        self.assertFalse(v["comparable"])
        self.assertIn("srm_version", v["reason"])

    def test_dataset_mismatch_takes_bootstrap_path(self):
        v = verdict(result(report_digest="sha256:" + "c" * 64), baseline(dataset="other"))
        self.assertEqual(v["status"], "pass", v["reason"])
        self.assertIn("dataset", v["reason"])

    def test_released_rc_without_result_is_bootstrap(self):
        v = gate.aupr_verdict(result(), RC, TAG, baseline=None, baseline_rc="rc-2026.11.03")
        self.assertEqual(v["status"], "pass")
        self.assertIn("rc-2026.11.03 has no dev benchmark result", v["reason"])

    def test_malformed_metrics(self):
        for bad in (None, "0.99", True, float("nan")):
            v = verdict(result(nt_aupr=bad), baseline())
            self.assertEqual(v["status"], "fail", bad)
            self.assertIn("nt_aupr missing or not a number", v["reason"])
        res = result()
        res["metrics"] = None
        self.assertEqual(verdict(res)["status"], "fail")
        res = result()
        del res["metrics"]
        self.assertEqual(verdict(res)["status"], "fail")

    def test_malformed_baseline_metrics_is_bootstrap(self):
        base = baseline()
        base["metrics"] = {"nt_aupr": None}
        v = verdict(result(), base)
        self.assertEqual(v["status"], "pass")
        self.assertFalse(v["comparable"])

    def test_no_usable_result_fails_aupr(self):
        self.assertIn("never started", verdict(None)["reason"])
        self.assertEqual(verdict(result(state="failed"))["status"], "fail")
        self.assertEqual(verdict(result(rc="rc-2026.11.03"))["status"], "fail")

    def test_summary_markdown(self):
        md = gate.summary_markdown(verdict(result(), baseline()))
        self.assertIn("#### aupr: pass", md)
        self.assertIn("| nt_aupr | 0.9900 | 0.9900 | 0.00% |", md)


class BaselineTest(unittest.TestCase):
    RECORDS = [
        {"id": "rc-2026.10.27", "state": "released", "released_at": "2026-10-29T18:00:00Z"},
        {"id": "rc-2026.11.03", "state": "released", "released_at": "2026-11-05T18:00:00Z"},
        {"id": "rc-2026.11.04", "state": "rejected", "released_at": None},
        {"id": "rc-2026.11.05", "state": "staged", "released_at": None},
        {"id": RC, "state": "vetting"},
    ]

    def test_newest_released(self):
        self.assertEqual(gate.select_baseline(self.RECORDS, RC), "rc-2026.11.03")

    def test_none_released(self):
        self.assertIsNone(gate.select_baseline(self.RECORDS[2:], RC))
        self.assertIsNone(gate.select_baseline([], RC))

    def test_excludes_self(self):
        recs = copy.deepcopy(self.RECORDS[:2])
        self.assertEqual(gate.select_baseline(recs, "rc-2026.11.03"), "rc-2026.10.27")

    @unittest.skipUnless(HAVE_YAML, "PyYAML not installed")
    def test_reads_yaml_records(self):
        with tempfile.TemporaryDirectory() as d:
            for rec in self.RECORDS:
                with open(os.path.join(d, rec["id"] + ".yaml"), "w") as fh:
                    yaml.safe_dump(rec, fh)
            with open(os.path.join(d, "empty.yaml"), "w"):
                pass
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                gate.main(["baseline", "--records-dir", d, "--exclude", RC])
            self.assertEqual(out.getvalue().strip(), "rc-2026.11.03")


class CliTest(unittest.TestCase):
    def run_cli(self, *argv):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(gate.main(list(argv)), 0)
        return dict(line.split("=", 1) for line in out.getvalue().splitlines())

    def test_missing_result_file(self):
        o = self.run_cli("pipeline", "--result", "/nonexistent/result.json", "--rc", RC, "--image-tag", TAG)
        self.assertEqual(o["status"], "fail")
        self.assertIn("never started", o["reason"])
        o = self.run_cli(
            "aupr", "--result", "/nonexistent/result.json", "--rc", RC, "--image-tag", TAG,
            "--missing-note", "last S3 error: AccessDenied",
        )  # fmt: skip
        self.assertEqual(o["status"], "fail")
        self.assertIn("no usable benchmark result: last S3 error: AccessDenied", o["reason"])
        self.assertNotIn("never started", o["reason"])

    def test_invalid_json(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "result.json")
            with open(p, "w") as fh:
                fh.write("{not json")
            o = self.run_cli("aupr", "--result", p, "--rc", RC, "--image-tag", TAG)
            self.assertEqual(o["status"], "fail")
            self.assertIn("not valid JSON", o["reason"])

    def test_aupr_writes_verdict_and_summary(self):
        with tempfile.TemporaryDirectory() as d:
            paths = {n: os.path.join(d, n) for n in ("r.json", "b.json", "v.json", "s.md")}
            for name, data in (("r.json", result(nt_aupr=0.97)), ("b.json", baseline())):
                with open(paths[name], "w") as fh:
                    json.dump(data, fh)
            o = self.run_cli(
                "aupr", "--result", paths["r.json"], "--rc", RC, "--image-tag", TAG,
                "--baseline", paths["b.json"], "--baseline-rc", "rc-2026.11.03",
                "--verdict-out", paths["v.json"], "--summary-out", paths["s.md"],
            )  # fmt: skip
            self.assertEqual(o["status"], "fail")
            with open(paths["v.json"]) as fh:
                self.assertEqual(json.load(fh)["status"], "fail")
            with open(paths["s.md"]) as fh:
                self.assertIn("aupr: fail", fh.read())


if __name__ == "__main__":
    unittest.main()
